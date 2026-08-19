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
  isCanonicalCashStation
});
