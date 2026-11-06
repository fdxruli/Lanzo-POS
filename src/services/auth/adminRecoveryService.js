import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { actorRuntimeController } from './actorRuntimeController';
import { reportActorAuthorityError } from './actorAuthorityRecovery';

export const RECOVERY_MESSAGES = Object.freeze({
  RECOVERY_CODE_INVALID: 'Código incorrecto o no disponible. Revisa el código recibido de soporte.',
  RECOVERY_CODE_EXPIRED: 'El código caducó. Solicita uno nuevo a soporte.',
  RECOVERY_CODE_USED: 'Este código ya fue utilizado. Prueba iniciar sesión con tu nueva contraseña.',
  RECOVERY_ATTEMPTS_EXHAUSTED: 'Se agotaron los cinco intentos. Solicita otro código a soporte.',
  RECOVERY_RATE_LIMITED: 'Demasiados intentos. Espera 15 minutos antes de volver a solicitarlo.',
  RECOVERY_REAUTH_REQUIRED: 'La contraseña actual no es correcta. Vuelve a introducirla.',
  RECOVERY_REQUEST_SESSION_REQUIRED: 'Confirma el correo desde la sesión que solicitó la vinculación.',
  RECOVERY_CONTACT_ALREADY_VERIFIED: 'Ya existe un correo verificado. Consulta su estado; para cambiarlo contacta con soporte.',
  RECOVERY_EMAIL_INVALID: 'Introduce una dirección de correo válida.',
  RECOVERY_PASSWORD_WEAK: 'Usa al menos 8 caracteres, una letra y un número, con un máximo de 72 bytes.',
  RECOVERY_PASSWORD_UNCHANGED: 'Elige una contraseña diferente de la anterior.',
  ONLINE_REQUIRED: 'Necesitas conexión a internet para completar la recuperación.',
  RECOVERY_UNAVAILABLE: 'La recuperación aún no está disponible en el servidor. Contacta con soporte.',
  RECOVERY_UNCONFIRMED: 'No pudimos confirmar el resultado. Si cambiaste tu contraseña, prueba iniciar sesión con la nueva antes de solicitar otro código.',
  ADMIN_SESSION_INVALID: 'Tu sesión ya no es válida. Inicia sesión nuevamente.',
  ADMIN_SESSION_REQUIRED: 'Inicia sesión como propietario para continuar.',
  ADMIN_SESSION_EXPIRED: 'Tu sesión caducó. Inicia sesión nuevamente.',
  ADMIN_DEVICE_REQUIRED: 'Este dispositivo requiere una nueva validación. Inicia sesión nuevamente.',
  LICENSE_NOT_ACTIVE: 'La licencia no está habilitada para esta operación. Contacta con soporte.',
  LICENSE_EXPIRED: 'Revisa la vigencia de tu licencia con soporte.',
  ACTOR_CONTEXT_STALE: 'La sesión cambió. Vuelve a abrir esta pantalla.'
});

export const recoveryErrorMessage = (result) => RECOVERY_MESSAGES[result?.code] || RECOVERY_MESSAGES.RECOVERY_UNCONFIRMED;
export const validRecoveryPassword = (password) => password.length >= 8
  && /[a-z]/i.test(password) && /[0-9]/.test(password) && new TextEncoder().encode(password).length <= 72;

// No logging, persistence or diagnostic capture: these calls contain passwords
// and temporary codes. A lost response is never treated as confirmed success.
async function callRecoveryRpc(name, args) {
  if (globalThis.navigator?.onLine === false) return { success: false, code: 'ONLINE_REQUIRED' };
  if (!supabaseClient) return { success: false, code: 'RECOVERY_UNAVAILABLE' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const { data, error } = await supabaseClient.rpc(name, args).abortSignal(controller.signal);
    if (error) return { success: false, code: error.code === 'PGRST202' ? 'RECOVERY_UNAVAILABLE' : 'RECOVERY_UNCONFIRMED' };
    if (data?.success === true) return data;
    return { success: false, code: Object.hasOwn(RECOVERY_MESSAGES, data?.code) ? data.code : 'RECOVERY_UNCONFIRMED' };
  } catch {
    return { success: false, code: 'RECOVERY_UNCONFIRMED' };
  } finally {
    clearTimeout(timer);
  }
}

async function authenticatedCall(name, licenseKey, payload = {}) {
  if (globalThis.navigator?.onLine === false) return { success: false, code: 'ONLINE_REQUIRED' };
  const handle = actorRuntimeController.capture('license');
  if (handle.actorType !== 'admin') return { success: false, code: 'ADMIN_SESSION_REQUIRED' };
  const auth = await buildPosSyncAuthContext({ licenseKey, deviceRole: 'admin' });
  handle.assertCurrent('license');
  const result = await callRecoveryRpc(name, {
    p_license_key: licenseKey,
    p_device_fingerprint: auth.deviceFingerprint,
    p_device_security_token: auth.securityToken,
    p_admin_session_token: auth.staffSessionToken,
    ...payload
  });
  handle.assertCurrent('license');
  if (!result.success) reportActorAuthorityError(result, { operation: name });
  return result;
}

export const getRecoveryContact = (licenseKey) => authenticatedCall('admin_recovery_contact_status', licenseKey);
export const requestRecoveryContact = (licenseKey, email, password) => authenticatedCall('admin_request_recovery_contact', licenseKey, {
  p_email: email.trim(), p_current_password: password
});
export const confirmRecoveryContact = (licenseKey, code) => authenticatedCall('admin_confirm_recovery_contact', licenseKey, { p_code: code });
export const redeemPasswordRecovery = async (licenseKey, code, password) => {
  const result = await callRecoveryRpc('admin_redeem_password_recovery', {
    p_license_key: licenseKey, p_code: code, p_new_password: password
  });
  return result.success && typeof result.username !== 'string'
    ? { success: false, code: 'RECOVERY_UNCONFIRMED' } : result;
};
