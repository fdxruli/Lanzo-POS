import { getStableDeviceId } from '../supabase';

export const CASH_STATION_IDENTITY_STATE = Object.freeze({
  CANONICAL: 'canonical',
  DETERMINISTIC_DEVICE_BOUND: 'deterministic-device-bound',
  LEGACY_UNRESOLVED: 'legacy_unresolved'
});

const normalizeDeviceId = (deviceId) => {
  const value = String(deviceId || '').trim();
  return value || null;
};

const normalizeCashStationId = (cashStationId) => {
  const value = String(cashStationId || '').trim();
  return value || null;
};

const LEGACY_DEVICE_STATION_PREFIX = 'local:device:';
const CANONICAL_DEVICE_STATION_PREFIX = 'cash_station_device_';

const getDeviceBoundStationIdentity = (cashStationId) => {
  const normalized = normalizeCashStationId(cashStationId);
  if (!normalized) return null;

  const prefix = normalized.startsWith(LEGACY_DEVICE_STATION_PREFIX)
    ? LEGACY_DEVICE_STATION_PREFIX
    : normalized.startsWith(CANONICAL_DEVICE_STATION_PREFIX)
      ? CANONICAL_DEVICE_STATION_PREFIX
      : null;
  if (!prefix) return null;

  const deviceId = normalizeDeviceId(normalized.slice(prefix.length));
  return deviceId ? { deviceId } : null;
};

/**
 * The browser used a legacy local representation before the server became
 * the cash-station authority. Only the two complete device-bound forms are
 * aliases; arbitrary station ids never match by prefix or partial text.
 */
export const areCashStationsEquivalent = (left, right) => {
  const leftId = normalizeCashStationId(left);
  const rightId = normalizeCashStationId(right);
  if (!leftId || !rightId) return false;
  if (leftId === rightId) return true;

  const leftIdentity = getDeviceBoundStationIdentity(leftId);
  const rightIdentity = getDeviceBoundStationIdentity(rightId);
  return Boolean(leftIdentity && rightIdentity && leftIdentity.deviceId === rightIdentity.deviceId);
};

const firstCashStationId = (...values) => values
  .map(normalizeCashStationId)
  .find(Boolean) || null;

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

/**
 * Local storage remains tenant-scoped.  This identity is a binding between a
 * stable device provenance and a financial station; it is not an actor and it
 * never grants permission or ownership.
 */
export const getCashStationIdentity = async ({ deviceId = null } = {}) => {
  const stableDeviceId = normalizeDeviceId(deviceId || await getStableDeviceId());
  if (!stableDeviceId) {
    const error = new Error('CASH_STATION_UNRESOLVED');
    error.code = 'CASH_STATION_UNRESOLVED';
    throw error;
  }

  return Object.freeze({
    deviceId: stableDeviceId,
    cashStationId: `local:device:${stableDeviceId}`,
    stationKey: `device_default:${stableDeviceId}`,
    identityState: CASH_STATION_IDENTITY_STATE.DETERMINISTIC_DEVICE_BOUND,
    bindingMode: 'device_default'
  });
};

export const getLocalCashStationId = async (options = {}) => (
  (await getCashStationIdentity(options)).cashStationId
);

export const isCanonicalCashStation = (record) => Boolean(
  record?.cashStationId || record?.cash_station_id
);

export default Object.freeze({
  CASH_STATION_IDENTITY_STATE,
  getCashStationIdentity,
  getLocalCashStationId,
  isCanonicalCashStation,
  areCashStationsEquivalent,
  getCashStationIdFromCloudResponse
});
