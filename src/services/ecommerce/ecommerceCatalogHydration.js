import Logger from '../Logger';
import { productMigrationService } from '../products/productMigrationService';
import { ecommerceCatalogSyncService } from './ecommerceCatalogSyncService';

const HYDRATION_TTL_MS = 60_000;
const hydrationByLicense = new Map();

const asText = (value) => String(value ?? '').trim();
const createHydrationError = (result) => {
  const error = new Error(
    result?.message
    || result?.code
    || 'No se pudo hidratar el catálogo cloud antes de sincronizar el portal.'
  );
  error.code = result?.code || 'ECOMMERCE_CATALOG_HYDRATION_FAILED';
  error.result = result;
  return error;
};

export const hydrateEcommerceCatalogSnapshot = async ({
  licenseKey,
  force = false,
  hydrateCloudCatalog = true,
  migrationService = productMigrationService,
  getNow = () => Date.now(),
  ttlMs = HYDRATION_TTL_MS
} = {}) => {
  const key = asText(licenseKey);
  if (!key) return { skipped: true, reason: 'missing_license' };
  if (hydrateCloudCatalog !== true) {
    return {
      success: true,
      skipped: true,
      reason: 'cloud_products_sync_disabled'
    };
  }

  const current = hydrationByLicense.get(key);
  if (current?.promise) return current.promise;

  const now = Number(getNow());
  if (
    force !== true
    && Number.isFinite(current?.completedAt)
    && Number.isFinite(now)
    && now - current.completedAt < ttlMs
  ) {
    return { success: true, cached: true, completedAt: current.completedAt };
  }

  const promise = (async () => {
    const result = await migrationService.pullFullSnapshot({ licenseKey: key });
    if (result?.success === false) throw createHydrationError(result);

    const completedAt = Number(getNow());
    hydrationByLicense.set(key, {
      promise: null,
      completedAt: Number.isFinite(completedAt) ? completedAt : Date.now()
    });
    return result || { success: true };
  })();

  hydrationByLicense.set(key, {
    promise,
    completedAt: current?.completedAt || null
  });

  try {
    return await promise;
  } catch (error) {
    if (hydrationByLicense.get(key)?.promise === promise) {
      hydrationByLicense.delete(key);
    }
    throw error;
  }
};

export const syncEcommerceCatalogAfterHydration = async ({
  licenseKey,
  request = {},
  forceHydration = false,
  hydrateCloudCatalog = true,
  shouldContinue = () => true,
  migrationService = productMigrationService,
  syncService = ecommerceCatalogSyncService,
  getNow,
  ttlMs
} = {}) => {
  try {
    const hydration = await hydrateEcommerceCatalogSnapshot({
      licenseKey,
      force: forceHydration,
      hydrateCloudCatalog,
      migrationService,
      getNow,
      ttlMs
    });

    if (shouldContinue() !== true) {
      return { skipped: true, reason: 'context_changed', hydration };
    }

    return await syncService.syncNow({
      ...request,
      fullReconcile: true
    });
  } catch (error) {
    Logger.warn('[Ecommerce/CatalogSync] Full snapshot hydration failed', {
      operation: 'ecommerce_catalog_hydration',
      code: error?.code || 'ECOMMERCE_CATALOG_HYDRATION_FAILED'
    });
    return {
      success: false,
      code: error?.code || 'ECOMMERCE_CATALOG_HYDRATION_FAILED',
      message: error?.message || 'No se pudo actualizar el catálogo local.',
      retryable: true
    };
  }
};

export const ecommerceCatalogHydrationInternals = Object.freeze({
  HYDRATION_TTL_MS,
  clear() {
    hydrationByLicense.clear();
  },
  get(licenseKey) {
    return hydrationByLicense.get(asText(licenseKey)) || null;
  }
});
