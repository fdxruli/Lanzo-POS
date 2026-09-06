const stableHash = (value) => {
  const input = String(value ?? 'missing');
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

const sanitizePart = (value, fallback = 'na') => {
  const raw = String(value ?? fallback).trim();
  if (!raw) return fallback;
  return raw
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, 80);
};

const normalizeValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const item = value[key];
        if (item !== undefined) acc[key] = normalizeValue(item);
        return acc;
      }, {});
  }
  return value;
};

export const stableStringify = (value) => {
  if (value === undefined) return '';
  try {
    return JSON.stringify(normalizeValue(value));
  } catch {
    return String(value);
  }
};

export const hashCloudContextPart = stableHash;

export const cloudRequestTags = Object.freeze({
  license: (licenseKey) => `license:${stableHash(licenseKey)}`,
  licenseId: (licenseId) => `license_id:${stableHash(licenseId)}`,
  device: (deviceId) => `device:${stableHash(deviceId)}`,
  staff: (staffUserId) => `staff:${stableHash(staffUserId)}`,
  staffSession: (staffSessionToken) => `staff_session:${stableHash(staffSessionToken)}`,
  actor: (actorKey) => `actor:${stableHash(actorKey)}`,
  actorSession: (actorSessionId) => `actor_session:${stableHash(actorSessionId)}`,
  cashStation: (cashStationId) => `cash_station:${stableHash(cashStationId)}`,
  rpc: (rpcName) => `rpc:${sanitizePart(rpcName)}`,
  resource: (resource) => `resource:${sanitizePart(resource)}`
});

export const buildCloudContextKey = ({
  licenseKey = null,
  licenseId = null,
  deviceId = null,
  staffUserId = null,
  staffSessionToken = null,
  actorKey = null,
  actorSessionId = null,
  cashStationId = null
} = {}) => ([
  licenseKey ? cloudRequestTags.license(licenseKey) : null,
  licenseId ? cloudRequestTags.licenseId(licenseId) : null,
  deviceId ? cloudRequestTags.device(deviceId) : null,
  staffUserId ? cloudRequestTags.staff(staffUserId) : null,
  staffSessionToken ? cloudRequestTags.staffSession(staffSessionToken) : null,
  actorKey ? cloudRequestTags.actor(actorKey) : null,
  actorSessionId ? cloudRequestTags.actorSession(actorSessionId) : null,
  cashStationId ? cloudRequestTags.cashStation(cashStationId) : null
].filter(Boolean).join('|') || 'context:anonymous');

export const buildCloudRequestKey = ({ resource, context = {}, params = {} } = {}) => [
  sanitizePart(resource, 'cloud_request'),
  buildCloudContextKey(context),
  stableStringify(params)
].join('::');

export const buildRpcRequestKey = (rpcName, {
  licenseKey = null,
  licenseId = null,
  deviceId = null,
  staffUserId = null,
  staffSessionToken = null,
  actorKey = null,
  actorSessionId = null,
  cashStationId = null,
  params = {}
} = {}) => buildCloudRequestKey({
  resource: `rpc:${sanitizePart(rpcName, 'rpc')}`,
  context: {
    licenseKey,
    licenseId,
    deviceId,
    staffUserId,
    staffSessionToken,
    actorKey,
    actorSessionId,
    cashStationId
  },
  params
});

export const buildBaseRpcContextFromArgs = (licenseKey, baseArgs = {}) => ({
  licenseKey: baseArgs.p_license_key || licenseKey || null,
  deviceId: baseArgs.p_device_fingerprint || null,
  staffSessionToken: baseArgs.p_staff_session_token || null
});
