const ORDER_DEVICE_STORAGE_KEY = 'lanzo_order_device_id';
const PRIMARY_DEVICE_STORAGE_KEY = 'lanzo_device_id';
const LEGACY_REVISION = 0;

const readStorageValue = (key) => {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorageValue = (key, value) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Versioning must not block POS edits when storage is unavailable.
  }
};

const createFallbackDeviceId = () => {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `pos-${randomId}`;

  return `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const getOrderDeviceId = () => {
  const primaryDeviceId = readStorageValue(PRIMARY_DEVICE_STORAGE_KEY);
  if (primaryDeviceId) return primaryDeviceId;

  const existingOrderDeviceId = readStorageValue(ORDER_DEVICE_STORAGE_KEY);
  if (existingOrderDeviceId) return existingOrderDeviceId;

  const newDeviceId = createFallbackDeviceId();
  writeStorageValue(ORDER_DEVICE_STORAGE_KEY, newDeviceId);
  return newDeviceId;
};

export const normalizeOrderRevision = (value) => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : LEGACY_REVISION;
};

const getOrderTimestamp = (order) => {
  const candidates = [order?.updatedAt, order?.timestamp, order?.createdAt];

  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
};

export const compareOrderVersions = (left, right) => {
  // Conflict order: monotonic revision, timestamp, then stable writer id.
  const revisionDifference = normalizeOrderRevision(left?.revision)
    - normalizeOrderRevision(right?.revision);
  if (revisionDifference !== 0) return Math.sign(revisionDifference);

  const timestampDifference = getOrderTimestamp(left) - getOrderTimestamp(right);
  if (timestampDifference !== 0) return Math.sign(timestampDifference);

  const leftDeviceId = String(left?.deviceId || '');
  const rightDeviceId = String(right?.deviceId || '');
  if (leftDeviceId === rightDeviceId) return 0;
  return leftDeviceId > rightDeviceId ? 1 : -1;
};

export const selectNewestOrder = (localOrder, dbOrder) => (
  compareOrderVersions(localOrder, dbOrder) > 0
    ? { source: 'local', order: localOrder }
    : { source: 'db', order: dbOrder }
);

export const touchOrderVersion = (order, now = new Date().toISOString()) => ({
  revision: normalizeOrderRevision(order?.revision) + 1,
  updatedAt: now,
  deviceId: getOrderDeviceId()
});

export const getNextPersistedOrderVersion = (
  localOrder,
  existingOrder = null,
  now = new Date().toISOString()
) => ({
  revision: Math.max(
    normalizeOrderRevision(localOrder?.revision),
    normalizeOrderRevision(existingOrder?.revision)
  ) + 1,
  updatedAt: now,
  deviceId: getOrderDeviceId()
});
