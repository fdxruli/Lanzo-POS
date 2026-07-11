import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import Logger from '../Logger';

const SAFE_MESSAGES = Object.freeze({
  ECOMMERCE_ORDERS_ACCESS_DENIED: 'No tienes permiso para administrar pedidos online.',
  ECOMMERCE_ORDERS_RPC_ACCESS_DENIED: 'No se pudo autorizar el acceso a los pedidos online. Actualiza la aplicación e intenta nuevamente.',
  ECOMMERCE_ORDER_INBOX_DISABLED: 'La bandeja de pedidos online no está disponible para esta licencia.',
  ECOMMERCE_STAFF_SESSION_REQUIRED: 'Inicia sesión como personal para administrar pedidos online.',
  ECOMMERCE_STAFF_SESSION_INVALID: 'Tu sesión de personal venció. Inicia sesión nuevamente.',
  ECOMMERCE_STAFF_PERMISSION_DENIED: 'Tu usuario no tiene permiso para administrar pedidos online.',
  ECOMMERCE_ORDERS_RATE_LIMITED: 'Hay demasiadas solicitudes. Espera un momento e intenta de nuevo.',
  ECOMMERCE_ORDER_NOT_FOUND: 'El pedido no existe o no está disponible.',
  ECOMMERCE_ORDER_INVALID_TRANSITION: 'El pedido ya no permite esta acción.',
  ECOMMERCE_REJECTION_REASON_REQUIRED: 'Escribe un motivo de rechazo de al menos 3 caracteres.',
  ECOMMERCE_REJECTION_REASON_TOO_LONG: 'El motivo de rechazo no puede superar 300 caracteres.',
  ECOMMERCE_ORDER_ACTION_FAILED: 'No se pudo completar la acción sobre el pedido.',
  INVALID_RPC_RESPONSE: 'El servidor devolvió una respuesta inválida.',
  SUPABASE_NOT_CONFIGURED: 'No se pudo conectar con el servicio de pedidos.',
  LICENSE_KEY_REQUIRED: 'No hay una licencia activa para cargar pedidos.',
  ECOMMERCE_ORDERS_AUTH_CONTEXT_INCOMPLETE: 'No se pudo confirmar este dispositivo. Vuelve a validar la licencia.'
});

const parsePayload = (data) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return { success: false, code: 'INVALID_RPC_RESPONSE' };
    }
  }
  return data && typeof data === 'object' ? data : { success: false, code: 'INVALID_RPC_RESPONSE' };
};

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeText = (value, fallback = '') => (
  typeof value === 'string' ? value : fallback
);

const normalizeCode = (payload = {}) => safeText(payload.code, payload.success === false ? 'ECOMMERCE_ORDER_ACTION_FAILED' : '');

const normalizeFailure = (payload = {}) => {
  const code = normalizeCode(payload);
  return {
    success: false,
    code,
    message: SAFE_MESSAGES[code] || SAFE_MESSAGES.ECOMMERCE_ORDER_ACTION_FAILED
  };
};

const normalizeOrderSummary = (order = {}) => ({
  id: safeText(order.id),
  code: safeText(order.code),
  status: safeText(order.status, 'new'),
  customerName: safeText(order.customerName),
  fulfillmentMethod: safeText(order.fulfillmentMethod, 'pickup'),
  itemCount: safeNumber(order.itemCount),
  total: safeNumber(order.total),
  currency: safeText(order.currency, 'MXN'),
  createdAt: order.createdAt || null,
  seenAt: order.seenAt || null,
  acceptedAt: order.acceptedAt || null,
  rejectedAt: order.rejectedAt || null
});

const normalizeCounts = (counts = {}) => ({
  new: safeNumber(counts.new),
  seen: safeNumber(counts.seen),
  pending: safeNumber(counts.pending),
  accepted: safeNumber(counts.accepted),
  rejected: safeNumber(counts.rejected),
  total: safeNumber(counts.total)
});

const normalizePagination = (pagination = {}) => ({
  limit: Math.min(Math.max(safeNumber(pagination.limit, 50), 1), 100),
  offset: Math.max(safeNumber(pagination.offset), 0),
  hasMore: Boolean(pagination.hasMore)
});

const normalizeItem = (item = {}) => ({
  id: safeText(item.id),
  productName: safeText(item.productName, 'Producto'),
  unitPrice: safeNumber(item.unitPrice),
  quantity: safeNumber(item.quantity),
  lineTotal: safeNumber(item.lineTotal),
  options: item.options && typeof item.options === 'object' && !Array.isArray(item.options)
    ? item.options
    : {}
});

const normalizeEvent = (event = {}) => ({
  eventType: safeText(event.eventType),
  actorType: safeText(event.actorType, 'system'),
  actorLabel: safeText(event.actorLabel, 'Sistema'),
  message: safeText(event.message),
  payload: event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload
    : {},
  createdAt: event.createdAt || null
});

const normalizeDetail = (order = {}) => ({
  id: safeText(order.id),
  code: safeText(order.code),
  status: safeText(order.status, 'new'),
  channel: safeText(order.channel, 'public_store'),
  fulfillmentMethod: safeText(order.fulfillmentMethod, 'pickup'),
  customer: {
    name: safeText(order.customer?.name),
    phone: safeText(order.customer?.phone),
    address: order.customer?.address || null,
    notes: order.customer?.notes || null
  },
  totals: {
    subtotal: safeNumber(order.totals?.subtotal),
    deliveryFee: safeNumber(order.totals?.deliveryFee),
    discountTotal: safeNumber(order.totals?.discountTotal),
    taxTotal: safeNumber(order.totals?.taxTotal),
    total: safeNumber(order.totals?.total),
    currency: safeText(order.totals?.currency, 'MXN')
  },
  payment: {
    method: safeText(order.payment?.method, 'on_delivery'),
    status: safeText(order.payment?.status, 'pending')
  },
  timestamps: {
    createdAt: order.timestamps?.createdAt || null,
    updatedAt: order.timestamps?.updatedAt || null,
    seenAt: order.timestamps?.seenAt || null,
    acceptedAt: order.timestamps?.acceptedAt || null,
    rejectedAt: order.timestamps?.rejectedAt || null
  },
  items: Array.isArray(order.items) ? order.items.map(normalizeItem) : [],
  events: Array.isArray(order.events) ? order.events.map(normalizeEvent) : [],
  contact: {
    whatsappUrl: typeof order.contact?.whatsappUrl === 'string' && order.contact.whatsappUrl.startsWith('https://wa.me/')
      ? order.contact.whatsappUrl
      : null
  }
});

const getLicenseKey = (licenseDetails = {}) => (
  licenseDetails.license_key ||
  licenseDetails.licenseKey ||
  licenseDetails.details?.license_key ||
  licenseDetails.details?.licenseKey ||
  null
);

const buildAuthArgs = async (licenseDetails = {}) => {
  const licenseKey = getLicenseKey(licenseDetails);
  if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');

  const authContext = await buildPosSyncAuthContext({ licenseKey });
  if (!authContext.deviceFingerprint || !authContext.securityToken) {
    throw new Error('ECOMMERCE_ORDERS_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: authContext.licenseKey,
    p_device_fingerprint: authContext.deviceFingerprint,
    p_security_token: authContext.securityToken,
    p_staff_session_token: authContext.staffSessionToken || null
  };
};

const logRpcFailure = (rpcName, error = {}) => {
  Logger.error('[ecommerceOrderService] RPC failed', {
    rpcName,
    code: error.code || null,
    message: error.message || null,
    details: error.details || null
  });
};

const callRpc = async (name, args) => {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');

  const { data, error } = await supabaseClient.rpc(name, args);
  if (error) {
    logRpcFailure(name, error);
    const code = String(error.code || '') === '42501'
      ? 'ECOMMERCE_ORDERS_RPC_ACCESS_DENIED'
      : 'ECOMMERCE_ORDER_ACTION_FAILED';
    const safeError = new Error(code);
    safeError.code = code;
    throw safeError;
  }

  const payload = parsePayload(data);
  if (payload.success === false) return normalizeFailure(payload);
  return payload;
};

export const getEcommerceOrderErrorMessage = (error) => {
  const code = error?.code || error?.message || 'ECOMMERCE_ORDER_ACTION_FAILED';
  return SAFE_MESSAGES[code] || SAFE_MESSAGES.ECOMMERCE_ORDER_ACTION_FAILED;
};

export async function listEcommerceOrders({
  licenseDetails,
  status = 'all',
  limit = 50,
  offset = 0
} = {}) {
  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    const payload = await callRpc('ecommerce_admin_list_orders', {
      ...authArgs,
      p_status: safeText(status, 'all'),
      p_limit: Math.min(Math.max(safeNumber(limit, 50), 1), 100),
      p_offset: Math.max(safeNumber(offset), 0)
    });

    if (payload.success === false) return payload;
    return {
      success: true,
      orders: Array.isArray(payload.orders)
        ? payload.orders.map(normalizeOrderSummary).filter((order) => order.id)
        : [],
      counts: normalizeCounts(payload.counts),
      pagination: normalizePagination(payload.pagination),
      filter: safeText(payload.filter, status)
    };
  } catch (error) {
    const code = error?.code || error?.message || 'ECOMMERCE_ORDER_ACTION_FAILED';
    return { success: false, code, message: getEcommerceOrderErrorMessage(error) };
  }
}

export async function getEcommerceOrder({ licenseDetails, orderId } = {}) {
  if (!orderId) return normalizeFailure({ code: 'ECOMMERCE_ORDER_NOT_FOUND' });
  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    const payload = await callRpc('ecommerce_admin_get_order', {
      ...authArgs,
      p_order_id: orderId
    });
    if (payload.success === false) return payload;
    return { success: true, order: normalizeDetail(payload.order) };
  } catch (error) {
    const code = error?.code || error?.message || 'ECOMMERCE_ORDER_ACTION_FAILED';
    return { success: false, code, message: getEcommerceOrderErrorMessage(error) };
  }
}

const mutateOrder = async (rpcName, { licenseDetails, orderId, reason } = {}) => {
  if (!orderId) return normalizeFailure({ code: 'ECOMMERCE_ORDER_NOT_FOUND' });
  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    const payload = await callRpc(rpcName, {
      ...authArgs,
      p_order_id: orderId,
      ...(rpcName === 'ecommerce_admin_reject_order' ? { p_reason: safeText(reason) } : {})
    });
    if (payload.success === false) return payload;
    return {
      success: true,
      changed: Boolean(payload.changed),
      order: payload.order ? normalizeOrderSummary(payload.order) : null
    };
  } catch (error) {
    const code = error?.code || error?.message || 'ECOMMERCE_ORDER_ACTION_FAILED';
    return { success: false, code, message: getEcommerceOrderErrorMessage(error) };
  }
};

export const markEcommerceOrderSeen = (args) => mutateOrder('ecommerce_admin_mark_order_seen', args);
export const acceptEcommerceOrder = (args) => mutateOrder('ecommerce_admin_accept_order', args);
export const rejectEcommerceOrder = (args) => mutateOrder('ecommerce_admin_reject_order', args);

export const ecommerceOrderServiceInternals = Object.freeze({
  buildAuthArgs,
  normalizeOrderSummary,
  normalizeDetail,
  normalizeCounts,
  normalizePagination
});
