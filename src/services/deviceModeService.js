import {
  getAdminSessionToken,
  getDeviceSecurityToken,
  supabaseClient
} from './supabase';
import { checkInternetConnection, getStableDeviceId } from './utils';
import {
  assertLocalTenantSyncAccess,
  runWithLocalTenantSyncLease
} from './tenant/localTenantGuard';
import { resolveDeviceMode } from './deviceModePolicy';

export const setDeviceModeSmart = async (deviceId, deviceMode, licenseKey) => {
  const tenantSource = { license_key: licenseKey };
  const normalizedMode = resolveDeviceMode({ device_mode: deviceMode });

  if (!deviceId || !licenseKey || !normalizedMode) {
    return {
      success: false,
      code: 'DEVICE_MODE_INVALID_REQUEST',
      message: 'No se pudo validar el cambio de modo del dispositivo.'
    };
  }

  await assertLocalTenantSyncAccess(tenantSource, {
    reason: 'device_mode_change_start'
  });

  return runWithLocalTenantSyncLease(
    tenantSource,
    { reason: 'device_mode_change_operation' },
    async () => {
      if (!(await checkInternetConnection())) {
        return {
          success: false,
          code: 'ONLINE_REQUIRED',
          message: 'Necesitas conexion a internet para cambiar el modo del dispositivo.'
        };
      }

      const [requesterFingerprint, deviceSecurityToken, adminSessionToken] = await Promise.all([
        getStableDeviceId(),
        getDeviceSecurityToken(),
        getAdminSessionToken()
      ]);

      if (!requesterFingerprint || !deviceSecurityToken || !adminSessionToken) {
        return {
          success: false,
          code: 'ADMIN_SESSION_REQUIRED',
          message: 'Se requiere una sesion Admin valida para cambiar el modo del dispositivo.'
        };
      }

      const { data, error } = await supabaseClient.rpc('admin_set_device_mode', {
        p_license_key: licenseKey,
        p_requester_fingerprint: requesterFingerprint,
        p_device_security_token: deviceSecurityToken,
        p_admin_session_token: adminSessionToken,
        p_target_device_id: deviceId,
        p_device_mode: normalizedMode
      });

      if (error) throw error;
      return data || {
        success: false,
        code: 'DEVICE_MODE_CHANGE_FAILED',
        message: 'El servidor no devolvio un resultado valido.'
      };
    }
  );
};
