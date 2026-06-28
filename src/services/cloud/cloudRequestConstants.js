export const CLOUD_REQUEST_TTL = Object.freeze({
  VERY_SHORT: 5 * 1000,
  SHORT: 15 * 1000,
  MEDIUM: 60 * 1000,
  REPORTS: 2 * 60 * 1000,
  LONG: 5 * 60 * 1000
});

export const CLOUD_REQUEST_COOLDOWN = Object.freeze({
  VERY_SHORT: 1500,
  SHORT: 3000,
  DEFAULT: 5000,
  REPORTS: 5000,
  SNAPSHOT: 5000
});

export const CLOUD_REQUEST_BACKOFF = Object.freeze({
  BASE_MS: 2000,
  MAX_MS: 30 * 1000,
  MAX_ATTEMPTS: 5
});

export const CLOUD_REQUEST_CACHE = Object.freeze({
  MAX_ENTRIES: 250,
  CLEANUP_INTERVAL_MS: 60 * 1000
});

export const CLOUD_REQUEST_TAGS = Object.freeze({
  REPORTS: 'reports',
  CASH: 'cash',
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  CUSTOMER_CREDIT: 'customer_credit',
  SALES: 'sales',
  SYNC: 'sync',
  LICENSE: 'license'
});

export const ENABLE_CLOUD_REQUEST_DEBUG = (() => {
  try {
    return Boolean(import.meta.env?.DEV) || import.meta.env?.VITE_CLOUD_REQUEST_DEBUG === 'true';
  } catch {
    return false;
  }
})();
