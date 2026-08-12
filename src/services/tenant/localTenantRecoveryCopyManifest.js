import {
  RECOVERY_DESTINATION_ACTION,
  RECOVERY_ROW_CLASSIFICATION
} from './localTenantRecoveryPolicy';

export const RECOVERY_COPY_MANIFEST_VERSION = 1;
const COPY_MANIFEST_FINGERPRINT_DOMAIN = 'lanzo-local-recovery-copy-manifest-v1';

const manifestError = (code, details = {}) => Object.assign(new Error(code), { code, details });
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};
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

const projectionRow = (row, classification) => Object.freeze({
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
  const primaryRows = PLAN_BUCKETS.flatMap(([classification, property]) => (
    (plan[property] || []).map((row) => projectionRow(row, classification))
  ));
  const primaryByRef = new Map();
  const uniqueRows = [];
  for (const row of primaryRows) {
    if (!row.ref || !row.store) throw manifestError('RECOVERY_COPY_REF_REQUIRED');
    // Two primary execution rows may be distinct physical records even when
    // their redacted projection is identical. Never deduplicate that case.
    if (primaryByRef.has(row.ref)) throw manifestError('RECOVERY_COPY_REF_COLLISION');
    primaryByRef.set(row.ref, row);
    uniqueRows.push(row);
  }
  for (const summarySourceRow of plan.quarantined || []) {
    const summaryRow = projectionRow(summarySourceRow, 'QUARANTINED');
    if (!summaryRow.ref || !summaryRow.store) throw manifestError('RECOVERY_COPY_REF_REQUIRED');
    const primaryRow = primaryByRef.get(summaryRow.ref);
    if (primaryRow) {
      // `quarantined` is a compatibility summary. It is only redundant when
      // it describes exactly the same primary provenance row.
      if (
        primaryRow.store !== summaryRow.store ||
        primaryRow.destinationAction !== summaryRow.destinationAction ||
        primaryRow.tier !== summaryRow.tier
      ) {
        throw manifestError('RECOVERY_COPY_REF_COLLISION');
      }
      continue;
    }
    if (uniqueRows.some((row) => row.ref === summaryRow.ref)) {
      throw manifestError('RECOVERY_COPY_REF_COLLISION');
    }
    uniqueRows.push(summaryRow);
  }
  return deepFreeze(stableSortRows(uniqueRows));
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

  return deepFreeze({
    ...projection,
    status: 'COPY_MANIFEST_READY',
    copyItemCount: copyItems.length,
    copyItemsByStore,
    manifestFingerprint
  });
};
