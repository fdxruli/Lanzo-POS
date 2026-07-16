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
  if (baseResult?.success === true || baseResult?.saleVerificationPending !== true) {
    return baseResult;
  }

  const order = useActiveOrders.getState().activeOrders?.get?.(orderId) || null;
  if (!order || order.origin !== 'ecommerce') return baseResult;

  const remote = await getEcommercePosConversionRemoteState({ order });
  if (!isOwnedRemoteReservation(order, remote)) return baseResult;

  const release = await tryAuthoritativeReservationRelease({ orderId, order, remote });
  if (release?.success === true) return release;
  return release
    ? { ...baseResult, authoritativeCancellation: release }
    : baseResult;
}

export const ecommercePosConversionRecoveryReleaseInternals = Object.freeze({
  isOwnedRemoteReservation,
  clearVerifiedReservationLocally,
  tryAuthoritativeReservationRelease
});