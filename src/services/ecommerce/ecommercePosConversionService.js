import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { ECOMMERCE_CONVERSION_STATUS } from './ecommercePosCheckoutConversion';
import {
  cancelEcommercePosConversionRemote,
  findEcommerceSale,
  getEcommercePosConversionRemoteState,
  recoverEcommercePosConversion as recoverBaseEcommercePosConversion,
  updateEcommerceConversionState
} from './ecommercePosConversionServiceBase';

export * from './ecommercePosConversionServiceBase';

const REMOTE_RECOVERY_STATUSES = new Set(['reserving', 'reserved', 'unknown']);

const isOwnedRemoteReservation = (order = {}, remote = {}) => Boolean(
  remote.success === true
  && remote.conversionStatus === 'reserved'
  && remote.conversionOwned === true
  && remote.conversionAttemptId
  && remote.reservedSaleId
  && remote.conversionKey
  && String(remote.reservedSaleId) === String(order.id)
  && !remote.convertedSaleId
  && !order.ecommerceConvertedSaleId
);

const shouldInspectRemoteReservation = ({ order, baseResult } = {}) => {
  if (!order || order.origin !== 'ecommerce') return false;
  if (
    order.ecommerceConvertedSaleId
    || order.ecommerceConversionStatus === ECOMMERCE_CONVERSION_STATUS.COMPLETED
  ) return false;

  if (baseResult?.saleVerificationPending === true) return true;
  if (REMOTE_RECOVERY_STATUSES.has(order.ecommerceRemoteConversionStatus)) return true;

  return [
    ECOMMERCE_CONVERSION_STATUS.IDLE,
    ECOMMERCE_CONVERSION_STATUS.ERROR
  ].includes(order.ecommerceConversionStatus || ECOMMERCE_CONVERSION_STATUS.IDLE);
};

const shouldReleaseOwnedReservation = ({ baseResult, remote } = {}) => (
  baseResult?.success !== false
  && baseResult?.saleVerificationPending !== true
  && remote?.claimValid === false
);

const clearVerifiedReservationLocally = async ({ orderId, cancellation }) => {
  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceConvertedSaleId: null,
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceCheckoutGateCode: 'PROCESS_INTERRUPTED_BEFORE_SALE',
    ecommerceCheckoutGateMessage: 'Se comprobó que el intento no creó una venta. Puedes volver a cobrar.',
    ecommerceRemoteConversionStatus: 'idle',
    ecommerceCheckoutSnapshot: null,
    ecommerceConversionAttemptId: null,
    ecommerceConversionActorIdentity: null,
    ecommerceCheckoutLockAttemptId: null,
    ecommerceCheckoutLockActorIdentity: null,
    ecommerceCanonicalCheckoutAttemptId: null,
    ecommerceRemoteConversionAttemptId: null,
    ecommerceRemoteReservedSaleId: null,
    ecommerceRemoteConversionStartedAt: null,
    ecommerceConversionError: {
      code: 'PROCESS_INTERRUPTED_BEFORE_SALE',
      message: 'Se comprobó que el intento no creó una venta. Puedes volver a cobrar.'
    }
  });

  const state = useActiveOrders.getState();
  if (typeof state.unlockOrder === 'function') {
    await state.unlockOrder(orderId);
  }

  return {
    success: true,
    changed: true,
    recoveredStatus: ECOMMERCE_CONVERSION_STATUS.ERROR,
    authoritativeRelease: true,
    cancellation
  };
};

const tryAuthoritativeReservationRelease = async ({ orderId, order, remote }) => {
  if (!isOwnedRemoteReservation(order, remote)) return null;

  let localSale;
  try {
    localSale = await findEcommerceSale({
      orderId: order.ecommerceOrderId,
      conversionKey: remote.conversionKey
    });
  } catch {
    return null;
  }
  if (localSale) return null;

  const cancellation = await cancelEcommercePosConversionRemote({
    order,
    attemptId: remote.conversionAttemptId,
    saleId: remote.reservedSaleId,
    conversionKey: remote.conversionKey,
    reason: 'recovery_authoritative_sale_check'
  });
  if (cancellation.success !== true) {
    return {
      success: false,
      code: cancellation.code,
      message: cancellation.message,
      cancellation
    };
  }

  return clearVerifiedReservationLocally({ orderId, cancellation });
};

export async function recoverEcommercePosConversion({ orderId } = {}) {
  const baseResult = await recoverBaseEcommercePosConversion({ orderId });
  const order = useActiveOrders.getState().activeOrders?.get?.(orderId) || null;

  if (!shouldInspectRemoteReservation({ order, baseResult })) return baseResult;

  const remote = await getEcommercePosConversionRemoteState({ order });
  if (!isOwnedRemoteReservation(order, remote)) return baseResult;
  if (!shouldReleaseOwnedReservation({ baseResult, remote })) return baseResult;

  const release = await tryAuthoritativeReservationRelease({ orderId, order, remote });
  if (release?.success === true) return release;
  return release
    ? {
        ...baseResult,
        success: false,
        code: release.code || baseResult?.code || 'ECOMMERCE_POS_CONVERSION_CANCEL_FAILED',
        message: release.message || baseResult?.message,
        authoritativeCancellation: release
      }
    : baseResult;
}

export const ecommercePosConversionRecoveryReleaseInternals = Object.freeze({
  REMOTE_RECOVERY_STATUSES,
  isOwnedRemoteReservation,
  shouldInspectRemoteReservation,
  shouldReleaseOwnedReservation,
  clearVerifiedReservationLocally,
  tryAuthoritativeReservationRelease
});
