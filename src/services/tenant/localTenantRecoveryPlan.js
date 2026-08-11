import { DB_NAME } from '../../config/dbConfig';
import { resolveActiveTenantIdentity } from './localTenantGuard';
import {
  LEGACY_RECOVERY_LOCAL_STORAGE_POLICY,
  LEGACY_RECOVERY_STORE_POLICY,
  RECOVERY_DESTINATION_ACTION,
  RECOVERY_PLAN_STATUS,
  RECOVERY_PLAN_VERSION,
  RECOVERY_PROVENANCE_TIER,
  RECOVERY_ROW_CLASSIFICATION,
  getLegacyRecoveryStorePolicy
} from './localTenantRecoveryPolicy';

const SYNC_META_SUFFIXES = [
  'pos_last_change_seq',
  'pos_sync_enabled',
  'pos_last_full_pull_at',
  'pos_realtime_status',
  'pos_last_pull_at',
  'pos_last_pull_error'
];

const DIRECT_ENTITY_STORE = Object.freeze({
  product: 'menu',
  category: 'categories',
  product_batch: 'product_batches',
  customer: 'customers',
  sale: 'sales',
  cash_session: 'cajas',
  cash_movement: 'movimientos_caja'
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

const digest = async (value, cryptoProvider = globalThis.crypto) => {
  if (!cryptoProvider?.subtle?.digest) throw new Error('RECOVERY_FINGERPRINT_UNAVAILABLE');
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const result = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

const fingerprintProjection = (recordsByStore, localStorage = {}) => {
  const stores = {};
  for (const [storeName, records] of stableEntries(recordsByStore)) {
    const storePolicy = getLegacyRecoveryStorePolicy(storeName);
    stores[storeName] = (Array.isArray(records) ? records : []).map((record) => ({
      primaryKey: record?.[storePolicy.primaryKey] ?? null,
      relationshipValues: storePolicy.relationshipFields
        .filter((field) => !field.includes('[]'))
        .map((field) => [field, record?.[field] ?? null]),
      cloudMarker: hasCloudMarker(record),
      // The fingerprint deliberately excludes license values, payloads,
      // names, personal data, tokens, caches and conflict contents.
      status: record?.status ?? null,
      timestamp: record?.updatedAt ?? record?.createdAt ?? record?.timestamp ?? null
    })).sort((left, right) => String(left.primaryKey).localeCompare(String(right.primaryKey)));
  }
  return {
    stores,
    localStorage: Object.keys(localStorage || {}).sort().map((key) => ({
      key,
      present: Boolean(localStorage[key])
    }))
  };
};

const tenantMatch = async (values, activeIdentity, cryptoProvider) => {
  const activeAliases = new Set(activeIdentity.aliases);
  const matches = [];
  for (const evidence of values) {
    const alias = await tenantAlias(evidence.value, cryptoProvider);
    matches.push({ ...evidence, matchesActive: activeAliases.has(alias) });
  }
  return matches;
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

const addPlanRow = async ({ buckets, storeSummaries, storeName, record, classification, tier = RECOVERY_PROVENANCE_TIER.D, cryptoProvider }) => {
  const policy = getLegacyRecoveryStorePolicy(storeName);
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

const buildDirectReferenceIndex = (recordsByStore, activeEvidence) => {
  const directReferences = new Map();
  for (const record of recordsByStore.sync_outbox || []) {
    if (!activeEvidence.has(record)) continue;
    const storeName = DIRECT_ENTITY_STORE[record?.entityType];
    const entityId = asText(record?.entityId);
    if (!storeName || !entityId) continue;
    if (!directReferences.has(storeName)) directReferences.set(storeName, new Set());
    directReferences.get(storeName).add(entityId);
  }
  return directReferences;
};

const getBusinessRowClassification = ({ storeName, record, directReferences, proven }) => {
  const policy = getLegacyRecoveryStorePolicy(storeName);
  if (policy.destinationAction === RECOVERY_DESTINATION_ACTION.RECOMPUTE) {
    return RECOVERY_ROW_CLASSIFICATION.DERIVED_RECOMPUTE;
  }
  if (policy.destinationAction === RECOVERY_DESTINATION_ACTION.IGNORE_OPERATIONALLY) {
    return RECOVERY_ROW_CLASSIFICATION.DO_NOT_MIGRATE;
  }
  const primaryKey = asText(record?.[policy.primaryKey]);
  if (directReferences.get(storeName)?.has(primaryKey)) return RECOVERY_ROW_CLASSIFICATION.PROVEN_DIRECT;
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
 * The adapter exposes exactly one operation.  Its transaction mode is fixed
 * to Dexie's readonly mode; it has no handle for mutations, sync or RPC.
 */
export const createReadOnlyLegacyInspectionAdapter = ({ database, sourceDatabase = DB_NAME } = {}) => {
  if (!database?.table || !database?.transaction) throw new Error('RECOVERY_READONLY_DATABASE_REQUIRED');
  return Object.freeze({
    async readSnapshot() {
      const available = new Set(database.tables?.map((table) => table.name) || []);
      const storeNames = Object.keys(LEGACY_RECOVERY_STORE_POLICY).filter((name) => available.has(name));
      const tables = storeNames.map((name) => database.table(name));
      const recordsByStore = await database.transaction('r', tables, async () => {
        const entries = await Promise.all(storeNames.map(async (storeName) => [
          storeName,
          await database.table(storeName).toArray()
        ]));
        return Object.fromEntries(entries);
      });
      return { sourceDatabase, recordsByStore, localStorage: {} };
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
  const fingerprint = await digest(fingerprintProjection(recordsByStore, snapshot.localStorage), cryptoProvider);
  const evidenceByRecord = new Map();
  const activeOutboxEvidence = new Set();
  let foreignCandidateCount = 0;
  const foreignCandidateTokens = new Set();
  let activeTierACount = 0;

  for (const [storeName, records] of stableEntries(recordsByStore)) {
    for (const record of records) {
      const matches = await tenantMatch(recordTenantValues(storeName, record), activeIdentity, cryptoProvider);
      evidenceByRecord.set(record, matches);
      if (storeName === 'sync_outbox' && matches.some((item) => item.matchesActive && item.tier === RECOVERY_PROVENANCE_TIER.A)) {
        activeOutboxEvidence.add(record);
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
  const directReferences = buildDirectReferenceIndex(recordsByStore, activeOutboxEvidence);
  const proven = {};

  for (const [storeName, records] of stableEntries(recordsByStore)) {
    const policy = getLegacyRecoveryStorePolicy(storeName);
    for (const record of records) {
      const matches = evidenceByRecord.get(record) || [];
      let classification;
      let tier = RECOVERY_PROVENANCE_TIER.D;
      if (storeName === 'sync_outbox') {
        classification = matches.some((item) => !item.matchesActive)
          ? RECOVERY_ROW_CLASSIFICATION.FOREIGN
          : matches.some((item) => item.matchesActive && item.tier === RECOVERY_PROVENANCE_TIER.A)
            ? RECOVERY_ROW_CLASSIFICATION.PROVEN_DIRECT
            : RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS;
        tier = RECOVERY_PROVENANCE_TIER.A;
      } else if (['company', 'sync_meta', 'sync_cache', 'sync_conflicts'].includes(storeName)) {
        classification = classifyMetadataRow({ storeName, matches });
        tier = matches.some((item) => item.tier === RECOVERY_PROVENANCE_TIER.B)
          ? RECOVERY_PROVENANCE_TIER.B
          : RECOVERY_PROVENANCE_TIER.C;
      } else {
        classification = getBusinessRowClassification({ storeName, record, directReferences, proven });
      }
      await addPlanRow({ buckets, storeSummaries, storeName, record, classification, tier, cryptoProvider });
      if ([RECOVERY_ROW_CLASSIFICATION.PROVEN_DIRECT, RECOVERY_ROW_CLASSIFICATION.PROVEN_RELATIONAL].includes(classification)) {
        const key = asText(record?.[policy.primaryKey]);
        if (key) (proven[storeName] ||= new Set()).add(key);
      }
    }
  }

  for (const [key, storagePolicy] of stableEntries(LEGACY_RECOVERY_LOCAL_STORAGE_POLICY)) {
    if (!snapshot.localStorage?.[key]) continue;
    const row = { [storagePolicy.primaryKey]: key };
    await addPlanRow({
      buckets,
      storeSummaries,
      storeName: `localStorage:${key}`,
      record: row,
      classification: storagePolicy.classification,
      tier: RECOVERY_PROVENANCE_TIER.D,
      cryptoProvider
    });
  }

  const counts = Object.fromEntries(Object.entries(buckets).map(([key, rows]) => [key, rows.length]));
  const warnings = [
    ...(activeTierACount === 0 ? ['ASSISTED_RECOVERY_REQUIRED'] : []),
    ...(counts.AMBIGUOUS > 0 ? ['UNSCOPED_ROWS_QUARANTINED'] : []),
    ...(counts.FOREIGN > 0 ? ['FOREIGN_METADATA_PRESERVED'] : []),
    ...(activeTierACount > 0 ? ['WHOLE_DATABASE_BINDING_FORBIDDEN'] : [])
  ].sort();

  return deepFreeze({
    version: RECOVERY_PLAN_VERSION,
    sourceDatabase: { name: snapshot.sourceDatabase || DB_NAME, role: 'legacy_vault' },
    sourceSnapshotFingerprint: `sha256:${fingerprint}`,
    activeTenantAuthority: { type: activeIdentity.authority, aliasesAvailable: activeIdentity.aliases.length },
    status: RECOVERY_PLAN_STATUS.PLAN_CREATED,
    createdFromSnapshot: true,
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
  const recoverable = Number(plan?.classifications?.PROVEN_DIRECT || 0) +
    Number(plan?.classifications?.PROVEN_RELATIONAL || 0);
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
