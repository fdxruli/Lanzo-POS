import {
  batchToCloudPayload, categoryToCloudPayload, productToCloudPayload,
  cloudBatchToLocal, cloudCategoryToLocal, cloudProductToLocal
} from './productMapper';

const normalizeStableValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizeStableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeStableValue(value[key])]));
  }
  return value;
};

export const stableStringify = (value) => JSON.stringify(normalizeStableValue(value));

export const fingerprint = (value) => {
  const input = String(value ?? '');
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    const char = BigInt(input.charCodeAt(index));
    first = ((first ^ char) * 0x100000001b3n) & mask;
    second = ((second ^ (char + BigInt(index))) * 0x100000001b3n) & mask;
  }
  return `${first.toString(16).padStart(16, '0')}${second.toString(16).padStart(16, '0')}`;
};

export const buildIndividualRecoveryIdempotencyKey = ({ licenseKey, product, batches = [] } = {}) => (
  `product-local-recovery:v1:${fingerprint(stableStringify({ licenseKey, product, batches }))}`
);

const withoutCloudTimestamps = (payload) => {
  const businessPayload = { ...(payload || {}) };
  delete businessPayload.created_at;
  delete businessPayload.updated_at;
  for (const field of ['recipe', 'wholesale_tiers']) {
    if (businessPayload[field] === null || businessPayload[field] === undefined) businessPayload[field] = [];
  }
  return businessPayload;
};

const completeCloudPayloadMatches = (local, cloud, toPayload, fromCloud) => Boolean(local && cloud)
  && stableStringify(withoutCloudTimestamps(toPayload(local)))
    === stableStringify(withoutCloudTimestamps(toPayload(fromCloud(cloud, null))));

// Compare the full writable catalog payload after the canonical Cloud-to-local mapping.
// This tolerates mapper normalization (for example null optional arrays) while checking
// quantities, attributes, metadata, and every other field that recovery writes.
export const checkCompleteProductPayload = (local, cloud) => (
  completeCloudPayloadMatches(local, cloud, productToCloudPayload, cloudProductToLocal)
);

export const checkCompleteCategoryPayload = (local, cloud) => (
  completeCloudPayloadMatches(local, cloud, categoryToCloudPayload, cloudCategoryToLocal)
);

export const checkCompleteBatchPayload = (local, cloud) => (
  completeCloudPayloadMatches(local, cloud, batchToCloudPayload, cloudBatchToLocal)
);

export const hasExplicitTenantMismatch = (record, licenseKey) => {
  const recordLicenseKey = record?.licenseKey || record?.license_key
    || record?.metadata?.licenseKey || record?.metadata?.license_key;
  return Boolean(recordLicenseKey && recordLicenseKey !== licenseKey);
};

export const isLocalWithoutCloudHistory = (record) => record?.id
  && !record.lastSyncedAt && !record.last_synced_at
  && [record.serverVersion, record.server_version].every((version) => version === undefined || version === null || version === 0)
  && !record.pendingOperationId && !record.deletionPending;
