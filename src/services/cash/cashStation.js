import { getStableDeviceId } from '../supabase';
import {
  getTenantStorageItem,
  setTenantStorageItem
} from '../tenant/tenantScopedStorage';

export const CASH_STATION_IDENTITY_STATE = Object.freeze({
  CANONICAL: 'canonical',
  LOCAL: 'local',
  DETERMINISTIC_DEVICE_BOUND: 'deterministic-device-bound',
  LEGACY_UNRESOLVED: 'legacy_unresolved'
});

export const LOCAL_STATION_KEY_PREFIX = 'local:device:';
export const CANONICAL_DEVICE_STATION_PREFIX = 'cash_station_device_';

const CASH_STATION_BINDINGS_KEY = 'cash-station-bindings-v1';
const CASH_STATION_BINDINGS_VERSION = 1;

const normalizeIdentifier = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const hashIdentifier = (value) => {
  const input = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeUuid = (value) => {
  const normalized = normalizeIdentifier(value);
  return normalized && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
};

export const isLocalStationKey = (value) => (
  typeof value === 'string' && value.trim().startsWith(LOCAL_STATION_KEY_PREFIX)
);

const stationCandidate = (record) => {
  if (typeof record === 'string') return normalizeIdentifier(record);
  return normalizeIdentifier(record?.cashStationId || record?.cash_station_id);
};

/**
 * A cloud station is not an alias of a browser-local key. The only valid
 * cross-record comparison is an exact comparison within the same identity
 * domain.
 */
export const isCanonicalCashStation = (record) => {
  const candidate = stationCandidate(record);
  return Boolean(candidate && !isLocalStationKey(candidate));
};

export const areCashStationsEquivalent = (left, right) => {
  const leftId = normalizeIdentifier(left);
  const rightId = normalizeIdentifier(right);
  return Boolean(leftId && rightId && leftId === rightId);
};

const firstCashStationId = (...values) => values
  .map(normalizeIdentifier)
  .find((value) => isCanonicalCashStation(value)) || null;

/**
 * Read only server-provided station evidence. The top-level `cash_station`
 * object is preferred; the remaining fields support older RPC response
 * shapes and the canonical station propagated by the financial intent path.
 */
export const getCashStationIdFromCloudResponse = (response = {}) => firstCashStationId(
  response?.cash_station?.id,
  response?.cashStation?.id,
  response?.cash_station_id,
  response?.cashStationId,
  response?.resolvedCashStationId,
  response?.cash_session?.cash_station_id,
  response?.cash_session?.cashStationId,
  response?.cash_session?.metadata?.cash_station_id,
  response?.cash_session?.metadata?.cashStationId
);

const readBindingDocument = () => {
  const raw = getTenantStorageItem(CASH_STATION_BINDINGS_KEY);
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.version === CASH_STATION_BINDINGS_VERSION && parsed?.bindings
      && typeof parsed.bindings === 'object'
      ? parsed
      : null;
  } catch {
    return null;
  }
};

/**
 * Reads a tenant-scoped browser binding. Raw license/fingerprint values are
 * deliberately not serialized; the active tenant namespace is an additional
 * boundary, while the hashes avoid leaking identifiers into localStorage.
 */
export const getCashStationBinding = ({ licenseKey = null, deviceFingerprint = null } = {}) => {
  const license = normalizeIdentifier(licenseKey);
  const fingerprint = normalizeIdentifier(deviceFingerprint);
  if (!license || !fingerprint) return null;

  const document = readBindingDocument();
  const licenseKeyHash = hashIdentifier(license);
  const fingerprintHash = hashIdentifier(fingerprint);
  if (!document || document.licenseKeyHash !== licenseKeyHash) return null;

  const binding = document.bindings[fingerprintHash];
  if (!binding
    || binding.licenseKeyHash !== licenseKeyHash
    || binding.deviceFingerprintHash !== fingerprintHash
    || !isCanonicalCashStation(binding.cashStationId)) {
    return null;
  }

  return Object.freeze({
    cashStationId: binding.cashStationId,
    deviceId: normalizeUuid(binding.deviceId),
    stationKey: normalizeIdentifier(binding.stationKey),
    bindingMode: normalizeIdentifier(binding.bindingMode)
  });
};

/**
 * Persists only authenticated cloud authority. A local synthetic key can
 * never be written as a cash-station binding.
 */
export const persistCashStationBinding = ({
  licenseKey = null,
  deviceFingerprint = null,
  cashStationId = null,
  deviceId = null,
  stationKey = null,
  bindingMode = 'device'
} = {}) => {
  const license = normalizeIdentifier(licenseKey);
  const fingerprint = normalizeIdentifier(deviceFingerprint);
  const station = normalizeIdentifier(cashStationId);
  if (!license || !fingerprint || !isCanonicalCashStation(station)) return false;

  const licenseKeyHash = hashIdentifier(license);
  const deviceFingerprintHash = hashIdentifier(fingerprint);
  const current = readBindingDocument();
  const bindings = current?.licenseKeyHash === licenseKeyHash
    ? { ...current.bindings }
    : {};

  bindings[deviceFingerprintHash] = {
    licenseKeyHash,
    deviceFingerprintHash,
    cashStationId: station,
    deviceId: normalizeUuid(deviceId),
    stationKey: normalizeIdentifier(stationKey),
    bindingMode: normalizeIdentifier(bindingMode) || 'device'
  };

  setTenantStorageItem(CASH_STATION_BINDINGS_KEY, JSON.stringify({
    version: CASH_STATION_BINDINGS_VERSION,
    licenseKeyHash,
    bindings
  }));
  return true;
};

/**
 * The browser identity contains provenance and a local storage key. The
 * financial station remains null until an authenticated cloud response has
 * established the tenant/device binding.
 */
export const getCashStationIdentity = async ({
  licenseKey = null,
  deviceFingerprint = null,
  deviceId = null
} = {}) => {
  const stableDeviceFingerprint = normalizeIdentifier(
    deviceFingerprint || deviceId || await getStableDeviceId()
  );
  if (!stableDeviceFingerprint) {
    const error = new Error('CASH_STATION_UNRESOLVED');
    error.code = 'CASH_STATION_UNRESOLVED';
    throw error;
  }

  const binding = getCashStationBinding({
    licenseKey,
    deviceFingerprint: stableDeviceFingerprint
  });

  return Object.freeze({
    deviceFingerprint: stableDeviceFingerprint,
    localStationKey: `${LOCAL_STATION_KEY_PREFIX}${stableDeviceFingerprint}`,
    cashStationId: binding?.cashStationId || null,
    deviceId: binding?.deviceId || null,
    stationKey: binding?.stationKey || null,
    identityState: binding
      ? CASH_STATION_IDENTITY_STATE.CANONICAL
      : CASH_STATION_IDENTITY_STATE.LEGACY_UNRESOLVED,
    bindingMode: binding?.bindingMode || null
  });
};

export const getLocalStationKey = async (options = {}) => (
  (await getCashStationIdentity(options)).localStationKey
);

// Kept as a compatibility export for callers that still use the old name.
export const getLocalCashStationId = getLocalStationKey;

export default Object.freeze({
  CASH_STATION_IDENTITY_STATE,
  LOCAL_STATION_KEY_PREFIX,
  CANONICAL_DEVICE_STATION_PREFIX,
  getCashStationIdentity,
  getCashStationBinding,
  persistCashStationBinding,
  getLocalStationKey,
  getLocalCashStationId,
  isLocalStationKey,
  isCanonicalCashStation,
  areCashStationsEquivalent,
  getCashStationIdFromCloudResponse
});
