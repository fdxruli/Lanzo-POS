import {
  resolveBarcodeResult,
} from './barcodeResolver';
import Logger from './Logger';

const MAX_CACHE_SIZE = 500;

const barcodeCache = new Map();

const stats = {
  hits: 0,
  misses: 0,
  errors: 0,
};

const normalizeCode = (code) => code.trim().toLowerCase();

const toStaticReference = (product) => ({
  id: product.id,
  isVariant: Boolean(product.isVariant),
  batchId: product.isVariant ? product.batchId || null : null,
  skuDetected: product.skuDetected || null,
});

// A cache entry never grants sale authority. Every read rechecks the
// tenant-local catalog, including newly inserted duplicate barcodes.
export const resolveWithCacheResult = async (code, skipCache = false) => {
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new Error('Codigo invalido');
  }
  const normalizedCode = normalizeCode(code);
  const cachedReference = !skipCache ? barcodeCache.get(normalizedCode) : null;

  try {
    const result = await resolveBarcodeResult(code);

    if (cachedReference) {
      stats.hits += 1;
      barcodeCache.delete(normalizedCode);
    } else {
      stats.misses += 1;
    }

    if (result.status !== 'RESOLVED') {
      barcodeCache.delete(normalizedCode);
      return structuredClone(result);
    }

    if (!cachedReference || String(cachedReference.id) !== String(result.product.id)) {
      if (barcodeCache.size >= MAX_CACHE_SIZE) {
        const keysToDelete = Math.ceil(MAX_CACHE_SIZE * 0.1);
        const iterator = barcodeCache.keys();
        for (let index = 0; index < keysToDelete; index += 1) {
          barcodeCache.delete(iterator.next().value);
        }
      }
    }

    barcodeCache.set(normalizedCode, toStaticReference(result.product));
    return structuredClone(result);
  } catch (error) {
    stats.errors += 1;
    Logger.error('Error en resolveWithCache:', error);
    throw error;
  }
};

export const resolveWithCache = async (code, skipCache = false) => {
  const result = await resolveWithCacheResult(code, skipCache);
  return result.status === 'RESOLVED' ? result.product : null;
};

export const invalidateCacheEntry = (code) => {
  if (!code) return;
  barcodeCache.delete(normalizeCode(code));
};

export const clearCache = () => {
  barcodeCache.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.errors = 0;
};

export const getCacheStats = () => {
  const total = stats.hits + stats.misses;

  return {
    hits: stats.hits,
    misses: stats.misses,
    errors: stats.errors,
    hitRate: total > 0 ? `${((stats.hits / total) * 100).toFixed(2)}%` : '0%',
    size: barcodeCache.size,
  };
};

export const isCached = (code) => {
  if (!code) return false;
  return barcodeCache.has(normalizeCode(code));
};

export const getCacheSize = () => barcodeCache.size;
