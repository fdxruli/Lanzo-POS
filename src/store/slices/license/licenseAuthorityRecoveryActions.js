import Logger from '../../../services/Logger';
import { FATAL_REASONS, LOCAL_FATAL_APP_STATUSES } from './licenseConstants';
import {
  getActorAuthorityRecoverySnapshot,
  reportActorAuthorityError,
  subscribeActorAuthorityRecovery
} from '../../../services/auth/actorAuthorityRecovery';

const HARD_BLOCKED_STATUSES = new Set([
  'unauthenticated', 'license_change_required', 'locked_renewal',
  'local_tenant_mismatch', 'local_database_recovery_required',
  ...LOCAL_FATAL_APP_STATUSES.filter((status) => status !== 'staff_login_required')
]);
const HARD_LICENSE_REASONS = new Set(FATAL_REASONS);

export const createLicenseAuthorityRecoveryActions = ({ set, get }) => {
  const routeRecovery = (recovery) => {
    const state = get();
    if (!state) return;
    if (!recovery) {
      set({ actorAuthorityRecovery: null });
      return;
    }
    if (state._isLoggingOut || HARD_BLOCKED_STATUSES.has(state.appStatus)
      || HARD_LICENSE_REASONS.has(state.licenseStatus)
      || HARD_LICENSE_REASONS.has(state.licenseDetails?.status)) return;
    const actorType = recovery.actorType || state.currentDeviceRole || null;
    const licenseKey = state.licenseDetails?.license_key
      || state.adminLoginLicenseKey || state.staffLoginLicenseKey || null;
    set({
      actorAuthorityRecovery: { ...recovery, actorType },
      appStatus: actorType === 'staff' ? 'staff_login_required'
        : actorType === 'admin' ? 'admin_login_required' : 'license_access_required',
      currentDeviceRole: actorType,
      currentAdminUser: null,
      currentStaffUser: null,
      pendingAdminSessionResult: null,
      adminLoginLicenseKey: licenseKey,
      staffLoginLicenseKey: licenseKey,
      adminLoginMessage: recovery.message,
      staffLoginMessage: recovery.message,
      adminLoginError: null,
      staffLoginError: null,
      lastIntegrityFailure: {
        code: 'ACTOR_REAUTHENTICATION_REQUIRED', message: recovery.message,
        source: 'authority', reason: recovery.reason
      }
    });
    state._invalidateProfileLoads?.();
    // Route synchronously before stopping sync so any already-running
    // validation sees the login screen and discards its obsolete response.
    try {
      Promise.resolve(state.stopLicenseSync?.()).catch(() => {
        Logger.warn('[ActorRecovery] No se pudo detener la sincronización de sesión.');
      });
    } catch {
      Logger.warn('[ActorRecovery] No se pudo detener la sincronización de sesión.');
    }
  };
  const unsubscribe = subscribeActorAuthorityRecovery(routeRecovery);
  return {
    actorAuthorityRecovery: null,
    _disposeActorAuthorityRecoveryObserver: unsubscribe,
    _requireActorAuthorityRecovery: async (error, options = {}) => {
      const handled = reportActorAuthorityError(error, options);
      if (handled) routeRecovery(getActorAuthorityRecoverySnapshot());
      return handled;
    }
  };
};
