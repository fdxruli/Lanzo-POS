import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import { db, STORES } from '../db/dexie';
import { SALE_STATUS } from '../sales/financialStats';
import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import {
  ECOMMERCE_CONVERSION_STATUS,
  ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
  createEcommerceConversionPatch,
  getEcommerceConversionKey
} from './ecommercePosCheckoutConversion';

export const ECOMMERCE_REMOTE_CONTRACT_PENDING = 'ECOMMERCE_REMOTE_CONVERSION_CONTRACT_PENDING';
export const ECOMMERCE_REMOTE_CONFIRMATION_FAILED = 'REMOTE_CONFIRMATION_FAILED';
export const ECOMMERCE_REMOTE_CONFIRMATION_CONFLICT = 'ECOMMERCE_POS_CONVERSION_CONFLICT';
export const ECOMMERCE_REMOTE_RESERVATION_FAILED = 'ECOMMERCE_POS_CONVERSION_RESERVATION_FAILED';
export const ECOMMERCE_REMOTE_RESERVATION_RELEASE_FAILED = 'ECOMMERCE_POS_CONVERSION_CANCEL_FAILED';

const getLicenseKey = (licenseDetails = {}) => (
  licenseDetails.license_key
  || licenseDetails.licenseKey
  || licenseDetails.details?.license_key
  || licenseDetails.details?.licenseKey
  || null
);

const buildAuthArgs = async (licenseDetails = {}) => {
  const licenseKey = getLicenseKey(licenseDetails);
  if (!licenseKey) throw Object.assign(new Error('LICENSE_KEY_REQUIRED'), { code: 'LICENSE_KEY_REQUIRED' });

  const authContext = await buildPosSyncAuthContext({ licenseKey });
  if (!authContext.deviceFingerprint || !authContext.securityToken) {
    throw Object.assign(
      new Error('ECOMMERCE_ORDERS_AUTH_CONTEXT_INCOMPLETE'),
      { code: 'ECOMMERCE_ORDERS_AUTH_CONTEXT_INCOMPLETE' }
    );
  }

  return {
    p_license_key: authContext.licenseKey,
    p_device_fingerprint: authContext.deviceFingerprint,
    p_security_token: authContext.securityToken,
    p_staff_session_token: authContext.staffSessionToken || null
  };
};

const parsePayload = (data) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return { success: false, code: 'INVALID_RPC_RESPONSE' };
    }
  }
  return data && typeof data === 'object'
    ? data
    : { success: false, code: 'INVALID_RPC_RESPONSE' };
};

const isMissingRpcError = (error = {}) => {
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '').toLowerCase();
  return (
    code === 'PGRST202'
    || code === '42883'
    || message.includes('could not find the function')
    || message.includes('does not exist')
    || message.includes('schema cache')
  );
};

const missingContractResult = () => ({
  success: false,
  code: ECOMMERCE_REMOTE_CONTRACT_PENDING,
  remoteContractVersion: 0,
  message: 'El contrato remoto de conversión todavía no está disponible.'
});

const callConversionRpc = async (rpcName, args) => {
  if (!supabaseClient) return missingContractResult();

  const { data, error } = await supabaseClient.rpc(rpcName, args);
  if (error) {
    if (isMissingRpcError(error)) return missingContractResult();
    return {
      success: false,
      code: error.code || 'ECOMMERCE_POS_CONVERSION_FAILED',
      message: 'No se pudo verificar o confirmar la conversión del pedido.'
    };
  }

  const payload = parsePayload(data);
  if (payload.success === false) {
    return {
      success: false,
      code: payload.code || 'ECOMMERCE_POS_CONVERSION_FAILED',
      message: payload.message || 'No se pudo verificar o confirmar la conversión del pedido.',
      details: payload.details || null,
      remoteContractVersion: Number(payload.contractVersion) || 0
    };
  }
  return payload;
};

const hashText = (value) => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const getEcommerceClaimIdentity = (order = {}) => {
  if (!order.ecommerceClaimToken) return null;
  return `claim-${hashText(`${order.ecommerceOrderId}:${order.ecommerceClaimToken}`)}`;
};

export const getEcommerceActorIdentity = (state = useAppStore.getState()) => {
  const staff = state.currentStaffUser || {};
  const actorId = staff.id || staff.staff_user_id || staff.user_id || staff.username || 'device';
  return `${state.currentDeviceRole || 'none'}:${actorId}`;
};

export async function getEcommercePosConversionRemoteState({
  order,
  licenseDetails = useAppStore.getState().licenseDetails
} = {}) {
  if (!order?.ecommerceOrderId || !order?.ecommerceClaimToken) {
    return {
      success: false,
      code: 'ECOMMERCE_CLAIM_LOST',
      remoteContractVersion: 0,
      claimOwned: false,
      claimValid: false
    };
  }

  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    const payload = await callConversionRpc('ecommerce_get_pos_conversion_state', {
      ...authArgs,
      p_order_id: order.ecommerceOrderId,
      p_claim_token: order.ecommerceClaimToken
    });
    if (payload.success === false) return payload;

    return {
      success: true,
      remoteContractVersion: Number(payload.contractVersion) || 0,
      orderId: payload.orderId || order.ecommerceOrderId,
      orderStatus: payload.orderStatus || null,
      draftStatus: payload.draftStatus || null,
      draftId: payload.draftId || null,
      claimOwned: payload.claimOwned === true,
      claimValid: payload.claimValid === true,
      claimExpiresAt: payload.claimExpiresAt || null,
      conversionStatus: payload.conversionStatus || 'idle',
      conversionOwned: payload.conversionOwned === true,
      conversionAttemptId: payload.conversionAttemptId || null,
      reservedSaleId: payload.reservedSaleId || null,
      conversionStartedAt: payload.conversionStartedAt || null,
      convertedSaleId: payload.convertedSaleId || null,
      convertedAt: payload.convertedAt || null,
      conversionKey: payload.conversionKey || null
    };
  } catch (error) {
    return {
      success: false,
      code: error?.code || 'ECOMMERCE_POS_CONVERSION_STATE_FAILED',
      message: 'No se pudo verificar el estado remoto del pedido.',
      remoteContractVersion: 0
    };
  }
}

const validateReservationArgs = ({ order, attemptId, saleId, conversionKey }) => (
  Boolean(
    order?.ecommerceOrderId
    && order?.ecommerceClaimToken
    && order?.id
    && attemptId
    && saleId
    && conversionKey
  )
);

export async function beginEcommercePosConversionRemote({
  order,
  attemptId,
  saleId = order?.id,
  conversionKey = getEcommerceConversionKey(order?.ecommerceOrderId),
  licenseDetails = useAppStore.getState().licenseDetails
} = {}) {
  if (!validateReservationArgs({ order, attemptId, saleId, conversionKey })) {
    return {
      success: false,
      code: 'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      message: 'Faltan datos para reservar la conversión.'
    };
  }

  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    const payload = await callConversionRpc('ecommerce_begin_pos_conversion', {
      ...authArgs,
      p_order_id: order.ecommerceOrderId,
      p_claim_token: order.ecommerceClaimToken,
      p_draft_id: order.id,
      p_attempt_id: attemptId,
      p_sale_id: saleId,
      p_conversion_key: conversionKey
    });
    if (payload.success === false) return payload;

    return {
      success: true,
      changed: payload.changed === true,
      idempotent: payload.idempotent === true,
      alreadyCompleted: payload.alreadyCompleted === true,
      remoteContractVersion: Number(payload.contractVersion) || ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
      orderId: payload.orderId || order.ecommerceOrderId,
      conversionStatus: payload.conversionStatus || 'reserved',
      conversionAttemptId: payload.conversionAttemptId || attemptId,
      reservedSaleId: payload.reservedSaleId || saleId,
      conversionStartedAt: payload.conversionStartedAt || null,
      convertedSaleId: payload.convertedSaleId || null,
      conversionKey: payload.conversionKey || conversionKey
    };
  } catch (error) {
    return {
      success: false,
      code: error?.code || ECOMMERCE_REMOTE_RESERVATION_FAILED,
      message: 'No se pudo reservar el pedido para cobro.'
    };
  }
}

export async function cancelEcommercePosConversionRemote({
  order,
  attemptId = order?.ecommerceConversionAttemptId,
  saleId = order?.id,
  conversionKey = order?.ecommerceCheckoutSnapshot?.ecommerceConversionKey
    || getEcommerceConversionKey(order?.ecommerceOrderId),
  reason = 'cancelled_before_sale',
  licenseDetails = useAppStore.getState().licenseDetails
} = {}) {
  if (!validateReservationArgs({ order, attemptId, saleId, conversionKey })) {
    return {
      success: false,
      code: 'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      message: 'Faltan datos para liberar la reserva de conversión.'
    };
  }

  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    const payload = await callConversionRpc('ecommerce_cancel_pos_conversion', {
      ...authArgs,
      p_order_id: order.ecommerceOrderId,
      p_claim_token: order.ecommerceClaimToken,
      p_attempt_id: attemptId,
      p_sale_id: saleId,
      p_conversion_key: conversionKey,
      p_reason: reason
    });
    if (payload.success === false) return payload;

    return {
      success: true,
      changed: payload.changed === true,
      idempotent: payload.idempotent === true,
      remoteContractVersion: Number(payload.contractVersion) || ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
      orderId: payload.orderId || order.ecommerceOrderId,
      conversionStatus: payload.conversionStatus || 'idle'
    };
  } catch (error) {
    return {
      success: false,
      code: error?.code || ECOMMERCE_REMOTE_RESERVATION_RELEASE_FAILED,
      message: 'No se pudo liberar la reserva remota de conversión.'
    };
  }
}

export async function completeEcommercePosConversionRemote({
  order,
  saleId,
  attemptId = order?.ecommerceConversionAttemptId,
  conversionKey = getEcommerceConversionKey(order?.ecommerceOrderId),
  licenseDetails = useAppStore.getState().licenseDetails
} = {}) {
  if (!validateReservationArgs({ order, attemptId, saleId, conversionKey })) {
    return {
      success: false,
      code: 'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      message: 'Faltan datos para confirmar la conversión.'
    };
  }

  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    const payload = await callConversionRpc('ecommerce_complete_pos_conversion', {
      ...authArgs,
      p_order_id: order.ecommerceOrderId,
      p_claim_token: order.ecommerceClaimToken,
      p_draft_id: order.id,
      p_attempt_id: attemptId,
      p_sale_id: saleId,
      p_conversion_key: conversionKey
    });
    if (payload.success === false) return payload;

    return {
      success: true,
      changed: payload.changed === true,
      idempotent: payload.idempotent === true,
      remoteContractVersion: Number(payload.contractVersion) || ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
      orderId: payload.orderId || order.ecommerceOrderId,
      orderStatus: payload.orderStatus || 'converted_to_sale',
      conversionStatus: payload.conversionStatus || 'completed',
      convertedSaleId: payload.convertedSaleId || saleId,
      convertedAt: payload.convertedAt || null,
      conversionKey: payload.conversionKey || conversionKey
    };
  } catch (error) {
    return {
      success: false,
      code: error?.code || ECOMMERCE_REMOTE_CONFIRMATION_FAILED,
      message: 'La venta fue registrada, pero falta confirmar el pedido online.'
    };
  }
}

export async function findEcommerceSale({ orderId, conversionKey } = {}) {
  const resolvedKey = conversionKey || getEcommerceConversionKey(orderId);
  if (!orderId && !resolvedKey) return null;

  const deterministicId = orderId ? `ecom-${String(orderId).trim()}` : null;
  if (deterministicId) {
    const byId = await db.table(STORES.SALES).get(deterministicId);
    const byIdKey = byId?.metadata?.idempotencyKey || byId?.metadata?.ecommerceConversionKey || null;
    if (
      (byId?.status === SALE_STATUS.CLOSED || byId?.status === 'closed')
      && byIdKey === resolvedKey
    ) return byId;
  }

  if (!resolvedKey) return null;
  return db.table(STORES.SALES)
    .filter((sale) => (
      (sale?.metadata?.idempotencyKey === resolvedKey
        || sale?.metadata?.ecommerceConversionKey === resolvedKey
        || sale?.idempotencyKey === resolvedKey)
      && (sale?.status === SALE_STATUS.CLOSED || sale?.status === 'closed')
    ))
    .first();
}

export const updateEcommerceConversionState = (orderId, status, values = {}) => {
  const activeOrders = useActiveOrders.getState();
  const order = activeOrders.activeOrders.get(orderId);
  if (!order || order.origin !== 'ecommerce') return null;

  const patch = createEcommerceConversionPatch(status, values);
  activeOrders.updateOrder(orderId, patch);
  return useActiveOrders.getState().activeOrders.get(orderId) || { ...order, ...patch };
};

export async function finalizeEcommerceConversionLocally({ orderId, saleId } = {}) {
  const order = useActiveOrders.getState().activeOrders.get(orderId);
  if (!order || order.origin !== 'ecommerce') return { success: true, removed: false };

  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.COMPLETED, {
    ecommerceConvertedSaleId: saleId,
    ecommerceRemoteConversionStatus: 'completed',
    ecommerceConversionError: null,
    ecommerceCheckoutSnapshot: null
  });
  useActiveOrders.getState().removeEcommerceDraftLocal(orderId);
  return { success: true, removed: true, saleId };
}

export async function retryEcommerceConversionConfirmation({ orderId } = {}) {
  let order = useActiveOrders.getState().activeOrders.get(orderId);
  if (!order || order.origin !== 'ecommerce') {
    return { success: false, code: 'ECOMMERCE_DRAFT_NOT_FOUND' };
  }

  const conversionKey = order.ecommerceCheckoutSnapshot?.ecommerceConversionKey
    || getEcommerceConversionKey(order.ecommerceOrderId);
  const sale = order.ecommerceConvertedSaleId
    ? await db.table(STORES.SALES).get(order.ecommerceConvertedSaleId)
    : await findEcommerceSale({ orderId: order.ecommerceOrderId, conversionKey });
  const saleId = sale?.id || order.ecommerceConvertedSaleId || null;

  if (!saleId) {
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
      ecommerceConvertedSaleId: null,
      ecommerceConversionError: {
        code: 'ECOMMERCE_SALE_NOT_FOUND',
        message: 'No se encontró una venta válida para confirmar.'
      }
    });
    return { success: false, code: 'ECOMMERCE_SALE_NOT_FOUND' };
  }

  if (!order.ecommerceConversionAttemptId) {
    const remote = await getEcommercePosConversionRemoteState({ order });
    if (remote.success === true && remote.conversionOwned && remote.conversionAttemptId) {
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
        ecommerceConversionAttemptId: remote.conversionAttemptId,
        ecommerceRemoteConversionStatus: remote.conversionStatus,
        ecommerceConvertedSaleId: saleId
      });
      order = useActiveOrders.getState().activeOrders.get(orderId) || order;
    }
  }

  const result = await completeEcommercePosConversionRemote({ order, saleId, conversionKey });
  if (result.success === false) {
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
      ecommerceConvertedSaleId: saleId,
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceConversionError: {
        code: result.code || ECOMMERCE_REMOTE_CONFIRMATION_FAILED,
        message: result.message || 'La venta fue registrada, pero falta confirmar el pedido online.'
      }
    });
    return { ...result, saleId };
  }

  await finalizeEcommerceConversionLocally({ orderId, saleId });
  return { ...result, saleId };
}

const unlockLocalOrder = async (orderId) => {
  const activeOrders = useActiveOrders.getState();
  if (typeof activeOrders.unlockOrder === 'function') {
    await activeOrders.unlockOrder(orderId);
  }
};

const recoverInterruptedBeforeSale = async ({ order, orderId, status }) => {
  const cancellation = await cancelEcommercePosConversionRemote({
    order,
    reason: `recovery_${status}`
  });
  await unlockLocalOrder(orderId);

  if (cancellation.success === false && cancellation.code !== ECOMMERCE_REMOTE_CONTRACT_PENDING) {
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
      ecommerceCheckoutGateStatus: 'blocked',
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceConversionError: {
        code: cancellation.code || ECOMMERCE_REMOTE_RESERVATION_RELEASE_FAILED,
        message: cancellation.message || 'No se pudo liberar la reserva remota de conversión.'
      }
    });
    return {
      success: false,
      code: cancellation.code || ECOMMERCE_REMOTE_RESERVATION_RELEASE_FAILED,
      recoveredStatus: ECOMMERCE_CONVERSION_STATUS.ERROR
    };
  }

  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceConvertedSaleId: null,
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceRemoteConversionStatus: 'idle',
    ecommerceCheckoutSnapshot: null,
    ecommerceConversionAttemptId: null,
    ecommerceConversionActorIdentity: null,
    ecommerceConversionError: {
      code: 'PROCESS_INTERRUPTED_BEFORE_SALE',
      message: 'El intento se interrumpió antes de encontrar una venta registrada.'
    }
  });
  return { success: true, recoveredStatus: ECOMMERCE_CONVERSION_STATUS.ERROR, changed: true };
};

export async function recoverEcommercePosConversion({ orderId } = {}) {
  const order = useActiveOrders.getState().activeOrders.get(orderId);
  if (!order || order.origin !== 'ecommerce') {
    return { success: false, code: 'ECOMMERCE_DRAFT_NOT_FOUND' };
  }

  const status = order.ecommerceConversionStatus || ECOMMERCE_CONVERSION_STATUS.IDLE;
  if (status === ECOMMERCE_CONVERSION_STATUS.COMPLETED) {
    useActiveOrders.getState().removeEcommerceDraftLocal(orderId);
    return { success: true, recoveredStatus: ECOMMERCE_CONVERSION_STATUS.COMPLETED };
  }

  const recoverableStatuses = [
    ECOMMERCE_CONVERSION_STATUS.VALIDATING,
    ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
    ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
    ECOMMERCE_CONVERSION_STATUS.SALE_CREATED,
    ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
  ];
  const hasReservationCleanupPending = status === ECOMMERCE_CONVERSION_STATUS.ERROR
    && order.ecommerceRemoteConversionStatus === 'reserved'
    && Boolean(order.ecommerceConversionAttemptId);

  if (!recoverableStatuses.includes(status) && !hasReservationCleanupPending) {
    return { success: true, recoveredStatus: status, changed: false };
  }

  const conversionKey = order.ecommerceCheckoutSnapshot?.ecommerceConversionKey
    || getEcommerceConversionKey(order.ecommerceOrderId);
  let sale;
  try {
    sale = await findEcommerceSale({ orderId: order.ecommerceOrderId, conversionKey });
  } catch (error) {
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
      ecommerceCheckoutGateStatus: 'blocked',
      ecommerceConversionError: {
        code: 'ECOMMERCE_SALE_READ_FAILED',
        message: 'No se pudo comprobar si la venta ya fue registrada. No se liberó la reserva remota.'
      }
    });
    return { success: false, code: 'ECOMMERCE_SALE_READ_FAILED', error };
  }

  if (!sale) {
    return recoverInterruptedBeforeSale({ order, orderId, status });
  }

  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
    ecommerceConvertedSaleId: sale.id,
    ecommerceRemoteConversionStatus: 'reserved',
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceConversionError: order.ecommerceConversionError || {
      code: ECOMMERCE_REMOTE_CONFIRMATION_FAILED,
      message: 'La venta fue registrada, pero falta confirmar el pedido online.'
    }
  });
  return {
    success: true,
    recoveredStatus: ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING,
    saleId: sale.id,
    changed: true
  };
}

export const ecommercePosConversionServiceInternals = Object.freeze({
  buildAuthArgs,
  parsePayload,
  isMissingRpcError,
  missingContractResult,
  callConversionRpc,
  hashText,
  validateReservationArgs,
  unlockLocalOrder,
  recoverInterruptedBeforeSale
});
