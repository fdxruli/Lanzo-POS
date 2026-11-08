import { createCanonicalLanzoDatabase } from '../services/db/dexie.js';
import {
  BACKUP_CHUNK_SIZE,
  BACKUP_EXTENSION,
  BACKUP_PREFIX,
  base64ToBytes,
  buildHeader,
  createBackupFileName,
  createTenantFingerprint,
  decryptChunk,
  deriveBackupKey,
  encryptChunk,
  getTenantBackupPrefix,
  parseHeader,
  readEncryptedChunks
} from '../services/backup/backupFormat.js';
import { exportWhitelistedDatabase } from '../services/backup/backupExport.js';
import {
  inspectBackupArchive,
  restoreWhitelistedDatabase
} from '../services/backup/backupRestore.js';
import {
  BACKUP_DATA_CATEGORIES,
  BACKUP_MONITORED_TABLE_NAMES
} from '../services/backup/backupScope.js';
import { countPendingRestoreOperations } from '../services/backup/backupRestore.js';
import {
  LOCAL_TENANT_BINDING_KEY,
  LOCAL_TENANT_BINDING_STORE,
  areLocalTenantAliasesCompatible,
  isTenantWorkerDatabaseName
} from '../services/tenant/localTenantPolicy.js';

let sessionKey = null;
let sessionVerifier = '';
let sessionSalt = '';
let sessionIterations = 600000;
let activeOperation = false;

function postProgress(operation, completed, total, phase) {
  self.postMessage({
    type: 'progress',
    operation,
    progress: total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0,
    phase
  });
}

function normalizeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.message || 'BACKUP_WORKER_ERROR',
    message: error?.message || 'Error interno del worker de respaldo.'
  };
}

async function openSourceDb(context) {
  if (!isTenantWorkerDatabaseName(context?.databaseName)) {
    throw new Error('BACKUP_TENANT_DATABASE_INVALID');
  }
  const database = createCanonicalLanzoDatabase(context.databaseName);
  await database.open();
  return database;
}

async function requireMatchingTenantBinding(database, expectedAliases = []) {
  if (!Array.isArray(expectedAliases) || expectedAliases.length === 0) {
    throw new Error('BACKUP_TENANT_ACCESS_REQUIRED');
  }
  if (!database.tables.some((table) => table.name === LOCAL_TENANT_BINDING_STORE)) {
    throw new Error('BACKUP_TENANT_BINDING_REQUIRED');
  }

  const binding = await database
    .table(LOCAL_TENANT_BINDING_STORE)
    .get(LOCAL_TENANT_BINDING_KEY);
  const boundAliases = binding?.tenantAliases || [binding?.tenantIdentity].filter(Boolean);
  if (
    !binding?.tenantIdentity
    || !areLocalTenantAliasesCompatible(boundAliases, expectedAliases)
  ) {
    throw new Error('BACKUP_TENANT_MISMATCH');
  }
  return binding;
}

async function copyFileToFinal(directoryHandle, sourceFileName, finalFileName) {
  const sourceHandle = await directoryHandle.getFileHandle(sourceFileName);
  const sourceFile = await sourceHandle.getFile();
  const finalHandle = await directoryHandle.getFileHandle(finalFileName, { create: true });
  const writable = await finalHandle.createWritable();
  try {
    await sourceFile.stream().pipeTo(writable);
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // The original error is more useful.
    }
    throw error;
  }
  await directoryHandle.removeEntry(sourceFileName);
}

async function rotateBackups(directoryHandle, tenantFingerprint, keep = 7) {
  const tenantPrefix = getTenantBackupPrefix(tenantFingerprint);
  const files = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'file' && name.startsWith(tenantPrefix) && name.endsWith(BACKUP_EXTENSION)) {
      files.push(name);
    }
  }
  files.sort().reverse();
  await Promise.all(files.slice(keep).map((name) => directoryHandle.removeEntry(name)));
}

async function writeEncryptedExport({
  directoryHandle = null,
  fileName,
  reason = 'manual',
  includeBlob = false,
  context = null,
  excludedBrowserState = null
}) {
  if (!sessionKey) throw new Error('BACKUP_SESSION_LOCKED');

  const database = await openSourceDb(context);
  let exportedBlob;
  let snapshot;
  let schemaVersion;
  try {
    await requireMatchingTenantBinding(database, context.tenantAliases);
    snapshot = await exportWhitelistedDatabase(database, {
      prettyJson: false,
      numRowsPerChunk: 500,
      includeManifest: true,
      progressCallback: ({ completedRows, totalRows }) => {
        postProgress('backup', completedRows, totalRows, 'exporting');
        return true;
      }
    });
    exportedBlob = snapshot.blob;
    schemaVersion = database.verno;
  } finally {
    database.close();
  }

  const tenantFingerprint = await createTenantFingerprint(context.tenantAliases);
  const pendingOperations = Object.values(snapshot.pendingCounts || {}).reduce((total, count) => total + count, 0);
  const partialReasons = [];
  if (pendingOperations > 0) partialReasons.push('pending_operations_require_reconciliation');
  if (snapshot.openCashSessionCount > 0) partialReasons.push('open_cash_sessions_require_reconciliation');
  if (excludedBrowserState?.inspectionComplete === false) partialReasons.push('browser_state_inspection_unavailable');
  if (Object.values(excludedBrowserState?.counts || {}).some((count) => Number(count) > 0)) {
    partialReasons.push('pending_browser_operations_excluded');
  }
  const tableCounts = snapshot.tableCounts;
  const categoryCounts = Object.fromEntries(Object.entries(BACKUP_DATA_CATEGORIES).map(([category, tables]) => (
    [category, tables.reduce((total, name) => total + (tableCounts[name] || 0), 0)]
  )));
  const coverage = {
    complete: partialReasons.length === 0,
    status: partialReasons.length === 0 ? 'complete' : 'partial',
    categories: Object.keys(BACKUP_DATA_CATEGORIES),
    tableCounts,
    categoryCounts,
    pendingOperationCounts: snapshot.pendingCounts,
    openCashSessions: snapshot.openCashSessionCount,
    excludedBrowserState: excludedBrowserState?.counts || {},
    partialReasons
  };
  const actualFileName = fileName || createBackupFileName(new Date(), tenantFingerprint);
  const { header, headerBytes, prefix } = buildHeader({
    createdAt: new Date().toISOString(),
    reason,
    sourceBytes: exportedBlob.size,
    chunkCount: Math.max(1, Math.ceil(exportedBlob.size / BACKUP_CHUNK_SIZE)),
    schemaVersion,
    tenantFingerprint,
    coverage,
    integrity: {
      algorithm: 'AES-GCM-256',
      tagBits: 128,
      chunkSize: BACKUP_CHUNK_SIZE
    },
    salt: sessionSalt,
    iterations: sessionIterations
  });

  const totalChunks = Math.max(1, Math.ceil(exportedBlob.size / BACKUP_CHUNK_SIZE));
  const parts = includeBlob || !directoryHandle ? [prefix] : null;
  const tempName = `${actualFileName}.tmp`;
  let writable = null;

  try {
    if (directoryHandle) {
      const tempHandle = await directoryHandle.getFileHandle(tempName, { create: true });
      writable = await tempHandle.createWritable();
      await writable.write(prefix);
    }

    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * BACKUP_CHUNK_SIZE;
      const plainBytes = new Uint8Array(await exportedBlob.slice(start, start + BACKUP_CHUNK_SIZE).arrayBuffer());
      const encryptedRecord = await encryptChunk(sessionKey, headerBytes, index, plainBytes);
      if (writable) await writable.write(encryptedRecord);
      if (parts) parts.push(encryptedRecord);
      postProgress('backup', index + 1, totalChunks, 'encrypting');
    }

    if (writable) {
      await writable.close();
      writable = null;
      await copyFileToFinal(directoryHandle, tempName, actualFileName);
      await rotateBackups(directoryHandle, tenantFingerprint);
      return {
        mode: 'DIRECTORY',
        fileName: actualFileName,
        header,
        ...(includeBlob && {
          blob: new Blob(parts, { type: 'application/octet-stream' })
        })
      };
    }

    return {
      mode: 'DOWNLOAD',
      fileName: actualFileName,
      header,
      blob: new Blob(parts, { type: 'application/octet-stream' })
    };
  } catch (error) {
    if (writable) {
      try {
        await writable.abort();
      } catch {
        // The original error is more useful.
      }
    }
    if (directoryHandle) {
      try {
        await directoryHandle.removeEntry(tempName);
      } catch {
        // A missing temporary file requires no recovery.
      }
    }
    throw error;
  }
}

async function decryptBackupBlob(blob, pin = null) {
  const { header, headerBytes, dataOffset } = await parseHeader(blob);
  const salt = base64ToBytes(header.salt);
  const keyResult = pin
    ? await deriveBackupKey(pin, salt, header.iterations)
    : { key: sessionKey, verifier: sessionVerifier };
  if (!keyResult.key) throw new Error('BACKUP_SESSION_LOCKED');

  const parts = [];
  const estimatedChunks = Math.max(1, Math.ceil(header.sourceBytes / header.chunkSize));
  let totalBytes = 0;
  let chunkCount = 0;
  for await (const chunk of readEncryptedChunks(blob, dataOffset)) {
    if (chunk.index !== chunkCount || chunk.index >= estimatedChunks) {
      throw new Error('BACKUP_CHUNK_SEQUENCE_INVALID');
    }
    try {
      const plaintext = await decryptChunk(keyResult.key, headerBytes, chunk.index, chunk.iv, chunk.cipherBytes);
      parts.push(plaintext);
      totalBytes += plaintext.byteLength;
    } catch {
      throw new Error('BACKUP_AUTHENTICATION_FAILED');
    }
    chunkCount += 1;
    postProgress('restore', chunk.index + 1, estimatedChunks, 'decrypting');
  }
  if (
    chunkCount !== estimatedChunks
    || (header.chunkCount !== undefined && header.chunkCount !== chunkCount)
    || totalBytes !== header.sourceBytes
  ) {
    throw new Error('BACKUP_INTEGRITY_CHECK_FAILED');
  }
  return { blob: new Blob(parts, { type: 'application/json' }), header, verifier: keyResult.verifier };
}

async function validateBackupTenant(header, context, binding) {
  if (header.version === 1) {
    if (header.dbName !== context.databaseName) {
      throw new Error('BACKUP_TENANT_DATABASE_MISMATCH');
    }
    if (!header.tenantIdentity) throw new Error('BACKUP_TENANT_IDENTITY_MISSING');
    if (!areLocalTenantAliasesCompatible([header.tenantIdentity], context.tenantAliases)) {
      throw new Error('BACKUP_TENANT_MISMATCH');
    }
    if (!areLocalTenantAliasesCompatible(
      binding.tenantAliases || [binding.tenantIdentity],
      context.tenantAliases
    )) throw new Error('BACKUP_TENANT_MISMATCH');
    return;
  }

  const expectedFingerprint = await createTenantFingerprint(context.tenantAliases);
  if (header.tenantFingerprint !== expectedFingerprint) throw new Error('BACKUP_TENANT_MISMATCH');
}

async function inspectBackup(file, pin, context = null) {
  const decrypted = await decryptBackupBlob(file, pin);
  const archiveVersion = decrypted.header.archiveVersion || decrypted.header.version;
  const database = await openSourceDb(context);
  try {
    const binding = await requireMatchingTenantBinding(database, context.tenantAliases);
    await validateBackupTenant(decrypted.header, context, binding);
    const archive = await inspectBackupArchive(decrypted.blob, { formatVersion: archiveVersion });
    if (archive.metadata?.data?.databaseName !== context.databaseName) {
      throw new Error('BACKUP_DATABASE_MISMATCH');
    }
    if (archiveVersion === 2) {
      const declared = decrypted.header.coverage?.tableCounts;
      if (!declared || JSON.stringify(Object.fromEntries(Object.entries(archive.tableCounts).sort()))
        !== JSON.stringify(Object.fromEntries(Object.entries(declared).sort()))) {
        throw new Error('BACKUP_COVERAGE_MANIFEST_MISMATCH');
      }
    }

    const targetCounts = {};
    const targetNames = archive.safeSourceNames.filter((name) => database.tables.some((table) => table.name === name));
    const monitoredNames = BACKUP_MONITORED_TABLE_NAMES.filter((name) => database.tables.some((table) => table.name === name));
    const pendingRows = {};
    await database.transaction('r', [...new Set([...targetNames, ...monitoredNames])].map((name) => database.table(name)), async () => {
      for (const tableName of targetNames) targetCounts[tableName] = await database.table(tableName).count();
      for (const tableName of monitoredNames) pendingRows[tableName] = await database.table(tableName).toArray();
    });
    const destinationPendingOperationCounts = countPendingRestoreOperations(pendingRows);
    const destinationHasBusinessData = Object.values(targetCounts).some((count) => count > 0);
    return {
      header: decrypted.header,
      formatVersion: archiveVersion,
      containerVersion: decrypted.header.version,
      sourceTableCounts: archive.tableCounts,
      sourceTableNames: archive.safeSourceNames,
      coverage: decrypted.header.coverage || {
        complete: false,
        status: 'partial',
        categories: ['catalog', 'sales', 'customers'],
        tableCounts: archive.tableCounts,
        partialReasons: ['legacy_v1_backup_contains_only_original_tables']
      },
      targetTableCounts: targetCounts,
      destinationHasBusinessData,
      destinationPendingOperationCounts
    };
  } finally {
    database.close();
  }
}

async function restoreBackup(file, pin, context = null, expectedDestinationHasBusinessData = false) {
  const decrypted = await decryptBackupBlob(file, pin);
  const archiveVersion = decrypted.header.archiveVersion || decrypted.header.version;
  const database = await openSourceDb(context);
  try {
    const binding = await requireMatchingTenantBinding(database, context.tenantAliases);
    await validateBackupTenant(decrypted.header, context, binding);
    const archive = await inspectBackupArchive(decrypted.blob, { formatVersion: archiveVersion });
    if (archive.metadata?.data?.databaseName !== context.databaseName) throw new Error('BACKUP_DATABASE_MISMATCH');
    const targetNames = archive.safeSourceNames.filter((name) => database.tables.some((table) => table.name === name));
    let destinationHasBusinessData = false;
    const monitoredNames = BACKUP_MONITORED_TABLE_NAMES.filter((name) => database.tables.some((table) => table.name === name));
    const pendingRows = {};
    await database.transaction('r', [...new Set([...targetNames, ...monitoredNames])].map((name) => database.table(name)), async () => {
      for (const tableName of targetNames) {
        if (await database.table(tableName).count() > 0) destinationHasBusinessData = true;
      }
      for (const tableName of monitoredNames) pendingRows[tableName] = await database.table(tableName).toArray();
    });
    const destinationPendingOperationCounts = countPendingRestoreOperations(pendingRows);
    if (destinationHasBusinessData !== (expectedDestinationHasBusinessData === true)) {
      throw new Error('BACKUP_DESTINATION_CHANGED_REVIEW_AGAIN');
    }
    if (Object.values(destinationPendingOperationCounts).some((count) => count > 0)) {
      throw new Error('BACKUP_RESTORE_PENDING_OPERATIONS');
    }
    const restored = await restoreWhitelistedDatabase(database, decrypted.blob, {
      expectedDatabaseName: context.databaseName,
      formatVersion: archiveVersion,
      progressCallback: ({ completedRows, totalRows }) => {
        postProgress('restore', completedRows, totalRows, 'importing');
        return true;
      }
    });
    return {
      restored: true,
      header: decrypted.header,
      restoredTables: restored.restoredTables,
      partial: restored.partial || archiveVersion === 1,
      coverage: decrypted.header.coverage || null
    };
  } finally {
    database.close();
  }
}

async function reencryptDirectory(directoryHandle, newPin, newSaltBytes, iterations, context) {
  if (!sessionKey) throw new Error('BACKUP_SESSION_LOCKED');
  const tenantFingerprint = await createTenantFingerprint(context.tenantAliases);
  const tenantPrefix = getTenantBackupPrefix(tenantFingerprint);
  const next = await deriveBackupKey(newPin, newSaltBytes, iterations);
  const candidates = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind !== 'file' || !name.endsWith(BACKUP_EXTENSION) || !name.startsWith(BACKUP_PREFIX)) continue;
    const isCurrentTenantFile = name.startsWith(tenantPrefix);
    const isUnscopedLegacyFile = name.startsWith(BACKUP_PREFIX) && !/^RESPALDO_LANZO_[a-f0-9]{64}_/i.test(name);
    if (isCurrentTenantFile || isUnscopedLegacyFile) candidates.push({ name, handle, isCurrentTenantFile });
  }
  candidates.sort((left, right) => left.name.localeCompare(right.name));

  const created = [];
  const migratedSourceNames = [];
  try {
    for (let fileIndex = 0; fileIndex < candidates.length; fileIndex += 1) {
      const candidate = candidates[fileIndex];
      const source = await candidate.handle.getFile();
      let decrypted;
      try {
        decrypted = await decryptBackupBlob(source);
      } catch (error) {
        if (candidate.isCurrentTenantFile) throw error;
        continue;
      }
      const bindingDatabase = await openSourceDb(context);
      try {
        const binding = await requireMatchingTenantBinding(bindingDatabase, context.tenantAliases);
        try {
          await validateBackupTenant(decrypted.header, context, binding);
        } catch (error) {
          if (candidate.isCurrentTenantFile) throw error;
          continue;
        }
      } finally {
        bindingDatabase.close();
      }
      const safeHeader = { ...decrypted.header };
      ['dbName', 'tenantIdentity', 'format', 'version'].forEach((field) => delete safeHeader[field]);
      const rekeyName = candidate.isCurrentTenantFile
        ? `${tenantPrefix}${candidate.name.slice(tenantPrefix.length, -BACKUP_EXTENSION.length)}_rekey_${Date.now()}${BACKUP_EXTENSION}`
        : createBackupFileName(new Date(Date.now() + fileIndex), tenantFingerprint);
      const tempName = `${rekeyName}.tmp`;
      const { headerBytes, prefix } = buildHeader({
        ...safeHeader,
        createdAt: new Date().toISOString(),
        reencryptedAt: new Date().toISOString(),
        tenantFingerprint,
        archiveVersion: decrypted.header.archiveVersion || decrypted.header.version,
        ...(decrypted.header.version === 1 && {
          coverage: {
            complete: false,
            status: 'partial',
            categories: ['catalog', 'sales', 'customers'],
            tableCounts: {},
            categoryCounts: {},
            partialReasons: ['legacy_v1_backup_contains_only_original_tables']
          }
        }),
        salt: btoa(String.fromCharCode(...newSaltBytes)),
        iterations
      });
      const tempHandle = await directoryHandle.getFileHandle(tempName, { create: true });
      const writable = await tempHandle.createWritable();
      await writable.write(prefix);
      const totalChunks = Math.max(1, Math.ceil(decrypted.blob.size / BACKUP_CHUNK_SIZE));
      for (let index = 0; index < totalChunks; index += 1) {
        const plain = new Uint8Array(await decrypted.blob.slice(index * BACKUP_CHUNK_SIZE, (index + 1) * BACKUP_CHUNK_SIZE).arrayBuffer());
        await writable.write(await encryptChunk(next.key, headerBytes, index, plain));
      }
      await writable.close();
      await copyFileToFinal(directoryHandle, tempName, rekeyName);
      created.push(rekeyName);
      migratedSourceNames.push(candidate.name);

      const verifiedHandle = await directoryHandle.getFileHandle(rekeyName);
      const verified = await decryptBackupBlob(await verifiedHandle.getFile(), newPin);
      if (verified.header.tenantFingerprint !== tenantFingerprint) throw new Error('BACKUP_TENANT_MISMATCH');
      postProgress('rekey', fileIndex + 1, candidates.length, 'reencrypting');
    }

    await Promise.allSettled(migratedSourceNames.map((name) => directoryHandle.removeEntry(name)));
    sessionKey = next.key;
    sessionVerifier = next.verifier;
    sessionSalt = btoa(String.fromCharCode(...newSaltBytes));
    sessionIterations = iterations;
    try {
      await rotateBackups(directoryHandle, tenantFingerprint);
    } catch {
      // Rekeyed files are already verified; cleanup can be retried later.
    }
    return {
      key: next.key,
      verifier: next.verifier,
      files: created.length,
      lastFileName: created.at(-1) || ''
    };
  } catch (error) {
    await Promise.all(created.map(async (name) => {
      try {
        await directoryHandle.removeEntry(name);
      } catch {
        // Preserve the original error.
      }
    }));
    throw error;
  }
}

async function handleMessage(message) {
  switch (message.command) {
    case 'unlock': {
      const salt = base64ToBytes(message.payload.salt);
      const result = await deriveBackupKey(message.payload.pin, salt, message.payload.iterations);
      if (message.payload.expectedVerifier && result.verifier !== message.payload.expectedVerifier) {
        throw new Error('BACKUP_PIN_INVALID');
      }
      sessionKey = result.key;
      sessionVerifier = result.verifier;
      sessionSalt = message.payload.salt;
      sessionIterations = message.payload.iterations;
      return { key: result.key, verifier: result.verifier };
    }
    case 'resume': {
      const { key, verifier, salt, iterations } = message.payload;
      if (
        key?.type !== 'secret'
        || key.extractable
        || key.algorithm?.name !== 'AES-GCM'
        || !key.usages?.includes('encrypt')
        || !key.usages?.includes('decrypt')
      ) {
        throw new Error('BACKUP_PERSISTED_KEY_INVALID');
      }
      sessionKey = key;
      sessionVerifier = verifier;
      sessionSalt = salt;
      sessionIterations = iterations;
      return { resumed: true };
    }
    case 'lock':
      sessionKey = null;
      sessionVerifier = '';
      return { locked: true };
    case 'backup':
      return writeEncryptedExport(message.payload);
    case 'restore':
      return restoreBackup(
        message.payload.file,
        message.payload.pin,
        message.payload.context,
        message.payload.expectedDestinationHasBusinessData
      );
    case 'inspect':
      return inspectBackup(
        message.payload.file,
        message.payload.pin,
        message.payload.context
      );
    case 'rekey':
      return reencryptDirectory(
        message.payload.directoryHandle,
        message.payload.newPin,
        base64ToBytes(message.payload.newSalt),
        message.payload.iterations,
        { databaseName: message.payload.databaseName, tenantAliases: message.payload.tenantAliases }
      );
    default:
      throw new Error('BACKUP_UNKNOWN_COMMAND');
  }
}

self.onmessage = async (event) => {
  const { id } = event.data;
  if (activeOperation) {
    self.postMessage({ id, type: 'error', error: normalizeError(new Error('BACKUP_OPERATION_IN_PROGRESS')) });
    return;
  }
  activeOperation = !['lock', 'unlock'].includes(event.data.command);
  try {
    const result = await handleMessage(event.data);
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: normalizeError(error) });
  } finally {
    activeOperation = false;
  }
};
