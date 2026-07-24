import {
  activateLicense,
  adminLoginOnDevice,
  adminLogoutSession,
  clearAdminSessionCache,
  clearStaffSessionCache,
  enrollAdminOwnerOnDevice
} from '../../../services/supabase';
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

  // La autenticación remota ya fue exitosa. Persistimos primero la sesión y la
  // licencia fuera de IndexedDB para no perderlas si la base local necesita reparación.
  await saveLicenseToStorage(licenseData);
  set({
    licenseDetails: licenseData,
    currentDeviceRole: 'admin',
    currentAdminUser: result.admin_user || null,
    currentStaffUser: null,
    adminLoginLicenseKey: licenseKey,
    adminLoginMessage: null,
    adminLoginError: null,
    adminEnrollmentRequired: false,
    pendingAdminSessionResult: result
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
    set({ pendingAdminSessionResult: null });
    return { success: true, remoteAuthenticated: true };
  } catch (error) {
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
      adminLoginError: {
        code: 'ADMIN_LOCAL_BOOTSTRAP_FAILED',
        message: 'La sesión ya fue validada, pero no se pudo completar la carga local. Reintenta sin volver a registrar el dispositivo.'
      }
    });
    return {
      success: false,
      remoteAuthenticated: true,
      code: 'ADMIN_LOCAL_BOOTSTRAP_FAILED',
      message: 'La sesión ya fue validada. Reintenta para completar la carga local.'
    };
  }
};

export const createLicenseAdminActions = ({ set, get }) => ({
  pendingAdminSessionResult: null,

  chooseLicenseAccess: (accessType) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    if (accessType === 'staff') {
      set({
        appStatus: 'staff_login_required',
        currentDeviceRole: 'staff',
        currentAdminUser: null,
        currentStaffUser: null,
        staffLoginLicenseKey: licenseKey,
        staffLoginMessage: 'Ingresa con el usuario asignado por el administrador.',
        staffLoginError: null
      });
      return;
    }
    set({ appStatus: 'admin_login_required', currentDeviceRole: 'admin', adminLoginError: null });
  },

  _requireAdminLogin: async (licenseSource = null, validation = {}) => {
    const source = licenseSource || get().licenseDetails || {};
    const licenseKey = source.license_key || get().adminLoginLicenseKey;
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
    const result = await activateLicense(licenseKey);
    if (result.admin_enrollment_required) {
      set({
        appStatus: 'admin_enrollment_required',
        licenseDetails: { ...(result.details || {}), license_key: licenseKey, device_role: 'admin' },
        currentDeviceRole: 'admin',
        currentAdminUser: null,
        adminLoginLicenseKey: licenseKey,
        adminLoginMessage: result.message,
        adminEnrollmentRequired: true
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

      Logger.warn('[AdminAuth] Backend legacy detectado; continuando con sesión local hasta aplicar la migración.');
      await saveLicenseToStorage(legacyLicense);
      set({
        licenseDetails: legacyLicense,
        currentDeviceRole: 'admin',
        currentAdminUser: legacyLicense.admin_user || null,
        currentStaffUser: null,
        adminLoginMessage: null,
        adminLoginError: null
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
      const pendingResult = get().pendingAdminSessionResult;
      if (pendingResult?.success) {
        return completeAdminSession(set, get, licenseKey, pendingResult, 'admin_login_resume');
      }

      const result = await adminLoginOnDevice({ licenseKey, username, password });
      if (!result.success) {
        set({ adminLoginError: { code: result.code, message: result.message } });
        return result;
      }
      return completeAdminSession(set, get, licenseKey, result, 'admin_login');
    } catch (error) {
      const classification = classifyDatabaseError(error);
      if (classification.structural) {
        const recoveryError = createDatabaseRecoveryError({
          ...getDatabaseRecoveryState(),
          errorCode: classification.code
        }, error);
        return {
          success: false,
          remoteAuthenticated: Boolean(get().pendingAdminSessionResult),
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
      const result = await enrollAdminOwnerOnDevice({ licenseKey, username, password, displayName });
      if (!result.success) {
        set({ adminLoginError: { code: result.code, message: result.message } });
        return result;
      }
      return completeAdminSession(set, get, licenseKey, result, 'admin_enrollment');
    } catch (error) {
      return {
        success: false,
        code: error?.code || 'ADMIN_ENROLLMENT_FAILED',
        message: error?.message || 'No se pudo completar la inscripción.'
      };
    }
  },

  logoutAdmin: async () => {
    const licenseKey = get().licenseDetails?.license_key || get().adminLoginLicenseKey;
    await get().stopLicenseSync();
    await adminLogoutSession(licenseKey);
    set({
      appStatus: 'admin_login_required',
      currentAdminUser: null,
      adminLoginLicenseKey: licenseKey || null,
      adminLoginMessage: 'Sesion administrativa cerrada.',
      adminLoginError: null,
      pendingAdminSessionResult: null
    });
  }
});
