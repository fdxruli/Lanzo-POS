import {
  activateLicense,
  adminLoginOnDevice,
  adminLogoutSession,
  clearAdminSessionCache,
  enrollAdminOwnerOnDevice
} from '../../../services/supabase';
import { saveLicenseToStorage } from '../../../services/licenseStorage';

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

  await saveLicenseToStorage(licenseData);
  set({
    licenseDetails: licenseData,
    currentDeviceRole: 'admin',
    currentAdminUser: result.admin_user || null,
    currentStaffUser: null,
    adminLoginLicenseKey: licenseKey,
    adminLoginMessage: null,
    adminLoginError: null,
    adminEnrollmentRequired: false
  });
  await get()._loadProfile(licenseKey, { forceRemote: true, reason });
  return { success: true };
};

export const createLicenseAdminActions = ({ set, get }) => ({
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
    if (source.license_key) await saveLicenseToStorage({ ...source, device_role: 'admin', admin_user: null });
    set({
      appStatus: 'admin_login_required',
      licenseDetails: source.license_key ? { ...source, device_role: 'admin', admin_user: null } : get().licenseDetails,
      currentDeviceRole: 'admin',
      currentAdminUser: null,
      adminLoginLicenseKey: licenseKey || null,
      adminLoginMessage: validation.message || 'Inicia sesion como administrador para continuar.',
      adminLoginError: validation.code ? { code: validation.code, message: validation.message || null } : null,
      adminEnrollmentRequired: false
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
    return result;
  },

  handleAdminLogin: async ({ username, password }) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    const result = await adminLoginOnDevice({ licenseKey, username, password });
    if (!result.success) {
      set({ adminLoginError: { code: result.code, message: result.message } });
      return result;
    }
    return completeAdminSession(set, get, licenseKey, result, 'admin_login');
  },

  handleAdminEnrollment: async ({ username, password, displayName }) => {
    const licenseKey = get().adminLoginLicenseKey || get().licenseDetails?.license_key;
    const result = await enrollAdminOwnerOnDevice({ licenseKey, username, password, displayName });
    if (!result.success) {
      set({ adminLoginError: { code: result.code, message: result.message } });
      return result;
    }
    return completeAdminSession(set, get, licenseKey, result, 'admin_enrollment');
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
      adminLoginError: null
    });
  }
});
