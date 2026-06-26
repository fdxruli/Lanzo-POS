import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import { productMigrationService } from './productMigrationService';
import { productConflictService } from './productConflictService';
import {
  PRODUCT_CATALOG_ENTITY_TYPES,
  PRODUCT_CATALOG_LAST_SEQ_KEY
} from './productConstants';
import { notifyProductsChanged } from './productEvents';

let registered = false;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);

const asError = (response, fallback) => {
  const error = new Error(response?.message || response?.code || fallback);
  error.code = response?.code || fallback;
  error.response = response;
  return error;
};

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? response?.changeSeq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const getExpectedVersion = (operation = {}) => {
  const value = Number(operation?.payload?.expectedVersion ?? operation?.payload?.expected_version);
  return Number.isFinite(value) && value > 0 ? value : null;
};

export const pullCatalogChanges = async (licenseKeyOverride = null) => {
  const licenseKey = licenseKeyOverride || getRuntimeLicenseKey();
  if (!licenseKey || !isOnline()) return { skipped: true };

  let sinceChangeSeq = Number(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey })) || 0;
  let hasMore = true;
  let applied = 0;

  while (hasMore) {
    const response = await productCloudRepository.pullCatalogChanges({
      licenseKey,
      sinceChangeSeq,
      limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
    });

    if (response?.success === false) {
      throw asError(response, 'PRODUCT_CHANGES_PULL_FAILED');
    }

    const counts = await productLocalRepository.applyCloudCatalog(response);
    applied += counts.categories + counts.products + counts.batches;

    const latestChangeSeq = normalizeChangeSeq(response, sinceChangeSeq);
    if (latestChangeSeq > sinceChangeSeq) {
      sinceChangeSeq = latestChangeSeq;
      await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, sinceChangeSeq, { licenseKey });
    }

    hasMore = Boolean(response.has_more || response.hasMore) && latestChangeSeq > 0;
    if ((counts.categories + counts.products + counts.batches) === 0 && latestChangeSeq === sinceChangeSeq) {
      hasMore = false;
    }
  }

  if (applied > 0) notifyProductsChanged({ source: 'productSyncHandler.pullCatalogChanges', applied });
  return { success: true, applied, latestChangeSeq: sinceChangeSeq };
};

export const productSyncHandler = {
  async onStart({ licenseKey } = {}) {
    if (!licenseKey || !isOnline()) return { skipped: true };

    try {
      const migrationResult = await productMigrationService.runInitialMigrationIfNeeded({ licenseKey });
      if (migrationResult?.blocked) {
        Logger.warn('[Products/Sync] Migracion inicial bloqueada:', migrationResult);
      }
      return migrationResult;
    } catch (error) {
      Logger.warn('[Products/Sync] Migracion inicial fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], context = {}) {
    const licenseKey = context.licenseKey || getRuntimeLicenseKey();
    if (!licenseKey || !isOnline()) return { applied: 0, skipped: true };

    if (!context.force && events.length > 0) {
      const hasCatalogEvents = events.some((event) => PRODUCT_CATALOG_ENTITY_TYPES.has(event.entity_type || event.entityType));
      if (!hasCatalogEvents) return { applied: 0, skipped: true };
    }

    return pullCatalogChanges(licenseKey);
  },

  async pushOperation(operation = {}) {
    const licenseKey = operation.licenseKey || getRuntimeLicenseKey();
    if (!licenseKey) throw new Error('PRODUCT_OUTBOX_LICENSE_REQUIRED');

    const payload = operation.payload || {};
    const expectedVersion = getExpectedVersion(operation);
    const idempotencyKey = operation.idempotencyKey || operation.id;
    const op = operation.operation;
    let response;

    if (operation.entityType === SYNC_ENTITY_TYPES.CATEGORY) {
      response = op === SYNC_OPERATIONS.DELETE
        ? await productCloudRepository.deleteCategory({
          licenseKey,
          categoryId: payload.categoryId || operation.entityId,
          expectedVersion,
          idempotencyKey
        })
        : await productCloudRepository.upsertCategory({
          licenseKey,
          category: payload.category,
          expectedVersion,
          idempotencyKey
        });
    } else if (operation.entityType === SYNC_ENTITY_TYPES.PRODUCT_BATCH) {
      response = op === SYNC_OPERATIONS.DELETE
        ? await productCloudRepository.deleteProductBatch({
          licenseKey,
          batchId: payload.batchId || operation.entityId,
          expectedVersion,
          idempotencyKey
        })
        : await productCloudRepository.upsertProductBatch({
          licenseKey,
          batch: payload.batch,
          expectedVersion,
          idempotencyKey
        });
    } else if (op === SYNC_OPERATIONS.DELETE) {
      response = await productCloudRepository.deleteProduct({
        licenseKey,
        productId: payload.productId || operation.entityId,
        expectedVersion,
        idempotencyKey
      });
    } else if (op === SYNC_OPERATIONS.TOGGLE_STATUS) {
      response = await productCloudRepository.toggleProductStatus({
        licenseKey,
        productId: payload.productId || operation.entityId,
        isActive: payload.isActive,
        expectedVersion,
        idempotencyKey
      });
    } else {
      response = await productCloudRepository.upsertProduct({
        licenseKey,
        product: payload.product,
        initialBatches: payload.initialBatches || [],
        expectedVersion,
        idempotencyKey
      });
    }

    if (productConflictService.isConflictResponse(response)) {
      await productConflictService.saveConflict({
        operation,
        response,
        source: 'productSyncHandler.pushOperation'
      });
      notifyProductsChanged({ source: 'productSyncHandler.pushOperation.conflict' });
      return { conflict: response, success: false };
    }

    if (response?.success === false) {
      throw asError(response, 'PRODUCT_PUSH_FAILED');
    }

    await productLocalRepository.applyCloudCatalog(response);

    const latestChangeSeq = normalizeChangeSeq(response, 0);
    if (latestChangeSeq > 0) {
      await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, latestChangeSeq, { licenseKey });
    }

    notifyProductsChanged({ source: 'productSyncHandler.pushOperation' });
    return response;
  }
};

export const registerProductSyncHandler = () => {
  if (registered) return false;

  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.CATEGORY, productSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.PRODUCT, productSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.PRODUCT_BATCH, productSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.INVENTORY_MOVEMENT, productSyncHandler);
  registered = true;
  Logger.log('[Products/Sync] Handler de catalogo registrado. Incluye movimientos de inventario para Fase 6C.');
  return true;
};

registerProductSyncHandler();

export default productSyncHandler;
