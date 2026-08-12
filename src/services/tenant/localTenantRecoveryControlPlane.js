import Dexie from 'dexie';
import { resolveActiveTenantIdentity } from './localTenantGuard';
import { areLocalTenantAliasesCompatible } from './localTenantPolicy';
import { createRecoveryContextFingerprint } from './localTenantRecoveryPlan';

export const RECOVERY_CONTROL_DB_NAME = 'LanzoRecoveryControl';
export const RECOVERY_JOURNAL_VERSION = 1;

export const RECOVERY_JOURNAL_STATE = Object.freeze({
  CREATED: 'CREATED',
  DESTINATION_NAMESPACE_RESERVED: 'DESTINATION_NAMESPACE_RESERVED',
  DESTINATION_READY: 'DESTINATION_READY',
  FAILED_RESUMABLE: 'FAILED_RESUMABLE',
  CANCELLED: 'CANCELLED'
});

const DIRECTORY_STORE = 'tenant_destination_directory';
const ALIAS_STORE = 'tenant_destination_aliases';
const JOURNAL_STORE = 'recovery_run_journal';
const ALIAS_TOKEN_DOMAIN = 'lanzo-local-recovery-destination-alias-v1';
const ALIAS_TYPE = Object.freeze({
  LICENSE_ID: 'license_id',
  LICENSE_KEY_SHA256: 'license_key_sha256'
});
const OPAQUE_ALIAS_PREFIX = Object.freeze({
  [ALIAS_TYPE.LICENSE_ID]: 'license-id:',
  [ALIAS_TYPE.LICENSE_KEY_SHA256]: 'license-key-sha256:'
});

const controlError = (code, details = {}) => Object.assign(new Error(code), { code, details });
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

const ensureEmptyDestinationNamespace = async ({ name }) => {
  if (!globalThis.indexedDB?.open) throw controlError('RECOVERY_DESTINATION_NAMESPACE_UNAVAILABLE');
  const database = await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(name, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(controlError('RECOVERY_DESTINATION_NAMESPACE_UNAVAILABLE'));
  });
  try {
    // RECOVERY.2A reserves an empty namespace only: no object stores, data or
    // schema are created here. A later isolated schema-factory phase owns that.
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

/**
 * RECOVERY.2A control-plane entry point. It has no legacy database argument
 * and therefore cannot obtain a write-capable LanzoDB1 handle or copy rows.
 */
export const createOrResumeRecoveryInfrastructure = async ({
  controlDatabase,
  recoveryPlan,
  activeTenantSource,
  cryptoProvider = globalThis.crypto,
  destinationNamespaceFactory = ensureEmptyDestinationNamespace
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
  const reservation = await reserveDirectoryAndJournal({
    controlDatabase,
    identity,
    recoveryPlan,
    cryptoProvider
  });
  let journal = reservation.journal;
  const name = destinationDatabaseName(reservation.tenantDatabaseId);

  if (reservation.resumed) assertJournalMatchesPlan(journal, recoveryPlan);

  if (journal.state === RECOVERY_JOURNAL_STATE.DESTINATION_READY) {
    return Object.freeze({ tenantDatabaseId: reservation.tenantDatabaseId, destinationDatabaseName: name, journal, resumed: true });
  }

  journal = await updateJournal(controlDatabase, journal.runId, {
    state: RECOVERY_JOURNAL_STATE.DESTINATION_NAMESPACE_RESERVED,
    failureReason: null,
    checkpoints: { destinationNamespaceReservedAt: now() }
  });
  try {
    await destinationNamespaceFactory({ name, tenantDatabaseId: reservation.tenantDatabaseId });
    journal = await updateJournal(controlDatabase, journal.runId, {
      state: RECOVERY_JOURNAL_STATE.DESTINATION_READY,
      checkpoints: { destinationReadyAt: now() }
    });
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

export const listRecoveryControlMetadata = async (controlDatabase) => {
  await controlDatabase.open();
  const [directory, aliases, journals] = await Promise.all([
    controlDatabase.table(DIRECTORY_STORE).toArray(),
    controlDatabase.table(ALIAS_STORE).toArray(),
    controlDatabase.table(JOURNAL_STORE).toArray()
  ]);
  return { directory, aliases, journals };
};
