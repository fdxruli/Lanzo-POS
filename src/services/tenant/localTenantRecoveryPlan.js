import { DB_NAME } from '../../config/dbConfig';
import { resolveActiveTenantIdentity } from './localTenantGuard';
import {
  LEGACY_RECOVERY_LOCAL_STORAGE_POLICY,
  LEGACY_RECOVERY_LOCAL_STORAGE_PREFIX_POLICY,
  LEGACY_RECOVERY_SESSION_STORAGE_POLICY,
  RECOVERY_DESTINATION_ACTION,
  RECOVERY_PLAN_STATUS,
  RECOVERY_PLAN_VERSION,
  RECOVERY_PROVENANCE_TIER,
  RECOVERY_ROW_CLASSIFICATION,
  getLegacyRecoveryStorePolicy,
  isKnownLegacyRecoveryStore
} from './localTenantRecoveryPolicy';

const SYNC_META_SUFFIXES = [
  'pos_last_change_seq',
  'pos_sync_enabled',
  'pos_last_full_pull_at',
  'pos_realtime_status',
  'pos_last_pull_at',
  'pos_last_pull_error'
];

const RECOVERY_CONTEXT_FINGERPRINT_DOMAIN = 'lanzo-local-recovery-context-v1';
const RECOVERY_FINGERPRINT_DOMAIN = 'lanzo-local-recovery-snapshot-v2';
const RECOVERY_RECORD_CONTENT_DOMAIN = 'lanzo-local-recovery-record-content-v1';
const BROWSER_STORAGE_INSPECTION_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  UNVERIFIED: 'UNVERIFIED'
});

const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const stableEntries = (object = {}) => Object.keys(object).sort().map((key) => [key, object[key]]);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(stableEntries(value).map(([key, item]) => [key, canonicalize(item)]));
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const recoveryError = (code, cause = null) => Object.assign(new Error(code), { code, cause });

const bytesToHex = (value) => Array.from(new Uint8Array(value))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const canonicalFingerprintValue = async (value, seen = new WeakSet()) => {
  if (value === null) return ['null'];
  if (value === undefined) return ['undefined'];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return ['number', 'NaN'];
    if (value === Infinity) return ['number', 'Infinity'];
    if (value === -Infinity) return ['number', '-Infinity'];
    if (Object.is(value, -0)) return ['number', '-0'];
    return ['number', value];
  }
  if (typeof value === 'symbol' || typeof value === 'function') {
    throw recoveryError('RECOVERY_SNAPSHOT_VALUE_UNSUPPORTED');
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return ['date', Number.isNaN(time) ? 'Invalid Date' : value.toISOString()];
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    try {
      return ['blob', value.type, bytesToHex(await value.arrayBuffer())];
    } catch (error) {
      throw recoveryError('RECOVERY_SNAPSHOT_VALUE_UNSUPPORTED', error);
    }
  }
  if (value instanceof ArrayBuffer) return ['array-buffer', bytesToHex(value)];
  if (ArrayBuffer.isView(value)) {
    return [
      'typed-array',
      value.constructor?.name || 'TypedArray',
      bytesToHex(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    ];
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw recoveryError('RECOVERY_SNAPSHOT_VALUE_UNSUPPORTED');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) items.push(await canonicalFingerprintValue(item, seen));
      return ['array', items];
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw recoveryError('RECOVERY_SNAPSHOT_VALUE_UNSUPPORTED');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) {
      throw recoveryError('RECOVERY_SNAPSHOT_VALUE_UNSUPPORTED');
    }
    const entries = [];
    for (const key of keys.sort()) {
      entries.push([key, await canonicalFingerprintValue(value[key], seen)]);
    }
    return ['object', entries];
  } finally {
    seen.delete(value);
  }
};

const digest = async (
  value,
  cryptoProvider = globalThis.crypto,
  domain = RECOVERY_FINGERPRINT_DOMAIN
) => {
  if (!cryptoProvider?.subtle?.digest) throw new Error('RECOVERY_FINGERPRINT_UNAVAILABLE');
  const bytes = new TextEncoder().encode(JSON.stringify([
    'lanzo-local-recovery-fingerprint',
    domain,
    await canonicalFingerprintValue(value)
  ]));
  const result = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return bytesToHex(result);
};

const tenantAlias = async (licenseKey, cryptoProvider = globalThis.crypto) => {
  if (!cryptoProvider?.subtle?.digest) throw new Error('RECOVERY_FINGERPRINT_UNAVAILABLE');
  const result = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(licenseKey));
  const hash = Array.from(new Uint8Array(result)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `license-key-sha256:${hash}`;
};

const recordRef = async (storeName, primaryKey, cryptoProvider) => (
  `${storeName}:${await digest({ primaryKey }, cryptoProvider).then((value) => value.slice(0, 24))}`
);

const knownMetaScope = (key) => {
  const suffix = SYNC_META_SUFFIXES.find((item) => key.endsWith(`:${item}`));
  return suffix ? key.slice(0, -(suffix.length + 1)) : '';
};

const recordTenantValues = (storeName, record) => {
  const values = [];
  const add = (value, tier) => {
    const normalized = asText(value);
    if (normalized && normalized.toLowerCase() !== 'legacy') values.push({ value: normalized, tier });
  };

  add(record?.license_key, RECOVERY_PROVENANCE_TIER.B);
  add(record?.licenseKey, storeName === 'sync_outbox'
    ? RECOVERY_PROVENANCE_TIER.A
    : RECOVERY_PROVENANCE_TIER.C);
  add(record?.metadata?.license_key, RECOVERY_PROVENANCE_TIER.C);
  add(record?.metadata?.licenseKey, RECOVERY_PROVENANCE_TIER.C);

  if (storeName === 'company' && asText(record?.id).startsWith('company:')) {
    add(record.id.slice('company:'.length), RECOVERY_PROVENANCE_TIER.B);
  }
  if (storeName === 'sync_meta') add(knownMetaScope(asText(record?.key)), RECOVERY_PROVENANCE_TIER.B);
  if (storeName === 'sync_cache' && asText(record?.key).startsWith('devices_')) {
    add(record.key.slice('devices_'.length), RECOVERY_PROVENANCE_TIER.C);
  }
  return values;
};

const hasCloudMarker = (record) => Boolean(
  record?.cloudSaleId ||
  record?.serverVersion ||
  record?.lastSyncedAt ||
  record?.cloudUpdatedAt
);

const fingerprintToken = async (value, cryptoProvider) => (
  (await digest(value, cryptoProvider)).slice(0, 32)
);

const storageFingerprintProjection = async (storage = {}, cryptoProvider) => (
  Promise.all(stableEntries(storage).map(async ([key, value]) => ({
    key,
    valueToken: await fingerprintToken({ browserStorageValue: value }, cryptoProvider)
  })))
);

const fingerprintProjection = async (
  recordsByStore,
  localStorage = {},
  sessionStorage = {},
  sourceMetadata = {},
  browserStorageInspection = {},
  cryptoProvider
) => {
  const stores = {};
  for (const [storeName, records] of stableEntries(recordsByStore)) {
    const storePolicy = getLegacyRecoveryStorePolicy(storeName);
    stores[storeName] = (await Promise.all((Array.isArray(records) ? records : []).map(async (record) => ({
      primaryKeyToken: await fingerprintToken({ primaryKey: record?.[storePolicy.primaryKey] ?? null }, cryptoProvider),
      recordContentToken: await digest(record, cryptoProvider, RECOVERY_RECORD_CONTENT_DOMAIN),
      relationshipTokens: await Promise.all(storePolicy.relationshipFields
        .filter((field) => !field.includes('[]'))
        .map(async (field) => [field, await fingerprintToken(record?.[field] ?? null, cryptoProvider)])),
      ownershipEvidenceTokens: (await Promise.all(recordTenantValues(storeName, record).map(async (evidence) => ({
        tier: evidence.tier,
        token: await fingerprintToken({ tenantEvidence: evidence.value }, cryptoProvider)
      })))).sort((left, right) => `${left.tier}:${left.token}`.localeCompare(`${right.tier}:${right.token}`)),
      cloudMarker: hasCloudMarker(record),
      status: record?.status ?? null,
      timestamp: record?.updatedAt ?? record?.createdAt ?? record?.timestamp ?? null
    })))).sort((left, right) => (
      `${left.primaryKeyToken}:${left.recordContentToken}`.localeCompare(
        `${right.primaryKeyToken}:${right.recordContentToken}`
      )
    ));
  }
  return {
    sourceMetadata,
    browserStorageInspection,
    stores,
    localStorage: await storageFingerprintProjection(localStorage, cryptoProvider),
    sessionStorage: await storageFingerprintProjection(sessionStorage, cryptoProvider)
  };
};

const tenantMatch = async (values, activeIdentity, cryptoProvider) => {
  const activeAliases = new Set(activeIdentity.aliases);
  const matches = [];
  for (const evidence of values) {
    const alias = await tenantAlias(evidence.value, cryptoProvider);
    matches.push({ ...evidence, alias, matchesActive: activeAliases.has(alias) });
  }
  return matches;
};

const uniqueTenantCandidates = (matches = []) => new Map(
  matches.map((match) => [match.alias, match])
);

const isUnambiguousActiveTierAOutbox = (matches = []) => {
  const candidates = uniqueTenantCandidates(matches);
  if (candidates.size !== 1) return false;
  const [candidate] = candidates.values();
  return candidate.matchesActive && matches.some((match) => (
    match.matchesActive && match.tier === RECOVERY_PROVENANCE_TIER.A
  ));
};

const classifyOutboxRow = (matches = []) => {
  const candidates = uniqueTenantCandidates(matches);
  if (candidates.size === 0) return RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS;
  if (candidates.size > 1 || [...candidates.values()].some((candidate) => !candidate.matchesActive)) {
    return RECOVERY_ROW_CLASSIFICATION.FOREIGN;
  }
  return isUnambiguousActiveTierAOutbox(matches)
    ? RECOVERY_ROW_CLASSIFICATION.PROVEN_DIRECT
    : RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS;
};

const classifyMetadataRow = ({ storeName, matches }) => {
  if (matches.some((item) => !item.matchesActive)) return RECOVERY_ROW_CLASSIFICATION.FOREIGN;
  if (storeName === 'sync_cache' && matches.some((item) => item.tier === RECOVERY_PROVENANCE_TIER.C)) {
    return RECOVERY_ROW_CLASSIFICATION.DEVICE_GLOBAL;
  }
  return RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS;
};

const createClassificationBuckets = () => Object.fromEntries(
  Object.values(RECOVERY_ROW_CLASSIFICATION).map((classification) => [classification, []])
);

const addPlanRow = async ({
  buckets,
  storeSummaries,
  storeName,
  record,
  classification,
  tier = RECOVERY_PROVENANCE_TIER.D,
  cryptoProvider,
  policyOverride = null
}) => {
  const policy = policyOverride || getLegacyRecoveryStorePolicy(storeName);
  const reference = await recordRef(storeName, record?.[policy.primaryKey], cryptoProvider);
  const row = { ref: reference, store: storeName, tier, destinationAction: policy.destinationAction };
  buckets[classification].push(row);
  const summary = storeSummaries[storeName] || (storeSummaries[storeName] = {
    total: 0,
    classifications: {},
    destinationAction: policy.destinationAction
  });
  summary.total += 1;
  summary.classifications[classification] = (summary.classifications[classification] || 0) + 1;
  return row;
};

const getBusinessRowClassification = ({ storeName, record, proven }) => {
  const policy = getLegacyRecoveryStorePolicy(storeName);
  if (policy.destinationAction === RECOVERY_DESTINATION_ACTION.RECOMPUTE) {
    return RECOVERY_ROW_CLASSIFICATION.DERIVED_RECOMPUTE;
  }
  if (policy.destinationAction === RECOVERY_DESTINATION_ACTION.IGNORE_OPERATIONALLY) {
    return RECOVERY_ROW_CLASSIFICATION.DO_NOT_MIGRATE;
  }
  if (storeName === 'product_batches' && proven.menu?.has(asText(record?.productId))) {
    return RECOVERY_ROW_CLASSIFICATION.PROVEN_RELATIONAL;
  }
  if (storeName === 'inventory_events' &&
    proven.sales?.has(asText(record?.saleId)) && proven.menu?.has(asText(record?.productId))) {
    return RECOVERY_ROW_CLASSIFICATION.PROVEN_RELATIONAL;
  }
  if (policy.cloudReconciliation && hasCloudMarker(record)) {
    return RECOVERY_ROW_CLASSIFICATION.CLOUD_RECONCILABLE;
  }
  return RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS;
};

/**
 * The adapter exposes exactly one operation. Its native transaction mode is
 * fixed to readonly; it has no handle for mutations, sync or RPC.
 */
const readStorageValue = (storage, key) => {
  const value = storage.getItem(key);
  return value === null ? undefined : value;
};

const readConfiguredBrowserStorage = ({ storage, exactPolicy, prefixPolicy = {} }) => {
  if (!storage || typeof storage.getItem !== 'function') {
    throw recoveryError('RECOVERY_STORAGE_INSPECTION_REQUIRED');
  }
  const values = {};
  for (const key of Object.keys(exactPolicy)) {
    const value = readStorageValue(storage, key);
    if (value !== undefined) values[key] = value;
  }

  if (Object.keys(prefixPolicy).length === 0) return values;
  if (typeof storage.key !== 'function' || !Number.isInteger(storage.length)) {
    throw recoveryError('RECOVERY_STORAGE_INSPECTION_REQUIRED');
  }
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key !== 'string' || !Object.keys(prefixPolicy).some((prefix) => key.startsWith(prefix))) continue;
    const value = readStorageValue(storage, key);
    if (value !== undefined) values[key] = value;
  }
  return values;
};

const requestToPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('RECOVERY_NATIVE_READ_FAILED'));
});

const readPhysicalObjectStoreSnapshot = (nativeDatabase) => {
  const storeNames = Array.from(nativeDatabase?.objectStoreNames || []).sort();
  if (storeNames.length === 0) return Promise.resolve({ recordsByStore: {}, objectStores: [] });
  const transaction = nativeDatabase.transaction(storeNames, 'readonly');
  const completed = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('RECOVERY_NATIVE_READ_FAILED'));
    transaction.onabort = () => reject(transaction.error || new Error('RECOVERY_NATIVE_READ_ABORTED'));
  });
  const records = Promise.all(storeNames.map(async (storeName) => {
    const objectStore = transaction.objectStore(storeName);
    return [storeName, await requestToPromise(objectStore.getAll()), objectStore.keyPath];
  }));
  return Promise.all([records, completed]).then(([entries]) => ({
    recordsByStore: Object.fromEntries(entries.map(([storeName, values]) => [storeName, values])),
    objectStores: entries.map(([storeName, , keyPath]) => ({
      name: storeName,
      keyPath: Array.isArray(keyPath) ? [...keyPath] : keyPath ?? null
    }))
  }));
};

const readWindowStorage = () => {
  try {
    return {
      localStorage: globalThis.window.localStorage,
      sessionStorage: globalThis.window.sessionStorage
    };
  } catch (error) {
    throw recoveryError('RECOVERY_STORAGE_INSPECTION_FAILED', error);
  }
};

const resolveBrowserStorageSources = ({ browserStorage, sessionStorage, allowStorageNotApplicable }) => {
  const suppliedLocalStorage = browserStorage?.localStorage ?? browserStorage;
  const suppliedSessionStorage = sessionStorage ?? browserStorage?.sessionStorage ?? null;
  if (typeof globalThis.window !== 'undefined') {
    const browserDefaults = readWindowStorage();
    const localStorage = suppliedLocalStorage ?? browserDefaults.localStorage;
    const tenantSessionStorage = suppliedSessionStorage ?? browserDefaults.sessionStorage;
    if (!localStorage || !tenantSessionStorage) throw recoveryError('RECOVERY_STORAGE_INSPECTION_REQUIRED');
    return { localStorage, sessionStorage: tenantSessionStorage, status: 'COMPLETE' };
  }
  if (suppliedLocalStorage || suppliedSessionStorage) {
    if (!suppliedLocalStorage || !suppliedSessionStorage) {
      throw recoveryError('RECOVERY_STORAGE_INSPECTION_REQUIRED');
    }
    return { localStorage: suppliedLocalStorage, sessionStorage: suppliedSessionStorage, status: 'COMPLETE' };
  }
  if (allowStorageNotApplicable === true) {
    return { localStorage: null, sessionStorage: null, status: 'NOT_APPLICABLE' };
  }
  throw recoveryError('RECOVERY_STORAGE_INSPECTION_REQUIRED');
};

export const createReadOnlyLegacyInspectionAdapter = ({
  database,
  sourceDatabase = DB_NAME,
  browserStorage,
  sessionStorage,
  allowStorageNotApplicable = false
} = {}) => {
  if (!database?.backendDB) throw new Error('RECOVERY_READONLY_DATABASE_REQUIRED');
  return Object.freeze({
    async readSnapshot() {
      const nativeDatabase = database.backendDB();
      if (!nativeDatabase?.objectStoreNames) throw new Error('RECOVERY_NATIVE_INSPECTION_REQUIRED');
      // This native readonly transaction inventories stores that Dexie does
      // not declare too; physical unknowns are therefore fail-closed.
      const physicalSnapshot = await readPhysicalObjectStoreSnapshot(nativeDatabase);
      const storageSources = resolveBrowserStorageSources({
        browserStorage,
        sessionStorage,
        allowStorageNotApplicable
      });
      return {
        sourceDatabase,
        sourceMetadata: {
          sourceDatabaseName: sourceDatabase,
          nativeDatabaseName: nativeDatabase.name,
          nativeDatabaseVersion: nativeDatabase.version,
          objectStores: physicalSnapshot.objectStores
        },
        recordsByStore: physicalSnapshot.recordsByStore,
        localStorage: storageSources.status === 'NOT_APPLICABLE' ? {} : readConfiguredBrowserStorage({
          storage: storageSources.localStorage,
          exactPolicy: LEGACY_RECOVERY_LOCAL_STORAGE_POLICY,
          prefixPolicy: LEGACY_RECOVERY_LOCAL_STORAGE_PREFIX_POLICY
        }),
        sessionStorage: storageSources.status === 'NOT_APPLICABLE' ? {} : readConfiguredBrowserStorage({
          storage: storageSources.sessionStorage,
          exactPolicy: LEGACY_RECOVERY_SESSION_STORAGE_POLICY
        }),
        browserStorageInspection: { status: storageSources.status }
      };
    }
  });
};

export const buildLegacyRecoveryPlan = async ({
  snapshot,
  activeTenantSource,
  cryptoProvider = globalThis.crypto
} = {}) => {
  if (!snapshot?.recordsByStore) throw new Error('RECOVERY_SNAPSHOT_REQUIRED');
  const activeIdentity = await resolveActiveTenantIdentity(activeTenantSource, cryptoProvider);
  const recordsByStore = Object.fromEntries(stableEntries(snapshot.recordsByStore).map(([storeName, records]) => [
    storeName,
    Array.isArray(records) ? [...records].sort((left, right) => String(left?.[getLegacyRecoveryStorePolicy(storeName).primaryKey]).localeCompare(String(right?.[getLegacyRecoveryStorePolicy(storeName).primaryKey]))) : []
  ]));
  const sourceMetadata = {
    sourceDatabaseName: snapshot.sourceMetadata?.sourceDatabaseName || snapshot.sourceDatabase || DB_NAME,
    nativeDatabaseName: snapshot.sourceMetadata?.nativeDatabaseName || snapshot.sourceDatabase || DB_NAME,
    nativeDatabaseVersion: snapshot.sourceMetadata?.nativeDatabaseVersion ?? null,
    objectStores: [...(snapshot.sourceMetadata?.objectStores || Object.keys(recordsByStore).map((name) => ({
      name,
      keyPath: null
    })))].sort((left, right) => String(left?.name).localeCompare(String(right?.name)))
  };
  const requestedInspectionStatus = snapshot.browserStorageInspection?.status;
  const browserStorageInspection = {
    status: Object.values(BROWSER_STORAGE_INSPECTION_STATUS).includes(requestedInspectionStatus)
      ? requestedInspectionStatus
      : BROWSER_STORAGE_INSPECTION_STATUS.UNVERIFIED
  };
  const fingerprint = await digest(
    await fingerprintProjection(
      recordsByStore,
      snapshot.localStorage,
      snapshot.sessionStorage,
      sourceMetadata,
      { browserStorageInspectionStatus: browserStorageInspection.status },
      cryptoProvider
    ),
    cryptoProvider
  );
  const recoveryContextFingerprint = await digest({
    domain: RECOVERY_CONTEXT_FINGERPRINT_DOMAIN,
    sourceSnapshotFingerprint: fingerprint,
    activeTenantAliases: [...activeIdentity.aliases].sort()
  }, cryptoProvider);
  const evidenceByRecord = new Map();
  let foreignCandidateCount = 0;
  const foreignCandidateTokens = new Set();
  let activeTierACount = 0;

  for (const [storeName, records] of stableEntries(recordsByStore)) {
    for (const record of records) {
      const matches = await tenantMatch(recordTenantValues(storeName, record), activeIdentity, cryptoProvider);
      evidenceByRecord.set(record, matches);
      if (storeName === 'sync_outbox' && isUnambiguousActiveTierAOutbox(matches)) {
        activeTierACount += 1;
      }
      for (const item of matches.filter((entry) => !entry.matchesActive)) {
        foreignCandidateTokens.add(await tenantAlias(item.value, cryptoProvider));
      }
    }
  }
  foreignCandidateCount = foreignCandidateTokens.size;

  const buckets = createClassificationBuckets();
  const storeSummaries = {};
  const proven = {};

  for (const [storeName, records] of stableEntries(recordsByStore)) {
    const policy = getLegacyRecoveryStorePolicy(storeName);
    for (const record of records) {
      const matches = evidenceByRecord.get(record) || [];
      let classification;
      let tier = RECOVERY_PROVENANCE_TIER.D;
      if (storeName === 'sync_outbox') {
        classification = classifyOutboxRow(matches);
        tier = RECOVERY_PROVENANCE_TIER.A;
      } else if (['company', 'sync_meta', 'sync_cache', 'sync_conflicts'].includes(storeName)) {
        classification = classifyMetadataRow({ storeName, matches });
        tier = matches.some((item) => item.tier === RECOVERY_PROVENANCE_TIER.B)
          ? RECOVERY_PROVENANCE_TIER.B
          : RECOVERY_PROVENANCE_TIER.C;
      } else {
        classification = getBusinessRowClassification({ storeName, record, proven });
      }
      await addPlanRow({ buckets, storeSummaries, storeName, record, classification, tier, cryptoProvider });
      if ([RECOVERY_ROW_CLASSIFICATION.PROVEN_DIRECT, RECOVERY_ROW_CLASSIFICATION.PROVEN_RELATIONAL].includes(classification)) {
        const key = asText(record?.[policy.primaryKey]);
        if (key) (proven[storeName] ||= new Set()).add(key);
      }
    }
  }

  const addBrowserStorageRows = async (storageName, storage, exactPolicy, prefixPolicy = {}) => {
    const policiesByKey = new Map(stableEntries(exactPolicy));
    for (const [prefix, policy] of stableEntries(prefixPolicy)) {
      for (const key of Object.keys(storage || {}).filter((item) => item.startsWith(prefix))) {
        policiesByKey.set(key, policy);
      }
    }
    for (const [key, storagePolicy] of [...policiesByKey.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (storage?.[key] === undefined || storage?.[key] === null || storage?.[key] === false) continue;
      const row = { [storagePolicy.primaryKey]: key };
      await addPlanRow({
        buckets,
        storeSummaries,
        storeName: `${storageName}:${key}`,
        record: row,
        classification: storagePolicy.classification,
        tier: RECOVERY_PROVENANCE_TIER.D,
        cryptoProvider,
        policyOverride: storagePolicy
      });
    }
  };
  await addBrowserStorageRows(
    'localStorage',
    snapshot.localStorage,
    LEGACY_RECOVERY_LOCAL_STORAGE_POLICY,
    LEGACY_RECOVERY_LOCAL_STORAGE_PREFIX_POLICY
  );
  await addBrowserStorageRows(
    'sessionStorage',
    snapshot.sessionStorage,
    LEGACY_RECOVERY_SESSION_STORAGE_POLICY
  );

  const counts = Object.fromEntries(Object.entries(buckets).map(([key, rows]) => [key, rows.length]));
  const unknownStores = Object.keys(recordsByStore)
    .filter((storeName) => !isKnownLegacyRecoveryStore(storeName))
    .sort();
  const boundSource = (recordsByStore.local_tenant_binding || []).some((record) => Boolean(record));
  const storageInspectionComplete = (
    browserStorageInspection.status === BROWSER_STORAGE_INSPECTION_STATUS.COMPLETE
  );
  const warnings = [
    ...(activeTierACount === 0 ? ['ASSISTED_RECOVERY_REQUIRED'] : []),
    ...(counts.AMBIGUOUS > 0 ? ['UNSCOPED_ROWS_QUARANTINED'] : []),
    ...(counts.FOREIGN > 0 ? ['FOREIGN_METADATA_PRESERVED'] : []),
    ...(activeTierACount > 0 ? ['WHOLE_DATABASE_BINDING_FORBIDDEN'] : []),
    ...(unknownStores.length > 0 ? ['UNKNOWN_STORE_PRESENT'] : []),
    ...(boundSource ? ['RECOVERY_SOURCE_ALREADY_BOUND'] : []),
    ...(!storageInspectionComplete ? ['RECOVERY_STORAGE_INSPECTION_NOT_COMPLETE'] : [])
  ].sort();

  return deepFreeze({
    version: RECOVERY_PLAN_VERSION,
    sourceDatabase: { name: snapshot.sourceDatabase || DB_NAME, role: 'legacy_vault' },
    sourceSnapshotFingerprint: `sha256:${fingerprint}`,
    recoveryContextFingerprint: `sha256:${recoveryContextFingerprint}`,
    activeTenantAuthority: { type: activeIdentity.authority, aliasesAvailable: activeIdentity.aliases.length },
    browserStorageInspection,
    status: RECOVERY_PLAN_STATUS.PLAN_CREATED,
    createdFromSnapshot: true,
    executableForFutureCopy: storageInspectionComplete && !boundSource && unknownStores.length === 0,
    preconditionFailure: boundSource
      ? 'RECOVERY_SOURCE_ALREADY_BOUND'
      : (!storageInspectionComplete ? 'RECOVERY_STORAGE_INSPECTION_NOT_COMPLETE' : null),
    unknownStores,
    evidence: {
      activeTierARecordCount: activeTierACount,
      activeCandidateHasTierA: activeTierACount > 0,
      foreignCandidateCount,
      wholeDatabaseOwnership: false
    },
    storeSummaries: canonicalize(storeSummaries),
    classifications: counts,
    provenDirect: buckets.PROVEN_DIRECT,
    provenRelational: buckets.PROVEN_RELATIONAL,
    cloudReconciliationRequired: buckets.CLOUD_RECONCILABLE,
    ambiguous: buckets.AMBIGUOUS,
    foreign: buckets.FOREIGN,
    derivedRecompute: buckets.DERIVED_RECOMPUTE,
    quarantined: [
      ...buckets.FOREIGN,
      ...buckets.AMBIGUOUS,
      ...buckets.DEVICE_GLOBAL,
      ...buckets.DO_NOT_MIGRATE,
      ...buckets.PROVEN_DIRECT.filter((row) => row.destinationAction === RECOVERY_DESTINATION_ACTION.QUARANTINE),
      ...buckets.PROVEN_RELATIONAL.filter((row) => row.destinationAction === RECOVERY_DESTINATION_ACTION.QUARANTINE)
    ],
    warnings
  });
};

export const inspectLegacyVaultAndBuildRecoveryPlan = async ({ adapter, activeTenantSource, cryptoProvider } = {}) => {
  if (!adapter || typeof adapter.readSnapshot !== 'function') throw new Error('RECOVERY_READONLY_ADAPTER_REQUIRED');
  const snapshot = await adapter.readSnapshot();
  return buildLegacyRecoveryPlan({ snapshot, activeTenantSource, cryptoProvider });
};

export const summarizeLegacyRecoveryPlan = (plan) => {
  const businessRows = ['menu', 'sales', 'customers']
    .reduce((total, storeName) => total + Number(plan?.storeSummaries?.[storeName]?.total || 0), 0);
  const recoverable = [
    ...(plan?.provenDirect || []),
    ...(plan?.provenRelational || [])
  ].filter((row) => row.destinationAction === RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN).length;
  const ambiguous = Number(plan?.classifications?.AMBIGUOUS || 0) +
    Number(plan?.classifications?.CLOUD_RECONCILABLE || 0);
  return deepFreeze({
    businessRowCount: businessRows,
    automaticallyRecoverableCount: recoverable,
    assistedRecoveryRequiredCount: ambiguous,
    dataWillBeDeleted: false,
    message: `Se encontraron ${businessRows} registros históricos. ${recoverable} pueden asociarse automáticamente todavía. ${ambiguous} requieren verificación o recuperación asistida. Ningún dato será eliminado.`
  });
};
