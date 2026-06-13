import Dexie from 'dexie';
import { exportDB, importInto, peakImportFile } from 'dexie-export-import';
import { DB_NAME } from '../config/dbConfig.js';
import {
  BACKUP_CHUNK_SIZE,
  BACKUP_EXTENSION,
  BACKUP_PREFIX,
  base64ToBytes,
  buildHeader,
  createBackupFileName,
  decryptChunk,
  deriveBackupKey,
  encryptChunk,
  parseHeader,
  readEncryptedChunks
} from '../services/backup/backupFormat.js';

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

async function openSourceDb() {
  const database = new Dexie(DB_NAME);
  await database.open();
  return database;
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

async function rotateBackups(directoryHandle, keep = 7) {
  const files = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'file' && name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_EXTENSION)) {
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
  includeBlob = false
}) {
  if (!sessionKey) throw new Error('BACKUP_SESSION_LOCKED');

  const database = await openSourceDb();
  let exportedBlob;
  try {
    exportedBlob = await exportDB(database, {
      prettyJson: false,
      numRowsPerChunk: 500,
      progressCallback: ({ completedRows, totalRows }) => {
        postProgress('backup', completedRows, totalRows, 'exporting');
        return true;
      }
    });
  } finally {
    database.close();
  }

  const actualFileName = fileName || createBackupFileName();
  const { header, headerBytes, prefix } = buildHeader({
    createdAt: new Date().toISOString(),
    dbName: DB_NAME,
    reason,
    sourceBytes: exportedBlob.size,
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
      await rotateBackups(directoryHandle);
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
  for await (const chunk of readEncryptedChunks(blob, dataOffset)) {
    try {
      parts.push(await decryptChunk(keyResult.key, headerBytes, chunk.index, chunk.iv, chunk.cipherBytes));
    } catch {
      throw new Error('BACKUP_AUTHENTICATION_FAILED');
    }
    postProgress('restore', chunk.index + 1, estimatedChunks, 'decrypting');
  }
  return { blob: new Blob(parts, { type: 'application/json' }), header, verifier: keyResult.verifier };
}

async function restoreBackup(file, pin) {
  const decrypted = await decryptBackupBlob(file, pin);
  const metadata = await peakImportFile(decrypted.blob);
  if (metadata?.data?.databaseName && metadata.data.databaseName !== DB_NAME) {
    throw new Error('BACKUP_DATABASE_MISMATCH');
  }

  const database = await openSourceDb();
  try {
    await importInto(database, decrypted.blob, {
      clearTablesBeforeImport: true,
      overwriteValues: true,
      acceptNameDiff: false,
      progressCallback: ({ completedRows, totalRows }) => {
        postProgress('restore', completedRows, totalRows, 'importing');
        return true;
      }
    });
  } finally {
    database.close();
  }
  return { restored: true, header: decrypted.header };
}

async function reencryptDirectory(directoryHandle, newPin, newSaltBytes, iterations) {
  if (!sessionKey) throw new Error('BACKUP_SESSION_LOCKED');
  const next = await deriveBackupKey(newPin, newSaltBytes, iterations);
  const candidates = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'file' && name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_EXTENSION)) {
      candidates.push({ name, handle });
    }
  }
  candidates.sort((left, right) => left.name.localeCompare(right.name));

  const created = [];
  try {
    for (let fileIndex = 0; fileIndex < candidates.length; fileIndex += 1) {
      const candidate = candidates[fileIndex];
      const source = await candidate.handle.getFile();
      const decrypted = await decryptBackupBlob(source);
      const rekeyName = `${BACKUP_PREFIX}REKEY_${Date.now()}_${fileIndex}${BACKUP_EXTENSION}`;
      const tempName = `${rekeyName}.tmp`;
      const { headerBytes, prefix } = buildHeader({
        ...decrypted.header,
        createdAt: new Date().toISOString(),
        reencryptedAt: new Date().toISOString(),
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

      const verifiedHandle = await directoryHandle.getFileHandle(rekeyName);
      await decryptBackupBlob(await verifiedHandle.getFile(), newPin);
      postProgress('rekey', fileIndex + 1, candidates.length, 'reencrypting');
    }

    await Promise.allSettled(candidates.map((candidate) => directoryHandle.removeEntry(candidate.name)));
    sessionKey = next.key;
    sessionVerifier = next.verifier;
    sessionSalt = btoa(String.fromCharCode(...newSaltBytes));
    sessionIterations = iterations;
    try {
      await rotateBackups(directoryHandle);
    } catch {
      // Rekeyed files are already verified; cleanup can be retried later.
    }
    return { verifier: next.verifier, files: created.length, lastFileName: created.at(-1) || '' };
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
      return { verifier: result.verifier };
    }
    case 'lock':
      sessionKey = null;
      sessionVerifier = '';
      return { locked: true };
    case 'backup':
      return writeEncryptedExport(message.payload);
    case 'restore':
      return restoreBackup(message.payload.file, message.payload.pin);
    case 'rekey':
      return reencryptDirectory(
        message.payload.directoryHandle,
        message.payload.newPin,
        base64ToBytes(message.payload.newSalt),
        message.payload.iterations
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
