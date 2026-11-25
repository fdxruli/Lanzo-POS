import Logger from '../Logger';
import { db, STORES } from '../db/dexie';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  isCloudCashSyncEnabled,
  shouldDeferPosBootstrapStartHook,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS
} from '../sync/syncConstants';
import { cashCloudRepository } from './cashCloudRepository';
import { cashLocalRepository } from './cashLocalRepository';
import { isBrowserOnline } from './cashActor';
import { isLocalTenantAccessError } from '../tenant/localTenantGuard';
import { hasCurrentActorPermission } from '../sync/actorPermission';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { durableSnapshotService, buildSnapshotContextId } from '../sync/durableSnapshotService';

const CASH_LAST_CHANGE_SEQ_KEY = 'cash_last_change_seq';
const CASH_SNAPSHOT_STREAM = 'cash_register';
let registered = false;

const notifyCashChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:cash-sync-updated'));
};

const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);

const getRuntimeCashCacheContext = () => {
  const state = useAppStore.getState() || {};
  const isStaff = state.currentDeviceRole === 'staff';
  const actor = isStaff ? state.currentStaffUser : (state.currentAdminUser || state.licenseDetails?.admin_user);
  return {
    actorKey: actor?.id ? `${isStaff ? 'staff' : 'admin'}:${actor.id}` : null,
    actorSessionId: state.currentStaffSession?.id
      || state.currentActorSession?.id
      || null
  };
};

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const applyCashPayload = async (response = {}, actorHandle = null) => {
  const sessions = Array.isArray(response.cash_sessions) ? response.cash_sessions : [];
  const movements = Array.isArray(response.movements) ? response.movements : [];
  return db.transaction('rw', [STORES.CAJAS, STORES.MOVIMIENTOS_CAJA], async () => {
    actorHandle?.assertCurrent?.();
    const appliedSessions = await cashLocalRepository.applyCloudCashSessions(sessions, { actorHandle });
    const appliedMovements = await cashLocalRepository.applyCloudCashMovements(movements, { actorHandle });
    actorHandle?.assertCurrent?.();
    if (appliedSessions.length !== sessions.length || appliedMovements.length !== movements.length) {
      throw new Error('CASH_LOCAL_APPLY_INCOMPLETE');
    }
    return appliedSessions.length + appliedMovements.length;
  });
};

const getCashScope = (actorHandle) => actorHandle?.actorType === 'staff' ? 'mine' : 'all';
const getCashCursorKey = (scope, actorHandle, useSnapshotContract) => {
  if (!useSnapshotContract || scope !== 'mine') return CASH_LAST_CHANGE_SEQ_KEY;
  return `${CASH_LAST_CHANGE_SEQ_KEY}:mine:${encodeURIComponent(actorHandle?.actorKey || 'unknown')}:${encodeURIComponent(actorHandle?.sessionId || 'no-session')}`;
};

const runCashSnapshot = async ({ licenseKey, actorHandle, snapshotProtocol, scope, force = false }) => {
  const contextId = buildSnapshotContextId({
    licenseKey,
    streamKey: CASH_SNAPSHOT_STREAM,
    scope: { cashScope: scope },
    actorHandle
  });
  const cursorKey = getCashCursorKey(scope, actorHandle, true);
  const snapshot = await durableSnapshotService.runConsistentSnapshot({
    licenseKey,
    streamKey: CASH_SNAPSHOT_STREAM,
    contextId,
    actorHandle,
    cursorKey,
    fetchPage: ({ referenceChangeSeq, pageCursor }) => cashCloudRepository.pullCashSnapshot({
      licenseKey,
      scope,
      limit: 500,
      snapshotProtocol,
      snapshotReferenceChangeSeq: referenceChangeSeq,
      pageCursor,
      actorHandle,
      force,
      allowCache: false
    }),
    applyPage: async (response) => {
      if (response.scope !== scope) throw new Error('CASH_SNAPSHOT_SCOPE_MISMATCH');
      const rowCount = (response.cash_sessions?.length || 0) + (response.movements?.length || 0);
      const applied = await applyCashPayload(response, actorHandle);
      actorHandle.assertCurrent();
      return { applied, rowCount };
    }
  });
  return { ...snapshot, contextId, cursorKey, scope };
};

export const cashSyncHandler = {
  actorPermission: 'cash_register',

  async onStart({ licenseDetails, licenseKey, reason = 'manual', force = false } = {}) {
    const resolvedLicenseKey = licenseKey || getLicenseKeyFromDetails(licenseDetails);
    if (!resolvedLicenseKey || !isBrowserOnline() || !isCloudCashSyncEnabled(licenseDetails)) {
      return { skipped: true };
    }
    if (!hasCurrentActorPermission('cash_register')) {
      return { skipped: true, reason: 'actor_permission_missing' };
    }

    if (shouldDeferPosBootstrapStartHook(reason, { force })) {
      Logger.log('[Cash/Sync] Snapshot inicial diferido por bootstrap inteligente.');
      return { skipped: true, deferred: true, reason: 'bootstrap_deferred_snapshot' };
    }

    try {
      const actorHandle = actorRuntimeController.capture('cash_register');
      const scope = getCashScope(actorHandle);
      const snapshotProtocol = await cashCloudRepository.negotiateSnapshotProtocol?.({
        licenseKey: resolvedLicenseKey, actorHandle, force
      }) || { supported: false, reason: 'snapshot_negotiation_unavailable' };
      actorHandle.assertCurrent();
      if (snapshotProtocol.supported) {
        const snapshot = await runCashSnapshot({ licenseKey: resolvedLicenseKey, actorHandle, snapshotProtocol, scope, force });
        actorHandle.assertCurrent();
        if (snapshot.applied > 0) notifyCashChanged();
        return { success: true, ...snapshot, consistent: true };
      }

      const response = await cashCloudRepository.pullCashSnapshot({
        licenseKey: resolvedLicenseKey,
        scope,
        limit: 100,
        includeClosed: true,
        force,
        cacheContext: getRuntimeCashCacheContext(),
        actorHandle
      });

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'CASH_SNAPSHOT_FAILED');
      }

      actorHandle.assertCurrent();
      const applied = await applyCashPayload(response, actorHandle);
      const latestChangeSeq = normalizeChangeSeq(response, 0);

      if (applied > 0) notifyCashChanged();
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
      Logger.warn('[Cash/Sync] Snapshot inicial fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], { licenseKey: capturedLicenseKey = null, force = false } = {}) {
    const licenseKey = capturedLicenseKey || getRuntimeLicenseKey();
    if (!licenseKey) return { applied: 0, skipped: true, reason: 'context_invalidated' };
    if (!isBrowserOnline()) return { applied: 0, skipped: true, reason: 'offline' };
    if (!hasCurrentActorPermission('cash_register')) {
      return { applied: 0, skipped: true, reason: 'actor_permission_missing' };
    }
    const actorHandle = actorRuntimeController.capture('cash_register');

    const hasCashEvents = events.some((event) => {
      const entityType = event.entity_type || event.entityType;
      return entityType === SYNC_ENTITY_TYPES.CASH_SESSION || entityType === SYNC_ENTITY_TYPES.CASH_MOVEMENT;
    });

    if (events.length > 0 && !hasCashEvents) {
      return { applied: 0, skipped: true, reason: 'module_not_applicable' };
    }

    const snapshotProtocol = await cashCloudRepository.negotiateSnapshotProtocol?.({ licenseKey, actorHandle })
      || { supported: false, reason: 'snapshot_negotiation_unavailable' };
    actorHandle.assertCurrent();
    const scope = getCashScope(actorHandle);
    const snapshotContextId = buildSnapshotContextId({
      licenseKey, streamKey: CASH_SNAPSHOT_STREAM, scope: { cashScope: scope }, actorHandle
    });
    const cursorKey = getCashCursorKey(scope, actorHandle, snapshotProtocol.supported);
    if (snapshotProtocol.supported && await durableSnapshotService.isActive({
      licenseKey, streamKey: CASH_SNAPSHOT_STREAM, contextId: snapshotContextId
    })) {
      if (!force) return { applied: 0, syncDeferred: true, reason: 'snapshot_resume_scheduled' };
      const resumed = await runCashSnapshot({ licenseKey, actorHandle, snapshotProtocol, scope, force: true });
      actorHandle.assertCurrent();
      if (resumed?.success !== true) return { applied: 0, syncDeferred: true, reason: 'snapshot_resume_pending' };
    }

    let sinceChangeSeq = snapshotProtocol.supported
      ? await durableSnapshotService.getRecoveryStartSeq({
        licenseKey,
        streamKey: CASH_SNAPSHOT_STREAM,
        contextId: snapshotContextId,
        cursorKey,
        fallback: 0
      })
      : Number(await syncMetaService.getMeta(cursorKey, 0, { licenseKey })) || 0;
    let hasMore = true;
    let applied = 0;
    let syncDeferred = false;

    while (hasMore) {
      const pageSinceChangeSeq = sinceChangeSeq;
      const response = await cashCloudRepository.pullCashChanges({
        licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
      });
      actorHandle.assertCurrent();

      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'CASH_CHANGES_PULL_FAILED');
        error.code = response.code || 'CASH_CHANGES_PULL_FAILED';
        error.retryable = response.retryable === true;
        error.response = response;
        throw error;
      }
      syncDeferred = syncDeferred || response?.sync_deferred === true || response?.syncDeferred === true;

      applied += await applyCashPayload(response, actorHandle);

      const latestChangeSeq = normalizeChangeSeq(response, pageSinceChangeSeq);
      if (latestChangeSeq > pageSinceChangeSeq) {
        actorHandle.assertCurrent();
        const advanced = await syncMetaService.advanceMeta(cursorKey, latestChangeSeq, { licenseKey });
        if (!Number.isSafeInteger(advanced) || advanced < latestChangeSeq) {
          throw new Error('POS_SYNC_CURSOR_PERSIST_FAILED');
        }
        // Keep the current traversal at the response boundary even when the
        // durable cursor was already higher before historical reconciliation.
        sinceChangeSeq = latestChangeSeq;
        actorHandle.assertCurrent();
      }

      hasMore = Boolean(response.has_more || response.hasMore)
        && latestChangeSeq > pageSinceChangeSeq;
    }

    if (snapshotProtocol.supported) {
      const recoveryComplete = await durableSnapshotService.completeRecovery({
        licenseKey,
        streamKey: CASH_SNAPSHOT_STREAM,
        contextId: snapshotContextId,
        cursorKey,
        latestChangeSeq: sinceChangeSeq,
        hasMore,
        syncDeferred
      });
      syncDeferred = syncDeferred || recoveryComplete === false;
    }

    if (applied > 0) notifyCashChanged();
    return { applied, latestChangeSeq: sinceChangeSeq, syncDeferred };
  },

  async pushOperation() {
    throw new Error('CASH_OUTBOX_DISABLED: Las operaciones de caja PRO no se encolan offline por seguridad.');
  }
};

export const registerCashSyncHandler = () => {
  if (registered) return false;

  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.CASH_SESSION, cashSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.CASH_MOVEMENT, cashSyncHandler);
  registered = true;
  Logger.log('[Cash/Sync] Handler de caja registrado.');
  return true;
};

registerCashSyncHandler();

export default cashSyncHandler;
