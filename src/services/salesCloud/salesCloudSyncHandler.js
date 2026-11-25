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
import { durableSnapshotService, buildSnapshotContextId } from '../sync/durableSnapshotService';

const SALES_LAST_CHANGE_SEQ_KEY = 'sales_cloud_base_last_change_seq';
const SALES_SNAPSHOT_STREAM = 'sales';
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

const getSalesScope = (actorHandle) => {
  actorHandle?.assertCurrent?.();
  const actor = actorRuntimeController.getState();
  actorHandle?.assertCurrent?.();
  const permissions = actor.permissions || [];
  const canSeeAll = actor.actorType === 'admin'
    || permissions.includes('*') || permissions.includes('reports');
  return {
    visibility: canSeeAll ? 'authorized' : 'actor',
    actorKey: canSeeAll ? null : actorHandle?.actorKey || null,
    sessionId: canSeeAll ? null : actorHandle?.sessionId || null
  };
};

const getSalesCursorKey = (scope, useSnapshotContract) => {
  if (!useSnapshotContract || scope.visibility === 'authorized') return SALES_LAST_CHANGE_SEQ_KEY;
  return `${SALES_LAST_CHANGE_SEQ_KEY}:actor:${encodeURIComponent(scope.actorKey || 'unknown')}:${encodeURIComponent(scope.sessionId || 'no-session')}`;
};

const runSalesSnapshot = async ({ licenseKey, actorHandle, snapshotProtocol, force = false }) => {
  const scope = getSalesScope(actorHandle);
  const contextId = buildSnapshotContextId({
    licenseKey,
    streamKey: SALES_SNAPSHOT_STREAM,
    scope: { ...scope, dateFrom: null, dateTo: null },
    actorHandle
  });
  const cursorKey = getSalesCursorKey(scope, true);
  const snapshot = await durableSnapshotService.runConsistentSnapshot({
    licenseKey,
    streamKey: SALES_SNAPSHOT_STREAM,
    contextId,
    actorHandle,
    cursorKey,
    fetchPage: ({ referenceChangeSeq, pageCursor }) => salesCloudRepository.pullSalesSnapshot({
      licenseKey,
      limit: 500,
      dateFrom: null,
      dateTo: null,
      snapshotProtocol,
      snapshotReferenceChangeSeq: referenceChangeSeq,
      pageCursor,
      actorHandle,
      force
    }),
    applyPage: async (response) => {
      if (response.scope?.date_from !== null || response.scope?.date_to !== null
        || response.scope?.visibility !== scope.visibility) {
        throw new Error('SALES_SNAPSHOT_SCOPE_MISMATCH');
      }
      const sales = Array.isArray(response.sales) ? response.sales : [];
      const saleIds = new Set(sales.map((sale) => sale?.id).filter(Boolean));
      if (saleIds.size !== sales.length
        || [...(response.items || []), ...(response.payments || [])].some((row) => (
          !saleIds.has(row?.sale_id || row?.saleId)
        ))) throw new Error('SALES_SNAPSHOT_PROJECTION_INVALID');
      const applied = await applySalesPayload(response, actorHandle);
      actorHandle.assertCurrent();
      return { applied: Math.max(applied, sales.length), rowCount: sales.length };
    }
  });
  return { ...snapshot, contextId, cursorKey, scope };
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
      const actorHandle = actorRuntimeController.capture('pos');
      await salesCloudShadowService.retryPendingShadowSales({ limit: 10 });
      actorHandle.assertCurrent();
      const snapshotProtocol = await salesCloudRepository.negotiateSnapshotProtocol?.({
        licenseKey: resolvedLicenseKey, actorHandle, force
      }) || { supported: false, reason: 'snapshot_negotiation_unavailable' };
      actorHandle.assertCurrent();

      if (snapshotProtocol.supported) {
        const snapshot = await runSalesSnapshot({ licenseKey: resolvedLicenseKey, actorHandle, snapshotProtocol, force });
        actorHandle.assertCurrent();
        if (snapshot.applied > 0) notifySalesCloudChanged();
        return { success: true, ...snapshot, consistent: true };
      }

      const snapshot = await salesCloudRepository.pullSalesSnapshot({
        licenseKey: resolvedLicenseKey,
        limit: 100,
        includeDeleted: false,
        force,
        actorHandle
      });
      actorHandle.assertCurrent();

      if (snapshot?.success === false) {
        throw new Error(snapshot.message || snapshot.code || 'SALES_CLOUD_SNAPSHOT_FAILED');
      }

      const applied = await applySalesPayload(snapshot, actorHandle);
      const latestChangeSeq = normalizeChangeSeq(snapshot, 0);

      if (applied > 0) notifySalesCloudChanged();
      return {
        success: true,
        applied,
        latestChangeSeq: null,
        observedChangeSeq: latestChangeSeq,
        consistent: false,
        legacyFallback: true
      };
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[SalesCloud/Sync] Inicio fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], { licenseKey: capturedLicenseKey = null, force = false } = {}) {
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
    const snapshotProtocol = await salesCloudRepository.negotiateSnapshotProtocol?.({ licenseKey, actorHandle })
      || { supported: false, reason: 'snapshot_negotiation_unavailable' };
    actorHandle.assertCurrent();
    const scope = getSalesScope(actorHandle);
    const snapshotContextId = buildSnapshotContextId({
      licenseKey,
      streamKey: SALES_SNAPSHOT_STREAM,
      scope: { ...scope, dateFrom: null, dateTo: null },
      actorHandle
    });
    const cursorKey = getSalesCursorKey(scope, snapshotProtocol.supported);
    if (snapshotProtocol.supported && await durableSnapshotService.isActive({
      licenseKey, streamKey: SALES_SNAPSHOT_STREAM, contextId: snapshotContextId
    })) {
      if (!force) return { applied: 0, syncDeferred: true, reason: 'snapshot_resume_scheduled' };
      const resumed = await runSalesSnapshot({ licenseKey, actorHandle, snapshotProtocol, force: true });
      actorHandle.assertCurrent();
      if (resumed?.success !== true) return { applied: 0, syncDeferred: true, reason: 'snapshot_resume_pending' };
    }

    let sinceChangeSeq = snapshotProtocol.supported
      ? await durableSnapshotService.getRecoveryStartSeq({
        licenseKey,
        streamKey: SALES_SNAPSHOT_STREAM,
        contextId: snapshotContextId,
        cursorKey,
        fallback: 0
      })
      : Number(await syncMetaService.getMeta(cursorKey, 0, { licenseKey })) || 0;
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
        const advanced = await syncMetaService.advanceMeta(cursorKey, latestChangeSeq, { licenseKey });
        if (!Number.isSafeInteger(advanced) || advanced < latestChangeSeq) {
          throw new Error('POS_SYNC_CURSOR_PERSIST_FAILED');
        }
        // A reconciliation can intentionally read below the stored cursor.
        // Do not use advanceMeta's monotonic maximum as the next page cursor.
        sinceChangeSeq = latestChangeSeq;
        actorHandle.assertCurrent();
      }

      hasMore = Boolean(response.has_more || response.hasMore)
        && latestChangeSeq > pageSinceChangeSeq;
    }

    if (snapshotProtocol.supported) {
      const recoveryComplete = await durableSnapshotService.completeRecovery({
        licenseKey,
        streamKey: SALES_SNAPSHOT_STREAM,
        contextId: snapshotContextId,
        cursorKey,
        latestChangeSeq: sinceChangeSeq,
        hasMore,
        syncDeferred
      });
      syncDeferred = syncDeferred || recoveryComplete === false;
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
