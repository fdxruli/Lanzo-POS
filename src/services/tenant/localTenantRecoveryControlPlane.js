import Dexie from 'dexie';
import {
  createCanonicalLanzoDatabase
} from '../db/dexie';
import {
  CURRENT_NATIVE_DATABASE_VERSION,
  LOCAL_TENANT_BINDING_DEXIE_VERSION
} from '../db/databaseSchema';
import { resolveActiveTenantIdentity } from './localTenantGuard';
import { areLocalTenantAliasesCompatible } from './localTenantPolicy';
import {
  createRecoveryContextFingerprint,
  inspectLegacyVaultAndBuildRecoveryPlan
} from './localTenantRecoveryPlan';
import { createRecoveryCopyManifest } from './localTenantRecoveryCopyManifest';

export const RECOVERY_CONTROL_DB_NAME = 'LanzoRecoveryControl';
export const RECOVERY_JOURNAL_VERSION = 1;
export const RECOVERY_DESTINATION_NAMESPACE_VERSION = 1;

export const RECOVERY_JOURNAL_STATE = Object.freeze({
  CREATED: 'CREATED',
  DESTINATION_NAMESPACE_RESERVED: 'DESTINATION_NAMESPACE_RESERVED',
  DESTINATION_READY: 'DESTINATION_READY',
  DESTINATION_SCHEMA_INSTALLING: 'DESTINATION_SCHEMA_INSTALLING',
  DESTINATION_SCHEMA_READY: 'DESTINATION_SCHEMA_READY',
  COPY_MANIFEST_BUILDING: 'COPY_MANIFEST_BUILDING',
  COPY_MANIFEST_READY: 'COPY_MANIFEST_READY',
  FAILED_RESUMABLE: 'FAILED_RESUMABLE',
  CANCELLED: 'CANCELLED'
});

const DIRECTORY_STORE = 'tenant_destination_directory';
const ALIAS_STORE = 'tenant_destination_aliases';
const JOURNAL_STORE = 'recovery_run_journal';
const ALIAS_TOKEN_DOMAIN = 'lanzo-local-recovery-destination-alias-v1';
const DESTINATION_SCHEMA_FINGERPRINT_DOMAIN = 'lanzo-local-recovery-destination-schema-v1';
const COPY_MANIFEST_STATES = new Set([
  RECOVERY_JOURNAL_STATE.COPY_MANIFEST_BUILDING,
  RECOVERY_JOURNAL_STATE.COPY_MANIFEST_READY
]);
const ALIAS_TYPE = Object.freeze({
  LICENSE_ID: 'license_id',
  LICENSE_KEY_SHA256: 'license_key_sha256'
});
const OPAQUE_ALIAS_PREFIX = Object.freeze({
  [ALIAS_TYPE.LICENSE_ID]: 'license-id:',
  [ALIAS_TYPE.LICENSE_KEY_SHA256]: 'license-key-sha256:'
});

const controlError = (code, details = {}) => Object.assign(new Error(code), { code, details });
const isForwardPhaseState = (state) => (
  state === RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_INSTALLING ||
  state === RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY ||
  COPY_MANIFEST_STATES.has(state)
);
const now = () => new Date().toISOString();
const bytesToHex = (value) => Array.from(new Uint8Array(value))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const digest = async (value, cryptoProvider = globalThis.crypto) => {
  if (!cryptoProvider?.subtle?.digest) throw controlError('RECOVERY_CONTROL_CRYPTO_UNAVAILABLE');
  const result = await cryptoProvider.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value))
  );
  return bytesToHex(result);
};

const stableJson = (value) => JSON.stringify(value);

const normalizeKeyPath = (keyPath) => (
  Array.isArray(keyPath) ? [...keyPath] : keyPath ?? null
);

const normalizeNativeStore = (store) => ({
  name: store.name,
  primaryKey: {
    keyPath: normalizeKeyPath(store.keyPath),
    autoIncrement: store.autoIncrement === true
  },
  indexes: Array.from(store.indexNames).sort().map((name) => {
    const index = store.index(name);
    return {
      name,
      keyPath: normalizeKeyPath(index.keyPath),
      unique: index.unique === true,
      multiEntry: index.multiEntry === true
    };
  })
});

const requestResult = (request, code) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(controlError(code));
});

const inspectPhysicalDestinationSchema = async (name, { requireExisting = true } = {}) => {
  if (requireExisting) await assertDestinationNamespaceExists(name);
  const database = await openDestinationNamespace(name);
  try {
    const storeNames = Array.from(database.objectStoreNames).sort();
    const stores = storeNames.map((storeName) => {
      const transaction = database.transaction(storeName, 'readonly');
      return normalizeNativeStore(transaction.objectStore(storeName));
    });
    const counts = {};
    for (const storeName of storeNames) {
      const transaction = database.transaction(storeName, 'readonly');
      counts[storeName] = await requestResult(
        transaction.objectStore(storeName).count(),
        'RECOVERY_DESTINATION_SCHEMA_INSPECTION_FAILED'
      );
    }
    return {
      nativeVersion: database.version,
      stores,
      counts,
      totalRows: Object.values(counts).reduce((total, count) => total + count, 0)
    };
  } finally {
    database.close();
  }
};

const describeDeclaredCanonicalSchema = () => {
  const database = createCanonicalLanzoDatabase('__lanzo_recovery_schema_descriptor__');
  try {
    return {
      dexieVersion: LOCAL_TENANT_BINDING_DEXIE_VERSION,
      nativeVersion: CURRENT_NATIVE_DATABASE_VERSION,
      stores: database.tables.map((table) => ({
        name: table.name,
        primaryKey: {
          keyPath: normalizeKeyPath(table.schema.primKey.keyPath),
          autoIncrement: table.schema.primKey.auto === true
        },
        indexes: table.schema.indexes.map((index) => ({
          name: index.name,
          keyPath: normalizeKeyPath(index.keyPath),
          unique: index.unique === true,
          multiEntry: index.multi === true
        })).sort((left, right) => left.name.localeCompare(right.name))
      })).sort((left, right) => left.name.localeCompare(right.name))
    };
  } finally {
    database.close();
  }
};

export const describeCanonicalRecoveryDestinationSchema = () => (
  Object.freeze(describeDeclaredCanonicalSchema())
);

const descriptorFromPhysicalInspection = (inspection) => ({
  dexieVersion: LOCAL_TENANT_BINDING_DEXIE_VERSION,
  nativeVersion: inspection.nativeVersion,
  stores: inspection.stores
});

const fingerprintDestinationSchema = async (descriptor, cryptoProvider) => (
  `sha256:${await digest({ domain: DESTINATION_SCHEMA_FINGERPRINT_DOMAIN, descriptor }, cryptoProvider)}`
);

const aliasToken = async (alias, cryptoProvider) => (
  `alias-token:${await digest([ALIAS_TOKEN_DOMAIN, alias], cryptoProvider)}`
);

const aliasTypeFor = (alias) => {
  if (alias.startsWith('license-id:')) return ALIAS_TYPE.LICENSE_ID;
  if (alias.startsWith('license-key-sha256:')) return ALIAS_TYPE.LICENSE_KEY_SHA256;
  throw controlError('RECOVERY_DESTINATION_ALIAS_TYPE_UNSUPPORTED');
};

const typedAliasTokens = async (aliases, cryptoProvider) => Promise.all(
  [...new Set(aliases)].sort().map(async (alias) => ({
    aliasToken: await aliasToken(alias, cryptoProvider),
    aliasType: aliasTypeFor(alias)
  }))
);

const opaqueCompatibilityAliases = (entries) => entries.map((entry) => {
  const prefix = OPAQUE_ALIAS_PREFIX[entry.aliasType];
  if (!prefix || !entry.aliasToken) throw controlError('RECOVERY_DESTINATION_ALIAS_INCOMPATIBLE');
  return `${prefix}${entry.aliasToken}`;
});

const areTypedAliasTokensCompatible = (existingEntries, incomingEntries) => (
  areLocalTenantAliasesCompatible(
    opaqueCompatibilityAliases(existingEntries),
    opaqueCompatibilityAliases(incomingEntries)
  )
);

const randomOpaqueId = (cryptoProvider = globalThis.crypto) => {
  if (typeof cryptoProvider?.randomUUID === 'function') return cryptoProvider.randomUUID().replaceAll('-', '');
  if (typeof cryptoProvider?.getRandomValues === 'function') {
    return bytesToHex(cryptoProvider.getRandomValues(new Uint8Array(16)));
  }
  throw controlError('RECOVERY_CONTROL_RANDOM_UNAVAILABLE');
};

export const destinationDatabaseName = (tenantDatabaseId) => `LanzoDB_t_${tenantDatabaseId}`;

export const createRecoveryControlDatabase = (name = RECOVERY_CONTROL_DB_NAME) => {
  const database = new Dexie(name);
  database.version(1).stores({
    [DIRECTORY_STORE]: 'tenantDatabaseId, createdAt',
    [ALIAS_STORE]: '&aliasToken, tenantDatabaseId',
    [JOURNAL_STORE]: 'runId, tenantDatabaseId, state, updatedAt, [tenantDatabaseId+state]'
  });
  database.version(2).stores({
    [DIRECTORY_STORE]: 'tenantDatabaseId, createdAt',
    [ALIAS_STORE]: '&aliasToken, tenantDatabaseId, aliasType',
    [JOURNAL_STORE]: 'runId, tenantDatabaseId, state, updatedAt, [tenantDatabaseId+state]'
  });
  return database;
};

const requireEligibleRecoveryPlan = (recoveryPlan) => {
  if (!recoveryPlan) throw controlError('RECOVERY_PLAN_REQUIRED');
  if (recoveryPlan.browserStorageInspection?.status !== 'COMPLETE') {
    throw controlError('RECOVERY_STORAGE_INSPECTION_NOT_COMPLETE');
  }
  if (recoveryPlan.preconditionFailure === 'RECOVERY_SOURCE_ALREADY_BOUND') {
    throw controlError('RECOVERY_SOURCE_ALREADY_BOUND');
  }
  if (recoveryPlan.unknownStores?.length > 0) throw controlError('UNKNOWN_STORE_PRESENT');
  if (recoveryPlan.executableForFutureCopy !== true) {
    throw controlError('RECOVERY_PLAN_NOT_EXECUTABLE');
  }
  if (!recoveryPlan.sourceSnapshotFingerprint || !recoveryPlan.recoveryContextFingerprint) {
    throw controlError('RECOVERY_FINGERPRINT_REQUIRED');
  }
};

const openDestinationNamespace = async (name) => {
  if (!globalThis.indexedDB?.open) throw controlError('RECOVERY_DESTINATION_NAMESPACE_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    // Omitting a requested version lets an existing database reveal its real
    // native version instead of forcing a versionchange during inspection.
    const request = globalThis.indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(controlError('RECOVERY_DESTINATION_NAMESPACE_UNAVAILABLE'));
  });
};

const assertDestinationNamespaceExists = async (name) => {
  if (typeof globalThis.indexedDB?.databases !== 'function') {
    throw controlError('RECOVERY_DESTINATION_NAMESPACE_INSPECTION_UNAVAILABLE');
  }
  const databases = await globalThis.indexedDB.databases();
  if (!databases.some((database) => database.name === name)) {
    throw controlError('RECOVERY_DESTINATION_NAMESPACE_MISSING');
  }
};

const inspectOrReserveEmptyDestinationNamespace = async ({ name, requireExisting = false }) => {
  if (requireExisting) await assertDestinationNamespaceExists(name);
  const database = await openDestinationNamespace(name);
  try {
    // RECOVERY.2A reserves an empty namespace only: no object stores, data or
    // schema are created here. A later isolated schema-factory phase owns that.
    if (database.version !== RECOVERY_DESTINATION_NAMESPACE_VERSION) {
      throw controlError('RECOVERY_DESTINATION_NAMESPACE_VERSION_MISMATCH');
    }
    if (database.objectStoreNames.length !== 0) {
      throw controlError('RECOVERY_DESTINATION_NAMESPACE_NOT_EMPTY');
    }
  } finally {
    database.close();
  }
};

const latestResumableJournal = (journals) => (
  [...journals]
    .filter((journal) => journal.state !== RECOVERY_JOURNAL_STATE.CANCELLED)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] || null
);

const assertJournalMatchesPlan = (journal, recoveryPlan) => {
  if (journal.sourceSnapshotFingerprint !== recoveryPlan.sourceSnapshotFingerprint) {
    throw controlError('RECOVERY_SOURCE_SNAPSHOT_CHANGED');
  }
  if (journal.recoveryContextFingerprint !== recoveryPlan.recoveryContextFingerprint) {
    throw controlError('RECOVERY_TENANT_CONTEXT_CHANGED');
  }
};

const reserveDirectoryAndJournal = async ({ controlDatabase, identity, recoveryPlan, cryptoProvider }) => {
  const tokens = await typedAliasTokens(identity.aliases, cryptoProvider);
  const directory = controlDatabase.table(DIRECTORY_STORE);
  const aliasesTable = controlDatabase.table(ALIAS_STORE);
  const journals = controlDatabase.table(JOURNAL_STORE);

  return controlDatabase.transaction('rw', directory, aliasesTable, journals, async () => {
    const existingAliases = await aliasesTable.where('aliasToken').anyOf(tokens.map((entry) => entry.aliasToken)).toArray();
    const destinations = [...new Set(existingAliases.map((entry) => entry.tenantDatabaseId))];
    if (destinations.length > 1) throw controlError('RECOVERY_DESTINATION_ALIAS_CONFLICT');

    let tenantDatabaseId = destinations[0];
    let existingDirectory = tenantDatabaseId ? await directory.get(tenantDatabaseId) : null;
    if (tenantDatabaseId) {
      const destinationAliases = await aliasesTable.where('tenantDatabaseId').equals(tenantDatabaseId).toArray();
      if (!areTypedAliasTokensCompatible(destinationAliases, tokens)) {
        throw controlError('RECOVERY_DESTINATION_ALIAS_INCOMPATIBLE');
      }
    }
    if (!tenantDatabaseId) {
      // A random collision must not let a previously unknown tenant attach to
      // another tenant's namespace. The directory is the durable authority.
      for (let attempts = 0; existingDirectory || !tenantDatabaseId; attempts += 1) {
        if (attempts >= 8) throw controlError('RECOVERY_DESTINATION_ID_UNAVAILABLE');
        tenantDatabaseId = randomOpaqueId(cryptoProvider);
        existingDirectory = await directory.get(tenantDatabaseId);
      }
    }
    if (!existingDirectory) {
      await directory.put({ tenantDatabaseId, createdAt: now(), updatedAt: now() });
    }

    for (const token of tokens) {
      const existing = await aliasesTable.get(token.aliasToken);
      if (existing && existing.tenantDatabaseId !== tenantDatabaseId) {
        throw controlError('RECOVERY_DESTINATION_ALIAS_CONFLICT');
      }
      if (!existing) {
        await aliasesTable.put({
          aliasToken: token.aliasToken,
          aliasType: token.aliasType,
          tenantDatabaseId,
          createdAt: now()
        });
      }
    }

    const existingJournal = latestResumableJournal(await journals.where('tenantDatabaseId').equals(tenantDatabaseId).toArray());
    if (existingJournal) return { tenantDatabaseId, journal: existingJournal, resumed: true };

    const timestamp = now();
    const journal = {
      runId: randomOpaqueId(cryptoProvider),
      journalVersion: RECOVERY_JOURNAL_VERSION,
      tenantDatabaseId,
      sourceSnapshotFingerprint: recoveryPlan.sourceSnapshotFingerprint,
      recoveryContextFingerprint: recoveryPlan.recoveryContextFingerprint,
      recoveryPlanVersion: recoveryPlan.version,
      state: RECOVERY_JOURNAL_STATE.CREATED,
      checkpoints: { createdAt: timestamp },
      failureReason: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await journals.put(journal);
    return { tenantDatabaseId, journal, resumed: false };
  });
};

const updateJournal = async (controlDatabase, runId, update) => {
  const journal = await controlDatabase.table(JOURNAL_STORE).get(runId);
  if (!journal) throw controlError('RECOVERY_JOURNAL_NOT_FOUND');
  const timestamp = now();
  const next = {
    ...journal,
    ...update,
    checkpoints: { ...journal.checkpoints, ...(update.checkpoints || {}) },
    updatedAt: timestamp
  };
  await controlDatabase.table(JOURNAL_STORE).put(next);
  return next;
};

const findExistingRecoveryJournalForIdentity = async ({
  controlDatabase,
  identity,
  cryptoProvider
}) => {
  const tokens = await typedAliasTokens(identity.aliases, cryptoProvider);
  const aliases = await controlDatabase.table(ALIAS_STORE).where('aliasToken').anyOf(
    tokens.map((entry) => entry.aliasToken)
  ).toArray();
  const destinations = [...new Set(aliases.map((entry) => entry.tenantDatabaseId))];
  if (destinations.length !== 1) return null;
  const journal = latestResumableJournal(await controlDatabase.table(JOURNAL_STORE)
    .where('tenantDatabaseId').equals(destinations[0]).toArray());
  return journal ? { tenantDatabaseId: destinations[0], journal } : null;
};

/**
 * RECOVERY.2A control-plane entry point. It has no legacy database argument
 * and therefore cannot obtain a write-capable LanzoDB1 handle or copy rows.
 */
export const createOrResumeRecoveryInfrastructure = async ({
  controlDatabase,
  recoveryPlan,
  activeTenantSource,
  cryptoProvider = globalThis.crypto,
  destinationNamespaceFactory = inspectOrReserveEmptyDestinationNamespace
} = {}) => {
  if (!controlDatabase?.transaction) throw controlError('RECOVERY_CONTROL_DATABASE_REQUIRED');
  requireEligibleRecoveryPlan(recoveryPlan);
  await controlDatabase.open();
  const identity = await resolveActiveTenantIdentity(activeTenantSource, cryptoProvider);
  const currentContextFingerprint = await createRecoveryContextFingerprint({
    sourceSnapshotFingerprint: recoveryPlan.sourceSnapshotFingerprint,
    activeTenantAliases: identity.aliases,
    cryptoProvider
  });
  if (currentContextFingerprint !== recoveryPlan.recoveryContextFingerprint) {
    throw controlError('RECOVERY_TENANT_CONTEXT_CHANGED');
  }
  const existingBeforeReservation = await findExistingRecoveryJournalForIdentity({
    controlDatabase, identity, cryptoProvider
  });
  if (
    isForwardPhaseState(existingBeforeReservation?.journal.state) ||
    (existingBeforeReservation?.journal.state === RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE &&
      existingBeforeReservation.journal.failureStage === 'COPY_MANIFEST')
  ) {
    throw controlError('RECOVERY_DESTINATION_PHASE_ADVANCED');
  }
  const reservation = await reserveDirectoryAndJournal({
    controlDatabase,
    identity,
    recoveryPlan,
    cryptoProvider
  });
  let journal = reservation.journal;
  const name = destinationDatabaseName(reservation.tenantDatabaseId);

  if (reservation.resumed) assertJournalMatchesPlan(journal, recoveryPlan);

  if (isForwardPhaseState(journal.state)) {
    // RECOVERY.2A owns only the empty v1 namespace. An advanced journal is
    // intentionally left untouched for RECOVERY.2B to revalidate.
    throw controlError('RECOVERY_DESTINATION_PHASE_ADVANCED');
  }

  const wasReady = journal.state === RECOVERY_JOURNAL_STATE.DESTINATION_READY;
  if (!wasReady) {
    journal = await updateJournal(controlDatabase, journal.runId, {
      state: RECOVERY_JOURNAL_STATE.DESTINATION_NAMESPACE_RESERVED,
      failureReason: null,
      checkpoints: { destinationNamespaceReservedAt: now() }
    });
  }
  try {
    await destinationNamespaceFactory({
      name,
      tenantDatabaseId: reservation.tenantDatabaseId,
      requireExisting: wasReady
    });
    if (!wasReady) {
      journal = await updateJournal(controlDatabase, journal.runId, {
        state: RECOVERY_JOURNAL_STATE.DESTINATION_READY,
        checkpoints: { destinationReadyAt: now() }
      });
    }
  } catch (error) {
    await updateJournal(controlDatabase, journal.runId, {
      state: RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE,
      failureReason: error?.code || 'RECOVERY_DESTINATION_NAMESPACE_FAILED',
      checkpoints: { destinationFailureAt: now() }
    });
    throw error;
  }

  return Object.freeze({
    tenantDatabaseId: reservation.tenantDatabaseId,
    destinationDatabaseName: name,
    journal,
    resumed: reservation.resumed
  });
};

const resolveExistingRecoveryJournal = async ({
  controlDatabase,
  identity,
  recoveryPlan,
  cryptoProvider
}) => {
  const aliasesTable = controlDatabase.table(ALIAS_STORE);
  const directory = controlDatabase.table(DIRECTORY_STORE);
  const journals = controlDatabase.table(JOURNAL_STORE);
  const tokens = await typedAliasTokens(identity.aliases, cryptoProvider);
  const existingAliases = await aliasesTable.where('aliasToken').anyOf(
    tokens.map((entry) => entry.aliasToken)
  ).toArray();
  const destinations = [...new Set(existingAliases.map((entry) => entry.tenantDatabaseId))];
  if (destinations.length !== 1) throw controlError('RECOVERY_DESTINATION_READY_REQUIRED');
  const tenantDatabaseId = destinations[0];
  const destinationAliases = await aliasesTable.where('tenantDatabaseId').equals(tenantDatabaseId).toArray();
  if (!areTypedAliasTokensCompatible(destinationAliases, tokens)) {
    throw controlError('RECOVERY_DESTINATION_ALIAS_INCOMPATIBLE');
  }
  if (!await directory.get(tenantDatabaseId)) throw controlError('RECOVERY_DESTINATION_DIRECTORY_MISSING');
  const journal = latestResumableJournal(await journals.where('tenantDatabaseId').equals(tenantDatabaseId).toArray());
  if (!journal) throw controlError('RECOVERY_DESTINATION_READY_REQUIRED');
  assertJournalMatchesPlan(journal, recoveryPlan);
  return { tenantDatabaseId, journal };
};

const isEmptyReservationInspection = (inspection) => (
  inspection.nativeVersion === RECOVERY_DESTINATION_NAMESPACE_VERSION &&
  inspection.stores.length === 0 &&
  inspection.totalRows === 0
);

const installCanonicalDestinationSchema = async (name) => {
  const destination = createCanonicalLanzoDatabase(name);
  try {
    await destination.open();
  } finally {
    destination.close();
  }
};

const schemaFailure = async ({ controlDatabase, journal, error }) => {
  await updateJournal(controlDatabase, journal.runId, {
    state: RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE,
    failureStage: 'DESTINATION_SCHEMA',
    failureReason: error?.code || 'RECOVERY_DESTINATION_SCHEMA_FAILED',
    checkpoints: { destinationSchemaFailureAt: now() }
  });
};

const verifyCanonicalDestinationSchema = async ({
  name,
  expectedDescriptor,
  expectedFingerprint,
  persistedFingerprint = null,
  requirePersistedFingerprint = false,
  cryptoProvider
}) => {
  const inspection = await inspectPhysicalDestinationSchema(name, { requireExisting: true });
  const actualDescriptor = descriptorFromPhysicalInspection(inspection);
  const actualFingerprint = await fingerprintDestinationSchema(actualDescriptor, cryptoProvider);
  if (requirePersistedFingerprint && !persistedFingerprint) {
    throw controlError('RECOVERY_DESTINATION_SCHEMA_FINGERPRINT_MISSING');
  }
  if (persistedFingerprint && persistedFingerprint !== expectedFingerprint) {
    throw controlError('RECOVERY_DESTINATION_SCHEMA_CODE_CHANGED');
  }
  if (
    stableJson(actualDescriptor) !== stableJson(expectedDescriptor) ||
    actualFingerprint !== expectedFingerprint ||
    inspection.totalRows !== 0
  ) {
    throw controlError('RECOVERY_DESTINATION_SCHEMA_MISMATCH');
  }
  return { inspection, actualFingerprint };
};

/**
 * RECOVERY.2B installs and verifies only the canonical destination schema.
 * It never receives a LanzoDB1 handle and does not activate the destination.
 */
export const createOrResumeRecoveryDestinationSchema = async ({
  controlDatabase,
  recoveryPlan,
  activeTenantSource,
  cryptoProvider = globalThis.crypto,
  installSchema = installCanonicalDestinationSchema
} = {}) => {
  if (!controlDatabase?.transaction) throw controlError('RECOVERY_CONTROL_DATABASE_REQUIRED');
  requireEligibleRecoveryPlan(recoveryPlan);
  await controlDatabase.open();
  const identity = await resolveActiveTenantIdentity(activeTenantSource, cryptoProvider);
  const currentContextFingerprint = await createRecoveryContextFingerprint({
    sourceSnapshotFingerprint: recoveryPlan.sourceSnapshotFingerprint,
    activeTenantAliases: identity.aliases,
    cryptoProvider
  });
  if (currentContextFingerprint !== recoveryPlan.recoveryContextFingerprint) {
    throw controlError('RECOVERY_TENANT_CONTEXT_CHANGED');
  }

  const resolved = await resolveExistingRecoveryJournal({
    controlDatabase, identity, recoveryPlan, cryptoProvider
  });
  let journal = resolved.journal;
  const name = destinationDatabaseName(resolved.tenantDatabaseId);
  const expectedDescriptor = describeDeclaredCanonicalSchema();
  const expectedFingerprint = await fingerprintDestinationSchema(expectedDescriptor, cryptoProvider);

  if (COPY_MANIFEST_STATES.has(journal.state)) {
    throw controlError('RECOVERY_DESTINATION_PHASE_ADVANCED');
  }

  if (journal.state === RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY) {
    try {
      const verified = await verifyCanonicalDestinationSchema({
        name,
        expectedDescriptor,
        expectedFingerprint,
        persistedFingerprint: journal.destinationSchemaFingerprint,
        requirePersistedFingerprint: true,
        cryptoProvider
      });
      return Object.freeze({
        tenantDatabaseId: resolved.tenantDatabaseId,
        destinationDatabaseName: name,
        journal: { ...journal, destinationSchemaFingerprint: verified.actualFingerprint },
        resumed: true
      });
    } catch (error) {
      await schemaFailure({ controlDatabase, journal, error });
      throw error;
    }
  }

  if (journal.state === RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE && journal.failureStage !== 'DESTINATION_SCHEMA') {
    throw controlError('RECOVERY_DESTINATION_FAILURE_STAGE_NOT_RESUMABLE');
  }
  if (![
    RECOVERY_JOURNAL_STATE.DESTINATION_READY,
    RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_INSTALLING,
    RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE
  ].includes(journal.state)) {
    throw controlError('RECOVERY_DESTINATION_READY_REQUIRED');
  }

  try {
    const before = await inspectPhysicalDestinationSchema(name, { requireExisting: true });
    const beforeDescriptor = descriptorFromPhysicalInspection(before);
    const beforeFingerprint = await fingerprintDestinationSchema(beforeDescriptor, cryptoProvider);
    const isCanonical = stableJson(beforeDescriptor) === stableJson(expectedDescriptor)
      && beforeFingerprint === expectedFingerprint
      && before.totalRows === 0;
    if (!isCanonical && !isEmptyReservationInspection(before)) {
      throw controlError('RECOVERY_DESTINATION_SCHEMA_MISMATCH');
    }

    if (journal.state !== RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_INSTALLING) {
      journal = await updateJournal(controlDatabase, journal.runId, {
        state: RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_INSTALLING,
        failureReason: null,
        failureStage: null,
        checkpoints: { destinationSchemaInstallingAt: now() }
      });
    }

    if (!isCanonical) await installSchema(name);
    const verified = await verifyCanonicalDestinationSchema({
      name, expectedDescriptor, expectedFingerprint, cryptoProvider
    });
    journal = await updateJournal(controlDatabase, journal.runId, {
      state: RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY,
      failureReason: null,
      failureStage: null,
      destinationSchemaFingerprint: verified.actualFingerprint,
      destinationDexieVersion: LOCAL_TENANT_BINDING_DEXIE_VERSION,
      destinationNativeVersion: CURRENT_NATIVE_DATABASE_VERSION,
      checkpoints: { destinationSchemaReadyAt: now() }
    });
    return Object.freeze({
      tenantDatabaseId: resolved.tenantDatabaseId,
      destinationDatabaseName: name,
      journal,
      resumed: resolved.journal.state !== RECOVERY_JOURNAL_STATE.DESTINATION_READY
    });
  } catch (error) {
    await schemaFailure({ controlDatabase, journal, error });
    throw error;
  }
};

const copyManifestFailure = async ({ controlDatabase, journal, error }) => {
  await updateJournal(controlDatabase, journal.runId, {
    state: RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE,
    failureStage: 'COPY_MANIFEST',
    failureReason: error?.code || 'RECOVERY_COPY_MANIFEST_FAILED',
    checkpoints: { copyManifestFailureAt: now() }
  });
};

const manifestLockMetadata = (manifest) => ({
  copyManifestVersion: manifest.version,
  copyManifestFingerprint: manifest.manifestFingerprint,
  copyManifestItemCount: manifest.copyItemCount,
  copyManifestStoreCounts: manifest.copyItemsByStore,
  copyManifestExcludedCounts: manifest.excludedCounts,
  copyManifestRecomputeSummary: manifest.recomputeSummary
});

const hasManifestLock = (journal) => Boolean(journal.copyManifestFingerprint);

const assertManifestLockMatches = (journal, manifest) => {
  if (!hasManifestLock(journal)) return;
  const expected = manifestLockMetadata(manifest);
  if (
    journal.copyManifestVersion !== expected.copyManifestVersion ||
    journal.copyManifestFingerprint !== expected.copyManifestFingerprint ||
    journal.copyManifestItemCount !== expected.copyManifestItemCount ||
    stableJson(journal.copyManifestStoreCounts) !== stableJson(expected.copyManifestStoreCounts) ||
    stableJson(journal.copyManifestExcludedCounts) !== stableJson(expected.copyManifestExcludedCounts) ||
    stableJson(journal.copyManifestRecomputeSummary) !== stableJson(expected.copyManifestRecomputeSummary)
  ) {
    throw controlError('RECOVERY_COPY_MANIFEST_CHANGED');
  }
};

const verifyDestinationForCopyManifest = async ({ name, journal, cryptoProvider }) => {
  const expectedDescriptor = describeDeclaredCanonicalSchema();
  const expectedFingerprint = await fingerprintDestinationSchema(expectedDescriptor, cryptoProvider);
  if (!journal.destinationSchemaFingerprint) {
    throw controlError('RECOVERY_DESTINATION_SCHEMA_FINGERPRINT_MISSING');
  }
  return verifyCanonicalDestinationSchema({
    name,
    expectedDescriptor,
    expectedFingerprint,
    persistedFingerprint: journal.destinationSchemaFingerprint,
    requirePersistedFingerprint: true,
    cryptoProvider
  });
};

/**
 * RECOVERY.2C produces only a deterministic, redacted manifest. The supplied
 * adapter owns a native readonly source read; this control plane never accepts
 * a source database write handle and never writes a destination business row.
 */
export const createOrResumeRecoveryCopyManifest = async ({
  controlDatabase,
  recoveryPlan,
  activeTenantSource,
  sourceAdapter,
  cryptoProvider = globalThis.crypto,
  createManifest = createRecoveryCopyManifest
} = {}) => {
  if (!controlDatabase?.transaction) throw controlError('RECOVERY_CONTROL_DATABASE_REQUIRED');
  if (!sourceAdapter?.readSnapshot) throw controlError('RECOVERY_READONLY_ADAPTER_REQUIRED');
  requireEligibleRecoveryPlan(recoveryPlan);
  await controlDatabase.open();
  const identity = await resolveActiveTenantIdentity(activeTenantSource, cryptoProvider);
  const currentContextFingerprint = await createRecoveryContextFingerprint({
    sourceSnapshotFingerprint: recoveryPlan.sourceSnapshotFingerprint,
    activeTenantAliases: identity.aliases,
    cryptoProvider
  });
  if (currentContextFingerprint !== recoveryPlan.recoveryContextFingerprint) {
    throw controlError('RECOVERY_TENANT_CONTEXT_CHANGED');
  }
  const resolved = await resolveExistingRecoveryJournal({
    controlDatabase, identity, recoveryPlan, cryptoProvider
  });
  let journal = resolved.journal;
  const name = destinationDatabaseName(resolved.tenantDatabaseId);
  if (journal.state === RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE && journal.failureStage !== 'COPY_MANIFEST') {
    throw controlError('RECOVERY_DESTINATION_FAILURE_STAGE_NOT_RESUMABLE');
  }
  if (![
    RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY,
    RECOVERY_JOURNAL_STATE.COPY_MANIFEST_BUILDING,
    RECOVERY_JOURNAL_STATE.COPY_MANIFEST_READY,
    RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE
  ].includes(journal.state)) {
    throw controlError('RECOVERY_DESTINATION_SCHEMA_READY_REQUIRED');
  }

  try {
    const destination = await verifyDestinationForCopyManifest({ name, journal, cryptoProvider });
    const revalidatedPlan = await inspectLegacyVaultAndBuildRecoveryPlan({
      adapter: sourceAdapter,
      activeTenantSource,
      cryptoProvider
    });
    const manifest = await createManifest({
      recoveryPlan,
      revalidatedPlan,
      destinationSchemaFingerprint: destination.actualFingerprint,
      cryptoProvider
    });

    assertManifestLockMatches(journal, manifest);

    if (journal.state === RECOVERY_JOURNAL_STATE.COPY_MANIFEST_READY) {
      return Object.freeze({
        tenantDatabaseId: resolved.tenantDatabaseId,
        destinationDatabaseName: name,
        journal,
        manifest,
        resumed: true
      });
    }

    if (journal.state !== RECOVERY_JOURNAL_STATE.COPY_MANIFEST_BUILDING) {
      journal = await updateJournal(controlDatabase, journal.runId, {
        state: RECOVERY_JOURNAL_STATE.COPY_MANIFEST_BUILDING,
        failureReason: null,
        failureStage: null,
        ...manifestLockMetadata(manifest),
        checkpoints: { copyManifestBuildingAt: now() }
      });
    }
    journal = await updateJournal(controlDatabase, journal.runId, {
      state: RECOVERY_JOURNAL_STATE.COPY_MANIFEST_READY,
      failureReason: null,
      failureStage: null,
      ...manifestLockMetadata(manifest),
      destinationSchemaFingerprint: destination.actualFingerprint,
      checkpoints: { copyManifestReadyAt: now() }
    });
    return Object.freeze({
      tenantDatabaseId: resolved.tenantDatabaseId,
      destinationDatabaseName: name,
      journal,
      manifest,
      resumed: resolved.journal.state !== RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY
    });
  } catch (error) {
    await copyManifestFailure({ controlDatabase, journal, error });
    throw error;
  }
};

export const listRecoveryControlMetadata = async (controlDatabase) => {
  await controlDatabase.open();
  const [directory, aliases, journals] = await Promise.all([
    controlDatabase.table(DIRECTORY_STORE).toArray(),
    controlDatabase.table(ALIAS_STORE).toArray(),
    controlDatabase.table(JOURNAL_STORE).toArray()
  ]);
  return { directory, aliases, journals };
};
