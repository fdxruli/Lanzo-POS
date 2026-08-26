import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  shouldDeferPosBootstrapStartHook,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import { productMigrationService } from './productMigrationService';
import { productLocalCatalogRecovery } from './productLocalCatalogRecovery';
import { productConflictService } from './productConflictService';
import {
  PRODUCT_CATALOG_ENTITY_TYPES,
  PRODUCT_CATALOG_LAST_SEQ_KEY,
  PRODUCT_SYNC_STATUS
} from './productConstants';
import { notifyProductsChanged } from './productEvents';
import { serializeProductCatalogSyncError } from './productCatalogSyncDiagnostics';
import { markInventoryEntrySynced } from '../inventory/inventoryEntryService';
import { isLocalTenantAccessError } from '../tenant/localTenantGuard';
import {
  assertProductInventoryMutationCurrent,
  assertProductInventoryOperationActorCurrent,
  captureProductInventoryMutation,
  getProductInventoryMutationRequirements
} from '../auth/productInventoryAuthority';

let registered = false;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);

const canMigrateProductCatalog = () => {
  const state = useAppStore.getState();
  if (typeof state?.canAccess !== 'function') return true;
  return state.canAccess('products') === true;
};

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

const isCatalogOperation = (operation = {}) => (
  operation.entityType === SYNC_ENTITY_TYPES.CATEGORY
  || operation.entityType === SYNC_ENTITY_TYPES.PRODUCT
  || operation.entityType === SYNC_ENTITY_TYPES.PRODUCT_BATCH
);

const getCurrentCatalogRecord = async (operation = {}) => {
  if (!isCatalogOperation(operation) || typeof productLocalRepository.getCatalogRecordForSync !== 'function') {
    return null;
  }

  return productLocalRepository.getCatalogRecordForSync(
    operation.entityType,
    operation.entityId
  );
};

const operationIdentityMatches = (operation = {}, localMutationId) => (
  Boolean(localMutationId)
  && new Set([operation.idempotencyKey, operation.id].filter(Boolean)).has(localMutationId)
);

const isRecoveredCreateReplay = (operation = {}, current = null) => {
  const isCreateOperation = operation.operation === SYNC_OPERATIONS.CREATE
    || operation.operation === SYNC_OPERATIONS.UPSERT;
  if (!current || !isCreateOperation || getExpectedVersion(operation) !== null) {
    return false;
  }

  const currentVersion = Number(current.serverVersion ?? current.server_version);
  return (
    current.syncStatus === PRODUCT_SYNC_STATUS.SYNCED
    && (current.pendingOperationId === null || current.pendingOperationId === undefined)
    && (current.localMutationId === null || current.localMutationId === undefined)
    && Number.isFinite(currentVersion)
    && currentVersion > 0
  );
};

const isStaleLocalMutation = (operation = {}, current = null) => {
  if (!current) return false;

  if (current.localMutationId) return !operationIdentityMatches(operation, current.localMutationId);
  if (isRecoveredCreateReplay(operation, current)) return true;

  const expectedVersion = getExpectedVersion(operation);
  const currentVersion = Number(current.serverVersion ?? current.server_version);
  return expectedVersion !== null && Number.isFinite(currentVersion) && currentVersion > expectedVersion;
};

const isPreRpcSupersededMutation = (operation = {}, current = null) => (
  isStaleLocalMutation(operation, current)
);

const hasNewerLocalMutation = async (operation = {}) => (
  isStaleLocalMutation(operation, await getCurrentCatalogRecord(operation))
);

const createStaleConflictResponse = (operation = {}, response = null, phase = 'post_rpc') => ({
  ...(response || {}),
  success: false,
  code: 'STALE_LOCAL_MUTATION',
  message: 'La respuesta del outbox corresponde a una mutacion local anterior y no se aplico.',
  entityType: operation.entityType || null,
  entityId: operation.entityId || null,
  operationId: operation.id || operation.idempotencyKey || null,
  stalePhase: phase
});

const saveStaleConflict = async (operation, response, phase) => {
  await productConflictService.saveConflict({
    operation,
    response,
    source: 'productSyncHandler.pushOperation.stale_local_mutation'
  });
  notifyProductsChanged({
    source: 'productSyncHandler.pushOperation.stale_local_mutation',
    phase
  });
};

export const pullCatalogChanges = async (licenseKeyOverride = null) => {
  const licenseKey = licenseKeyOverride || getRuntimeLicenseKey();
  if (!licenseKey || !isOnline()) return { skipped: true };

  let sinceChangeSeq = Number(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey })) || 0;
  let hasMore = true;
  let applied = 0;
  const changedProductIds = new Set();

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
    for (const product of [...(response.products || []), ...(response.product ? [response.product] : [])]) {
      if (product?.id) changedProductIds.add(product.id);
    }
    for (const batch of [...(response.batches || []), ...(response.batch ? [response.batch] : [])]) {
      const productId = batch?.product_id || batch?.productId;
      if (productId) changedProductIds.add(productId);
    }

    if (counts.rejected?.length > 0) {
      const rejected = counts.rejected[0];
      const error = new Error('Cambios de catalogo aplicados parcialmente; se conserva el cursor para reintentar.');
      error.code = 'PRODUCT_CATALOG_CHANGES_PARTIAL';
      error.catalogSyncContext = {
        phase: 'snapshot_normalization', licenseKey, entityType: rejected.entityType,
        entityId: rejected.entityId, index: rejected.index, retryable: true
      };
      throw error;
    }

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

  if (applied > 0) {
    notifyProductsChanged({
      source: 'productSyncHandler.pullCatalogChanges',
      operation: 'synced',
      productIds: [...changedProductIds],
      applied,
      timestamp: Date.now()
    });
  }
  return { success: true, applied, latestChangeSeq: sinceChangeSeq };
};

export const productSyncHandler = {
  async onStart({ licenseKey, reason = 'manual', force = false } = {}) {
    if (!licenseKey || !isOnline()) return { skipped: true };

    if (shouldDeferPosBootstrapStartHook(reason, { force })) {
      Logger.log('[Products/Sync] Snapshot/migracion inicial diferida por bootstrap inteligente.');
      return { skipped: true, deferred: true, reason: 'bootstrap_deferred_snapshot' };
    }

    try {
      const canMigrateProducts = canMigrateProductCatalog();

      if (!canMigrateProducts) {
        const recovery = await productLocalCatalogRecovery.savePermissionBlockedWarning({ licenseKey });
        if (recovery?.blocked) {
          Logger.warn('[Products/Sync] Rescate de catalogo local bloqueado por permisos:', recovery);
          return recovery;
        }
        const snapshot = await productMigrationService.pullFullSnapshot({ licenseKey, skipCutoverGuard: true });
        return { ...snapshot, recovery, migrationSkipped: true };
      }

      const migrationResult = await productMigrationService.runInitialMigrationIfNeeded({ licenseKey });
      if (migrationResult?.blocked) {
        Logger.warn('[Products/Sync] Migracion inicial bloqueada:', migrationResult);
        return migrationResult;
      }

      const recovery = migrationResult?.recovery || await productLocalCatalogRecovery.runUnsyncedCatalogRecovery({
        licenseKey,
        canMigrateProducts
      });
      if (recovery?.blocked) {
        Logger.warn('[Products/Sync] Rescate de catalogo local bloqueado:', recovery);
      }

      return { ...migrationResult, recovery };
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      const diagnostic = serializeProductCatalogSyncError(error, {
        operation: 'product_sync_on_start', licenseKey
      });
      Logger.warn('[Products/Sync] Migracion/rescate de catalogo fallo sin bloquear app:', diagnostic);
      return { success: false, error, diagnostic };
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
    const mutationRequirements = getProductInventoryMutationRequirements(operation);
    const actorRequirementFlags = { products: mutationRequirements.includes('products'), inventory: mutationRequirements.includes('inventory') };
    let actorHandle = null;
    // R2D rows carry an immutable actor origin. Pre-R2D catalog/inventory rows
    // intentionally have no actorSensitivity and retain their historical
    // tenant-scoped replay semantics; they must not be assigned currentActor
    // during replay. The cloud repository still validates the current request
    // context at the RPC boundary without persisting it into the old row.
    if (mutationRequirements.length > 0 && operation.actorSensitivity === 'actor_bound') {
      try {
        assertProductInventoryOperationActorCurrent(operation);
        actorHandle = captureProductInventoryMutation(actorRequirementFlags);
        assertProductInventoryMutationCurrent(actorHandle, actorRequirementFlags);
      } catch (error) {
        if (String(error?.code || '').startsWith('ACTOR_')) {
          const actorConflict = { success: false, code: error.code, message: 'La operacion local no puede ejecutarse con el actor actual.', entityType: operation.entityType || null, entityId: operation.entityId || null, operationId: operation.id || operation.idempotencyKey || null };
          await saveStaleConflict(operation, actorConflict, 'actor_context');
          return { conflict: actorConflict, success: false };
        }
        throw error;
      }
    }

    const currentBeforeRpc = await getCurrentCatalogRecord(operation);
    if (isPreRpcSupersededMutation(operation, currentBeforeRpc)) {
      const staleResponse = createStaleConflictResponse(operation, null, 'pre_rpc');
      await saveStaleConflict(operation, staleResponse, 'pre_rpc');
      return { conflict: staleResponse, success: false };
    }

    let response;

    if (operation.entityType === SYNC_ENTITY_TYPES.CATEGORY) {
      response = op === SYNC_OPERATIONS.DELETE
        ? await productCloudRepository.deleteCategory({
          actorHandle,
          licenseKey,
          categoryId: payload.categoryId || operation.entityId,
          expectedVersion,
          idempotencyKey
        })
        : await productCloudRepository.upsertCategory({
          actorHandle,
          licenseKey,
          category: payload.category,
          expectedVersion,
          idempotencyKey
        });
    } else if (operation.entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY) {
      response = await productCloudRepository.addInventoryEntry({
        actorHandle,
        licenseKey,
        entry: payload.entry,
        idempotencyKey
      });
    } else if (operation.entityType === SYNC_ENTITY_TYPES.PRODUCT_BATCH) {
      response = op === SYNC_OPERATIONS.DELETE
        ? await productCloudRepository.deleteProductBatch({
          actorHandle,
          licenseKey,
          batchId: payload.batchId || operation.entityId,
          expectedVersion,
          idempotencyKey
        })
        : await productCloudRepository.upsertProductBatch({
          actorHandle,
          licenseKey,
          batch: payload.batch,
          expectedVersion,
          idempotencyKey
        });
    } else if (op === SYNC_OPERATIONS.DELETE) {
      response = await productCloudRepository.deleteProduct({
        actorHandle,
        licenseKey,
        productId: payload.productId || operation.entityId,
        expectedVersion,
        idempotencyKey
      });
    } else if (op === SYNC_OPERATIONS.TOGGLE_STATUS) {
      response = await productCloudRepository.toggleProductStatus({
        actorHandle,
        licenseKey,
        productId: payload.productId || operation.entityId,
        isActive: payload.isActive,
        expectedVersion,
        idempotencyKey
      });
    } else {
      response = await productCloudRepository.upsertProduct({
        actorHandle,
        licenseKey,
        product: payload.product,
        initialBatches: payload.initialBatches || [],
        isNewProduct: payload.isNewProduct === true || operation.operation === SYNC_OPERATIONS.CREATE,
        expectedVersion,
        idempotencyKey
      });
    }

    if (actorHandle) assertProductInventoryMutationCurrent(actorHandle, actorRequirementFlags);

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

    if (await hasNewerLocalMutation(operation)) {
      const staleResponse = createStaleConflictResponse(operation, response, 'post_rpc');
      await saveStaleConflict(operation, staleResponse, 'post_rpc');
      return { conflict: staleResponse, success: false };
    }

    await productLocalRepository.applyCloudCatalog(response);

    if (operation.entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY) {
      await markInventoryEntrySynced(idempotencyKey, response);
    }

    const latestChangeSeq = normalizeChangeSeq(response, 0);
    if (latestChangeSeq > 0) {
      await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, latestChangeSeq, { licenseKey });
    }

    const changedProductId = operation.entityType === SYNC_ENTITY_TYPES.PRODUCT
      ? (payload.productId || payload.product?.id || operation.entityId)
      : (
        operation.entityType === SYNC_ENTITY_TYPES.PRODUCT_BATCH
          ? (payload.batch?.product_id || payload.batch?.productId || response?.batch?.product_id || response?.batch?.productId)
          : null
      );
    notifyProductsChanged({
      source: 'productSyncHandler.pushOperation',
      operation: 'synced',
      productId: changedProductId,
      productIds: changedProductId ? [changedProductId] : [],
      timestamp: Date.now()
    });
    return response;
  }
};

export const registerProductSyncHandler = () => {
  if (registered) return false;

  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.CATEGORY, productSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.PRODUCT, productSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.PRODUCT_BATCH, productSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.INVENTORY_MOVEMENT, productSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.INVENTORY_ENTRY, productSyncHandler);
  registered = true;
  Logger.log('[Products/Sync] Handler de catalogo registrado. Incluye movimientos de inventario para Fase 6C.');
  return true;
};

registerProductSyncHandler();

export default productSyncHandler;
