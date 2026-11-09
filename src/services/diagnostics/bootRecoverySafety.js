import { getActorCheckoutOwnerships, getPendingActorOperations } from '../auth/actorOperationalHandoff';
import { getLocalDatabaseActivitySnapshot } from '../db/databaseRuntime';
import { hasAdminUpdateWrites, getAdminUpdateDraftBlockReason } from '../../pwa/adminUpdateSafety';
import { useAppStore } from '../../store/useAppStore';
import { getBootProgress } from './bootProgress';

// Read-only; do not clear checkout ownership or infer success from an absent active transaction.
export const getBootRetrySafety = () => {
  try {
    const state = useAppStore.getState();
    const progress = getBootProgress();
    const pendingCount = getPendingActorOperations().length;
    const checkouts = getActorCheckoutOwnerships();
    const liveCheckouts = checkouts.filter(item => item.persisted !== true).length;
    const savedCheckouts = checkouts.length - liveCheckouts;
    const activity = getLocalDatabaseActivitySnapshot();
    const reason = state._isInitializing || progress.active ? 'bootstrap_active'
      : pendingCount ? 'operation_active'
        : liveCheckouts ? 'checkout_active'
          : activity.hasActiveNativeRequest || activity.preflightActive ? 'database_active'
            : state.isBackupLoading ? 'backup_active'
              : hasAdminUpdateWrites() ? 'write_active'
                : getAdminUpdateDraftBlockReason() ? 'draft_active'
                  : null;
    return Object.freeze({
      canRetry: reason === null,
      // Saved checkouts survive a new in-place verification, but must still
      // prevent PWA replacement/reload while their resolution is unknown.
      canUpdate: reason === null && savedCheckouts === 0,
      reason, pendingCount, liveCheckouts, savedCheckouts,
      phase: progress.phase, phaseSince: progress.since
    });
  } catch {
    return Object.freeze({canRetry:false,canUpdate:false,reason:'unverified',pendingCount:null,liveCheckouts:null,savedCheckouts:null,phase:'unknown',phaseSince:null});
  }
};
