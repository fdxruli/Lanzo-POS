const CHUNK_ERROR_PATTERN = /ChunkLoadError|Loading chunk [\d-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;
const STORAGE_PREFIX = 'lanzo:public-chunk-recovery:';

export const isPublicChunkLoadError = (error) => {
  const message = [error?.name, error?.message, error?.reason?.message, error?.error?.message]
    .filter(Boolean)
    .join(' ');
  return CHUNK_ERROR_PATTERN.test(message);
};

export const getPublicChunkRecoveryKey = (locationRef = window.location) => (
  `${STORAGE_PREFIX}${locationRef.pathname}`
);

export function recoverFromPublicChunkError(error, {
  locationRef = window.location,
  storage = window.sessionStorage
} = {}) {
  if (!isPublicChunkLoadError(error)) return false;
  const key = getPublicChunkRecoveryKey(locationRef);
  if (storage.getItem(key) === 'attempted') return false;
  storage.setItem(key, 'attempted');
  locationRef.reload();
  return true;
}

export function markPublicStoreBootSuccessful({
  locationRef = window.location,
  storage = window.sessionStorage
} = {}) {
  storage.removeItem(getPublicChunkRecoveryKey(locationRef));
}
