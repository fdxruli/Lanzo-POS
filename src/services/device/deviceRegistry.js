import Dexie from 'dexie';

// This database is deliberately independent from both the legacy LanzoDB1
// vault and the tenant runtime. It is available before license resolution and
// is not a cache for arbitrary application data.
export const DEVICE_REGISTRY_DATABASE_NAME = 'LanzoDeviceRegistry';
export const DEVICE_REGISTRY_STORE = 'device_meta';
export const DEVICE_REGISTRY_KEYS = Object.freeze({
  STABLE_DEVICE_ID: 'lanzo_device_id',
  LICENSE_ATTEMPTS: 'lanzo_license_attempts'
});

const allowedKeys = new Set(Object.values(DEVICE_REGISTRY_KEYS));

const registry = new Dexie(DEVICE_REGISTRY_DATABASE_NAME);
registry.version(1).stores({
  [DEVICE_REGISTRY_STORE]: 'key'
});

const assertAllowedKey = (key) => {
  if (!allowedKeys.has(key)) {
    throw new Error('DEVICE_REGISTRY_KEY_NOT_ALLOWED');
  }
};

const assertAllowedValue = (key, value) => {
  if (key === DEVICE_REGISTRY_KEYS.STABLE_DEVICE_ID) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('DEVICE_REGISTRY_DEVICE_ID_INVALID');
    }
    return;
  }

  if (value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DEVICE_REGISTRY_LICENSE_ATTEMPTS_INVALID');
  }

  const keys = Object.keys(value);
  if (!keys.every((field) => field === 'attempts' || field === 'lockedUntil')
    || !Number.isInteger(value.attempts)
    || value.attempts < 0
    || (value.lockedUntil !== null && !Number.isFinite(value.lockedUntil))) {
    throw new Error('DEVICE_REGISTRY_LICENSE_ATTEMPTS_INVALID');
  }
};

// The API remains intentionally key-scoped. Both key and value validation are
// part of the boundary so no tenant identity, license key, or business record
// can be persisted here.
export const readDeviceRegistryValue = async (key) => {
  assertAllowedKey(key);
  const record = await registry.table(DEVICE_REGISTRY_STORE).get(key);
  return record?.value ?? null;
};

export const writeDeviceRegistryValue = async (key, value) => {
  assertAllowedKey(key);
  assertAllowedValue(key, value);
  await registry.table(DEVICE_REGISTRY_STORE).put({ key, value });
};

// Used only by isolated test setup before deleting the temporary IndexedDB.
export const closeDeviceRegistry = () => registry.close();
