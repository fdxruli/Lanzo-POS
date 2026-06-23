const sanitizeSegment = (value, fallback = 'unknown') => {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
};

const randomHex = (bytes = 8) => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint8Array(bytes);
    crypto.getRandomValues(buffer);
    return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return Math.random().toString(16).slice(2).padEnd(bytes * 2, '0').slice(0, bytes * 2);
};

export const generateIdempotencyKey = ({
  entityType = 'generic',
  operation = 'unknown',
  entityId = 'new',
  deviceId = null,
  prefix = 'pos'
} = {}) => {
  const timestamp = Date.now().toString(36);
  const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : randomHex(16);

  return [
    sanitizeSegment(prefix, 'pos'),
    sanitizeSegment(entityType, 'generic'),
    sanitizeSegment(operation, 'unknown'),
    sanitizeSegment(entityId, 'new'),
    sanitizeSegment(deviceId || 'device'),
    timestamp,
    randomPart
  ].join(':');
};

export const buildOperationHashInput = ({ entityType, operation, entityId, payload } = {}) => JSON.stringify({
  entityType: entityType || null,
  operation: operation || null,
  entityId: entityId || null,
  payload: payload || null
});
