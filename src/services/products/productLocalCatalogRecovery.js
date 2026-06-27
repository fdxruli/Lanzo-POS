import Logger from '../Logger';
import { syncConflictService } from '../sync/syncConflictService';
import { syncMetaService } from '../sync/syncMetaService';
import { SYNC_ENTITY_TYPES } from '../sync/syncConstants';
import {
  batchToCloudPayload,
  categoryToCloudPayload,
  productToCloudPayload
} from './productMapper';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import { validateLocalCatalogForMigration } from './productMigrationService';
import {
  PRODUCT_MIGRATION_BATCH_SIZE,
  PRODUCTS_UNSYNCED_RESCUE_META_KEY
} from './productConstants';
import { notifyProductsChanged } from './productEvents';

const nowIso = () => new Date().toISOString();
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const countCatalogRows = ({ categories = [], products = [], batches = [] } = {}) => (
  categories.length + products.length + batches.length
);

const saveRecoveryWarning = async ({ licenseKey, issues, conflictType, message }) => {
  const conflict = await syncConflictService.saveConflict({
    id: `products-recovery:${licenseKey}:${Date.now()}`,
    entityType: SYNC_ENTITY_TYPES.PRODUCT,
    entityId: 'local-catalog-recovery',
    conflictType,
    localPayload: { issues },
    serverPayload: null,
    metadata: { licenseKey, message }
  });

  await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, {
    at: nowIso(),
    conflictId: conflict?.id || null,
    issues
  }, { licenseKey });

  return conflict;
};

const markCatalogConflictRecords = async (catalog = {}, reason = 'PRODUCT_CATALOG_RECOVERY_BLOCKED') => {
  const groups = [
    [SYNC_ENTITY_TYPES.CATEGORY, catalog.categories || []],
    [SYNC_ENTITY_TYPES.PRODUCT, catalog.products || []],
    [SYNC_ENTITY_TYPES.PRODUCT_BATCH, catalog.batches || []]
  ];

  for (const [entityType, records] of groups) {
    for (const record of records) {
      try {
        await productLocalRepository.markConflict({ entityType, entityId: record.id, reason });
      } catch (error) {
        Logger.warn('[Products/Recovery] No se pudo marcar conflicto local:', { entityType, id: record?.id, error });
      }
    }
  }
};

const migrateUnsyncedCatalog = async ({ licenseKey, catalog }) => {
  const batchPrefix = `products-recovery-${licenseKey}-${Date.now()}`;
  let migrated = 0;

  for (let index = 0; index < catalog.categories.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
    const categories = catalog.categories.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(categoryToCloudPayload);
    const response = await productCloudRepository.migrateLocalCatalog({
      licenseKey,
      categories,
      products: [],
      batches: [],
      batchId: `${batchPrefix}-categories-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
    });

    if (response?.success === false) throw Object.assign(new Error(response.message || response.code || 'PRODUCT_RECOVERY_CATEGORY_FAILED'), { response });
    await productLocalRepository.applyCloudCatalog(response);
    migrated += categories.length;
  }

  for (let index = 0; index < catalog.products.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
    const products = catalog.products.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(productToCloudPayload);
    const response = await productCloudRepository.migrateLocalCatalog({
      licenseKey,
      categories: [],
      products,
      batches: [],
      batchId: `${batchPrefix}-products-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
    });

    if (response?.success === false) throw Object.assign(new Error(response.message || response.code || 'PRODUCT_RECOVERY_PRODUCT_FAILED'), { response });
    await productLocalRepository.applyCloudCatalog(response);
    migrated += products.length;
  }

  for (let index = 0; index < catalog.batches.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
    const batches = catalog.batches.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(batchToCloudPayload);
    const response = await productCloudRepository.migrateLocalCatalog({
      licenseKey,
      categories: [],
      products: [],
      batches,
      batchId: `${batchPrefix}-batches-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
    });

    if (response?.success === false) throw Object.assign(new Error(response.message || response.code || 'PRODUCT_RECOVERY_BATCH_FAILED'), { response });
    await productLocalRepository.applyCloudCatalog(response);
    migrated += batches.length;
  }

  return migrated;
};

export const productLocalCatalogRecovery = {
  async savePermissionBlockedWarning({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };

    const catalog = await productLocalRepository.listUnsyncedLocalCatalogForCloud();
    const unsynced = countCatalogRows(catalog);
    if (unsynced === 0) return { success: true, skipped: true, reason: 'no_unsynced_catalog' };

    const issues = [{
      type: 'PRODUCT_RECOVERY_PERMISSION_DENIED',
      message: 'Este dispositivo tiene productos locales no sincronizados, pero el staff no tiene permiso para migrar catalogo.'
    }];

    await saveRecoveryWarning({
      licenseKey,
      issues,
      conflictType: 'PRODUCT_RECOVERY_PERMISSION_DENIED',
      message: 'Recuperacion de catalogo local detenida por permisos insuficientes.'
    });
    await markCatalogConflictRecords(catalog, 'STAFF_WITHOUT_PRODUCTS_PERMISSION');
    notifyProductsChanged({ source: 'productLocalCatalogRecovery.permission_denied' });

    return { success: false, blocked: true, reason: 'permission_denied', issues, unsynced };
  },

  async runUnsyncedCatalogRecovery({ licenseKey, canMigrateProducts = true } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (!isOnline()) return { skipped: true, reason: 'offline' };
    if (!canMigrateProducts) return this.savePermissionBlockedWarning({ licenseKey });

    const catalog = await productLocalRepository.listUnsyncedLocalCatalogForCloud();
    const unsynced = countCatalogRows(catalog);
    if (unsynced === 0) {
      await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, null, { licenseKey });
      return { success: true, skipped: true, reason: 'no_unsynced_catalog' };
    }

    const validationCatalog = await productLocalRepository.getLocalCatalogForMigration();
    const issues = validateLocalCatalogForMigration(validationCatalog);
    if (issues.length > 0) {
      await saveRecoveryWarning({
        licenseKey,
        issues,
        conflictType: 'PRODUCT_RECOVERY_BLOCKED',
        message: 'Recuperacion de catalogo local detenida por datos inconsistentes.'
      });
      await markCatalogConflictRecords(catalog, 'PRODUCT_RECOVERY_VALIDATION_FAILED');
      notifyProductsChanged({ source: 'productLocalCatalogRecovery.validation_failed' });
      return { success: false, blocked: true, issues, unsynced };
    }

    try {
      const recovered = await migrateUnsyncedCatalog({ licenseKey, catalog });
      await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, null, { licenseKey });
      notifyProductsChanged({ source: 'productLocalCatalogRecovery.recovered', recovered });
      return { success: true, recovered };
    } catch (error) {
      const response = error?.response;
      const issues = [{
        type: response?.code || 'PRODUCT_RECOVERY_RPC_FAILED',
        message: response?.message || error?.message || 'Fallo RPC de recuperacion de catalogo.',
        response
      }];

      await saveRecoveryWarning({
        licenseKey,
        issues,
        conflictType: 'PRODUCT_RECOVERY_RPC_FAILED',
        message: 'Recuperacion de catalogo local detenida por error remoto.'
      });
      await markCatalogConflictRecords(catalog, 'PRODUCT_RECOVERY_RPC_FAILED');
      notifyProductsChanged({ source: 'productLocalCatalogRecovery.rpc_failed' });
      return { success: false, blocked: true, issues, unsynced };
    }
  }
};

export default productLocalCatalogRecovery;
