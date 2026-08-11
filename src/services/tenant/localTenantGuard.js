import { db as defaultDatabase } from '../db/dexie';
import { ensureLocalDatabaseReady } from '../db/databaseRuntime';
import {
  DEVICE_SCOPED_SYNC_CACHE_KEYS,
  LOCAL_TENANT_BINDING_KEY,
  LOCAL_TENANT_BINDING_STORE,
  LOCAL_TENANT_ERROR_CODES,
  LOCAL_TENANT_STATUS,
  LOCAL_STORE_SCOPE,
  TENANT_OWNED_LOCAL_STORAGE_KEYS,
  TENANT_OWNED_LOCAL_STORAGE_PREFIXES,
  TENANT_OWNED_SESSION_STORAGE_KEYS,
  LocalTenantAccessError,
  areLocalTenantAliasesCompatible,
  createLocalTenantAccessController,
  getLocalStoreScope,
  isLocalTenantAccessError,
  localTenantAccessController
} from './localTenantPolicy';

const BINDING_VERSION = 1;
const MAX_SNAPSHOT_RETRIES = 3;
const EVIDENCE_STORES = new Set(['company', 'sync_outbox', 'sync_meta', 'sync_cache']);
const LEGACY_AUTO_ADOPTION_STORES = new Set(['company']);
const NULL_TOMBSTONE_SYNC_CACHE_KEYS = new Set([
  'device_security_token',
  'staff_session_token',
  'staff_session_id',
  'admin_session_token',
  'admin_session_id',
  'last_valid_admin_session',
  'last_valid_license_state',
  'security_monotonic_clock'
]);
const SYNC_META_SUFFIXES = [
  'pos_last_change_seq',
  'pos_sync_enabled',
  'pos_last_full_pull_at',
  'pos_realtime_status',
  'pos_last_pull_at',
  'pos_last_pull_error'
];
const STORAGE_ACCESS_DENIED = Symbol('LOCAL_TENANT_STORAGE_ACCESS_DENIED');

const normalizeLicenseKey = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

const normalizeLicenseId = (value) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const pickLicenseKey = (source) => {
  if (typeof source === 'string') return normalizeLicenseKey(source);
  return normalizeLicenseKey(
    source?.license_key ||
    source?.licenseKey ||
    source?.details?.license_key ||
    source?.details?.licenseKey
  );
};

const pickLicenseId = (source) => normalizeLicenseId(
  source?.license_id ||
  source?.licenseId ||
  source?.details?.license_id ||
  source?.details?.licenseId
);

const bytesToHex = (bytes) => Array.from(bytes)
  .map((value) => value.toString(16).padStart(2, '0'))
  .join('');

export const resolveActiveTenantIdentity = async (
  source,
  cryptoProvider = globalThis.crypto
) => {
  const licenseId = pickLicenseId(source);
  const licenseKey = pickLicenseKey(source);
  const aliases = [];

  if (licenseId) aliases.push(`license-id:${licenseId}`);

  if (licenseKey) {
    if (!cryptoProvider?.subtle?.digest) {
      throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.IDENTITY_UNAVAILABLE, {
        reason: 'sha256_unavailable'
      });
    }

    const digest = await cryptoProvider.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(licenseKey)
    );
    aliases.push(`license-key-sha256:${bytesToHex(new Uint8Array(digest))}`);
  }

  if (aliases.length === 0) {
    throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.IDENTITY_MISSING, {
      reason: 'license_identity_missing'
    });
  }

  return {
    primary: aliases[0],
    aliases: [...new Set(aliases)],
    authority: licenseId ? 'license_id' : 'license_key_sha256'
  };
};

const requestToPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('INDEXEDDB_REQUEST_FAILED'));
});

const isMeaningfulSyncCacheRecord = (record) => {
  const key = record?.key;
  if (DEVICE_SCOPED_SYNC_CACHE_KEYS.has(key)) return false;
  if (
    NULL_TOMBSTONE_SYNC_CACHE_KEYS.has(key) &&
    (record?.value === null || record?.value === undefined) &&
    record?.data === undefined
  ) {
    return false;
  }
  return true;
};

const parseStoredJson = (rawValue) => {
  try {
    return { parsed: true, value: JSON.parse(rawValue) };
  } catch {
    return { parsed: false, value: null };
  }
};

const collectionHasEntries = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
};

const isMeaningfulTenantLocalStorageValue = (key, rawValue) => {
  if (typeof rawValue !== 'string') return false;
  if (key === 'lanzo_cash_opening_policy') return true;
  if (TENANT_OWNED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (rawValue.length === 0) return false;

  const decoded = parseStoredJson(rawValue);
  // Corrupt/unknown legacy business payloads are data, not an empty cache.
  if (!decoded.parsed) return true;

  if (key === 'lanzo-active-orders-storage') {
    const state = decoded.value?.state || decoded.value || {};
    return collectionHasEntries(state.activeOrders) || Boolean(state.currentOrderId);
  }

  if (key === 'lanzo:restaurant-order-close-pending:v1') {
    return collectionHasEntries(decoded.value);
  }

  if (key === 'ignored_expirations_ttl') {
    return collectionHasEntries(decoded.value);
  }

  // These are legacy cart/inventory payloads. Empty arrays/objects are safe;
  // any nested/primitive state is conservatively treated as business data.
  if (Array.isArray(decoded.value)) return decoded.value.length > 0;
  if (decoded.value && typeof decoded.value === 'object') {
    const state = decoded.value.state || decoded.value;
    const keys = Object.keys(state).filter((item) => item !== 'version');
    if (keys.length === 0) return false;
    return keys.some((item) => {
      const value = state[item];
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object') return Object.keys(value).length > 0;
      return value !== null && value !== undefined && value !== '' && value !== false;
    });
  }

  return Boolean(decoded.value);
};

const getDefaultBrowserStorage = () => {
  if (typeof globalThis.window === 'undefined') return null;
  try {
    return globalThis.window.localStorage;
  } catch {
    return STORAGE_ACCESS_DENIED;
  }
};

const getDefaultSessionStorage = () => {
  if (typeof globalThis.window === 'undefined') return null;
  try {
    return globalThis.window.sessionStorage;
  } catch {
    return STORAGE_ACCESS_DENIED;
  }
};

const readTenantOwnedBrowserStorageSnapshot = (browserStorage) => {
  if (browserStorage === STORAGE_ACCESS_DENIED) {
    throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.STORAGE_INSPECTION_FAILED, {
      reason: 'local_storage_access_denied'
    });
  }
  if (!browserStorage) return { counts: {}, occupiedStores: [] };

  const counts = {};
  const occupiedStores = [];

  try {
    for (let index = 0; index < browserStorage.length; index += 1) {
      const key = browserStorage.key(index);
      const isTenantOwned = TENANT_OWNED_LOCAL_STORAGE_KEYS.has(key) ||
        TENANT_OWNED_LOCAL_STORAGE_PREFIXES.some((prefix) => key?.startsWith(prefix));
      if (!isTenantOwned) continue;

      let rawValue = null;
      try {
        rawValue = browserStorage.getItem(key);
      } catch {
        throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.STORAGE_INSPECTION_FAILED, {
          reason: 'local_storage_record_read_failed'
        });
      }

      if (!isMeaningfulTenantLocalStorageValue(key, rawValue)) continue;
      const location = `localStorage:${key}`;
      counts[location] = 1;
      occupiedStores.push(location);
    }
  } catch (error) {
    if (isLocalTenantAccessError(error)) throw error;
    throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.STORAGE_INSPECTION_FAILED, {
      reason: 'local_storage_enumeration_failed'
    });
  }

  return { counts, occupiedStores: occupiedStores.sort() };
};

const readTenantOwnedSessionStorageSnapshot = (sessionStorage) => {
  if (sessionStorage === STORAGE_ACCESS_DENIED) {
    throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.STORAGE_INSPECTION_FAILED, {
      reason: 'session_storage_access_denied'
    });
  }
  if (!sessionStorage) return { counts: {}, occupiedStores: [] };
  const counts = {};
  const occupiedStores = [];

  for (const key of TENANT_OWNED_SESSION_STORAGE_KEYS) {
    try {
      const rawValue = sessionStorage.getItem(key);
      if (typeof rawValue !== 'string' || rawValue.length === 0) continue;
      const location = `sessionStorage:${key}`;
      counts[location] = 1;
      occupiedStores.push(location);
    } catch {
      throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.STORAGE_INSPECTION_FAILED, {
        reason: 'session_storage_inspection_failed'
      });
    }
  }

  return { counts, occupiedStores };
};

const addEvidence = (collector, value, source) => {
  const normalized = normalizeLicenseKey(value);
  if (!normalized || normalized.toLowerCase() === 'legacy') return;
  collector.keys.add(normalized);
  collector.sources.add(source);
};

const collectRecordEvidence = (collector, record, source) => {
  addEvidence(collector, record?.license_key, source);
  addEvidence(collector, record?.licenseKey, source);
  addEvidence(collector, record?.details?.license_key, source);
  addEvidence(collector, record?.details?.licenseKey, source);
};

const collectEvidence = (recordsByStore) => {
  const collector = { keys: new Set(), sources: new Set() };
  const ownershipCollector = { keys: new Set(), sources: new Set() };
  let ownershipEvidenceComplete = (recordsByStore.company || []).length > 0;

  for (const record of recordsByStore.company || []) {
    const recordOwnership = { keys: new Set(), sources: new Set() };
    collectRecordEvidence(collector, record, 'company.license_key');
    collectRecordEvidence(ownershipCollector, record, 'company.license_key');
    collectRecordEvidence(recordOwnership, record, 'company.license_key');
    if (typeof record?.id === 'string' && record.id.startsWith('company:')) {
      addEvidence(collector, record.id.slice('company:'.length), 'company.scoped_id');
      addEvidence(ownershipCollector, record.id.slice('company:'.length), 'company.scoped_id');
      addEvidence(recordOwnership, record.id.slice('company:'.length), 'company.scoped_id');
    }
    if (recordOwnership.keys.size !== 1) ownershipEvidenceComplete = false;
  }

  for (const record of recordsByStore.sync_outbox || []) {
    collectRecordEvidence(collector, record, 'sync_outbox.licenseKey');
    addEvidence(collector, record?.metadata?.licenseKey, 'sync_outbox.metadata');
    addEvidence(collector, record?.metadata?.license_key, 'sync_outbox.metadata');
  }

  for (const record of recordsByStore.sync_meta || []) {
    const key = typeof record?.key === 'string' ? record.key : '';
    const suffix = SYNC_META_SUFFIXES.find((item) => key.endsWith(`:${item}`));
    if (suffix) addEvidence(collector, key.slice(0, -(suffix.length + 1)), 'sync_meta.scoped_key');
    collectRecordEvidence(collector, record, 'sync_meta.record');
  }

  for (const record of recordsByStore.sync_cache || []) {
    collectRecordEvidence(collector, record, 'sync_cache.record');
    collectRecordEvidence(collector, record?.value, 'sync_cache.value');
    collectRecordEvidence(collector, record?.value?.payload, 'sync_cache.validated_payload');
    collectRecordEvidence(collector, record?.value?.payload?.details, 'sync_cache.validated_payload');

    if (typeof record?.key === 'string' && record.key.startsWith('devices_')) {
      addEvidence(collector, record.key.slice('devices_'.length), 'sync_cache.devices_key');
    }
  }

  return {
    ...collector,
    ownershipKeys: ownershipCollector.keys,
    ownershipSources: ownershipCollector.sources,
    ownershipEvidenceComplete
  };
};

const normalizeBinding = (record) => {
  if (!record?.tenantIdentity) return null;
  const aliases = Array.isArray(record.tenantAliases)
    ? record.tenantAliases.filter(Boolean)
    : [record.tenantIdentity];
  return {
    ...record,
    tenantAliases: [...new Set([record.tenantIdentity, ...aliases])]
  };
};

const buildSnapshot = ({ binding, storeResults, browserStorageSnapshot }) => {
  const recordsByStore = {};
  const counts = { ...(browserStorageSnapshot?.counts || {}) };

  for (const result of storeResults) {
    if (Array.isArray(result.value)) {
      recordsByStore[result.storeName] = result.value;
      counts[result.storeName] = result.storeName === 'sync_cache'
        ? result.value.filter(isMeaningfulSyncCacheRecord).length
        : result.value.length;
    } else {
      counts[result.storeName] = Number(result.value) || 0;
    }
  }

  const evidence = collectEvidence(recordsByStore);
  const occupiedStores = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([storeName]) => storeName)
    .sort();
  const unscopedLegacyStores = occupiedStores.filter(
    (storeName) => !LEGACY_AUTO_ADOPTION_STORES.has(storeName)
  );

  return {
    binding: normalizeBinding(binding),
    counts,
    occupiedStores,
    hasTenantOwnedData: occupiedStores.length > 0,
    evidenceKeys: [...evidence.keys].sort(),
    evidenceSources: [...evidence.sources].sort(),
    ownershipEvidenceKeys: [...evidence.ownershipKeys].sort(),
    ownershipEvidenceSources: [...evidence.ownershipSources].sort(),
    ownershipEvidenceComplete: evidence.ownershipEvidenceComplete,
    unscopedLegacyStores
  };
};

const getNativeStoreNames = (nativeDatabase) => Array.from(nativeDatabase.objectStoreNames);

const queueSnapshotRequests = (
  transaction,
  storeNames,
  browserStorage,
  tenantSessionStorage
) => {
  const bindingRequest = storeNames.includes(LOCAL_TENANT_BINDING_STORE)
    ? requestToPromise(
      transaction.objectStore(LOCAL_TENANT_BINDING_STORE).get(LOCAL_TENANT_BINDING_KEY)
    )
    : Promise.resolve(null);

  const tenantStoreNames = storeNames.filter(
    (name) => getLocalStoreScope(name) === LOCAL_STORE_SCOPE.TENANT_OWNED
  );
  const storeRequests = tenantStoreNames.map((storeName) => {
    const objectStore = transaction.objectStore(storeName);
    const request = EVIDENCE_STORES.has(storeName) ? objectStore.getAll() : objectStore.count();
    return requestToPromise(request).then((value) => ({ storeName, value }));
  });

  return Promise.all([bindingRequest, Promise.all(storeRequests)])
    .then(([binding, storeResults]) => {
      const localSnapshot = readTenantOwnedBrowserStorageSnapshot(browserStorage);
      const sessionSnapshot = readTenantOwnedSessionStorageSnapshot(tenantSessionStorage);
      return buildSnapshot({
        binding,
        storeResults,
        browserStorageSnapshot: {
          counts: { ...localSnapshot.counts, ...sessionSnapshot.counts },
          occupiedStores: [
            ...localSnapshot.occupiedStores,
            ...sessionSnapshot.occupiedStores
          ].sort()
        }
      });
    });
};

const readNativeSnapshot = (
  nativeDatabase,
  browserStorage,
  tenantSessionStorage
) => new Promise((resolve, reject) => {
  const storeNames = getNativeStoreNames(nativeDatabase);
  const transaction = nativeDatabase.transaction(storeNames, 'readonly');
  let snapshot = null;

  transaction.oncomplete = () => resolve(snapshot);
  transaction.onerror = () => reject(transaction.error || new Error('LOCAL_TENANT_INSPECTION_FAILED'));
  transaction.onabort = () => reject(transaction.error || new Error('LOCAL_TENANT_INSPECTION_ABORTED'));

  queueSnapshotRequests(transaction, storeNames, browserStorage, tenantSessionStorage)
    .then((value) => {
      snapshot = value;
    })
    .catch((error) => {
      reject(error);
      try { transaction.abort(); } catch { /* transaction already closed */ }
    });
});

const comparableSnapshot = (snapshot) => JSON.stringify({
  binding: snapshot?.binding
    ? {
      tenantIdentity: snapshot.binding.tenantIdentity,
      tenantAliases: [...snapshot.binding.tenantAliases].sort(),
      bindingVersion: snapshot.binding.bindingVersion
    }
    : null,
  counts: snapshot?.counts || {},
  evidenceKeys: snapshot?.evidenceKeys || [],
  ownershipEvidenceKeys: snapshot?.ownershipEvidenceKeys || [],
  ownershipEvidenceComplete: snapshot?.ownershipEvidenceComplete === true,
  unscopedLegacyStores: snapshot?.unscopedLegacyStores || []
});

const buildBindingRecord = (identity, source) => {
  const now = new Date().toISOString();
  return {
    key: LOCAL_TENANT_BINDING_KEY,
    tenantIdentity: identity.primary,
    tenantAliases: [...identity.aliases],
    authority: identity.authority,
    bindingVersion: BINDING_VERSION,
    source,
    createdAt: now,
    updatedAt: now
  };
};

const commitBindingIfUnchanged = (
  nativeDatabase,
  expectedSnapshot,
  bindingRecord,
  browserStorage,
  tenantSessionStorage
) => (
  new Promise((resolve, reject) => {
    const storeNames = getNativeStoreNames(nativeDatabase);
    const transaction = nativeDatabase.transaction(storeNames, 'readwrite');
    let committedSnapshot = null;
    let rejected = false;

    transaction.oncomplete = () => {
      if (!rejected) resolve(committedSnapshot);
    };
    transaction.onerror = () => reject(transaction.error || new Error('LOCAL_TENANT_BINDING_FAILED'));
    transaction.onabort = () => {
      if (!rejected) reject(transaction.error || new Error('LOCAL_TENANT_BINDING_ABORTED'));
    };

    queueSnapshotRequests(transaction, storeNames, browserStorage, tenantSessionStorage)
      .then((currentSnapshot) => {
        if (comparableSnapshot(currentSnapshot) !== comparableSnapshot(expectedSnapshot)) {
          rejected = true;
          reject(new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SNAPSHOT_CHANGED, {
            reason: 'local_snapshot_changed'
          }));
          transaction.abort();
          return;
        }

        const putRequest = transaction
          .objectStore(LOCAL_TENANT_BINDING_STORE)
          .put(bindingRecord);

        requestToPromise(putRequest)
          .then(() => {
            committedSnapshot = {
              ...currentSnapshot,
              binding: normalizeBinding(bindingRecord)
            };
          })
          .catch((error) => {
            rejected = true;
            reject(error);
            try { transaction.abort(); } catch { /* transaction already closed */ }
          });
      })
      .catch((error) => {
        rejected = true;
        reject(error);
        try { transaction.abort(); } catch { /* transaction already closed */ }
      });
  })
);

const bindingMatchesIdentity = (binding, identity) => {
  return areLocalTenantAliasesCompatible(
    binding?.tenantAliases || [],
    identity?.aliases || []
  );
};

const identitiesOverlap = (left, right) => areLocalTenantAliasesCompatible(
  left?.aliases || [],
  right?.aliases || []
);

const publicInspection = (snapshot) => ({
  hasTenantOwnedData: snapshot.hasTenantOwnedData,
  occupiedStores: [...snapshot.occupiedStores],
  counts: { ...snapshot.counts },
  evidenceCount: snapshot.evidenceKeys.length,
  evidenceSources: [...snapshot.evidenceSources],
  binding: snapshot.binding
    ? {
      authority: snapshot.binding.authority,
      bindingVersion: snapshot.binding.bindingVersion,
      source: snapshot.binding.source
    }
    : null
});

const createBlockedError = (code, snapshot, reason) => new LocalTenantAccessError(code, {
  reason,
  hasTenantOwnedData: snapshot.hasTenantOwnedData,
  occupiedStores: snapshot.occupiedStores,
  unscopedLegacyStores: snapshot.unscopedLegacyStores,
  evidenceSources: snapshot.evidenceSources,
  evidenceCount: snapshot.evidenceKeys.length
});

export const createLocalTenantGuard = ({
  database = defaultDatabase,
  controller = database === defaultDatabase
    ? localTenantAccessController
    : createLocalTenantAccessController(),
  cryptoProvider = globalThis.crypto,
  browserStorage = getDefaultBrowserStorage(),
  tenantSessionStorage = getDefaultSessionStorage(),
  ensureReady = database === defaultDatabase
    ? ensureLocalDatabaseReady
    : async () => {
      if (!database.isOpen()) await database.open();
      return database;
    }
} = {}) => {
  const activeSyncLeases = new Map();
  let nextSyncLeaseId = 1;
  const resolveIdentity = (source) => resolveActiveTenantIdentity(source, cryptoProvider);
  const blockForLocalTenantError = (error) => {
    if (!isLocalTenantAccessError(error)) return;
    controller.block(
      error,
      error.code === LOCAL_TENANT_ERROR_CODES.MISMATCH
        ? LOCAL_TENANT_STATUS.MISMATCH
        : LOCAL_TENANT_STATUS.LEGACY_UNRESOLVED
    );
  };

  const getNativeDatabase = async () => {
    await ensureReady();
    const nativeDatabase = database.backendDB();
    if (!nativeDatabase) throw new Error('LOCAL_TENANT_DATABASE_NOT_OPEN');
    return nativeDatabase;
  };

  const inspectTenantOwnedLocalData = async () => {
    const snapshot = await readNativeSnapshot(
      await getNativeDatabase(),
      browserStorage,
      tenantSessionStorage
    );
    return publicInspection(snapshot);
  };

  const getLocalTenantBinding = async () => {
    const snapshot = await readNativeSnapshot(
      await getNativeDatabase(),
      browserStorage,
      tenantSessionStorage
    );
    return snapshot.binding
      ? {
        authority: snapshot.binding.authority,
        bindingVersion: snapshot.binding.bindingVersion,
        source: snapshot.binding.source,
        tenantIdentity: snapshot.binding.tenantIdentity,
        tenantAliases: [...snapshot.binding.tenantAliases]
      }
      : null;
  };

  const assertLocalTenantAccess = async (source, { reason = 'license_validation' } = {}) => {
    const activeIdentity = await resolveIdentity(source);
    const alreadyGranted = controller.isGrantedFor(activeIdentity);

    if (
      !alreadyGranted &&
      [...activeSyncLeases.values()].some((lease) => !identitiesOverlap(lease.identity, activeIdentity))
    ) {
      const error = new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.MISMATCH, {
        reason: 'tenant_transition_during_active_sync'
      });
      controller.block(error, LOCAL_TENANT_STATUS.MISMATCH);
      throw error;
    }

    if (!alreadyGranted) controller.enable(reason);
    const nativeDatabase = await getNativeDatabase();

    for (let attempt = 0; attempt < MAX_SNAPSHOT_RETRIES; attempt += 1) {
      let snapshot;
      try {
        snapshot = await readNativeSnapshot(
          nativeDatabase,
          browserStorage,
          tenantSessionStorage
        );
      } catch (error) {
        blockForLocalTenantError(error);
        throw error;
      }

      if (snapshot.binding && bindingMatchesIdentity(snapshot.binding, activeIdentity)) {
        if (!alreadyGranted) controller.grant(activeIdentity, 'same_tenant');
        return { status: 'pass', binding: snapshot.binding, inspection: publicInspection(snapshot) };
      }

      // Phase 1 uses a sticky database binding. Even a currently empty
      // database is not rebound automatically: this removes cross-tab races
      // where Tenant A can still have an in-flight writer while Tenant B sees
      // an empty snapshot. Multi-tenant/rebind UX belongs to phase 2.
      if (snapshot.binding) {
        const error = createBlockedError(
          LOCAL_TENANT_ERROR_CODES.MISMATCH,
          snapshot,
          'bound_tenant_mismatch'
        );
        controller.block(error, LOCAL_TENANT_STATUS.MISMATCH);
        throw error;
      }

      let bindingIdentity = activeIdentity;
      let bindingSource = 'new_empty_database';

      if (!snapshot.binding && snapshot.hasTenantOwnedData) {
        if (
          snapshot.ownershipEvidenceKeys.length !== 1
          || snapshot.evidenceKeys.length !== 1
          || snapshot.ownershipEvidenceComplete !== true
          || snapshot.unscopedLegacyStores.length > 0
        ) {
          const error = createBlockedError(
            LOCAL_TENANT_ERROR_CODES.LEGACY_UNRESOLVED,
            snapshot,
            snapshot.evidenceKeys.length > 1
              ? 'conflicting_legacy_tenant_evidence'
              : snapshot.unscopedLegacyStores.length > 0
                ? 'unverifiable_legacy_tenant_data'
                : 'missing_legacy_tenant_evidence'
          );
          controller.block(error, LOCAL_TENANT_STATUS.LEGACY_UNRESOLVED);
          throw error;
        }

        bindingIdentity = await resolveIdentity({
          license_key: snapshot.ownershipEvidenceKeys[0]
        });
        bindingSource = 'legacy_internal_evidence';
      }

      const bindingRecord = buildBindingRecord(bindingIdentity, bindingSource);

      try {
        const committed = await commitBindingIfUnchanged(
          nativeDatabase,
          snapshot,
          bindingRecord,
          browserStorage,
          tenantSessionStorage
        );

        if (!bindingMatchesIdentity(committed.binding, activeIdentity)) {
          const error = createBlockedError(
            LOCAL_TENANT_ERROR_CODES.MISMATCH,
            committed,
            'legacy_tenant_mismatch'
          );
          controller.block(error, LOCAL_TENANT_STATUS.MISMATCH);
          throw error;
        }

        controller.grant(activeIdentity, bindingSource);
        return {
          status: bindingSource === 'legacy_internal_evidence'
            ? 'legacy_backfilled'
            : 'bound',
          binding: committed.binding,
          inspection: publicInspection(committed)
        };
      } catch (error) {
        if (error?.code === LOCAL_TENANT_ERROR_CODES.SNAPSHOT_CHANGED) continue;
        blockForLocalTenantError(error);
        throw error;
      }
    }

    const latest = await readNativeSnapshot(
      nativeDatabase,
      browserStorage,
      tenantSessionStorage
    );
    const error = createBlockedError(
      LOCAL_TENANT_ERROR_CODES.SNAPSHOT_CHANGED,
      latest,
      'snapshot_changed_repeatedly'
    );
    controller.block(error, LOCAL_TENANT_STATUS.LEGACY_UNRESOLVED);
    throw error;
  };

  const assertLocalTenantSyncAccess = async (source, { reason = 'sync' } = {}) => {
    if (!controller.getState().enabled) {
      throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, {
        reason: `${reason}_guard_not_initialized`
      });
    }
    const identity = await resolveIdentity(source);
    if (controller.isGrantedFor(identity)) return { status: 'pass' };

    throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, { reason });
  };

  const acquireLocalTenantSyncLease = async (source, { reason = 'sync_operation' } = {}) => {
    const identity = await resolveIdentity(source);
    // No await is allowed between this check and registering the lease. A
    // second digest used to permit a tenant transition in that gap.
    if (!controller.getState().enabled || !controller.isGrantedFor(identity)) {
      throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, { reason });
    }
    const leaseId = nextSyncLeaseId;
    nextSyncLeaseId += 1;
    activeSyncLeases.set(leaseId, { identity, reason });
    let released = false;

    return {
      release() {
        if (released) return;
        released = true;
        activeSyncLeases.delete(leaseId);
      }
    };
  };

  const runWithLocalTenantSyncLease = async (source, options, operation) => {
    const lease = await acquireLocalTenantSyncLease(source, options);
    try {
      return await operation();
    } finally {
      lease.release();
    }
  };

  return {
    controller,
    initialize: (reason = 'bootstrap') => controller.enable(reason),
    lock: (reason = 'no_active_license') => controller.lock(reason),
    reset: () => {
      activeSyncLeases.clear();
      return controller.reset();
    },
    getState: () => controller.getState(),
    resolveActiveTenantIdentity: resolveIdentity,
    getLocalTenantBinding,
    inspectTenantOwnedLocalData,
    canSafelyRebindEmptyDatabase: async () => {
      const snapshot = await inspectTenantOwnedLocalData();
      return !snapshot.binding && !snapshot.hasTenantOwnedData;
    },
    assertLocalTenantAccess,
    assertLocalTenantSyncAccess,
    acquireLocalTenantSyncLease,
    runWithLocalTenantSyncLease
  };
};

const defaultGuard = createLocalTenantGuard();

export const initializeLocalTenantGuard = defaultGuard.initialize;
export const lockLocalTenantAccess = defaultGuard.lock;
export const getLocalTenantGuardState = defaultGuard.getState;
export const getLocalTenantBinding = defaultGuard.getLocalTenantBinding;
export const inspectTenantOwnedLocalData = defaultGuard.inspectTenantOwnedLocalData;
export const canSafelyRebindEmptyDatabase = defaultGuard.canSafelyRebindEmptyDatabase;
export const assertLocalTenantAccess = defaultGuard.assertLocalTenantAccess;
export const assertLocalTenantSyncAccess = defaultGuard.assertLocalTenantSyncAccess;
export const acquireLocalTenantSyncLease = defaultGuard.acquireLocalTenantSyncLease;
export const runWithLocalTenantSyncLease = defaultGuard.runWithLocalTenantSyncLease;
export const resetLocalTenantGuardForTests = defaultGuard.reset;
export { isLocalTenantAccessError };
