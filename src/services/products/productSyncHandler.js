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
import {
  ensureCloudProductCategory,
  getProductCloudConfirmationError
} from './productCategoryCloudGate';
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
import { markCloudPharmacyReceiptRejected, markInventoryEntrySynced } from '../inventory/inventoryEntryService';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { hasCurrentActorPermission } from '../sync/actorPermission';
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
const PRODUCT_CATALOG_READ_PERMISSIONS = Object.freeze(['products', 'pos', 'inventory']);

const getProductCatalogReadPermission = () => PRODUCT_CATALOG_READ_PERMISSIONS
  .find((permission) => hasCurrentActorPermission(permission)) || null;

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

export const pullCatalogChanges = async (licenseKeyOverride = null, { actorHandle = null } = {}) => {
  const licenseKey = licenseKeyOverride || getRuntimeLicenseKey();
  if (!licenseKey || !isOnline()) return { skipped: true };

  let sinceChangeSeq = Number(await syncMetaService.getMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, 0, { licenseKey })) || 0;
  let hasMore = true;
  let applied = 0;
  let syncDeferred = false;
  const changedProductIds = new Set();

  while (hasMore) {
    actorHandle?.assertCurrent();
    const pageSinceChangeSeq = sinceChangeSeq;
    const response = await productCloudRepository.pullCatalogChanges({
      licenseKey,
      sinceChangeSeq: pageSinceChangeSeq,
      limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
    });
    actorHandle?.assertCurrent();

    if (response?.success === false) {
      throw asError(response, 'PRODUCT_CHANGES_PULL_FAILED');
    }
    syncDeferred = syncDeferred || response?.sync_deferred === true || response?.syncDeferred === true;

    const counts = await productLocalRepository.applyCloudCatalog(response, { protectLocalChanges: true });
    actorHandle?.assertCurrent();
    if (counts.deferredCatalog) {
      throw asError({ code: 'PRODUCT_CATALOG_LOCAL_CHANGES_PENDING' });
    }
    if (counts.deferredInventory > 0) {
      const error = new Error('Recepción farmacéutica local pendiente: no avanzar cursor ni sobrescribir existencias.');
      error.code = 'PHARMACY_INVENTORY_CATALOG_DEFERRED';
      error.catalogSyncContext = { phase: 'inventory_receipt_pending', licenseKey, retryable: true };
      throw error;
    }
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

    const latestChangeSeq = normalizeChangeSeq(response, pageSinceChangeSeq);
    if (latestChangeSeq > pageSinceChangeSeq) {
      sinceChangeSeq = await syncMetaService.advanceMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, latestChangeSeq, { licenseKey })
        ?? latestChangeSeq;
    }

    hasMore = Boolean(response.has_more || response.hasMore) && latestChangeSeq > 0;
    if (latestChangeSeq <= pageSinceChangeSeq) {
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
  return { success: true, applied, latestChangeSeq: sinceChangeSeq, syncDeferred };
};

export const productSyncHandler = {
  actorPermissions: PRODUCT_CATALOG_READ_PERMISSIONS,

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
        const snapshot = await productMigrationService.pullFullSnapshot({ licenseKey });
        return { ...snapshot, recovery, migrationSkipped: true };
      }

      return await productMigrationService.runInitialMigrationIfNeeded({ licenseKey });
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
    if (!licenseKey) return { applied: 0, skipped: true, reason: 'context_invalidated' };
    if (!isOnline()) return { applied: 0, skipped: true, reason: 'offline' };
    const readPermission = getProductCatalogReadPermission();
    if (!readPermission) {
      return { applied: 0, skipped: true, reason: 'actor_permission_missing' };
    }

    if (!context.force && events.length > 0) {
      const hasCatalogEvents = events.some((event) => PRODUCT_CATALOG_ENTITY_TYPES.has(event.entity_type || event.entityType));
      if (!hasCatalogEvents) return { applied: 0, skipped: true, reason: 'module_not_applicable' };
    }

    const actorHandle = actorRuntimeController.capture(readPermission);
    return pullCatalogChanges(licenseKey, { actorHandle });
  },

  async pushOperation(operation = {}, { actorHandle: outboxActor } = {}) {
    const licenseKey = operation.licenseKey || getRuntimeLicenseKey();
    if (!licenseKey) throw new Error('PRODUCT_OUTBOX_LICENSE_REQUIRED');

    const payload = operation.payload || {};
    const expectedVersion = getExpectedVersion(operation);
    const idempotencyKey = operation.idempotencyKey || operation.id;
    const op = operation.operation;
    const cloudInventoryEntry = operation.entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY
      && payload.cloudInventoryEntry === true;
    const cloudConfirmation = cloudInventoryEntry || payload.cloudPharmacyReceipt === true;
    const pharmacyReceipt = operation.entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY
      && (payload.cloudPharmacyReceipt === true || Boolean(payload.entry?.metadata?.pharmacyReceipt));
    const mutationRequirements = getProductInventoryMutationRequirements(operation);
    const actorRequirementFlags = { products: mutationRequirements.includes('products'), inventory: mutationRequirements.includes('inventory') };
    let actorHandle = null;
    // R2D rows carry an immutable actor origin. Pre-R2D catalog/inventory rows
    // intentionally have no actorSensitivity and retain their historical
    // tenant-scoped replay semantics; they must not be assigned currentActor
    // during replay. The cloud repository still validates the current request
    // context at the RPC boundary without persisting it into the old row.
    if (outboxActor && operation.actorSensitivity !== 'actor_bound') {
      outboxActor.assertCurrent();
      actorHandle = captureProductInventoryMutation(actorRequirementFlags);
    }
    if (mutationRequirements.length > 0 && operation.actorSensitivity === 'actor_bound') {
      try {
        if (!pharmacyReceipt && !cloudInventoryEntry) assertProductInventoryOperationActorCurrent(operation);
        actorHandle = captureProductInventoryMutation(actorRequirementFlags);
        // A restored session may verify or retry the same receipt as its
        // original actor. The request still checks live permissions on both ends.
        if ((pharmacyReceipt || cloudInventoryEntry) && operation.originActorKey !== actorHandle.actorKey) {
          assertProductInventoryOperationActorCurrent(operation);
        }
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
    let verifyLegacyPharmacyReceipt = false;

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
      const cloudPharmacyReceipt = payload.cloudPharmacyReceipt === true;
      verifyLegacyPharmacyReceipt = !cloudPharmacyReceipt && Boolean(payload.entry?.metadata?.pharmacyReceipt);
      try {
        response = await productCloudRepository.addInventoryEntry({
          actorHandle,
          licenseKey,
          entry: payload.entry,
          ...(cloudPharmacyReceipt ? { cloudPharmacyReceipt } : {}),
          ...(verifyLegacyPharmacyReceipt ? { verifyLegacyPharmacyReceipt } : {}),
          idempotencyKey
        });
      } catch (error) {
        if (!cloudPharmacyReceipt || error?.code !== 'P0001'
          || !/^(PHARMACY_CLASSIFICATION_REQUIRED|PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE|PHARMACY_BATCHES_REQUIRED|PHARMACY_PROVENANCE_REQUIRED|PHARMACY_BATCH_IDENTITY_REQUIRED|PHARMACY_RECEIPT_BATCH_MISMATCH|PHARMACY_EXISTING_BATCH_REQUIRED|PRODUCT_NOT_FOUND|BATCH_NOT_FOUND)$/.test(error.message)) throw error;
        response = { success: false, code: error.message };
      }
      if (verifyLegacyPharmacyReceipt) {
        if (response?.success !== true || response.idempotency_key !== idempotencyKey
          || response.product?.id !== payload.entry.productId || !Array.isArray(response.batches)
          || !['confirmed', 'rejected'].includes(response.receipt_outcome)) {
          throw asError({ code: 'PHARMACY_INVENTORY_REVIEW_REQUIRED' }, 'PRODUCT_PUSH_FAILED');
        }
        const applied = await productLocalRepository.applyCloudCatalog(response, {
          legacyReceipt: { productId: payload.entry.productId, batchId: payload.entry.batchId }
        });
        if (applied.deferredInventory || applied.rejected.length) {
          throw asError({ code: 'PHARMACY_INVENTORY_REVIEW_REQUIRED' }, 'PRODUCT_PUSH_FAILED');
        }
        if (actorHandle) assertProductInventoryMutationCurrent(actorHandle, actorRequirementFlags);
        await markInventoryEntrySynced(idempotencyKey, response);
        notifyProductsChanged({ source: 'productSyncHandler.pharmacyReceiptReconciled', productId: operation.entityId });
        return response;
      }
      if (cloudConfirmation && response?.success === false
        && /^(PHARMACY_|PRODUCT_NOT_FOUND$|BATCH_PRODUCT_MISMATCH$|BATCH_NOT_FOUND$|INVALID_QUANTITY$|INVALID_UNIT_PRECISION$|STRICT_(EXPIRY|MANUFACTURER_BATCH)_REQUIRED$|STOCK_TRACKING_DISABLED$|VARIANT_REQUIRED$|IDEMPOTENCY_PAYLOAD_MISMATCH$)/.test(response.code)) {
        if (actorHandle) assertProductInventoryMutationCurrent(actorHandle, actorRequirementFlags);
        await markCloudPharmacyReceiptRejected(idempotencyKey, response.code);
        return response;
      }
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
      await ensureCloudProductCategory({
        licenseKey,
        categoryId: payload.product?.category_id ?? payload.product?.categoryId,
        actorHandle
      });
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

    if (operation.entityType === SYNC_ENTITY_TYPES.PRODUCT
      && op !== SYNC_OPERATIONS.DELETE
      && op !== SYNC_OPERATIONS.TOGGLE_STATUS) {
      const confirmationError = getProductCloudConfirmationError(response, payload.product || {});
      if (confirmationError) throw asError(confirmationError, 'PRODUCT_PUSH_FAILED');
    }

    // A timeout or malformed RPC reply never proves that a receipt committed.
    // The same key is retried; only a verified canonical movement may be acked.
    if (operation.entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY && (
      response?.success !== true
      || !response?.inventory_movement?.id
      || response?.idempotency_key !== idempotencyKey
      || (cloudConfirmation && (
        response.product?.id !== operation.entityId || !response.batch?.id
        || response.batch?.product_id !== operation.entityId
      ))
    )) {
      throw asError({ code: 'INVENTORY_RECEIPT_CONFIRMATION_MISSING' }, 'PRODUCT_PUSH_FAILED');
    }

    if (await hasNewerLocalMutation(operation)) {
      const staleResponse = createStaleConflictResponse(operation, response, 'post_rpc');
      await saveStaleConflict(operation, staleResponse, 'post_rpc');
      return { conflict: staleResponse, success: false };
    }

    const applied = cloudConfirmation
      ? await productLocalRepository.applyCloudCatalog(response, { requireInventoryProjection: true })
      : await productLocalRepository.applyCloudCatalog(response);
    if (cloudConfirmation && (applied?.rejected?.length || applied?.deferredInventory)) {
      throw asError({ code: 'INVENTORY_RECEIPT_PROJECTION_PENDING' }, 'PRODUCT_PUSH_FAILED');
    }

    if (operation.entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY) {
      await markInventoryEntrySynced(idempotencyKey, response);
    }

    // A write ACK confirms this mutation only; pullCatalogChanges owns the read cursor.
    const changedProductId = operation.entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY
      ? operation.entityId : operation.entityType === SYNC_ENTITY_TYPES.PRODUCT
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
