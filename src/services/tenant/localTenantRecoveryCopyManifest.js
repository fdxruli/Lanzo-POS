import {
  RECOVERY_DESTINATION_ACTION,
  RECOVERY_ROW_CLASSIFICATION
} from './localTenantRecoveryPolicy';

export const RECOVERY_COPY_MANIFEST_VERSION = 1;
const COPY_MANIFEST_FINGERPRINT_DOMAIN = 'lanzo-local-recovery-copy-manifest-v1';

const manifestError = (code, details = {}) => Object.assign(new Error(code), { code, details });
const bytesToHex = (value) => Array.from(new Uint8Array(value))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');
const stableSortRows = (rows = []) => [...rows].sort((left, right) => (
  `${left.store}:${left.ref}:${left.tier || ''}`.localeCompare(`${right.store}:${right.ref}:${right.tier || ''}`)
));

const sha256 = async (value, cryptoProvider = globalThis.crypto) => {
  if (!cryptoProvider?.subtle?.digest) throw manifestError('RECOVERY_COPY_MANIFEST_CRYPTO_UNAVAILABLE');
  const result = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return bytesToHex(result);
};

const projectionRow = (row, classification) => ({
  ref: row?.ref,
  store: row?.store,
  classification,
  destinationAction: row?.destinationAction,
  tier: row?.tier || null
});

const PLAN_BUCKETS = Object.freeze([
  [RECOVERY_ROW_CLASSIFICATION.PROVEN_DIRECT, 'provenDirect'],
  [RECOVERY_ROW_CLASSIFICATION.PROVEN_RELATIONAL, 'provenRelational'],
  [RECOVERY_ROW_CLASSIFICATION.CLOUD_RECONCILABLE, 'cloudReconciliationRequired'],
  [RECOVERY_ROW_CLASSIFICATION.AMBIGUOUS, 'ambiguous'],
  [RECOVERY_ROW_CLASSIFICATION.FOREIGN, 'foreign'],
  [RECOVERY_ROW_CLASSIFICATION.DERIVED_RECOMPUTE, 'derivedRecompute']
]);

export const createRecoveryPlanExecutionProjection = (plan) => {
  if (!plan) throw manifestError('RECOVERY_PLAN_REQUIRED');
  const rows = PLAN_BUCKETS.flatMap(([classification, property]) => (
    (plan[property] || []).map((row) => projectionRow(row, classification))
  ));
  // `quarantined` is a compatibility summary which repeats primary buckets.
  // Keep only summary-only rows in the execution projection.
  const primaryRefs = new Set(rows.map((row) => row.ref));
  rows.push(...(plan.quarantined || [])
    .filter((row) => !primaryRefs.has(row.ref))
    .map((row) => projectionRow(row, 'QUARANTINED')));
  const seen = new Map();
  const uniqueRows = [];
  for (const row of rows) {
    if (!row.ref || !row.store) throw manifestError('RECOVERY_COPY_REF_REQUIRED');
    const previous = seen.get(row.ref);
    // A duplicate inside a primary semantic bucket is ambiguous provenance.
    if (previous && JSON.stringify(previous) === JSON.stringify(row)) continue;
    if (previous) throw manifestError('RECOVERY_COPY_REF_COLLISION');
    seen.set(row.ref, row);
    uniqueRows.push(row);
  }
  return Object.freeze(stableSortRows(uniqueRows));
};

export const createRecoveryCopyManifest = async ({
  recoveryPlan,
  revalidatedPlan = recoveryPlan,
  destinationSchemaFingerprint,
  cryptoProvider = globalThis.crypto
} = {}) => {
  if (!destinationSchemaFingerprint) throw manifestError('RECOVERY_DESTINATION_SCHEMA_FINGERPRINT_REQUIRED');
  if (revalidatedPlan.sourceSnapshotFingerprint !== recoveryPlan.sourceSnapshotFingerprint) {
    throw manifestError('RECOVERY_SOURCE_SNAPSHOT_CHANGED');
  }
  if (revalidatedPlan.recoveryContextFingerprint !== recoveryPlan.recoveryContextFingerprint) {
    throw manifestError('RECOVERY_TENANT_CONTEXT_CHANGED');
  }
  const suppliedProjection = createRecoveryPlanExecutionProjection(recoveryPlan);
  const revalidatedProjection = createRecoveryPlanExecutionProjection(revalidatedPlan);
  if (JSON.stringify(suppliedProjection) !== JSON.stringify(revalidatedProjection)) {
    throw manifestError('RECOVERY_COPY_PLAN_POLICY_CHANGED');
  }

  const copyItems = suppliedProjection.filter((row) => (
    [RECOVERY_ROW_CLASSIFICATION.PROVEN_DIRECT, RECOVERY_ROW_CLASSIFICATION.PROVEN_RELATIONAL]
      .includes(row.classification) &&
    row.destinationAction === RECOVERY_DESTINATION_ACTION.COPY_IF_PROVEN
  ));
  const copyItemsByStore = Object.fromEntries(Object.entries(copyItems.reduce((counts, row) => {
    counts[row.store] = (counts[row.store] || 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right)));
  const excludedCounts = Object.fromEntries(Object.entries(suppliedProjection
    .filter((row) => !copyItems.includes(row))
    .reduce((counts, row) => {
      const key = `${row.classification}:${row.destinationAction}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right)));
  const recomputeSummary = Object.fromEntries(Object.entries(suppliedProjection
    .filter((row) => row.destinationAction === RECOVERY_DESTINATION_ACTION.RECOMPUTE)
    .reduce((counts, row) => {
      counts[row.store] = (counts[row.store] || 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right)));
  const projection = {
    version: RECOVERY_COPY_MANIFEST_VERSION,
    sourceSnapshotFingerprint: recoveryPlan.sourceSnapshotFingerprint,
    recoveryContextFingerprint: recoveryPlan.recoveryContextFingerprint,
    recoveryPlanVersion: recoveryPlan.version,
    destinationSchemaFingerprint,
    copyItems,
    excludedCounts,
    recomputeSummary
  };
  const manifestFingerprint = `sha256:${await sha256({
    domain: COPY_MANIFEST_FINGERPRINT_DOMAIN,
    projection
  }, cryptoProvider)}`;

  return Object.freeze({
    ...projection,
    status: 'COPY_MANIFEST_READY',
    copyItemCount: copyItems.length,
    copyItemsByStore,
    manifestFingerprint
  });
};
