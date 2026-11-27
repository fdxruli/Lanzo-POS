// src/store/slices/license/licenseStaffActions.js

import { notifyPosCatalogSessionReset } from '../../../services/products/posCatalogSessionEvents';
import {
  clearStaffSessionCache,
  clearAdminSessionCache,
  hasStaffSessionToken,
  staffLoginOnDevice,
  staffLogoutSession
} from '../../../services/supabase';
import {
  beginActorRuntimeAuthentication,
  grantAuthenticatedActorRuntime,
  lockActorRuntime,
  refreshAuthenticatedStaffSession
} from '../../../services/auth/actorSessionRuntimeBridge';
import { resolveStaffAuthRoutingDecision } from '../../../services/deviceModePolicy';

import {
  saveLicenseToStorage
} from '../../../services/licenseStorage';

import {
  getStaffLoginMessage
} from './licenseGuards';
import {
  assertLocalTenantAccess,
  initializeLocalTenantGuard,
  isLocalTenantAccessError,
  lockLocalTenantAccess
} from '../../../services/tenant/localTenantGuard';
import { enterLocalTenantIsolationFailure } from './localTenantIsolationState';
import { isBrowserStorageUnavailableError } from '../../../services/db/databaseRecoveryState';

import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import {
  ACTOR_HANDOFF_CHECKOUT_OWNED,
  assertActorSessionCanClose
} from '../../../services/auth/actorOperationalHandoff';
import { isAuthoritativeSessionDenial } from '../../../services/auth/sessionVerification';
import { STAFF_ONLY_MODE_LOGIN_MESSAGE, STAFF_SESSION_CLOSED_MESSAGE } from './licenseConstants';
import { captureLicenseValidationContext, assertLicenseValidationContextCurrent,
  persistWithinLicenseValidationContext } from './licenseValidationContext';
import Logger from '../../../services/Logger';

export const hasStaffValidationContext = async (state = {}, licenseDetails = {}) => {
  const routingDecision = resolveStaffAuthRoutingDecision(state, licenseDetails);
  if (routingDecision !== null) return routingDecision;
  return hasStaffSessionToken();
};

export const createLicenseStaffActions = ({
  set,
  get
}) => {
  let pending = null;
  let pendingKey = null;
  let queued = false;
  let lastKey = null;
  let lastAttempt = 0;
  let deferred = null;
  return ({
  _stopStaffPermissionRefresh: () => { clearTimeout(deferred); deferred = null; queued = false; },
  refreshStaffSessionPermissions: (reason = 'manual') => {
    const state = get();
    const actor = actorRuntimeController.getState();
    if (state.appStatus !== 'ready' || state._isInitializing || actor.status !== 'granted' ||
        actor.actorType !== 'staff' || !state.licenseDetails?.license_key || !navigator.onLine) return Promise.resolve(false);
    let context;
    try { context = captureLicenseValidationContext(state, null, { trackPermissions: false }); }
    catch { return Promise.resolve(false); }
    const key = JSON.stringify(context.actorBinding) + context.licenseKey;
    if (pending) {
      queued ||= reason === 'realtime_event' || key !== pendingKey;
      return pending;
    }
    const remaining = 90_000 - (Date.now() - lastAttempt);
    if (reason !== 'realtime_event' && key === lastKey && remaining > 0) {
      // One bounded trailing check covers an online/focus event lost to the
      // cooldown. No polling loop or extra browser listeners are introduced.
      deferred ||= setTimeout(() => { deferred = null; get().refreshStaffSessionPermissions('resume_deferred'); }, remaining);
      return Promise.resolve(false);
    }
    clearTimeout(deferred); deferred = null;
    pendingKey = key; lastKey = key; lastAttempt = Date.now();
    const assertContext = () => {
      assertLicenseValidationContextCurrent(context, get());
      if (queued) throw Object.assign(new Error('Staff verification superseded by a newer signal'), {
        code: 'SESSION_VERIFICATION_CONTEXT_STALE'
      });
      if (get().appStatus !== 'ready') throw new Error('STAFF_REFRESH_CONTEXT_STALE');
    };
    pending = (async () => {
      try {
        const verified = await refreshAuthenticatedStaffSession({ licenseKey: context.licenseKey,
          handle: context.actorHandle, assertContext,
          beforeApply: staff => persistWithinLicenseValidationContext(context, get, () => saveLicenseToStorage({
            ...get().licenseDetails, device_role: 'staff', staff_user: staff, admin_user: null
          }))
        });
        assertContext();
        if (isAuthoritativeSessionDenial(verified)) {
          await get()._requireStaffLogin(get().licenseDetails, verified);
          return false;
        }
        if (verified.verificationStatus !== 'verified' || verified.valid !== true) {
          Logger.warn('[StaffPermissions] Verificación no concluyente:', verified.verificationStatus, verified.code);
          return false;
        }
        Logger.log('[StaffPermissions] Permisos verificados para la sesión Staff activa.');
        set({ currentDeviceRole: 'staff', currentStaffUser: verified.staff_user,
          licenseDetails: { ...get().licenseDetails, device_role: 'staff', staff_user: verified.staff_user, admin_user: null } });
        return true;
      } catch (error) {
        Logger.warn('[StaffPermissions] Respuesta descartada o verificación no disponible:', error?.code || error?.message);
        return false;
      }
    })().then(result => {
      pending = null;
      if (queued) { queued = false; return get().refreshStaffSessionPermissions('realtime_event'); }
      return result;
    });
    return pending;
  },
  _requireStaffLogin: async (licenseSource = null, validation = {}) => {
    const state = get();
    const sourceLicense = licenseSource || state.licenseDetails || {};
    const licenseKey = sourceLicense.license_key || state.staffLoginLicenseKey || null;
    const preserveSessionCredentials = validation.preserveSessionCredentials === true;
    const sessionCredentialCleared = validation.sessionCredentialCleared === true;

    const nextLicenseDetails = sourceLicense.license_key
      ? {
        ...sourceLicense,
        device_role: 'staff',
        ...(preserveSessionCredentials ? {} : { staff_user: null })
      }
      : state.licenseDetails;

    lockActorRuntime('staff_login_required');

    // Si un staff queda bloqueado/liberado/no autorizado, apagamos cualquier
    // sincronización activa para evitar revalidaciones de fondo o un canal
    // Realtime vivo mientras el usuario está en StaffLoginModal.
    try {
      // stopLicenseSync clears timers and listeners before its first await.
      // Realtime channel teardown can settle later; it must not trap the
      // authorized Staff login route after the Admin session was revoked.
      Promise.resolve(get().stopLicenseSync()).catch((error) => {
        Logger.warn('[StaffAuth] No se pudo detener completamente la sincronización al solicitar acceso Staff:', error?.code || error?.message);
      });
    } catch (error) {
      Logger.warn('[StaffAuth] No se pudo detener completamente la sincronización al solicitar acceso Staff:', error?.code || error?.message);
    }

    if (!preserveSessionCredentials) {
      // The verifier already reconciled both role snapshots under the tenant
      // lease. Do not clear either cache after this await: a
      // newer login may have established credentials in the meantime.
      if (!sessionCredentialCleared) {
        await clearStaffSessionCache();
        await clearAdminSessionCache();
      }
    }

    if (nextLicenseDetails?.license_key && !preserveSessionCredentials) {
      await saveLicenseToStorage(nextLicenseDetails);
    }

    set({
      appStatus: 'staff_login_required',
      ...(nextLicenseDetails ? { licenseDetails: nextLicenseDetails } : {}),
      licenseSyncActive: false,
      licenseSyncMode: 'idle',
      licenseSyncLicenseKey: null,
      currentDeviceRole: 'staff',
      currentStaffUser: null,
      staffLoginLicenseKey: licenseKey,
      staffLoginMessage: getStaffLoginMessage(validation),
      staffLoginError: null
    });
  },

  handleStaffLogin: async ({ username, password }) => {
    const state = get();
    if (state._isLoggingOut) {
      return { success: false, code: 'STAFF_LOGOUT_IN_PROGRESS', message: 'Espera a que termine el cierre de sesión Staff.' };
    }
    const licenseKey = state.staffLoginLicenseKey || state.licenseDetails?.license_key;

    if (!licenseKey) {
      lockActorRuntime('staff_login_missing_license');
      return { success: false, message: 'No hay licencia para iniciar sesion staff.' };
    }

    try {
      initializeLocalTenantGuard('staff_login');
      await assertLocalTenantAccess({ license_key: licenseKey }, { reason: 'staff_login' });
      beginActorRuntimeAuthentication('staff');
    } catch (error) {
      lockActorRuntime('staff_login_tenant_rejected');
      if (isBrowserStorageUnavailableError(error)) {
        return { success: false, code: error.code, message: error.message };
      }
      if (!isLocalTenantAccessError(error)) throw error;
      enterLocalTenantIsolationFailure(set, error);
      return {
        success: false,
        localTenantMismatch: true,
        code: error.code,
        message: error.message
      };
    }
    let result;
    try {
      result = await staffLoginOnDevice({
        licenseKey,
        username,
        password,
        beforeLocalPersistence: (tenantSource) => assertLocalTenantAccess(
          tenantSource,
          { reason: 'staff_login_before_local_persistence' }
        )
      });
    } catch (error) {
      lockActorRuntime('staff_login_failed');
      if (isBrowserStorageUnavailableError(error)) {
        return { success: false, code: error.code, message: error.message };
      }
      if (!isLocalTenantAccessError(error)) throw error;
      enterLocalTenantIsolationFailure(set, error);
      return {
        success: false,
        localTenantMismatch: true,
        code: error.code,
        message: error.message
      };
    }

    if (!result.success) {
      lockActorRuntime('staff_credentials_rejected');
      const isStaffAlreadyInUse = result.code === 'STAFF_ALREADY_IN_USE';

      const message = isStaffAlreadyInUse
        ? [
          'Este usuario staff ya está activo en otro dispositivo. Pide al administrador liberar ese dispositivo desde Configuración > Licencia y Rubros > Dispositivos.',
          result.active_device_name ? `Dispositivo activo: ${result.active_device_name}` : null
        ].filter(Boolean).join('\n')
        : result.message;

      set({
        appStatus: isStaffAlreadyInUse ? 'staff_login_required' : state.appStatus,
        currentDeviceRole: isStaffAlreadyInUse ? 'staff' : state.currentDeviceRole,
        currentStaffUser: isStaffAlreadyInUse ? null : state.currentStaffUser,
        staffLoginLicenseKey: licenseKey,
        staffLoginMessage: message,
        staffLoginError: {
          code: result.code || 'STAFF_LOGIN_FAILED',
          message,
          active_device_name: result.active_device_name || null,
          active_device_last_used_at: result.active_device_last_used_at || null,
          active_device_activated_at: result.active_device_activated_at || null
        }
      });

      return {
        success: false,
        code: result.code,
        message,
        active_device_name: result.active_device_name || null,
        active_device_last_used_at: result.active_device_last_used_at || null,
        active_device_activated_at: result.active_device_activated_at || null
      };
    }
    const licenseDataToSave = {
      ...state.licenseDetails,
      ...result.details,
      license_key: result.details?.license_key || licenseKey,
      valid: true,
      device_role: 'staff',
      staff_user: result.staff_user || result.details?.staff_user || null
    };
    try {
      await assertLocalTenantAccess(licenseDataToSave, { reason: 'staff_login_response' });
    } catch (error) {
      lockActorRuntime('staff_login_response_tenant_rejected');
      if (!isLocalTenantAccessError(error)) throw error;
      enterLocalTenantIsolationFailure(set, error);
      return {
        success: false,
        localTenantMismatch: true,
        code: error.code,
        message: error.message
      };
    }
    // Keep the persisted actor role and both token caches in lockstep even
    // when the RPC adapter is replaced or mocked by an embedding host.
    await clearAdminSessionCache();
    await saveLicenseToStorage(licenseDataToSave);

    set({
      licenseDetails: licenseDataToSave,
      _isLoggingOut: false,
      currentDeviceRole: 'staff',
      currentStaffUser: licenseDataToSave.staff_user,
      staffLoginLicenseKey: licenseKey,
      staffLoginMessage: null,
      staffLoginError: null,
      localTenantIsolation: null
    });

    try {
      // Actor authority must exist before profile hydration can publish the
      // operational UI as ready. If profile hydration later fails, the catch
      // below invalidates this actor epoch again.
      await grantAuthenticatedActorRuntime({
        actorType: 'staff',
        actor: licenseDataToSave.staff_user
      });
      await get()._loadProfile(licenseKey);
      if (get().appStatus === 'ready') {
        get()._validateInBackground?.(licenseKey, { reason: 'staff_login' });
      }
    } catch (error) {
      lockActorRuntime('staff_actor_binding_failed');
      set({
        appStatus: 'staff_login_required',
        currentStaffUser: null,
        staffLoginError: {
          code: error?.code || 'ACTOR_SESSION_BINDING_FAILED',
          message: 'No se pudo vincular la sesión staff al contexto operativo. Vuelve a iniciar sesión.'
        }
      });
      return {
        success: false,
        code: error?.code || 'ACTOR_SESSION_BINDING_FAILED',
        message: 'No se pudo vincular la sesión staff al contexto operativo.'
      };
    }

    return { success: true };
  },
  requireStaffLoginAfterDeviceModeChange: async (deviceMode) => {
    if (deviceMode !== 'staff_only') {
      return { success: false, code: 'STAFF_DEVICE_MODE_CHANGE_INVALID' };
    }
    const state = get();
    const licenseKey = state.licenseDetails?.license_key || state.adminLoginLicenseKey;
    if (!licenseKey) return { success: false, code: 'STAFF_LOGIN_MISSING_LICENSE' };

    const nextLicenseDetails = {
      ...(state.licenseDetails || {}),
      license_key: licenseKey,
      device_mode: 'staff_only',
      device_role: 'staff',
      admin_user: null,
      staff_user: null
    };
    await get()._requireStaffLogin(nextLicenseDetails, {
      code: 'DEVICE_MODE_STAFF_LOGIN_REQUIRED',
      message: STAFF_ONLY_MODE_LOGIN_MESSAGE
    });
    return { success: true };
  },
  logoutStaff: async () => {
    const state = get();
    if (state._isLoggingOut) {
      return { success: false, code: 'STAFF_LOGOUT_IN_PROGRESS', message: 'El cierre de sesión Staff ya está en curso.' };
    }
    if (state.isBackupLoading) {
      return {
        success: false,
        code: 'BACKUP_OPERATION_ACTIVE',
        message: 'Espera a que termine el respaldo o la restauración antes de cerrar sesión.'
      };
    }
    const actor = actorRuntimeController.getState();
    if (actor.status !== 'granted' || actor.actorType !== 'staff') {
      return { success: false, code: 'STAFF_SESSION_NOT_ACTIVE', message: 'No hay una sesión Staff activa en este dispositivo.' };
    }
    const licenseKey = state.licenseDetails?.license_key || state.staffLoginLicenseKey;
    if (!licenseKey) {
      return { success: false, code: 'STAFF_LOGOUT_LICENSE_MISSING', message: 'No se pudo confirmar el negocio de la sesión Staff.' };
    }

    try {
      assertActorSessionCanClose({ tenant: actor.tenant, actorKey: actor.actorKey });
    } catch (error) {
      const code = error?.code || 'ACTOR_HANDOFF_PENDING_OPERATIONS';
      const message = code === ACTOR_HANDOFF_CHECKOUT_OWNED
        ? 'Hay un cobro o cierre de venta en curso. Termina la operación antes de cerrar sesión; su estado local se conserva.'
        : 'Hay una operación de caja o guardado en curso. Espera a que termine antes de cerrar sesión.';
      return { success: false, code, message };
    }

    const nextLicenseDetails = state.licenseDetails?.license_key
      ? { ...state.licenseDetails, device_role: 'staff', staff_user: null }
      : state.licenseDetails;
    // Invalidate actor-sensitive async work before any remote/local logout I/O.
    // Durable local data and Outbox rows remain tenant-owned and untouched.
    lockActorRuntime('staff_actor_logged_out');
    get()._invalidateProfileLoads?.();
    get().resetEcommerceOrdersState?.();
    get().lockDriveSession?.();
    get()._stopStaffPermissionRefresh?.();
    set({
      appStatus: 'staff_login_required',
      _isLoggingOut: true,
      licenseSyncActive: false,
      licenseSyncMode: 'idle',
      licenseSyncLicenseKey: null,
      ...(nextLicenseDetails ? { licenseDetails: nextLicenseDetails } : {}),
      currentDeviceRole: 'staff',
      currentStaffUser: null,
      cashOpeningPolicy: 'manual',
      staffLoginLicenseKey: licenseKey || null,
      staffLoginMessage: 'Cerrando sesion staff...',
      staffLoginError: null
    });
    notifyPosCatalogSessionReset();
    let cleanupError = null;
    try {
      // stopLicenseSync synchronously clears timers/listeners, then may await
      // channel teardown. The actor fence is already closed, so teardown can
      // settle in the background without trapping the login screen.
      Promise.resolve(get().stopLicenseSync()).catch((error) => {
        Logger.warn('[StaffAuth] No se pudo detener completamente la sincronización al cerrar sesión:', error?.code || error?.message);
      });
    } catch (error) {
      // Actor authority was already invalidated. Keep the logout moving so a
      // deferred Cloud read or channel teardown cannot trap the user.
      Logger.warn('[StaffAuth] No se pudo detener completamente la sincronización al cerrar sesión:', error?.code || error?.message);
    }
    try {
      await staffLogoutSession(licenseKey);
    } catch (error) {
      cleanupError = error;
      Logger.warn('[StaffAuth] No se pudo limpiar la sesión Staff:', error?.code || error?.message);
    }
    try {
      if (nextLicenseDetails?.license_key) await saveLicenseToStorage(nextLicenseDetails);
    } catch (error) {
      cleanupError ||= error;
      Logger.warn('[StaffAuth] No se pudo persistir el rol local después del cierre Staff:', error?.code || error?.message);
    } finally {
      lockLocalTenantAccess('staff_actor_logged_out');
      get().lockDriveSession?.();
    }
    set({
      appStatus: 'staff_login_required',
      currentDeviceRole: 'staff',
      currentStaffUser: null,
      cashOpeningPolicy: 'manual',
      staffLoginLicenseKey: licenseKey || null,
      staffLoginMessage: STAFF_SESSION_CLOSED_MESSAGE,
      staffLoginError: cleanupError ? {
        code: 'STAFF_LOGOUT_CLEANUP_FAILED',
        message: 'No se pudo completar la limpieza local de la sesión Staff.'
      } : null,
      _isLoggingOut: false
    });
    if (cleanupError) {
      return {
        success: false,
        code: 'STAFF_LOGOUT_CLEANUP_FAILED',
        message: 'La autoridad Staff se cerró, pero no se pudo confirmar la limpieza local de credenciales. No recargues y vuelve a intentarlo.'
      };
    }
    return { success: true };
  }
});
};
