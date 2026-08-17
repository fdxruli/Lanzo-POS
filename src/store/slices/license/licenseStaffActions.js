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
  lockActorRuntime
} from '../../../services/auth/actorSessionRuntimeBridge';

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

export const hasStaffValidationContext = async (state = {}, licenseDetails = {}) => (
  // The persisted role is authoritative.  A leftover staff token must never
  // re-route an admin device into the staff flow during a background check.
  // Only when the role is genuinely unknown do we use a stored token as a
  // discovery hint.
  (() => {
    const canonicalRole =
      licenseDetails?.device_role ||
      state.licenseDetails?.device_role ||
      state.currentDeviceRole ||
      null;

    if (canonicalRole === 'admin') return false;
    if (canonicalRole === 'staff') return true;
    return null;
  })() ?? (
    state.appStatus === 'staff_login_required' ||
    hasStaffSessionToken()
  )
);

export const createLicenseStaffActions = ({
  set,
  get
}) => ({
  _requireStaffLogin: async (licenseSource = null, validation = {}) => {
    const state = get();
    const sourceLicense = licenseSource || state.licenseDetails || {};
    const licenseKey = sourceLicense.license_key || state.staffLoginLicenseKey || null;

    const nextLicenseDetails = sourceLicense.license_key
      ? {
        ...sourceLicense,
        device_role: 'staff',
        staff_user: null
      }
      : state.licenseDetails;

    lockActorRuntime('staff_login_required');

    // Si un staff queda bloqueado/liberado/no autorizado, apagamos cualquier
    // sincronización activa para evitar revalidaciones de fondo o un canal
    // Realtime vivo mientras el usuario está en StaffLoginModal.
    await get().stopLicenseSync();

    await clearStaffSessionCache();
    await clearAdminSessionCache();

    if (nextLicenseDetails?.license_key) {
      await saveLicenseToStorage(nextLicenseDetails);
    }

    set({
      appStatus: 'staff_login_required',
      ...(nextLicenseDetails ? { licenseDetails: nextLicenseDetails } : {}),
      currentDeviceRole: 'staff',
      currentStaffUser: null,
      staffLoginLicenseKey: licenseKey,
      staffLoginMessage: getStaffLoginMessage(validation),
      staffLoginError: null
    });
  },

  handleStaffLogin: async ({ username, password }) => {
    const state = get();
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
  logoutStaff: async () => {
    const licenseKey = get().licenseDetails?.license_key || get().staffLoginLicenseKey;
    // Invalidate actor-sensitive async work before any remote/local logout I/O.
    // Tenant teardown keeps its existing behavior in this phase.
    lockActorRuntime('staff_actor_logged_out');
    get()._invalidateProfileLoads?.();
    get().resetEcommerceOrdersState?.();
    get().lockDriveSession?.();
    set({
      appStatus: 'staff_login_required',
      _isLoggingOut: true,
      currentDeviceRole: 'staff',
      currentStaffUser: null,
      cashOpeningPolicy: 'manual',
      staffLoginLicenseKey: licenseKey || null,
      staffLoginMessage: 'Cerrando sesion staff...',
      staffLoginError: null
    });
    notifyPosCatalogSessionReset();
    try {
      await get().stopLicenseSync();
      await staffLogoutSession(licenseKey);
    } finally {
      lockLocalTenantAccess('staff_actor_logged_out');
      get().lockDriveSession?.();
    }
    set({
      appStatus: 'staff_login_required',
      _isLoggingOut: true,
      currentDeviceRole: 'staff',
      currentStaffUser: null,
      cashOpeningPolicy: 'manual',
      staffLoginLicenseKey: licenseKey || null,
      staffLoginMessage: 'Sesion staff cerrada.',
      staffLoginError: null
    });
  }
});
