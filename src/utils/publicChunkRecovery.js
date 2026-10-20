const CHUNK_ERROR_PATTERN = /ChunkLoadError|Loading chunk [\d-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;
const RECOVERY_KEY = 'lanzo:public-chunk-recovery:v1';

const safeRead = (value, key) => {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
};

const getSessionStorage = (locationRef) => {
  try {
    return locationRef?.storage || globalThis.sessionStorage || null;
  } catch {
    return null;
  }
};

export const isPublicChunkLoadError = (error) => {
  const message = [
    safeRead(error, 'name'),
    safeRead(error, 'message'),
    safeRead(safeRead(error, 'reason'), 'message'),
    safeRead(safeRead(error, 'error'), 'message')
  ]
    .filter(Boolean)
    .join(' ');
  return CHUNK_ERROR_PATTERN.test(message);
};

// One tab-wide mark avoids storing a public store slug or route-derived value.
export const getPublicChunkRecoveryKey = () => RECOVERY_KEY;

export function recoverFromPublicChunkError(error, {
  locationRef = globalThis.window?.location,
  storage,
  navigatorRef = globalThis.navigator
} = {}) {
  if (!isPublicChunkLoadError(error)) return false;
  if (navigatorRef?.onLine === false || typeof locationRef?.reload !== 'function') return false;

  const key = RECOVERY_KEY;
  const resolvedStorage = storage || getSessionStorage(locationRef);
  if (!resolvedStorage) return false;
  try {
    if (resolvedStorage.getItem(key) === 'attempted') return false;
    resolvedStorage.setItem(key, 'attempted');
  } catch {
    // Without a durable one-shot marker, reloading could create a recovery loop.
    return false;
  }
  locationRef.reload();
  return true;
}
