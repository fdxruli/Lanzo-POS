import Logger from '../Logger';
import { syncMetaService } from '../sync/syncMetaService';
import { SYNC_LIMITS } from '../sync/syncConstants';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import { productLocalCatalogRecovery } from './productLocalCatalogRecovery';
import {
  buildProductsMigratedMetaKey,
  PRODUCT_CATALOG_LAST_SEQ_KEY,
  PRODUCTS_LAST_SNAPSHOT_AT_META_KEY,
  PRODUCTS_MIGRATED_AT_META_KEY,
  PRODUCTS_MIGRATION_BATCH_ROOT_META_KEY,
  PRODUCTS_MIGRATION_WARNING_META_KEY
} from './productConstants';
import { notifyProductsChanged } from './productEvents';
import { createProductCatalogSyncError } from './productCatalogSyncDiagnostics';

const nowIso = () => new Date().toISOString();
const initialMigrationByLicense = new Map();
export { validateLocalCatalogForMigration } from './productMigrationValidation';

export const productMigrationService = {
  async pullFullSnapshot({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };

    let applied = 0;
    let latestChangeSeq = 0;
    let rejected = [];
    let deferredCatalog = 0;

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

        const counts = await productLocalRepository.applyCloudCatalog(response, { protectLocalChanges: true });
        deferredCatalog += counts.deferredCatalog || 0;
        if (counts.deferredInventory > 0) {
          throw createProductCatalogSyncError('Recepción farmacéutica local pendiente: no avanzar cursor ni sobrescribir existencias.', {
            code: 'PHARMACY_INVENTORY_SNAPSHOT_DEFERRED',
            phase: 'inventory_receipt_pending', retryable: true, licenseKey
          });
        }
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

    if (deferredCatalog) return { success: false, blocked: true, reason: 'local_catalog_pending', deferredCatalog };

    if (latestChangeSeq > 0) {
      await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, latestChangeSeq, { licenseKey });
    }
    await syncMetaService.setMeta(PRODUCTS_LAST_SNAPSHOT_AT_META_KEY, nowIso(), { licenseKey });
    notifyProductsChanged({ source: 'productMigrationService.pullFullSnapshot', applied });
    return { success: true, applied, latestChangeSeq };
  },

  async runInitialMigrationIfNeeded({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: true, reason: 'offline' };
    if (initialMigrationByLicense.has(licenseKey)) return initialMigrationByLicense.get(licenseKey);

    const operation = (async () => {
      const recovery = await productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey });
      if (recovery?.success !== true) {
        return { success: false, blocked: recovery?.blocked === true, recovery };
      }

      const snapshot = await this.pullFullSnapshot({ licenseKey });
      if (snapshot?.success !== true) return { ...snapshot, recovery };

      const migratedKey = buildProductsMigratedMetaKey(licenseKey);
      if (!await syncMetaService.getMeta(migratedKey, false, { licenseKey })) {
        await syncMetaService.setMeta(PRODUCTS_MIGRATED_AT_META_KEY, nowIso(), { licenseKey });
        await syncMetaService.setMeta(migratedKey, true, { licenseKey });
      }
      await syncMetaService.setMeta(PRODUCTS_MIGRATION_WARNING_META_KEY, null, { licenseKey });
      await syncMetaService.setMeta(PRODUCTS_MIGRATION_BATCH_ROOT_META_KEY, null, { licenseKey });
      return { ...snapshot, recovery };
    })();

    initialMigrationByLicense.set(licenseKey, operation);
    try {
      return await operation;
    } finally {
      initialMigrationByLicense.delete(licenseKey);
    }
  }
};

export default productMigrationService;
