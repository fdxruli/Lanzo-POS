import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';

const BRIDGE_MESSAGES = Object.freeze({
  POST_DOWNGRADE_CASH_ALREADY_CLOSED: 'Esta caja ya fue cerrada.',
  POST_DOWNGRADE_CASH_NOT_ELIGIBLE: 'Esta caja no pertenece a las operaciones pendientes del plan anterior.',
  POST_DOWNGRADE_CASH_OWNER_REQUIRED: 'Sólo el propietario puede reconciliar cajas pendientes después del cambio de plan.',
  IDEMPOTENCY_CONFLICT: 'Esta confirmación ya se usó con datos distintos. Revisa la caja antes de intentar de nuevo.',
  ADMIN_CLOSE_COUNTED_AMOUNT_REQUIRED: 'Ingresa el efectivo contado para completar este cierre.',
  ADMIN_CLOSE_COMMENT_REQUIRED: 'Agrega un comentario para documentar este cierre.',
  ADMIN_CLOSE_UNVERIFIED_COUNTED_FORBIDDEN: 'El cierre sin conteo físico no puede incluir un monto contado.',
  ADMIN_CLOSE_UNVERIFIED_NEXT_FUND_FORBIDDEN: 'El cierre sin conteo físico no puede dejar fondo para el siguiente turno.',
  NEXT_SHIFT_FUND_INVALID: 'El fondo para el siguiente turno no es válido.',
  NEXT_SHIFT_FUND_EXCEEDS_COUNTED: 'El fondo para el siguiente turno no puede ser mayor al efectivo contado.',
  VERSION_CONFLICT: 'La caja cambió desde que la revisaste. Actualizamos los datos; vuelve a confirmar el cierre.',
  CASH_TOTALS_CHANGED: 'El efectivo esperado cambió mientras revisabas la caja. Actualizamos los datos; revísalos antes de confirmar nuevamente.'
});

const RESPONSE_CODES_SAFE_FOR_MODAL = new Set(['VERSION_CONFLICT', 'CASH_TOTALS_CHANGED']);

const parseRpcPayload = (value) => {
  if (typeof value === 'string') return JSON.parse(value);
  return value || {};
};

const extractBridgeCode = (error) => {
  const text = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ');
  return Object.keys(BRIDGE_MESSAGES).find((code) => text.includes(code))
    || (BRIDGE_MESSAGES[error?.code] ? error.code : null);
};

const bridgeError = (error, fallback) => {
  const bridgeCode = extractBridgeCode(error);
  const normalized = new Error(BRIDGE_MESSAGES[bridgeCode] || fallback);
  normalized.bridgeCode = bridgeCode || 'POST_DOWNGRADE_CASH_RECONCILIATION_FAILED';
  normalized.cause = error;
  return normalized;
};

const assertSupabase = () => {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');
};

const buildBridgeArgs = async (licenseKey) => {
  if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
  const context = await buildPosSyncAuthContext({ licenseKey });
  if (!context?.licenseKey || !context?.deviceFingerprint || !context?.securityToken) {
    throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  }
  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    p_security_token: context.securityToken,
    p_actor_session_token: context.staffSessionToken || null
  };
};

const invoke = async (rpcName, args, fallbackMessage) => {
  assertSupabase();
  try {
    const { data, error } = await supabaseClient.rpc(rpcName, args);
    if (error) throw error;
    return parseRpcPayload(data);
  } catch (error) {
    throw bridgeError(error, fallbackMessage);
  }
};

const normalizeFailure = (payload, fallbackMessage) => {
  const internalCode = payload?.code || 'POST_DOWNGRADE_CASH_RECONCILIATION_FAILED';
  const message = BRIDGE_MESSAGES[internalCode] || payload?.message || fallbackMessage;
  return {
    ...payload,
    success: false,
    code: RESPONSE_CODES_SAFE_FOR_MODAL.has(internalCode) ? internalCode : null,
    internalCode,
    message
  };
};

export const postDowngradeCashReconciliation = {
  async list({ licenseKey }) {
    const base = await buildBridgeArgs(licenseKey);
    const payload = await invoke(
      'pos_list_post_downgrade_cash_sessions',
      base,
      'No se pudieron consultar las cajas pendientes del plan anterior.'
    );
    if (payload?.success === false) return normalizeFailure(payload, 'No se pudieron consultar las cajas pendientes del plan anterior.');
    return {
      success: true,
      cashSessions: Array.isArray(payload.cash_sessions) ? payload.cash_sessions : [],
      pendingCount: Number(payload.pending_count || 0),
      downgradedAt: payload.downgraded_at || null,
      previousPlanCode: payload.previous_plan_code || null,
      currentPlanCode: payload.current_plan_code || null
    };
  },

  async detail({ licenseKey, cashSessionId }) {
    const base = await buildBridgeArgs(licenseKey);
    const payload = await invoke(
      'pos_get_post_downgrade_cash_session_detail',
      { ...base, p_cash_session_id: cashSessionId },
      'No se pudo cargar el detalle de esta caja.'
    );
    if (payload?.success === false) return normalizeFailure(payload, 'No se pudo cargar el detalle de esta caja.');
    return {
      success: true,
      cashSession: payload.cash_session || null,
      movements: Array.isArray(payload.movements) ? payload.movements : [],
      auditEvents: Array.isArray(payload.audit_events) ? payload.audit_events : []
    };
  },

  async close({
    licenseKey,
    cashSessionId,
    closingMode,
    countedAmount,
    nextShiftFund,
    reasonCode,
    comments,
    expectedVersion,
    idempotencyKey
  }) {
    const base = await buildBridgeArgs(licenseKey);
    const payload = await invoke(
      'pos_close_post_downgrade_cash_session',
      {
        ...base,
        p_cash_session_id: cashSessionId,
        p_closing_mode: closingMode,
        p_counted_amount: countedAmount ?? null,
        p_next_shift_fund: nextShiftFund ?? null,
        p_reason_code: reasonCode,
        p_comments: comments || null,
        p_expected_version: expectedVersion ?? null,
        p_idempotency_key: idempotencyKey
      },
      'No se pudo completar la conciliación de esta caja.'
    );
    if (payload?.success === false) return normalizeFailure(payload, 'No se pudo completar la conciliación de esta caja.');
    return {
      success: true,
      response: payload,
      cashSession: payload.cash_session || null,
      idempotencyKey: payload.idempotency_key || idempotencyKey
    };
  }
};

export default postDowngradeCashReconciliation;
