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
  typeof value === 'string'
  && value.trim().startsWith(LOCAL_STATION_KEY_PREFIX)
  && value.trim().slice(LOCAL_STATION_KEY_PREFIX.length).length > 0
);

const stationCandidate = (record) => {
  if (typeof record === 'string') return normalizeIdentifier(record);
  return normalizeIdentifier(
    record?.cashStationId
      || record?.cash_station_id
      || record?.id
  );
};

const CANONICAL_CASH_STATION_PATTERN = new RegExp(
  '^' + CANONICAL_DEVICE_STATION_PREFIX
    + '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'i'
);

/**
 * A cloud station is a canonical server identity, never a browser-local
 * alias, a raw device fingerprint or a partial/suffixed identifier.
 */
export const isCanonicalCashStation = (record) => {
  const candidate = stationCandidate(record);
  return Boolean(candidate && CANONICAL_CASH_STATION_PATTERN.test(candidate));
};

export const areCashStationsEquivalent = (left, right) => {
  const leftId = normalizeIdentifier(left);
  const rightId = normalizeIdentifier(right);
  if (!leftId || !rightId || leftId !== rightId) return false;

  const sameLocalDomain = isLocalStationKey(leftId) && isLocalStationKey(rightId);
  const sameCloudDomain = isCanonicalCashStation(leftId) && isCanonicalCashStation(rightId);
  return sameLocalDomain || sameCloudDomain;
};

const addStationEvidence = (evidence, source, value) => {
  const normalized = normalizeIdentifier(value);
  if (normalized) evidence.push({ source, value: normalized });
};

const addStationRecordEvidence = (evidence, record, sourcePrefix) => {
  if (!record || typeof record !== 'object') return;

  addStationEvidence(evidence, sourcePrefix + '.cash_station_id', record.cash_station_id);
  addStationEvidence(evidence, sourcePrefix + '.cashStationId', record.cashStationId);
  addStationEvidence(evidence, sourcePrefix + '.resolved_cash_station_id', record.resolved_cash_station_id);
  addStationEvidence(evidence, sourcePrefix + '.resolvedCashStationId', record.resolvedCashStationId);
};

const addNestedStationEvidence = (evidence, record, sourcePrefix) => {
  if (!record || typeof record !== 'object') return;

  addStationEvidence(evidence, sourcePrefix + '.cash_station.id', record.cash_station?.id);
  addStationEvidence(evidence, sourcePrefix + '.cashStation.id', record.cashStation?.id);
  addStationRecordEvidence(evidence, record, sourcePrefix);
};

export const getCashStationEvidence = (response = {}) => {
  const evidence = [];
  if (!response || typeof response !== 'object') return evidence;

  addNestedStationEvidence(evidence, response, 'response');

  const cashSession = response.cash_session || response.cashSession;
  addNestedStationEvidence(evidence, cashSession, 'response.cash_session');

  const directMovement = response.movement || response.cashMovement;
  addNestedStationEvidence(evidence, directMovement, 'response.movement');

  const sessions = Array.isArray(response.cash_sessions)
    ? response.cash_sessions
    : Array.isArray(response.cashSessions)
      ? response.cashSessions
      : [];
  for (const session of sessions) {
    addNestedStationEvidence(evidence, session, 'response.cash_sessions');
  }

  const movements = Array.isArray(response.movements) ? response.movements : [];
  for (const movement of movements) {
    addNestedStationEvidence(evidence, movement, 'response.movements');
  }

  const stationOpenCashSession = response.station_open_cash_session
    || response.stationOpenCashSession;
  addNestedStationEvidence(evidence, stationOpenCashSession, 'response.station_open_cash_session');

  return evidence.map((entry) => Object.freeze(entry));
};

/**
 * Read only server-provided station evidence. The first canonical value is
 * preferred, while callers can inspect all evidence to reject conflicts.
 */
export const getCashStationIdFromCloudResponse = (response = {}) => (
  getCashStationEvidence(response).find((entry) => isCanonicalCashStation(entry.value))?.value || null
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
  if (!license || !fingerprint || isLocalStationKey(fingerprint)) return null;

  const document = readBindingDocument();
  const licenseKeyHash = hashIdentifier(license);
  const fingerprintHash = hashIdentifier(fingerprint);
  if (!document || document.licenseKeyHash !== licenseKeyHash) return null;

  const binding = document.bindings[fingerprintHash];
  const bindingDeviceId = normalizeUuid(binding?.deviceId);
  const bindingMatchesDevice = !bindingDeviceId
    || binding.cashStationId === CANONICAL_DEVICE_STATION_PREFIX + bindingDeviceId;
  if (!binding
    || binding.licenseKeyHash !== licenseKeyHash
    || binding.deviceFingerprintHash !== fingerprintHash
    || !isCanonicalCashStation(binding.cashStationId)
    || !bindingMatchesDevice) {
    return null;
  }

  return Object.freeze({
    cashStationId: binding.cashStationId,
    deviceId: bindingDeviceId,
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
  const canonicalDeviceId = normalizeUuid(deviceId);
  if (!license || !fingerprint || isLocalStationKey(fingerprint)
    || !isCanonicalCashStation(station)) return false;
  if (deviceId && !canonicalDeviceId) return false;
  if (canonicalDeviceId
    && station !== CANONICAL_DEVICE_STATION_PREFIX + canonicalDeviceId) return false;

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
    deviceId: canonicalDeviceId,
    stationKey: isLocalStationKey(stationKey)
      ? null
      : normalizeIdentifier(stationKey),
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
  // deviceId is cloud metadata and can never become the browser fingerprint.
  // Keeping these domains separate prevents localStationKey/cloud station
  // comparisons from changing when the actor changes on the same terminal.
  const suppliedFingerprint = normalizeIdentifier(deviceFingerprint);
  const stableDeviceFingerprint = normalizeIdentifier(
    suppliedFingerprint && !isLocalStationKey(suppliedFingerprint)
      ? suppliedFingerprint
      : await getStableDeviceId()
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
  const suppliedDeviceId = normalizeUuid(deviceId);

  return Object.freeze({
    deviceFingerprint: stableDeviceFingerprint,
    localStationKey: LOCAL_STATION_KEY_PREFIX + stableDeviceFingerprint,
    cashStationId: binding?.cashStationId || null,
    // This remains cloud device metadata; it is never used to derive the
    // browser fingerprint or a local station key.
    deviceId: binding?.deviceId || suppliedDeviceId || null,
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
  getCashStationEvidence,
  getCashStationIdFromCloudResponse
});
