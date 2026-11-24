import Logger from '../Logger';
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

const CASH_LAST_CHANGE_SEQ_KEY = 'cash_last_change_seq';
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

  const appliedSessions = await cashLocalRepository.applyCloudCashSessions(sessions, { actorHandle });
  const appliedMovements = await cashLocalRepository.applyCloudCashMovements(movements, { actorHandle });

  return appliedSessions.length + appliedMovements.length;
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
      const state = useAppStore.getState();
      const scope = state?.currentDeviceRole === 'staff' ? 'mine' : 'all';
      const response = await cashCloudRepository.pullCashSnapshot({
        licenseKey: resolvedLicenseKey,
        scope,
        limit: 100,
        includeClosed: true,
        force,
        cacheContext: getRuntimeCashCacheContext()
      });

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'CASH_SNAPSHOT_FAILED');
      }

      const applied = await applyCashPayload(response);
      const latestChangeSeq = normalizeChangeSeq(response, 0);
      if (latestChangeSeq > 0) {
        await syncMetaService.setMeta(CASH_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey: resolvedLicenseKey });
      }

      if (applied > 0) notifyCashChanged();
      return { success: true, applied, latestChangeSeq };
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[Cash/Sync] Snapshot inicial fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], { licenseKey: capturedLicenseKey = null } = {}) {
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

    let sinceChangeSeq = Number(await syncMetaService.getMeta(CASH_LAST_CHANGE_SEQ_KEY, 0, { licenseKey })) || 0;
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
        sinceChangeSeq = await syncMetaService.advanceMeta(CASH_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey })
          ?? latestChangeSeq;
        actorHandle.assertCurrent();
      }

      hasMore = Boolean(response.has_more || response.hasMore)
        && latestChangeSeq > pageSinceChangeSeq;
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
