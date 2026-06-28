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

const CASH_LAST_CHANGE_SEQ_KEY = 'cash_last_change_seq';
let registered = false;

const notifyCashChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:cash-sync-updated'));
};

const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const applyCashPayload = async (response = {}) => {
  const sessions = Array.isArray(response.cash_sessions) ? response.cash_sessions : [];
  const movements = Array.isArray(response.movements) ? response.movements : [];

  const appliedSessions = await cashLocalRepository.applyCloudCashSessions(sessions);
  const appliedMovements = await cashLocalRepository.applyCloudCashMovements(movements);

  return appliedSessions.length + appliedMovements.length;
};

export const cashSyncHandler = {
  async onStart({ licenseDetails, licenseKey, reason = 'manual', force = false } = {}) {
    const resolvedLicenseKey = licenseKey || getLicenseKeyFromDetails(licenseDetails);
    if (!resolvedLicenseKey || !isBrowserOnline() || !isCloudCashSyncEnabled(licenseDetails)) {
      return { skipped: true };
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
        force
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
      Logger.warn('[Cash/Sync] Snapshot inicial fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = []) {
    const licenseKey = getRuntimeLicenseKey();
    if (!licenseKey || !isBrowserOnline()) return { applied: 0, skipped: true };

    const hasCashEvents = events.some((event) => {
      const entityType = event.entity_type || event.entityType;
      return entityType === SYNC_ENTITY_TYPES.CASH_SESSION || entityType === SYNC_ENTITY_TYPES.CASH_MOVEMENT;
    });

    if (events.length > 0 && !hasCashEvents) {
      return { applied: 0, skipped: true };
    }

    let sinceChangeSeq = Number(await syncMetaService.getMeta(CASH_LAST_CHANGE_SEQ_KEY, 0, { licenseKey })) || 0;
    let hasMore = true;
    let applied = 0;

    while (hasMore) {
      const response = await cashCloudRepository.pullCashChanges({
        licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
      });

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'CASH_CHANGES_PULL_FAILED');
      }

      applied += await applyCashPayload(response);

      const latestChangeSeq = normalizeChangeSeq(response, sinceChangeSeq);
      if (latestChangeSeq > sinceChangeSeq) {
        sinceChangeSeq = latestChangeSeq;
        await syncMetaService.setMeta(CASH_LAST_CHANGE_SEQ_KEY, sinceChangeSeq, { licenseKey });
      }

      hasMore = Boolean(response.has_more || response.hasMore) && latestChangeSeq > 0;
      if (latestChangeSeq === sinceChangeSeq && !response.has_more && !response.hasMore) {
        hasMore = false;
      }
    }

    if (applied > 0) notifyCashChanged();
    return { applied, latestChangeSeq: sinceChangeSeq };
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
