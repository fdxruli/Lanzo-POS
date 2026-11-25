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
import { durableSnapshotService, buildSnapshotContextId } from '../sync/durableSnapshotService';

const nowIso = () => new Date().toISOString();
const initialMigrationByLicense = new Map();
export { validateLocalCatalogForMigration } from './productMigrationValidation';

export const productMigrationService = {
  async pullFullSnapshot({ licenseKey, actorHandle = null, snapshotProtocol: negotiatedProtocol = null } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };

    let applied = 0;
    let rejected = [];
    let deferredCatalog = 0;

    actorHandle?.assertCurrent?.();
    const snapshotProtocol = negotiatedProtocol
      || await productCloudRepository.negotiateSnapshotProtocol({ licenseKey, actorHandle });
    actorHandle?.assertCurrent?.();

    if (snapshotProtocol.supported) {
      const contextId = buildSnapshotContextId({
        licenseKey,
        streamKey: 'product_catalog',
        scope: { entities: ['category', 'product', 'product_batch'], includeDeleted: true },
        actorHandle
      });
      const snapshot = await durableSnapshotService.runConsistentSnapshot({
        licenseKey,
        streamKey: 'product_catalog',
        contextId,
        actorHandle,
        cursorKey: PRODUCT_CATALOG_LAST_SEQ_KEY,
        fetchPage: ({ referenceChangeSeq, pageCursor }) => productCloudRepository.pullCatalogSnapshot({
          licenseKey,
          limit: Math.min(SYNC_LIMITS.DEFAULT_PULL_LIMIT, 500),
          snapshotProtocol,
          snapshotReferenceChangeSeq: referenceChangeSeq,
          pageCursor,
          actorHandle
        }),
        applyPage: async (response) => {
          const counts = await productLocalRepository.applyCloudCatalog(response, {
            protectLocalChanges: true,
            ...(actorHandle ? { actorHandle } : {})
          });
          rejected = rejected.concat(counts.rejected || []);
          deferredCatalog += counts.deferredCatalog || 0;
          if (counts.deferredInventory > 0) {
            throw createProductCatalogSyncError('Recepción farmacéutica local pendiente: no avanzar cursor ni sobrescribir existencias.', {
              code: 'PHARMACY_INVENTORY_SNAPSHOT_DEFERRED',
              phase: 'inventory_receipt_pending', retryable: true, licenseKey
            });
          }
          if (counts.rejected?.length > 0) {
            Logger.warn('[Products/Snapshot] Registros invalidos omitidos durante aplicacion local.', {
              operation: 'pull_full_snapshot', phase: 'snapshot_normalization', entityErrors: counts.rejected
            });
          }
          const rowCount = (response.categories?.length || 0)
            + (response.products?.length || 0)
            + (response.batches?.length || 0);
          const pageApplied = counts.categories + counts.products + counts.batches;
          applied += pageApplied;
          if (counts.rejected?.length || counts.deferredCatalog > 0) {
            return {
              complete: false,
              rejected: counts.rejected?.length || 0,
              deferred: counts.deferredCatalog || 0,
              rowCount,
              code: counts.rejected?.length ? 'PRODUCT_CATALOG_SNAPSHOT_PARTIAL' : 'PRODUCT_CATALOG_LOCAL_PENDING'
            };
          }
          return { applied: pageApplied, rowCount };
        }
      });

      actorHandle?.assertCurrent?.();
      if (!await syncMetaService.setMeta(PRODUCTS_LAST_SNAPSHOT_AT_META_KEY, nowIso(), { licenseKey })) {
        throw new Error('POS_SYNC_SNAPSHOT_CHECKPOINT_FAILED');
      }
      notifyProductsChanged({ source: 'productMigrationService.pullFullSnapshot', applied });
      return {
        ...snapshot,
        applied,
        snapshotReferenceChangeSeq: snapshot.referenceChangeSeq,
        consistent: true
      };
    }

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

        const counts = await productLocalRepository.applyCloudCatalog(response, {
          protectLocalChanges: true,
          ...(actorHandle ? { actorHandle } : {})
        });
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

    // Legacy OFFSET snapshots are kept for current Production compatibility,
    // but their changing page cursors are not evidence for an applied delta.
    if (!await syncMetaService.setMeta(PRODUCTS_LAST_SNAPSHOT_AT_META_KEY, nowIso(), { licenseKey })) {
      throw new Error('POS_SYNC_SNAPSHOT_CHECKPOINT_FAILED');
    }
    notifyProductsChanged({ source: 'productMigrationService.pullFullSnapshot', applied });
    return { success: true, applied, latestChangeSeq: null, consistent: false, legacyFallback: true };
  },

  async runInitialMigrationIfNeeded({ licenseKey, actorHandle = null } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: true, reason: 'offline' };
    if (initialMigrationByLicense.has(licenseKey)) return initialMigrationByLicense.get(licenseKey);

    const operation = (async () => {
      const recovery = await productLocalCatalogRecovery.runUnsyncedCatalogRecovery({ licenseKey, actorHandle });
      if (recovery?.success !== true) {
        return { success: false, blocked: recovery?.blocked === true, recovery };
      }

      const migratedKey = buildProductsMigratedMetaKey(licenseKey);
      const alreadyMigrated = await syncMetaService.getMeta(migratedKey, false, { licenseKey });
      actorHandle?.assertCurrent?.();
      let snapshotProtocol = null;
      if (alreadyMigrated) {
        snapshotProtocol = await productCloudRepository.negotiateSnapshotProtocol({ licenseKey, actorHandle });
        actorHandle?.assertCurrent?.();
        if (!snapshotProtocol.supported) {
          return {
            success: true,
            skipped: true,
            alreadyMigrated: true,
            consistent: false,
            legacyFallback: true,
            recovery
          };
        }
      }

      const snapshot = await this.pullFullSnapshot({ licenseKey, actorHandle, snapshotProtocol });
      if (snapshot?.success !== true) return { ...snapshot, recovery };

      if (!alreadyMigrated) {
        if (!await syncMetaService.setMeta(PRODUCTS_MIGRATED_AT_META_KEY, nowIso(), { licenseKey })
          || !await syncMetaService.setMeta(migratedKey, true, { licenseKey })) {
          throw new Error('POS_SYNC_SNAPSHOT_CHECKPOINT_FAILED');
        }
      }
      if (!await syncMetaService.setMeta(PRODUCTS_MIGRATION_WARNING_META_KEY, null, { licenseKey })
        || !await syncMetaService.setMeta(PRODUCTS_MIGRATION_BATCH_ROOT_META_KEY, null, { licenseKey })) {
        throw new Error('POS_SYNC_SNAPSHOT_CHECKPOINT_FAILED');
      }
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
