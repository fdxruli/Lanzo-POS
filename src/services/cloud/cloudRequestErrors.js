export const CLOUD_REQUEST_RESPONSE_STALE_CODE = 'CLOUD_REQUEST_RESPONSE_STALE';

export const isCloudRequestResponseStale = (value) => {
  const pending = [value];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || (typeof current !== 'object' && typeof current !== 'function') || visited.has(current)) continue;
    visited.add(current);
    if (current.code === CLOUD_REQUEST_RESPONSE_STALE_CODE) return true;
    pending.push(current.cause, current.originalError, current.error, current.response);
  }
  return false;
};
