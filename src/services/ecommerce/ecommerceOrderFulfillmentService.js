import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';

const SAFE_MESSAGES = Object.freeze({
  ECOMMERCE_ORDERS_ACCESS_DENIED: 'No tienes permiso para administrar pedidos online.',
  ECOMMERCE_STAFF_SESSION_REQUIRED: 'Inicia sesión como personal para administrar pedidos online.',
  ECOMMERCE_STAFF_SESSION_INVALID: 'Tu sesión de personal venció. Inicia sesión nuevamente.',
  ECOMMERCE_STAFF_PERMISSION_DENIED: 'Tu usuario no tiene permiso para administrar pedidos online.',
  ECOMMERCE_ORDERS_RATE_LIMITED: 'Hay demasiadas solicitudes. Espera un momento e intenta de nuevo.',
  ECOMMERCE_ORDER_NOT_FOUND: 'El pedido no existe o no está disponible.',
  ECOMMERCE_ORDER_STATUS_STALE: 'El pedido cambió en otro dispositivo. Actualiza el detalle e intenta nuevamente.',
  ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION: 'Esta acción ya no corresponde al estado actual del pedido.',
  ECOMMERCE_ORDER_STATUS_IDEMPOTENCY_REQUIRED: 'No se pudo preparar una transición segura.',
  ECOMMERCE_ORDER_PUBLIC_MESSAGE_INVALID: 'El mensaje público debe ser texto plano de hasta 280 caracteres.',
  ECOMMERCE_ORDER_FULFILLMENT_TERMINAL: 'Este pedido ya fue completado o cancelado. No admite nuevas acciones operativas ni de Punto de Venta.',
  ECOMMERCE_ORDER_POS_DRAFT_PREPARED: 'Existe un borrador preparado en Punto de Venta. Resuélvelo antes de completar o cancelar el pedido.',
  ECOMMERCE_ORDER_POS_CONVERSION_IN_PROGRESS: 'Existe un cobro reservado o en progreso. Verifica la venta antes de completar o cancelar el pedido.',
  ECOMMERCE_POS_DRAFT_IN_PROGRESS: 'El pedido está siendo preparado en otro dispositivo.',
  ECOMMERCE_ORDER_ACTION_FAILED: 'No se pudo actualizar el estado operativo del pedido.'
});

const asText = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback);
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getLicenseKey = (licenseDetails = {}) => (
  licenseDetails.license_key
  || licenseDetails.licenseKey
  || licenseDetails.details?.license_key
  || licenseDetails.details?.licenseKey
  || null
);

const buildAuthArgs = async (licenseDetails = {}) => {
  const licenseKey = getLicenseKey(licenseDetails);
  if (!licenseKey) return null;
  const auth = await buildPosSyncAuthContext({ licenseKey });
  if (!auth.deviceFingerprint || !auth.securityToken) return null;
  return {
    p_license_key: auth.licenseKey,
    p_device_fingerprint: auth.deviceFingerprint,
    p_security_token: auth.securityToken,
    p_staff_session_token: auth.staffSessionToken || null
  };
};

const normalizeFulfillment = (value = {}) => ({
  status: asText(value.status, 'received'),
  internalStatus: asText(value.internalStatus) || null,
  version: Math.max(0, Math.floor(asNumber(value.version, 0))),
  updatedAt: value.updatedAt || null,
  publicMessage: asText(value.publicMessage),
  paymentRegistered: Boolean(value.paymentRegistered)
});

const normalizeResult = (payload = {}) => {
  if (payload?.success !== true) {
    const code = asText(payload?.code, 'ECOMMERCE_ORDER_ACTION_FAILED');
    return {
      success: false,
      code,
      message: SAFE_MESSAGES[code] || SAFE_MESSAGES.ECOMMERCE_ORDER_ACTION_FAILED,
      details: payload?.details && typeof payload.details === 'object' ? payload.details : null
    };
  }
  return {
    success: true,
    changed: Boolean(payload.changed),
    idempotent: Boolean(payload.idempotent),
    order: {
      id: asText(payload.order?.id),
      code: asText(payload.order?.code),
      status: asText(payload.order?.status),
      fulfillment: normalizeFulfillment(payload.order?.fulfillment)
    }
  };
};

export async function getEcommerceOrderFulfillment({
  licenseDetails,
  orderId,
  client = supabaseClient
} = {}) {
  if (!orderId || !client) {
    return normalizeResult({ success: false, code: 'ECOMMERCE_ORDER_NOT_FOUND' });
  }
  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    if (!authArgs) return normalizeResult({ success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' });
    const { data, error } = await client.rpc('ecommerce_admin_get_order', {
      ...authArgs,
      p_order_id: orderId
    });
    if (error || data?.success !== true) {
      return normalizeResult(data?.success === false ? data : { success: false, code: 'ECOMMERCE_ORDER_ACTION_FAILED' });
    }
    return {
      success: true,
      order: {
        id: asText(data.order?.id),
        code: asText(data.order?.code),
        status: asText(data.order?.status),
        fulfillmentMethod: data.order?.fulfillmentMethod === 'delivery' ? 'delivery' : 'pickup',
        fulfillment: normalizeFulfillment(data.order?.fulfillment)
      }
    };
  } catch {
    return normalizeResult({ success: false, code: 'ECOMMERCE_ORDER_ACTION_FAILED' });
  }
}

export async function updateEcommerceOrderFulfillment({
  licenseDetails,
  orderId,
  transition,
  expectedVersion,
  idempotencyKey,
  publicMessage = null,
  client = supabaseClient
} = {}) {
  if (!orderId || !transition || !idempotencyKey) {
    return normalizeResult({ success: false, code: 'ECOMMERCE_ORDER_ACTION_FAILED' });
  }
  if (!client) {
    return normalizeResult({ success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' });
  }

  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    if (!authArgs) return normalizeResult({ success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' });
    const { data, error } = await client.rpc('ecommerce_admin_update_order_fulfillment', {
      ...authArgs,
      p_order_id: orderId,
      p_transition: transition,
      p_expected_version: Math.max(0, Math.floor(asNumber(expectedVersion, 0))),
      p_idempotency_key: asText(idempotencyKey).slice(0, 160),
      p_public_message: asText(publicMessage).slice(0, 280) || null
    });
    if (error) return normalizeResult({ success: false, code: 'ECOMMERCE_ORDER_ACTION_FAILED' });
    return normalizeResult(data);
  } catch {
    return normalizeResult({ success: false, code: 'ECOMMERCE_ORDER_ACTION_FAILED' });
  }
}

export const FULFILLMENT_LABELS = Object.freeze({
  accepted: 'Pedido aceptado',
  preparing: 'En preparación',
  ready: 'Listo',
  out_for_delivery: 'En camino',
  completed: 'Completado',
  cancelled: 'Cancelado',
  attention: 'Requiere atención'
});

export function getEcommerceFulfillmentActions(order = {}) {
  if (!['accepted', 'converted_to_sale'].includes(order.status)) return [];
  const state = order.fulfillment?.internalStatus || order.fulfillment?.status;
  const method = order.fulfillmentMethod === 'delivery' ? 'delivery' : 'pickup';
  const cancel = { transition: 'cancelled', label: 'Cancelar pedido', destructive: true };

  if (state === 'accepted') {
    return [{ transition: 'preparing', label: 'Iniciar preparación' }, cancel];
  }
  if (state === 'preparing') {
    return [{ transition: 'ready', label: 'Marcar como listo' }, cancel];
  }
  if (state === 'ready' && method === 'delivery') {
    return [{ transition: 'out_for_delivery', label: 'Marcar en camino' }, cancel];
  }
  if (state === 'ready' && method === 'pickup') {
    return [{ transition: 'completed', label: 'Completar pedido' }, cancel];
  }
  if (state === 'out_for_delivery' && method === 'delivery') {
    return [{ transition: 'completed', label: 'Completar pedido' }, cancel];
  }
  return [];
}

export const ecommerceOrderFulfillmentInternals = Object.freeze({
  SAFE_MESSAGES,
  normalizeFulfillment,
  normalizeResult,
  getLicenseKey,
  buildAuthArgs
});
