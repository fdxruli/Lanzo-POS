import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import { db, STORES } from '../db/dexie';
import { SALE_STATUS } from '../sales/financialStats';
import { salesCloudCashierService } from '../salesCloud/salesCloudCashierService';
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
export const ECOMMERCE_SALE_READ_FAILED = 'ECOMMERCE_SALE_READ_FAILED';
export const ECOMMERCE_SALE_VERIFICATION_PENDING = 'ECOMMERCE_SALE_VERIFICATION_PENDING';

const SALE_VERIFICATION_PENDING_MESSAGE = 'No se pudo confirmar todavía si la venta fue registrada. El pedido permanece reservado para evitar un cobro duplicado.';

const getLicenseKey = (licenseDetails = {}) => (
  licenseDetails.license_key
  || licenseDetails.licenseKey
  || licenseDetails.details?.license_key
  || licenseDetails.details?.licenseKey
  || null
);

const buildAuthArgs = async (licenseDetails = {}) => {
  const licenseKey = getLicenseKey(licenseDetails);
  if (!licenseKey) {
    throw Object.assign(new Error('LICENSE_KEY_REQUIRED'), { code: 'LICENSE_KEY_REQUIRED' });
  }

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

const callReservationRpc = async ({ rpcName, order, attemptId, saleId, conversionKey, extraArgs = {}, licenseDetails }) => {
  if (!validateReservationArgs({ order, attemptId, saleId, conversionKey })) {
    return {
      success: false,
      code: 'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      message: 'Faltan datos requeridos para la conversión.'
    };
  }

  try {
    const authArgs = await buildAuthArgs(licenseDetails);
    return await callConversionRpc(rpcName, {
      ...authArgs,
      p_order_id: order.ecommerceOrderId,
      p_claim_token: order.ecommerceClaimToken,
      p_attempt_id: attemptId,
      p_sale_id: saleId,
      p_conversion_key: conversionKey,
      ...extraArgs
    });
  } catch (error) {
    return {
      success: false,
      code: error?.code || 'ECOMMERCE_POS_CONVERSION_FAILED',
      message: 'No se pudo completar la operación remota de conversión.'
    };
  }
};

export async function beginEcommercePosConversionRemote({
  order,
  attemptId,
  saleId = order?.id,
  conversionKey = getEcommerceConversionKey(order?.ecommerceOrderId),
  licenseDetails = useAppStore.getState().licenseDetails
} = {}) {
  const payload = await callReservationRpc({
    rpcName: 'ecommerce_begin_pos_conversion',
    order,
    attemptId,
    saleId,
    conversionKey,
    extraArgs: { p_draft_id: order?.id },
    licenseDetails
  });
  if (payload.success === false) {
    return {
      ...payload,
      code: payload.code || ECOMMERCE_REMOTE_RESERVATION_FAILED,
      message: payload.message || 'No se pudo reservar el pedido para cobro.'
    };
  }

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
  const payload = await callReservationRpc({
    rpcName: 'ecommerce_cancel_pos_conversion',
    order,
    attemptId,
    saleId,
    conversionKey,
    extraArgs: { p_reason: reason },
    licenseDetails
  });
  if (payload.success === false) {
    return {
      ...payload,
      code: payload.code || ECOMMERCE_REMOTE_RESERVATION_RELEASE_FAILED,
      message: payload.message || 'No se pudo liberar la reserva remota de conversión.'
    };
  }

  return {
    success: true,
    changed: payload.changed === true,
    idempotent: payload.idempotent === true,
    remoteContractVersion: Number(payload.contractVersion) || ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
    orderId: payload.orderId || order.ecommerceOrderId,
    conversionStatus: payload.conversionStatus || 'idle'
  };
}

export async function completeEcommercePosConversionRemote({
  order,
  saleId,
  attemptId = order?.ecommerceConversionAttemptId,
  conversionKey = getEcommerceConversionKey(order?.ecommerceOrderId),
  licenseDetails = useAppStore.getState().licenseDetails
} = {}) {
  const payload = await callReservationRpc({
    rpcName: 'ecommerce_complete_pos_conversion',
    order,
    attemptId,
    saleId,
    conversionKey,
    extraArgs: { p_draft_id: order?.id },
    licenseDetails
  });
  if (payload.success === false) {
    return {
      ...payload,
      code: payload.code || ECOMMERCE_REMOTE_CONFIRMATION_FAILED,
      message: payload.message || 'La venta fue registrada, pero falta confirmar el pedido online.'
    };
  }

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
}

const getSaleConversionKey = (sale = {}) => (
  sale?.metadata?.idempotencyKey
  || sale?.metadata?.ecommerceConversionKey
  || sale?.idempotencyKey
  || null
);

const isValidEcommerceSale = (sale, conversionKey) => (
  Boolean(sale)
  && (sale.status === SALE_STATUS.CLOSED || sale.status === 'closed')
  && getSaleConversionKey(sale) === conversionKey
);

export async function findEcommerceSale({ orderId, conversionKey } = {}) {
  const resolvedKey = conversionKey || getEcommerceConversionKey(orderId);
  if (!resolvedKey) return null;

  const deterministicId = orderId ? `ecom-${String(orderId).trim()}` : null;
  if (deterministicId) {
    const byId = await db.table(STORES.SALES).get(deterministicId);
    if (isValidEcommerceSale(byId, resolvedKey)) return byId;
  }

  return db.table(STORES.SALES)
    .filter((sale) => isValidEcommerceSale(sale, resolvedKey))
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

const isSameRemoteReservation = (order, remote) => (
  remote?.conversionStatus === 'reserved'
  && remote?.conversionOwned === true
  && remote?.conversionAttemptId === order?.ecommerceConversionAttemptId
  && remote?.reservedSaleId === order?.id
);

const shouldVerifyCloudSale = (order = {}) => {
  const mode = String(order.ecommerceSaleExecutionMode || 'unknown').toLowerCase();
  return mode === 'unknown' || mode.startsWith('cloud');
};

const markSaleVerificationPending = ({ orderId, saleId = null, code = ECOMMERCE_SALE_VERIFICATION_PENDING, message = SALE_VERIFICATION_PENDING_MESSAGE }) => {
  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceConvertedSaleId: saleId,
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceRemoteConversionStatus: 'reserved',
    ecommerceConversionError: { code, message }
  });
  return {
    success: false,
    code,
    message,
    recoveredStatus: ECOMMERCE_CONVERSION_STATUS.ERROR,
    saleVerificationPending: true,
    saleId
  };
};

const verifySaleForRecovery = async ({ order, remote }) => {
  const conversionKey = order.ecommerceCheckoutSnapshot?.ecommerceConversionKey
    || remote?.conversionKey
    || getEcommerceConversionKey(order.ecommerceOrderId);
  const expectedSaleId = order.ecommerceConvertedSaleId
    || remote?.convertedSaleId
    || remote?.reservedSaleId
    || order.id;

  let localSale;
  try {
    localSale = await findEcommerceSale({
      orderId: order.ecommerceOrderId,
      conversionKey
    });
  } catch (error) {
    return {
      success: false,
      code: ECOMMERCE_SALE_READ_FAILED,
      message: 'No se pudo comprobar si la venta ya fue registrada. La reserva remota se conserva.',
      error
    };
  }

  if (localSale) {
    return {
      success: true,
      exists: true,
      source: 'local',
      saleId: localSale.id,
      sale: localSale,
      conversionKey
    };
  }

  if (!shouldVerifyCloudSale(order)) {
    return { success: true, exists: false, source: 'local', conversionKey, expectedSaleId };
  }

  const cloud = await salesCloudCashierService.verifyCommittedSale({
    localSaleId: expectedSaleId,
    idempotencyKey: conversionKey,
    startedAt: order.ecommerceRemoteConversionStartedAt
      || remote?.conversionStartedAt
      || order.ecommerceConversionStartedAt,
    licenseDetails: useAppStore.getState().licenseDetails
  });
  if (cloud.success === false) {
    return {
      success: false,
      code: ECOMMERCE_SALE_VERIFICATION_PENDING,
      message: cloud.message || SALE_VERIFICATION_PENDING_MESSAGE,
      error: cloud.error || null
    };
  }

  if (cloud.exists) {
    return {
      success: true,
      exists: true,
      source: 'cloud',
      saleId: cloud.saleId,
      cloudSaleId: cloud.cloudSaleId,
      sale: cloud.localSale,
      conversionKey
    };
  }

  return { success: true, exists: false, source: 'cloud', conversionKey, expectedSaleId };
};

const unlockLocalOrder = async (orderId) => {
  const activeOrders = useActiveOrders.getState();
  if (typeof activeOrders.unlockOrder === 'function') {
    await activeOrders.unlockOrder(orderId);
  }
};

const moveRecoveredSaleToConfirmationPending = ({ orderId, saleId, remote }) => {
  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
    ecommerceConvertedSaleId: saleId,
    ecommerceRemoteConversionStatus: remote?.conversionStatus || 'reserved',
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceConversionError: {
      code: ECOMMERCE_REMOTE_CONFIRMATION_FAILED,
      message: 'La venta fue registrada, pero falta confirmar el pedido online.'
    }
  });
  return {
    success: true,
    recoveredStatus: ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING,
    saleId,
    changed: true
  };
};

const releaseVerifiedAttemptWithoutSale = async ({ order, orderId, status, remote }) => {
  if (remote?.convertedSaleId || remote?.conversionStatus === 'completed') {
    return markSaleVerificationPending({ orderId, saleId: remote.convertedSaleId || null });
  }

  if (remote?.conversionStatus === 'reserved' && !isSameRemoteReservation(order, remote)) {
    return markSaleVerificationPending({
      orderId,
      code: 'ECOMMERCE_POS_CONVERSION_RESERVATION_LOST',
      message: 'La reserva remota pertenece a otro intento. El pedido permanece bloqueado.'
    });
  }

  if (remote?.conversionStatus === 'reserved') {
    const cancellation = await cancelEcommercePosConversionRemote({
      order,
      reason: `recovery_${status}`
    });
    if (cancellation.success === false) {
      return markSaleVerificationPending({
        orderId,
        code: cancellation.code || ECOMMERCE_REMOTE_RESERVATION_RELEASE_FAILED,
        message: cancellation.message || 'No se pudo liberar la reserva remota de conversión.'
      });
    }
  } else if (remote?.conversionStatus !== 'idle') {
    return markSaleVerificationPending({ orderId });
  }

  await unlockLocalOrder(orderId);
  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceConvertedSaleId: null,
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceRemoteConversionStatus: 'idle',
    ecommerceCheckoutSnapshot: null,
    ecommerceConversionAttemptId: null,
    ecommerceConversionActorIdentity: null,
    ecommerceCheckoutLockAttemptId: null,
    ecommerceCheckoutLockActorIdentity: null,
    ecommerceConversionError: {
      code: 'PROCESS_INTERRUPTED_BEFORE_SALE',
      message: 'Se comprobó que el intento no creó una venta. Puedes volver a intentarlo.'
    }
  });
  return { success: true, recoveredStatus: ECOMMERCE_CONVERSION_STATUS.ERROR, changed: true };
};

export async function retryEcommerceConversionConfirmation({ orderId } = {}) {
  let order = useActiveOrders.getState().activeOrders.get(orderId);
  if (!order || order.origin !== 'ecommerce') {
    return { success: false, code: 'ECOMMERCE_DRAFT_NOT_FOUND' };
  }

  const remote = await getEcommercePosConversionRemoteState({ order });
  if (remote.success === false) {
    return markSaleVerificationPending({
      orderId,
      saleId: order.ecommerceConvertedSaleId || null,
      code: remote.code || ECOMMERCE_SALE_VERIFICATION_PENDING,
      message: remote.message || SALE_VERIFICATION_PENDING_MESSAGE
    });
  }

  const verification = await verifySaleForRecovery({ order, remote });
  if (verification.success === false) {
    return markSaleVerificationPending({
      orderId,
      saleId: order.ecommerceConvertedSaleId || remote.convertedSaleId || null,
      code: verification.code,
      message: verification.message
    });
  }
  if (!verification.exists) {
    return markSaleVerificationPending({
      orderId,
      code: 'ECOMMERCE_SALE_NOT_FOUND',
      message: 'No se encontró una venta cerrada con la clave ecommerce esperada. La reserva se conserva.'
    });
  }

  const saleId = verification.saleId;
  if (remote.conversionStatus === 'completed' && remote.convertedSaleId === saleId) {
    await finalizeEcommerceConversionLocally({ orderId, saleId });
    return { success: true, idempotent: true, saleId, recoveredStatus: ECOMMERCE_CONVERSION_STATUS.COMPLETED };
  }

  if (!isSameRemoteReservation(order, remote)) {
    return markSaleVerificationPending({
      orderId,
      saleId,
      code: 'ECOMMERCE_POS_CONVERSION_RESERVATION_LOST',
      message: 'La venta existe, pero la reserva remota ya no coincide con este intento.'
    });
  }

  if (!order.ecommerceConversionAttemptId && remote.conversionAttemptId) {
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
      ecommerceConversionAttemptId: remote.conversionAttemptId,
      ecommerceRemoteConversionStatus: remote.conversionStatus,
      ecommerceConvertedSaleId: saleId
    });
    order = useActiveOrders.getState().activeOrders.get(orderId) || order;
  }

  const result = await completeEcommercePosConversionRemote({
    order,
    saleId,
    conversionKey: verification.conversionKey
  });
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
  const hasReservationRecoveryPending = status === ECOMMERCE_CONVERSION_STATUS.ERROR
    && order.ecommerceRemoteConversionStatus === 'reserved'
    && Boolean(order.ecommerceConversionAttemptId);

  if (!recoverableStatuses.includes(status) && !hasReservationRecoveryPending) {
    return { success: true, recoveredStatus: status, changed: false };
  }

  const remote = await getEcommercePosConversionRemoteState({ order });
  if (remote.success === false) {
    return markSaleVerificationPending({
      orderId,
      saleId: order.ecommerceConvertedSaleId || null,
      code: remote.code || ECOMMERCE_SALE_VERIFICATION_PENDING,
      message: remote.message || SALE_VERIFICATION_PENDING_MESSAGE
    });
  }

  const verification = await verifySaleForRecovery({ order, remote });
  if (verification.success === false) {
    return markSaleVerificationPending({
      orderId,
      saleId: order.ecommerceConvertedSaleId || remote.convertedSaleId || null,
      code: verification.code,
      message: verification.message
    });
  }

  if (verification.exists) {
    if (remote.conversionStatus === 'completed' && remote.convertedSaleId === verification.saleId) {
      await finalizeEcommerceConversionLocally({ orderId, saleId: verification.saleId });
      return {
        success: true,
        recoveredStatus: ECOMMERCE_CONVERSION_STATUS.COMPLETED,
        saleId: verification.saleId,
        changed: true
      };
    }
    return moveRecoveredSaleToConfirmationPending({
      orderId,
      saleId: verification.saleId,
      remote
    });
  }

  if ([
    ECOMMERCE_CONVERSION_STATUS.SALE_CREATED,
    ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
  ].includes(status)) {
    return markSaleVerificationPending({
      orderId,
      saleId: order.ecommerceConvertedSaleId || remote.convertedSaleId || null
    });
  }

  return releaseVerifiedAttemptWithoutSale({ order, orderId, status, remote });
}

export const ecommercePosConversionServiceInternals = Object.freeze({
  SALE_VERIFICATION_PENDING_MESSAGE,
  buildAuthArgs,
  parsePayload,
  isMissingRpcError,
  missingContractResult,
  callConversionRpc,
  hashText,
  validateReservationArgs,
  callReservationRpc,
  getSaleConversionKey,
  isValidEcommerceSale,
  isSameRemoteReservation,
  shouldVerifyCloudSale,
  markSaleVerificationPending,
  verifySaleForRecovery,
  unlockLocalOrder,
  moveRecoveredSaleToConfirmationPending,
  releaseVerifiedAttemptWithoutSale
});
