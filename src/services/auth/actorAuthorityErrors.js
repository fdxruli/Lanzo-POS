// Pure classification shared by RPC, license and POS boundaries. Only known
// codes/reasons influence recovery; raw server messages never reach the UI.
const SESSION_MESSAGE = 'Tu sesión cambió o necesita volver a validarse. Inicia sesión nuevamente para continuar.';
const DEVICE_CODES = ['DEVICE_TOKEN_INVALID', 'DEVICE_TOKEN_REQUIRED'];
const SESSION_CODES = [
  'ACTOR_SESSION_REQUIRED', 'ADMIN_LOGIN_REQUIRED', 'ADMIN_SESSION_REQUIRED',
  'ADMIN_SESSION_INVALID', 'ADMIN_SESSION_EXPIRED', 'ADMIN_SESSION_REVOKED',
  'STAFF_LOGIN_REQUIRED', 'STAFF_SESSION_REQUIRED', 'STAFF_SESSION_INVALID',
  'STAFF_SESSION_EXPIRED', 'STAFF_SESSION_REVOKED'
];
const BLOCKED_CODES = ['DEVICE_NOT_ALLOWED', 'DEVICE_NOT_ACTIVE', 'DEVICE_RELEASED', 'DEVICE_BANNED'];
const PERMISSION_CODES = ['ACTOR_PERMISSION_DENIED', 'POS_PERMISSION_DENIED', 'NO_PERMISSION'];
const ACTOR_CODES = [
  'ACTOR_CONTEXT_LOCKED', 'ACTOR_CONTEXT_STALE', 'ACTOR_IDENTITY_INVALID',
  'ACTOR_HANDOFF_REQUIRED', 'ACTOR_TENANT_NOT_READY', 'ACTOR_TENANT_MISMATCH', 'ACTOR_DEVICE_REQUIRED'
];
const KNOWN_CODES = new Set([
  ...DEVICE_CODES, ...SESSION_CODES, ...BLOCKED_CODES, ...PERMISSION_CODES,
  ...ACTOR_CODES, 'CLONING_DETECTED', 'CLOUD_REQUEST_RESPONSE_STALE'
]);

const getEvidence = (error) => {
  const codes = new Set();
  const reasons = [];
  const pending = [error];
  const visited = new Set();
  while (pending.length) {
    const value = pending.shift();
    if (!value || visited.has(value)) continue;
    visited.add(value);
    if (typeof value === 'string') {
      for (const word of value.toUpperCase().match(/[A-Z][A-Z0-9_]+/g) || []) {
        if (KNOWN_CODES.has(word)) codes.add(word);
      }
      continue;
    }
    if (typeof value !== 'object') continue;
    pending.push(value.code, value.message, value.reason, value.cause, value.originalError, value.error, value.response);
    if (typeof value.details === 'string') pending.push(value.details);
    if (typeof value.hint === 'string') pending.push(value.hint);
    if (typeof value.reason === 'string') reasons.push(value.reason);
    if (typeof value.details?.reason === 'string') reasons.push(value.details.reason);
  }
  return { codes, reasons };
};

export const classifyActorAuthorityError = (error, runtimeState = null) => {
  const { codes, reasons } = getEvidence(error);
  const actorType = runtimeState?.actorType === 'staff' || runtimeState?.actorType === 'admin'
    ? runtimeState.actorType : null;
  const reason = runtimeState?.reason || reasons[0] || null;
  const result = (kind, code, requiresReauthentication, recoveryReason, message = SESSION_MESSAGE) => Object.freeze({
    kind, code, requiresReauthentication, reason: recoveryReason, actorType, message
  });
  const find = (values) => values.find((code) => codes.has(code));

  // A discarded response is evidence of a generation change, not a new auth
  // failure. Even its wrapped cause must not relock a freshly authenticated actor.
  if (codes.has('CLOUD_REQUEST_RESPONSE_STALE')) {
    return result('response_stale', 'CLOUD_REQUEST_RESPONSE_STALE', false, 'cloud_response_discarded', 'La consulta cambió. Vuelve a intentarlo.');
  }
  const blocked = find(BLOCKED_CODES);
  if (blocked) return result('device_blocked', blocked, false, 'device_authorization_blocked', 'Este dispositivo ya no está autorizado. Pide al administrador revisar su acceso.');
  if (codes.has('CLONING_DETECTED')) {
    return result('cloning_detected', 'CLONING_DETECTED', false, 'device_integrity_rejected', 'No se pudo validar el acceso de este dispositivo. Revisa su autorización con el administrador.');
  }
  const permission = find(PERMISSION_CODES);
  if (permission) return result('permission_denied', permission, false, 'actor_permission_denied', 'No tienes permiso para realizar esta acción.');

  const device = find(DEVICE_CODES);
  if (device) return result('device_auth', device, true, 'device_auth_reauthentication_required');
  const session = find(SESSION_CODES);
  if (session) {
    const classification = result('session_required', session, true, 'actor_session_reauthentication_required');
    return Object.freeze({ ...classification, actorType: actorType || (session.startsWith('STAFF_') ? 'staff' : session.startsWith('ADMIN_') ? 'admin' : null) });
  }
  const actor = find(ACTOR_CODES);
  if (!actor) return null;
  if (reason === 'device_authorization_blocked') {
    return result('device_blocked', actor, false, reason, 'Este dispositivo ya no está autorizado. Pide al administrador revisar su acceso.');
  }
  if (reason === 'device_integrity_rejected') {
    return result('cloning_detected', actor, false, reason, 'No se pudo validar el acceso de este dispositivo. Revisa su autorización con el administrador.');
  }
  if (/(?:^|_)logout(?:_|$)|logged_out|voluntary_logout/.test(reason || '')) {
    return result('logout', actor, false, reason, 'Inicia sesión para continuar.');
  }
  if (reason === 'actor_context_changed_in_other_tab') {
    return result('foreign_tab', actor, true, reason, 'Tu sesión se actualizó en otra pestaña. Vuelve a validar tu acceso para continuar aquí.');
  }
  if (reason === 'device_auth_reauthentication_required') return result('device_auth', actor, true, reason);
  if (/handoff|bootstrap|tenant|binding/.test(reason || '') || ['ACTOR_HANDOFF_REQUIRED', 'ACTOR_TENANT_NOT_READY', 'ACTOR_TENANT_MISMATCH'].includes(actor)) {
    return result('bootstrap_failed', actor, true, 'actor_handoff_reauthentication_required');
  }
  return result(actor === 'ACTOR_CONTEXT_STALE' ? 'stale_actor' : 'session_required', actor, true, 'actor_session_reauthentication_required');
};
