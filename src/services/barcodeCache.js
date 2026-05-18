import {
  resolveBarcode,
  resolveBarcodeByStaticReference,
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

export const resolveWithCache = async (code, skipCache = false) => {
  if (!code || typeof code !== 'string') {
    throw new Error('Codigo invalido');
  }

  const normalizedCode = normalizeCode(code);

  if (!skipCache) {
    const cachedReference = barcodeCache.get(normalizedCode);

    if (cachedReference) {
      stats.hits += 1;

      const liveProduct = await resolveBarcodeByStaticReference(cachedReference, code);

      if (liveProduct) {
        return structuredClone(liveProduct);
      }

      barcodeCache.delete(normalizedCode);
    }
  }

  stats.misses += 1;

  try {
    const product = await resolveBarcode(code);

    if (!product) {
      return null;
    }

    if (!barcodeCache.has(normalizedCode) && barcodeCache.size >= MAX_CACHE_SIZE) {
      barcodeCache.clear();
    }

    barcodeCache.set(normalizedCode, toStaticReference(product));

    return structuredClone(product);
  } catch (error) {
    stats.errors += 1;
    Logger.error('Error en resolveWithCache:', error);
    throw error;
  }
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
