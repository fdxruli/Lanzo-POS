import Logger from '../Logger';
import { syncConflictService } from '../sync/syncConflictService';
import { syncMetaService } from '../sync/syncMetaService';
import { SYNC_ENTITY_TYPES, SYNC_LIMITS } from '../sync/syncConstants';
import {
  batchToCloudPayload,
  categoryToCloudPayload,
  productToCloudPayload
} from './productMapper';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import { productLocalCatalogRecovery } from './productLocalCatalogRecovery';
import { validateLocalCatalogForMigration } from './productMigrationValidation';
import { validateMigrationBatchResponse } from './productMigrationResponseValidation';
import {
  buildProductsMigratedMetaKey,
  PRODUCT_CATALOG_LAST_SEQ_KEY,
  PRODUCT_MIGRATION_BATCH_SIZE,
  PRODUCTS_LAST_SNAPSHOT_AT_META_KEY,
  PRODUCTS_MIGRATED_AT_META_KEY,
  PRODUCTS_MIGRATION_WARNING_META_KEY
} from './productConstants';
import { notifyProductsChanged } from './productEvents';
import { createProductCatalogSyncError } from './productCatalogSyncDiagnostics';

const nowIso = () => new Date().toISOString();
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const initialMigrationByLicense = new Map();
export { validateLocalCatalogForMigration } from './productMigrationValidation';

const saveBlockedMigrationConflict = async ({ licenseKey, issues }) => {
  const conflict = await syncConflictService.saveConflict({
    id: `products-migration:${licenseKey}:${Date.now()}`,
    entityType: SYNC_ENTITY_TYPES.PRODUCT,
    entityId: 'local-catalog-migration',
    conflictType: 'PRODUCT_MIGRATION_BLOCKED',
    localPayload: { issues },
    serverPayload: null,
    metadata: {
      licenseKey,
      message: 'Migracion inicial de catalogo detenida por datos locales inconsistentes.'
    }
  });

  await syncMetaService.setMeta(PRODUCTS_MIGRATION_WARNING_META_KEY, {
    at: nowIso(),
    conflictId: conflict?.id || null,
    issues
  }, { licenseKey });

  return conflict;
};

const getBlockedMigrationResult = async ({ licenseKey, response, expectedCounts }) => {
  const issues = validateMigrationBatchResponse({ response, expectedCounts });
  if (issues.length === 0) return null;

  await saveBlockedMigrationConflict({ licenseKey, issues });
  Logger.warn('[Products/Migration] Migracion bloqueada por respuesta RPC invalida:', issues);
  return { success: false, blocked: true, issues, response };
};

export const productMigrationService = {
  async pullFullSnapshot({ licenseKey, skipCutoverGuard = false } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };

    if (!skipCutoverGuard) {
      const migratedKey = buildProductsMigratedMetaKey(licenseKey);
      const alreadyMigrated = await syncMetaService.getMeta(migratedKey, false, { licenseKey });
      if (alreadyMigrated) {
        const recovery = await productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
          licenseKey,
          canMigrateProducts: true
        });
        if (recovery?.blocked || recovery?.success === false) {
          return { success: false, blocked: true, recovery };
        }
      }
    }

    let applied = 0;
    let latestChangeSeq = 0;
    let rejected = [];

    for (const entityType of ['category', 'product', 'product_batch']) {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const response = await productCloudRepository.pullCatalogSnapshot({
          licenseKey,
          entityType,
          offset,
          limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
          includeDeleted: true
        });

        if (response?.success === false) {
          throw new Error(response.message || response.code || 'PRODUCT_SNAPSHOT_FAILED');
        }

        const counts = await productLocalRepository.applyCloudCatalog(response);
        rejected = rejected.concat(counts.rejected || []);
        const count = counts.categories + counts.products + counts.batches;
        applied += count;
        const responseCount = (response.categories?.length || 0)
          + (response.products?.length || 0)
          + (response.batches?.length || 0);
        offset += responseCount;
        hasMore = Boolean(response.has_more || response.hasMore) && responseCount > 0;

        if (counts.rejected?.length > 0) {
          Logger.warn('[Products/Snapshot] Registros invalidos omitidos durante aplicacion local.', {
            operation: 'pull_full_snapshot', phase: 'snapshot_normalization', entityErrors: counts.rejected, offset
          });
        }

        const responseSeq = Number(response.latest_change_seq ?? response.latestChangeSeq ?? latestChangeSeq);
        if (Number.isFinite(responseSeq) && responseSeq > latestChangeSeq) {
          latestChangeSeq = responseSeq;
          // A snapshot may span several pages. The cursor only becomes durable
          // after every page has been written successfully.
        }
      }
    }

    if (rejected.length > 0) {
      throw createProductCatalogSyncError('El snapshot se aplico parcialmente; el cursor se conserva para un reintento seguro.', {
        code: 'PRODUCT_CATALOG_SNAPSHOT_PARTIAL',
        phase: 'snapshot_normalization',
        entityType: rejected[0]?.entityType || null,
        entityId: rejected[0]?.entityId || null,
        index: rejected[0]?.index,
        retryable: true,
        licenseKey
      });
    }

    if (latestChangeSeq > 0) {
      await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, latestChangeSeq, { licenseKey });
    }
    await syncMetaService.setMeta(PRODUCTS_LAST_SNAPSHOT_AT_META_KEY, nowIso(), { licenseKey });
    notifyProductsChanged({ source: 'productMigrationService.pullFullSnapshot', applied });
    return { success: true, applied, latestChangeSeq };
  },

  async runInitialMigrationIfNeeded({ licenseKey } = {}) {
    if (licenseKey && initialMigrationByLicense.has(licenseKey)) {
      return initialMigrationByLicense.get(licenseKey);
    }

    const operation = (async () => {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (!isOnline()) return { skipped: true, reason: 'offline' };

    const migratedKey = buildProductsMigratedMetaKey(licenseKey);
    const alreadyMigrated = await syncMetaService.getMeta(migratedKey, false, { licenseKey });

    if (alreadyMigrated) {
      // PRODUCTS_MIGRATED only proves that an earlier cloud bootstrap
      // completed. It does not prove that a later FREE period produced no
      // local-only mutations. Reconcile those mutations before allowing the
      // next authoritative snapshot to write local state.
      const recovery = await productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
        licenseKey,
        canMigrateProducts: true
      });
      if (recovery?.blocked || recovery?.success === false) {
        return {
          success: false,
          blocked: true,
          recovery
        };
      }

      const snapshot = await this.pullFullSnapshot({ licenseKey, skipCutoverGuard: true });
      return { ...snapshot, recovery };
    }

    const localCatalog = await productLocalRepository.getLocalCatalogForMigration();
    const issues = validateLocalCatalogForMigration(localCatalog);

    if (issues.length > 0) {
      await saveBlockedMigrationConflict({ licenseKey, issues });
      Logger.warn('[Products/Migration] Migracion bloqueada por conflictos locales:', issues);
      return { success: false, blocked: true, issues };
    }

    const totalLocalRows = localCatalog.categories.length + localCatalog.products.length + localCatalog.batches.length;

    if (totalLocalRows > 0) {
      const batchId = `products-${licenseKey}-${Date.now()}`;

      for (let index = 0; index < localCatalog.categories.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
        const categories = localCatalog.categories.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(categoryToCloudPayload);
        const response = await productCloudRepository.migrateLocalCatalog({
          licenseKey,
          categories,
          products: [],
          batches: [],
          batchId: `${batchId}-categories-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
        });

        const blocked = await getBlockedMigrationResult({
          licenseKey,
          response,
          expectedCounts: { categories: categories.length, products: 0, batches: 0 }
        });
        if (blocked) return blocked;

        await productLocalRepository.applyCloudCatalog(response);
      }

      for (let index = 0; index < localCatalog.products.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
        const products = localCatalog.products.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(productToCloudPayload);
        const response = await productCloudRepository.migrateLocalCatalog({
          licenseKey,
          categories: [],
          products,
          batches: [],
          batchId: `${batchId}-products-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
        });

        const blocked = await getBlockedMigrationResult({
          licenseKey,
          response,
          expectedCounts: { categories: 0, products: products.length, batches: 0 }
        });
        if (blocked) return blocked;

        await productLocalRepository.applyCloudCatalog(response);
      }

      for (let index = 0; index < localCatalog.batches.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
        const batches = localCatalog.batches.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(batchToCloudPayload);

        const response = await productCloudRepository.migrateLocalCatalog({
          licenseKey,
          categories: [],
          products: [],
          batches,
          batchId: `${batchId}-batches-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
        });

        const blocked = await getBlockedMigrationResult({
          licenseKey,
          response,
          expectedCounts: { categories: 0, products: 0, batches: batches.length }
        });
        if (blocked) return blocked;

        await productLocalRepository.applyCloudCatalog(response);
      }
    }

    const snapshot = await this.pullFullSnapshot({ licenseKey, skipCutoverGuard: true });

    await syncMetaService.setMeta(migratedKey, true, { licenseKey });
    await syncMetaService.setMeta(PRODUCTS_MIGRATED_AT_META_KEY, nowIso(), { licenseKey });
    await syncMetaService.setMeta(PRODUCTS_MIGRATION_WARNING_META_KEY, null, { licenseKey });

    Logger.log(`[Products/Migration] Migracion inicial completada. Local=${totalLocalRows}, snapshot=${snapshot.applied || 0}`);
    notifyProductsChanged({ source: 'productMigrationService.runInitialMigrationIfNeeded' });

    return {
      success: true,
      migrated: totalLocalRows,
      snapshotCount: snapshot.applied || 0
    };
    })();

    if (!licenseKey) return operation;

    initialMigrationByLicense.set(licenseKey, operation);
    try {
      return await operation;
    } finally {
      if (initialMigrationByLicense.get(licenseKey) === operation) {
        initialMigrationByLicense.delete(licenseKey);
      }
    }
  }
};

export default productMigrationService;
