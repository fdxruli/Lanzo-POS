import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  isCloudSalesBaseSyncEnabled,
  shouldDeferPosBootstrapStartHook,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { salesCloudRepository } from './salesCloudRepository';
import { salesCloudLocalRepository } from './salesCloudLocalRepository';
import { isLocalTenantAccessError } from '../tenant/localTenantGuard';
import { salesCloudShadowService } from './salesCloudShadowService';
import { hasCurrentActorPermission } from '../sync/actorPermission';
import { actorRuntimeController } from '../auth/actorRuntimeController';

const SALES_LAST_CHANGE_SEQ_KEY = 'sales_cloud_base_last_change_seq';
let registered = false;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);
const getRuntimeLicenseDetails = () => useAppStore.getState()?.licenseDetails || null;

const notifySalesCloudChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:sales-cloud-sync-updated'));
  window.dispatchEvent(new CustomEvent('lanzo:sales-sync-updated'));
};

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const hasSalesEvents = (events = []) => events.some((event) => {
  const entityType = event.entity_type || event.entityType;
  return entityType === SYNC_ENTITY_TYPES.SALE
    || entityType === SYNC_ENTITY_TYPES.SALE_ITEM
    || entityType === SYNC_ENTITY_TYPES.SALE_PAYMENT
    || entityType === SYNC_ENTITY_TYPES.SALE_CANCELLATION
    || entityType === SYNC_ENTITY_TYPES.INVENTORY_MOVEMENT;
});

const applySalesPayload = async (response = {}, actorHandle = null) => {
  actorHandle?.assertCurrent();
  const result = await salesCloudLocalRepository.applyCloudSalesPayload(response, { actorHandle });
  actorHandle?.assertCurrent();
  return Number(result.cached || 0) + Number(result.patchedLocal || 0);
};

export const salesCloudSyncHandler = {
  actorPermission: 'pos',

  async onStart({ licenseDetails, licenseKey, reason = 'manual', force = false } = {}) {
    const resolvedLicenseKey = licenseKey || getLicenseKeyFromDetails(licenseDetails);
    if (!resolvedLicenseKey || !isOnline() || !isCloudSalesBaseSyncEnabled(licenseDetails)) {
      return { skipped: true };
    }
    if (!hasCurrentActorPermission('pos')) return { skipped: true, reason: 'actor_permission_missing' };

    if (shouldDeferPosBootstrapStartHook(reason, { force })) {
      Logger.log('[SalesCloud/Sync] Snapshot inicial diferido por bootstrap inteligente.');
      return { skipped: true, deferred: true, reason: 'bootstrap_deferred_snapshot' };
    }

    try {
      await salesCloudShadowService.retryPendingShadowSales({ limit: 10 });

      const snapshot = await salesCloudRepository.pullSalesSnapshot({
        licenseKey: resolvedLicenseKey,
        limit: 100,
        includeDeleted: false,
        force
      });

      if (snapshot?.success === false) {
        throw new Error(snapshot.message || snapshot.code || 'SALES_CLOUD_SNAPSHOT_FAILED');
      }

      const applied = await applySalesPayload(snapshot);
      const latestChangeSeq = normalizeChangeSeq(snapshot, 0);
      if (latestChangeSeq > 0) {
        await syncMetaService.setMeta(SALES_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey: resolvedLicenseKey });
      }

      if (applied > 0) notifySalesCloudChanged();
      return { success: true, applied, latestChangeSeq };
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[SalesCloud/Sync] Inicio fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], { licenseKey: capturedLicenseKey = null } = {}) {
    const licenseKey = capturedLicenseKey || getRuntimeLicenseKey();
    if (!licenseKey) return { applied: 0, skipped: true, reason: 'context_invalidated' };
    if (!isOnline()) return { applied: 0, skipped: true, reason: 'offline' };
    if (!isCloudSalesBaseSyncEnabled(getRuntimeLicenseDetails())) {
      return { applied: 0, skipped: true, reason: 'module_not_applicable' };
    }
    if (!hasCurrentActorPermission('pos')) {
      return { applied: 0, skipped: true, reason: 'actor_permission_missing' };
    }
    if (events.length > 0 && !hasSalesEvents(events)) {
      return { applied: 0, skipped: true, reason: 'module_not_applicable' };
    }

    const actorHandle = actorRuntimeController.capture('pos');
    let sinceChangeSeq = Number(await syncMetaService.getMeta(SALES_LAST_CHANGE_SEQ_KEY, 0, { licenseKey })) || 0;
    actorHandle.assertCurrent();
    let hasMore = true;
    let applied = 0;
    let syncDeferred = false;

    while (hasMore) {
      const pageSinceChangeSeq = sinceChangeSeq;
      const response = await salesCloudRepository.pullSalesChanges({
        licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
      });
      actorHandle.assertCurrent();

      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'SALES_CLOUD_CHANGES_PULL_FAILED');
        error.code = response.code || 'SALES_CLOUD_CHANGES_PULL_FAILED';
        error.retryable = response.retryable === true;
        error.response = response;
        throw error;
      }
      syncDeferred = syncDeferred || response?.sync_deferred === true || response?.syncDeferred === true;

      applied += await applySalesPayload(response, actorHandle);

      const latestChangeSeq = normalizeChangeSeq(response, pageSinceChangeSeq);
      if (latestChangeSeq > pageSinceChangeSeq) {
        actorHandle.assertCurrent();
        sinceChangeSeq = await syncMetaService.advanceMeta(SALES_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey })
          ?? latestChangeSeq;
        actorHandle.assertCurrent();
      }

      hasMore = Boolean(response.has_more || response.hasMore)
        && latestChangeSeq > pageSinceChangeSeq;
    }

    if (applied > 0) notifySalesCloudChanged();
    return { applied, latestChangeSeq: sinceChangeSeq, syncDeferred };
  },

  async pushOperation(operation = {}, { actorHandle } = {}) {
    if (operation.operation !== SYNC_OPERATIONS.UPSERT_SHADOW) {
      throw new Error('SALES_CLOUD_OPERATION_NOT_ALLOWED_IN_6A');
    }

    const licenseKey = operation.licenseKey || getRuntimeLicenseKey();
    if (!licenseKey) throw new Error('SALES_CLOUD_OUTBOX_LICENSE_REQUIRED');

    const payload = operation.payload || {};
    let localSale = payload.sale;
    if (!localSale?.id && operation.entityId) {
      localSale = await salesCloudLocalRepository.getSaleById(operation.entityId);
    }

    if (!localSale?.id && !payload.sale?.id) {
      throw new Error('SALES_CLOUD_OUTBOX_SALE_REQUIRED');
    }

    const response = await salesCloudRepository.upsertSaleShadow({
      licenseKey,
      sale: payload.sale,
      items: payload.items || [],
      payments: payload.payments || [],
      idempotencyKey: operation.idempotencyKey || payload.idempotencyKey,
      actorHandle
    });

    if (response?.success === false) {
      throw new Error(response.message || response.code || 'SALES_CLOUD_OUTBOX_PUSH_FAILED');
    }

    await salesCloudLocalRepository.applyCloudSalesPayload(response);
    await salesCloudLocalRepository.markShadowSynced(operation.entityId || payload.sale?.id, response);
    notifySalesCloudChanged();
    return response;
  }
};

export const registerSalesCloudSyncHandler = () => {
  if (registered) return false;

  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.SALE, salesCloudSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.SALE_ITEM, salesCloudSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.SALE_PAYMENT, salesCloudSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.SALE_CANCELLATION, salesCloudSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.INVENTORY_MOVEMENT, salesCloudSyncHandler);
  registered = true;
  Logger.log('[SalesCloud/Sync] Handler Fase 6E registrado. Ventas cloud y cancelaciones usan Supabase como fuente oficial.');
  return true;
};

registerSalesCloudSyncHandler();

export default salesCloudSyncHandler;
