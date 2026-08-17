import { notifyPosCatalogSessionReset } from '../../../services/products/posCatalogSessionEvents';
import {
  activateLicense,
  adminLoginOnDevice,
  adminLogoutSession,
  clearAdminSessionCache,
  clearStaffSessionCache,
  enrollAdminOwnerOnDevice
} from '../../../services/supabase';
import {
  beginActorRuntimeAuthentication,
  grantAuthenticatedActorRuntime,
  lockActorRuntime
} from '../../../services/auth/actorSessionRuntimeBridge';
import { saveLicenseToStorage } from '../../../services/licenseStorage';
import { ensureLocalDatabaseReady } from '../../../services/db/databaseRuntime';
import {
  DATABASE_RECOVERY_STATUS,
  classifyDatabaseError,
  createDatabaseRecoveryError,
  getDatabaseRecoveryState,
  isStructuralDatabaseError,
  setDatabaseRecoveryState
} from '../../../services/db/databaseRecoveryState';
import Logger from '../../../services/Logger';
import {
  assertLocalTenantAccess,
  initializeLocalTenantGuard,
  isLocalTenantAccessError,
  lockLocalTenantAccess
} from '../../../services/tenant/localTenantGuard';
import { enterLocalTenantIsolationFailure } from './localTenantIsolationState';
import {
  clearPendingAdminSession,
  clearPendingAdminSessionIfLicenseChanged,
  createPendingAdminSession,
  validatePendingAdminSession
} from './pendingAdminSession';

const completeAdminSession = async (set, get, licenseKey, result, reason) => {
  const licenseData = {
    ...get().licenseDetails,
    ...result.details,
    license_key: result.details?.license_key || licenseKey,
    valid: true,
    device_role: 'admin',
    staff_user: null,
    admin_user: result.admin_user || null
  };

  await assertLocalTenantAccess(licenseData, { reason });
  await saveLicenseToStorage(licenseData);
  set({
    licenseDetails: licenseData,
    _isLoggingOut: false,
    currentDeviceRole: 'admin',
    currentAdminUser: result.admin_user || null,
    currentStaffUser: null,
    adminLoginLicenseKey: licenseKey,
    adminLoginMessage: null,
    adminLoginError: null,
    adminEnrollmentRequired: false,
    localTenantIsolation: null,
    pendingAdminSessionResult: createPendingAdminSession({ licenseKey, result })
  });

  try {
    try {
      await clearStaffSessionCache();
    } catch (cacheError) {
      if (!isStructuralDatabaseError(cacheError)) throw cacheError;
      Logger.warn('[AdminAuth] Limpieza staff diferida por recuperación local.');
    }

    await ensureLocalDatabaseReady();
    await get()._loadProfile(licenseKey, { forceRemote: true, reason });
    await grantAuthenticatedActorRuntime({
      actorType: 'admin',
      actor: result.admin_user || licenseData.admin_user
    });
    set({ pendingAdminSessionResult: null });
    return { success: true, remoteAuthenticated: true };
  } catch (error) {
    lockActorRuntime('admin_actor_binding_or_bootstrap_failed');
    const classification = classifyDatabaseError(error);

    if (classification.structural) {
      const currentDiagnostic = error?.diagnostic || getDatabaseRecoveryState();
      setDatabaseRecoveryState({
        ...currentDiagnostic,
        status: currentDiagnostic?.isRetryable === false
          ? DATABASE_RECOVERY_STATUS.FAILED
          : DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
        errorCode: currentDiagnostic?.errorCode || classification.code,
        databaseName: currentDiagnostic?.databaseName || 'LanzoDB1',
        isRetryable: classification.retryable !== false,
        requiresMigration: classification.requiresMigration === true || currentDiagnostic?.requiresMigration === true,
        message: currentDiagnostic?.message || 'La sesión administrativa es válida, pero la base local necesita recuperarse.'
      });
      set({
        appStatus: 'local_database_recovery_required',
        adminLoginError: {
          code: classification.code,
          message: 'La sesión se inició correctamente. Falta recuperar la base local antes de entrar.'
        }
      });
      return {
        success: false,
        remoteAuthenticated: true,
        localRecoveryRequired: true,
        code: classification.code,
        message: 'La sesión se inició correctamente. Lanzo conservará tus datos mientras repara la base local.'
      };
    }

    Logger.error('[AdminAuth] Sesión remota válida; falló el bootstrap local:', error);
    set({
      appStatus: 'admin_login_required',
      adminLoginError: {
        code: error?.code || 'ADMIN_LOCAL_BOOTSTRAP_FAILED',
        message: error?.code?.startsWith?.('ACTOR_')
          ? 'La sesión se validó, pero no pudo vincularse a la autoridad operativa. Vuelve a iniciar sesión.'
          : 'La sesión ya fue validada, pero no se pudo completar la carga local. Reintenta sin volver a registrar el dispositivo.'
      }
    });
    return {
      success: false,
      remoteAuthenticated: true,
      code: error?.code || 'ADMIN_LOCAL_BOOTSTRAP_FAILED',
      message: error?.code?.startsWith?.('ACTOR_')
        ? 'La sesión no obtuvo autoridad operativa.'
        : 'La sesión ya fue validada. Reintenta para completar la carga local.'
    };
  }
};

export const createLicenseAdminActions = ({ set, get }) => ({
  pendingAdminSessionResult: null,

  chooseLicenseAccess: (accessType) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    if (accessType === 'staff') {
      clearPendingAdminSession(set, 'choose_staff_access');
      set({
        appStatus: 'staff_login_required',
        currentDeviceRole: 'staff',
        currentAdminUser: null,
        currentStaffUser: null,
        staffLoginLicenseKey: licenseKey,
        staffLoginMessage: null,
        staffLoginError: null
      });
      return;
    }
    set({
      appStatus: 'admin_login_required',
      currentDeviceRole: 'admin',
      adminLoginMessage: null,
      adminLoginError: null
    });
  },

  returnToLicenseAccessChoice: async () => {
    const state = get();
    const licenseKey = state.adminLoginLicenseKey
      || state.staffLoginLicenseKey
      || state.licenseDetails?.license_key
      || null;
    const hasAuthenticatedAdminSession = Boolean(
      state.pendingAdminSessionResult?.result?.success
      || state.currentAdminUser
    );

    // An explicit actor logout already cleared the actor credential before the
    // tenant guard was locked. In that state the login modal is intentionally
    // allowed to switch profiles without touching tenant-owned SYNC_CACHE.
    // Persisted cleanup is only required when a remote Admin session is still
    // active/pending (for example after a local bootstrap failure).
    if (hasAuthenticatedAdminSession) {
      try {
        if (licenseKey) {
          try {
            await adminLogoutSession(licenseKey);
          } catch (logoutError) {
            Logger.warn('[AdminAuth] Falló el cierre remoto al cambiar de perfil; limpiando credencial local.', logoutError);
            await clearAdminSessionCache();
          }
        } else {
          await clearAdminSessionCache();
        }

        await clearStaffSessionCache();
      } catch (cleanupError) {
        Logger.error('[AdminAuth] No se pudo limpiar la sesión actor antes de cambiar de perfil:', cleanupError);
        return {
          success: false,
          code: 'ACTOR_SESSION_CLEANUP_FAILED',
          message: 'No se pudo limpiar la sesión actual. Reintenta antes de cambiar de perfil.'
        };
      }
    }

    lockActorRuntime('return_to_license_access_choice');
    clearPendingAdminSession(set, 'return_to_access_choice');
    set({
      appStatus: 'license_access_required',
      currentDeviceRole: null,
      currentAdminUser: null,
      currentStaffUser: null,
      adminLoginLicenseKey: licenseKey,
      staffLoginLicenseKey: licenseKey,
      adminLoginMessage: null,
      adminLoginError: null,
      staffLoginMessage: null,
      staffLoginError: null,
      adminEnrollmentRequired: false,
      _isLoggingOut: false
    });
    return { success: true };
  },

  _requireAdminLogin: async (licenseSource = null, validation = {}) => {
    const source = licenseSource || get().licenseDetails || {};
    const licenseKey = source.license_key || get().adminLoginLicenseKey;
    lockActorRuntime('admin_login_required');
    await get().stopLicenseSync();
    await clearAdminSessionCache();
    await clearStaffSessionCache();
    if (source.license_key) await saveLicenseToStorage({ ...source, device_role: 'admin', admin_user: null });
    set({
      appStatus: 'admin_login_required',
      licenseDetails: source.license_key ? { ...source, device_role: 'admin', admin_user: null } : get().licenseDetails,
      currentDeviceRole: 'admin',
      currentAdminUser: null,
      adminLoginLicenseKey: licenseKey || null,
      adminLoginMessage: validation.message || 'Inicia sesion como administrador para continuar.',
      adminLoginError: validation.code ? { code: validation.code, message: validation.message || null } : null,
      adminEnrollmentRequired: false,
      pendingAdminSessionResult: null
    });
  },

  discoverAdminAccess: async (licenseKey) => {
    initializeLocalTenantGuard('admin_access_discovery');
    await assertLocalTenantAccess({ license_key: licenseKey }, { reason: 'admin_access_discovery' });
    clearPendingAdminSessionIfLicenseChanged(set, get, licenseKey, 'discover_other_license');
    const result = await activateLicense(licenseKey, {
      beforeLocalPersistence: (details = {}) => assertLocalTenantAccess(
        { ...details, license_key: details.license_key || licenseKey },
        { reason: 'admin_access_activation' }
      )
    });
    if (result.admin_enrollment_required) {
      lockActorRuntime('admin_enrollment_required');
      set({
        appStatus: 'admin_enrollment_required',
        licenseDetails: { ...(result.details || {}), license_key: licenseKey, device_role: 'admin' },
        currentDeviceRole: 'admin',
        currentAdminUser: null,
        adminLoginLicenseKey: licenseKey,
        adminLoginMessage: result.message,
        adminEnrollmentRequired: true,
        pendingAdminSessionResult: null
      });
      return { success: false, enrollmentRequired: true };
    }
    if (result.access_choice_required) {
      await get()._requireAdminLogin({ ...(result.details || {}), license_key: licenseKey, device_role: 'admin' }, result);
      return { success: false, adminLoginRequired: true };
    }

    if (result.valid) {
      const legacyLicense = {
        ...get().licenseDetails,
        ...(result.details || {}),
        license_key: licenseKey,
        device_role: 'admin',
        staff_user: null
      };

      // Legacy device validation has no authenticated actor session proof.
      // Preserve compatibility, but never manufacture ActorRuntime authority.
      lockActorRuntime('legacy_admin_without_actor_session');
      Logger.warn('[AdminAuth] Backend legacy detectado; continuando con sesión local hasta aplicar la migración.');
      await saveLicenseToStorage(legacyLicense);
      set({
        licenseDetails: legacyLicense,
        _isLoggingOut: false,
        currentDeviceRole: 'admin',
        currentAdminUser: legacyLicense.admin_user || null,
        currentStaffUser: null,
        adminLoginMessage: null,
        adminLoginError: null,
        pendingAdminSessionResult: null
      });
      await get()._processOfflineMode(legacyLicense, { reason: 'legacy_admin_auth_compatibility' });
      return { success: true, legacyBackendFallback: true };
    }

    await get()._requireAdminLogin(
      { ...(result.details || {}), ...get().licenseDetails, license_key: licenseKey, device_role: 'admin' },
      result
    );
    return { success: false, adminLoginRequired: true };
  },

  handleAdminLogin: async ({ username, password }) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;

    try {
      initializeLocalTenantGuard('admin_login');
      await assertLocalTenantAccess({ license_key: licenseKey }, { reason: 'admin_login' });
      beginActorRuntimeAuthentication('admin');
      const pending = get().pendingAdminSessionResult;
      const pendingValidation = validatePendingAdminSession({
        pending,
        licenseKey,
        currentAdminUser: get().currentAdminUser
      });
      if (pendingValidation.valid) {
        return completeAdminSession(set, get, licenseKey, pending.result, 'admin_login_resume');
      }
      if (pending) clearPendingAdminSession(set, pendingValidation.reason || 'pending_session_invalid');

      const result = await adminLoginOnDevice({
        licenseKey,
        username,
        password,
        beforeLocalPersistence: (tenantSource) => assertLocalTenantAccess(
          tenantSource,
          { reason: 'admin_login_before_local_persistence' }
        )
      });
      if (!result.success) {
        lockActorRuntime('admin_credentials_rejected');
        clearPendingAdminSession(set, 'admin_credentials_rejected');
        set({ adminLoginError: { code: result.code, message: result.message } });
        return result;
      }
      return completeAdminSession(set, get, licenseKey, result, 'admin_login');
    } catch (error) {
      lockActorRuntime('admin_login_failed');
      if (isLocalTenantAccessError(error)) {
        enterLocalTenantIsolationFailure(set, error);
        return {
          success: false,
          localTenantMismatch: true,
          code: error.code,
          message: error.message
        };
      }

      const classification = classifyDatabaseError(error);
      if (classification.structural) {
        const recoveryError = createDatabaseRecoveryError({
          ...getDatabaseRecoveryState(),
          errorCode: classification.code
        }, error);
        return {
          success: false,
          remoteAuthenticated: validatePendingAdminSession({
            pending: get().pendingAdminSessionResult,
            licenseKey,
            currentAdminUser: get().currentAdminUser
          }).valid,
          localRecoveryRequired: true,
          code: classification.code,
          message: recoveryError.message
        };
      }
      Logger.error('[AdminAuth] Error durante login:', error);
      return {
        success: false,
        code: error?.code || 'ADMIN_LOGIN_FAILED',
        message: error?.message || 'No se pudo iniciar sesión.'
      };
    }
  },

  handleAdminEnrollment: async ({ username, password, displayName }) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    try {
      initializeLocalTenantGuard('admin_enrollment');
      await assertLocalTenantAccess({ license_key: licenseKey }, { reason: 'admin_enrollment' });
      beginActorRuntimeAuthentication('admin');
      const result = await enrollAdminOwnerOnDevice({
        licenseKey,
        username,
        password,
        displayName,
        beforeLocalPersistence: (tenantSource) => assertLocalTenantAccess(
          tenantSource,
          { reason: 'admin_enrollment_before_local_persistence' }
        )
      });
      if (!result.success) {
        lockActorRuntime('admin_enrollment_rejected');
        clearPendingAdminSession(set, 'admin_credentials_rejected');
        set({ adminLoginError: { code: result.code, message: result.message } });
        return result;
      }
      return completeAdminSession(set, get, licenseKey, result, 'admin_enrollment');
    } catch (error) {
      lockActorRuntime('admin_enrollment_failed');
      if (isLocalTenantAccessError(error)) {
        enterLocalTenantIsolationFailure(set, error);
        return {
          success: false,
          localTenantMismatch: true,
          code: error.code,
          message: error.message
        };
      }

      return {
        success: false,
        code: error?.code || 'ADMIN_ENROLLMENT_FAILED',
        message: error?.message || 'No se pudo completar la inscripción.'
      };
    }
  },

  logoutAdmin: async () => {
    const licenseKey = get().licenseDetails?.license_key || get().adminLoginLicenseKey;
    // Invalidate actor-sensitive async work before any remote/local logout I/O.
    // Tenant teardown keeps its existing behavior in this phase.
    lockActorRuntime('admin_actor_logged_out');
    get()._invalidateProfileLoads?.();
    get().resetEcommerceOrdersState?.();
    get().lockDriveSession?.();
    set({
      appStatus: 'admin_login_required',
      _isLoggingOut: true,
      currentAdminUser: null,
      cashOpeningPolicy: 'manual',
      adminLoginLicenseKey: licenseKey || null,
      adminLoginMessage: 'Cerrando sesion administrativa...',
      adminLoginError: null,
      pendingAdminSessionResult: null
    });
    notifyPosCatalogSessionReset();
    try {
      await get().stopLicenseSync();
      await adminLogoutSession(licenseKey);
    } finally {
      lockLocalTenantAccess('admin_actor_logged_out');
      get().lockDriveSession?.();
    }
    set({
      appStatus: 'admin_login_required',
      _isLoggingOut: true,
      currentAdminUser: null,
      cashOpeningPolicy: 'manual',
      adminLoginLicenseKey: licenseKey || null,
      adminLoginMessage: 'Sesion administrativa cerrada.',
      adminLoginError: null,
      pendingAdminSessionResult: null
    });
  }
});
