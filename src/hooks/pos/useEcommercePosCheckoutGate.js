import { useCallback } from 'react';
import { useActiveOrders } from './useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import { showMessageModal } from '../../services/utils';
import { salesCloudCashierService } from '../../services/salesCloud/salesCloudCashierService';
import {
  ECOMMERCE_CONVERSION_STATUS,
  buildEcommerceCheckoutSnapshot,
  getEcommerceCheckoutEligibility
} from '../../services/ecommerce/ecommercePosCheckoutConversion';
import {
  ECOMMERCE_SALE_READ_FAILED,
  ECOMMERCE_SALE_VERIFICATION_PENDING,
  cancelEcommercePosConversionRemote,
  completeEcommercePosConversionRemote,
  finalizeEcommerceConversionLocally,
  findEcommerceSale,
  getEcommerceActorIdentity,
  getEcommerceClaimIdentity,
  getEcommercePosConversionRemoteState,
  recoverEcommercePosConversion,
  updateEcommerceConversionState
} from '../../services/ecommerce/ecommercePosConversionService';
import {
  canPrepareEcommercePosDraft,
  getEcommercePosContextIdentity
} from '../../services/ecommerce/ecommercePosDraftService';
import {
  ECOMMERCE_INVENTORY_STALE_RESPONSE,
  revalidateEcommerceDraftInventory
} from '../../services/ecommerce/ecommercePosInventoryResolution';
import {
  ECOMMERCE_CHECKOUT_TARGET_CHANGED,
  ECOMMERCE_STALE_CHECKOUT_ATTEMPT,
  buildCheckoutTargetChangedResult,
  buildStaleCheckoutAttemptResult
} from './checkoutTargetIdentity';

const STALE_CHECKOUT_ATTEMPT = ECOMMERCE_STALE_CHECKOUT_ATTEMPT;

const createAttemptId = () => (
  globalThis.crypto?.randomUUID?.()
  || `ecom-checkout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

const getCurrentOrder = () => {
  const activeOrders = useActiveOrders.getState();
  return activeOrders.currentOrderId
    ? activeOrders.activeOrders.get(activeOrders.currentOrderId) || null
    : null;
};

const getOrderById = (orderId) => (
  useActiveOrders.getState().activeOrders.get(orderId) || null
);

const isCheckoutTargetStillActive = ({ orderId, expectedOrigin = 'ecommerce' } = {}) => {
  if (!orderId) return false;
  const state = useActiveOrders.getState();
  const order = state.activeOrders.get(orderId) || null;
  return Boolean(
    order
    && state.currentOrderId === orderId
    && order.id === orderId
    && (!expectedOrigin || order.origin === expectedOrigin)
  );
};

const isAttemptOwner = (orderId, ownedAttemptId) => {
  if (!orderId || !ownedAttemptId) return false;
  const current = getOrderById(orderId);
  return Boolean(current)
    && current.ecommerceConversionAttemptId === ownedAttemptId;
};

const buildStaleAttemptResult = (result = {}) => buildStaleCheckoutAttemptResult(result);

const buildTargetChangedResult = () => buildCheckoutTargetChangedResult({
  expectedOrigin: 'ecommerce'
});

const isTargetChangedResult = (result) => (
  result?.code === ECOMMERCE_CHECKOUT_TARGET_CHANGED
  || result?.code === 'POS_CHECKOUT_TARGET_CHANGED'
  || result?.targetChanged === true
);

const isEcommerceOrder = (order) => order?.origin === 'ecommerce';

const isSameRemoteReservation = (order, remote) => (
  remote?.conversionStatus === 'reserved'
  && remote?.conversionOwned === true
  && remote?.conversionAttemptId === order?.ecommerceConversionAttemptId
  && remote?.reservedSaleId === order?.id
);

const buildEligibilityContext = ({ order, remote, existingSale = null, state = useAppStore.getState() }) => ({
  contextIdentity: getEcommercePosContextIdentity(state),
  permissionsAllowed: canPrepareEcommercePosDraft(state),
  claimOwned: remote?.claimOwned === true && remote?.claimValid === true,
  inventoryFresh: true,
  remoteContractVersion: remote?.remoteContractVersion || 0,
  remoteConvertedSaleId: remote?.convertedSaleId || null,
  existingSaleId: existingSale?.id || null,
  conversionInProgress: remote?.conversionStatus === 'reserved'
    && !isSameRemoteReservation(order, remote),
  actorIdentity: getEcommerceActorIdentity(state),
  claimIdentity: getEcommerceClaimIdentity(order)
});

const buildSnapshotIgnoringTransientStatus = (order, context) => buildEcommerceCheckoutSnapshot({
  ...order,
  ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.IDLE,
  ecommerceConvertedSaleId: null
}, context);

const buildConversionContext = ({ order, attemptId, actorIdentity } = {}) => ({
  localOrderId: order?.id || null,
  ecommerceOrderId: order?.ecommerceOrderId || null,
  attemptId: attemptId || order?.ecommerceConversionAttemptId || null,
  actorIdentity: actorIdentity || order?.ecommerceConversionActorIdentity || null,
  claimToken: order?.ecommerceClaimToken || null,
  conversionKey: order?.ecommerceCheckoutSnapshot?.ecommerceConversionKey || null,
  saleId: order?.id || null,
  orderSnapshot: order ? {
    ...order,
    ecommerceConversionAttemptId: attemptId || order.ecommerceConversionAttemptId || null
  } : null
});

const releaseRemoteReservationBeforeSale = async ({
  order = null,
  conversionContext = null,
  reason
}) => {
  const context = conversionContext || buildConversionContext({ order });
  const reservationOrder = order || context?.orderSnapshot;

  if (
    !isEcommerceOrder(reservationOrder)
    || reservationOrder.ecommerceConvertedSaleId
    || !context?.attemptId
    || !context?.conversionKey
    || !context?.localOrderId
  ) {
    return { success: true, skipped: true };
  }

  return cancelEcommercePosConversionRemote({
    order: reservationOrder,
    attemptId: context.attemptId,
    saleId: context.saleId,
    conversionKey: context.conversionKey,
    reason
  });
};

const hasLocalAttemptOwnership = ({ orderId, ownedAttemptId }) => (
  ownedAttemptId
    ? isAttemptOwner(orderId, ownedAttemptId)
    : isCheckoutTargetStillActive({ orderId })
);

const failBeforeSale = async ({
  orderId,
  code,
  message,
  closeCanonicalCheckout,
  expectedCheckoutAttemptId = null,
  releaseRemoteReservation = false,
  releaseReason = 'failed_before_sale',
  preserveReservation = false,
  ownedAttemptId = null,
  conversionContext = null
}) => {
  let order = getOrderById(orderId);
  let localOwner = hasLocalAttemptOwnership({ orderId, ownedAttemptId });

  let cancellation = { success: true, skipped: true };
  if (releaseRemoteReservation) {
    cancellation = await releaseRemoteReservationBeforeSale({
      order,
      conversionContext,
      reason: releaseReason
    });
    localOwner = hasLocalAttemptOwnership({ orderId, ownedAttemptId });
    order = getOrderById(orderId) || order;
  }

  if (!localOwner) return buildStaleAttemptResult({ cancellation });

  if (typeof closeCanonicalCheckout === 'function') {
    const closeResult = await closeCanonicalCheckout({
      expectedOrderId: orderId,
      expectedCheckoutAttemptId
    });
    if (closeResult?.staleAttempt) return buildStaleAttemptResult(closeResult);
    if (!hasLocalAttemptOwnership({ orderId, ownedAttemptId })) {
      return buildStaleAttemptResult(closeResult);
    }
  }

  const cancellationUncertain = cancellation.success === false && cancellation.skipped !== true;
  const mustPreserve = preserveReservation || cancellationUncertain;
  const finalMessage = cancellationUncertain
    ? `${message} La reserva remota quedó pendiente de recuperación.`
    : message;

  if (!hasLocalAttemptOwnership({ orderId, ownedAttemptId })) {
    return buildStaleAttemptResult({ cancellation });
  }

  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceCheckoutGateCode: code,
    ecommerceCheckoutGateMessage: finalMessage,
    ecommerceRemoteConversionStatus: mustPreserve ? 'reserved' : 'idle',
    ...(mustPreserve ? {} : {
      ecommerceCheckoutSnapshot: null,
      ecommerceConversionAttemptId: null,
      ecommerceConversionActorIdentity: null,
      ecommerceCheckoutLockAttemptId: null,
      ecommerceCheckoutLockActorIdentity: null,
      ecommerceCanonicalCheckoutAttemptId: null
    }),
    ecommerceConversionError: {
      code: cancellationUncertain ? cancellation.code : code,
      message: finalMessage
    }
  });

  if (hasLocalAttemptOwnership({ orderId, ownedAttemptId })) {
    showMessageModal(finalMessage, null, { type: 'warning' });
  }
  return { success: false, code, message: finalMessage, cancellation };
};

const hasOwnedCheckoutLock = (order, actorIdentity) => (
  order?.isLockedForCheckout === true
  && Boolean(order?.ecommerceConversionAttemptId)
  && order?.ecommerceCheckoutLockAttemptId === order.ecommerceConversionAttemptId
  && order?.ecommerceCheckoutLockActorIdentity === actorIdentity
  && order?.ecommerceConversionActorIdentity === actorIdentity
  && Boolean(order?.ecommerceCanonicalCheckoutAttemptId)
);

const markUncertainSaleResult = ({ orderId, code, message, ownedAttemptId = null }) => {
  if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult();

  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceCheckoutGateCode: code,
    ecommerceCheckoutGateMessage: message,
    ecommerceRemoteConversionStatus: 'reserved',
    ecommerceConversionRecoveryFromStatus: ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
    ecommerceConversionError: { code, message }
  });
  if (isAttemptOwner(orderId, ownedAttemptId)) {
    showMessageModal(message, null, { type: 'warning' });
  }
  return { success: false, code, message, saleVerificationPending: true };
};

export function useEcommercePosCheckoutGate({ checkout }) {
  const handleInitiateCheckout = useCallback(async ({
    expectedOrderId = null,
    expectedOrigin = null
  } = {}) => {
    let order = expectedOrderId ? getOrderById(expectedOrderId) : getCurrentOrder();

    if (!isEcommerceOrder(order)) {
      if (expectedOrigin === 'ecommerce' || expectedOrderId) return buildTargetChangedResult();
      return checkout.handleInitiateCheckout();
    }

    const orderId = expectedOrderId || order.id;
    if (
      order.id !== orderId
      || (expectedOrigin && order.origin !== expectedOrigin)
      || !isCheckoutTargetStillActive({ orderId, expectedOrigin: 'ecommerce' })
    ) {
      return buildTargetChangedResult();
    }

    const recovered = await recoverEcommercePosConversion({ orderId });
    if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    if (recovered?.success === false) {
      const message = recovered.message
        || order.ecommerceConversionError?.message
        || 'No se pudo recuperar el intento anterior de conversión.';
      showMessageModal(message, null, { type: 'warning' });
      return recovered;
    }

    order = getOrderById(orderId);
    if (!order || !isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    if (
      order.ecommerceConversionStatus === ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
      || order.ecommerceConversionStatus === ECOMMERCE_CONVERSION_STATUS.SALE_CREATED
      || order.ecommerceConvertedSaleId
    ) {
      const message = 'La venta ya fue registrada. Solo falta confirmar el pedido online.';
      showMessageModal(message, null, { type: 'warning' });
      return { success: false, code: 'ECOMMERCE_CONFIRMATION_PENDING', message };
    }

    const state = useAppStore.getState();
    const remote = await getEcommercePosConversionRemoteState({
      order,
      licenseDetails: state.licenseDetails
    });
    if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    if (remote.success === false) {
      return failBeforeSale({
        orderId,
        code: remote.code,
        message: remote.message || 'No se pudo comprobar el pedido online.',
        closeCanonicalCheckout: null
      });
    }

    let existingSale;
    try {
      existingSale = await findEcommerceSale({ orderId: order.ecommerceOrderId });
    } catch {
      if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();
      return failBeforeSale({
        orderId,
        code: ECOMMERCE_SALE_READ_FAILED,
        message: 'No se pudo comprobar si el pedido ya tiene una venta registrada.',
        closeCanonicalCheckout: null,
        preserveReservation: remote.conversionStatus === 'reserved'
      });
    }
    if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    if (existingSale || remote.convertedSaleId) {
      const saleId = existingSale?.id || remote.convertedSaleId;
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
        ecommerceConvertedSaleId: saleId,
        ecommerceConversionAttemptId: order.ecommerceConversionAttemptId || remote.conversionAttemptId || null,
        ecommerceRemoteConversionStatus: remote.conversionStatus || 'completed',
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceCheckoutGateCode: 'ECOMMERCE_ALREADY_CONVERTED',
        ecommerceCheckoutGateMessage: 'La venta ya existe; no se volverá a cobrar.',
        ecommerceConversionError: null
      });
      const message = 'La venta ya existe; no se volverá a cobrar. Reintenta únicamente la confirmación online.';
      showMessageModal(message, null, { type: 'warning' });
      return { success: false, code: 'ECOMMERCE_ALREADY_CONVERTED', saleId, message };
    }

    const context = buildEligibilityContext({ order, remote, existingSale, state });
    const eligibility = getEcommerceCheckoutEligibility(order, context);
    if (!eligibility.eligible) {
      return failBeforeSale({
        orderId,
        code: eligibility.code,
        message: eligibility.message,
        closeCanonicalCheckout: null,
        preserveReservation: remote.conversionStatus === 'reserved'
      });
    }

    const attemptId = createAttemptId();
    const actorIdentity = context.actorIdentity;
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.VALIDATING, {
      ecommerceConversionAttemptId: attemptId,
      ecommerceConversionActorIdentity: actorIdentity,
      ecommerceCheckoutGateStatus: 'authorized',
      ecommerceCheckoutGateCode: null,
      ecommerceCheckoutGateMessage: null,
      ecommerceRemoteContractVersion: remote.remoteContractVersion,
      ecommerceRemoteConversionStatus: 'idle',
      ecommerceSaleExecutionMode: 'unknown',
      ecommerceConversionError: null,
      ecommerceCanonicalCheckoutAttemptId: null
    });

    order = getOrderById(orderId);
    if (!isAttemptOwner(orderId, attemptId) || !isCheckoutTargetStillActive({ orderId })) {
      return buildTargetChangedResult();
    }

    const conversionContext = buildConversionContext({ order, attemptId, actorIdentity });
    const result = await checkout.handleInitiateCheckout({
      expectedOrderId: orderId,
      expectedOrigin: 'ecommerce'
    });

    if (isTargetChangedResult(result)) return buildTargetChangedResult();
    if (!isAttemptOwner(orderId, attemptId)) return buildStaleAttemptResult(result);
    if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    order = getOrderById(orderId);
    if (result?.success === true && isEcommerceOrder(order)) {
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING, {
        ecommerceCheckoutGateStatus: 'authorized',
        ecommerceRemoteConversionStatus: 'reserved',
        ecommerceCheckoutLockAttemptId: attemptId,
        ecommerceCheckoutLockActorIdentity: actorIdentity,
        ecommerceCanonicalCheckoutAttemptId: result.checkoutAttemptId || null,
        ecommerceConversionError: null
      });
      return result;
    }

    if (isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      return failBeforeSale({
        orderId,
        code: result?.code || 'ECOMMERCE_CHECKOUT_START_FAILED',
        message: result?.message || result?.reason || 'No se pudo iniciar el cobro.',
        closeCanonicalCheckout: null,
        expectedCheckoutAttemptId: result?.checkoutAttemptId || null,
        releaseRemoteReservation: ['reserved', 'reserving', 'unknown'].includes(
          order.ecommerceRemoteConversionStatus
        ),
        releaseReason: 'checkout_start_failed',
        ownedAttemptId: attemptId,
        conversionContext
      });
    }
    return result;
  }, [checkout]);

  const handleProcessOrder = useCallback(async (paymentData) => {
    let order = getCurrentOrder();
    if (!isEcommerceOrder(order)) return checkout.handleProcessOrder(paymentData);

    const orderId = order.id;
    const ownedAttemptId = order.ecommerceConversionAttemptId;
    const expectedCheckoutAttemptId = order.ecommerceCanonicalCheckoutAttemptId;
    const storedSnapshot = order.ecommerceCheckoutSnapshot;
    const state = useAppStore.getState();
    const contextIdentity = getEcommercePosContextIdentity(state);
    const actorIdentity = getEcommerceActorIdentity(state);
    const conversionContext = buildConversionContext({
      order,
      attemptId: ownedAttemptId,
      actorIdentity
    });

    if (!isCheckoutTargetStillActive({ orderId }) || !isAttemptOwner(orderId, ownedAttemptId)) {
      return buildStaleAttemptResult();
    }

    if (!hasOwnedCheckoutLock(order, actorIdentity)) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_CHECKOUT_LOCK_LOST',
        message: 'El lock de cobro ya no pertenece a este intento.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        expectedCheckoutAttemptId,
        releaseRemoteReservation: true,
        releaseReason: 'checkout_lock_lost',
        ownedAttemptId,
        conversionContext
      });
    }

    if (
      !canPrepareEcommercePosDraft(state)
      || contextIdentity !== order.ecommerceLicenseIdentity
      || actorIdentity !== order.ecommerceConversionActorIdentity
    ) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_PERMISSION_DENIED',
        message: 'El actor o sus permisos cambiaron durante el cobro.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        expectedCheckoutAttemptId,
        releaseRemoteReservation: true,
        releaseReason: 'actor_or_permission_changed',
        ownedAttemptId,
        conversionContext
      });
    }

    const remote = await getEcommercePosConversionRemoteState({
      order,
      licenseDetails: state.licenseDetails
    });
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult();
    if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    if (
      remote.success === false
      || remote.claimOwned !== true
      || remote.claimValid !== true
      || remote.draftStatus !== 'prepared'
      || (remote.draftId && remote.draftId !== order.id)
      || !isSameRemoteReservation(order, remote)
    ) {
      const sameOwnedReservation = isSameRemoteReservation(order, remote);
      return failBeforeSale({
        orderId,
        code: remote.code || 'ECOMMERCE_CLAIM_LOST',
        message: remote.message || 'La reserva del pedido o de la conversión ya no pertenece a este intento.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        expectedCheckoutAttemptId,
        releaseRemoteReservation: sameOwnedReservation,
        releaseReason: 'remote_claim_or_reservation_lost',
        preserveReservation: remote.success === false
          || (remote.conversionStatus === 'reserved' && !sameOwnedReservation),
        ownedAttemptId,
        conversionContext
      });
    }

    const inventoryResult = await revalidateEcommerceDraftInventory({ orderId });
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult();
    if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    if (
      inventoryResult?.success !== true
      || inventoryResult?.stale === true
      || inventoryResult?.code === ECOMMERCE_INVENTORY_STALE_RESPONSE
    ) {
      return failBeforeSale({
        orderId,
        code: inventoryResult?.code || 'ECOMMERCE_INVENTORY_NOT_READY',
        message: 'El inventario cambió. Resuélvelo nuevamente.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        expectedCheckoutAttemptId,
        releaseRemoteReservation: true,
        releaseReason: 'inventory_changed_before_sale',
        ownedAttemptId,
        conversionContext
      });
    }

    order = getOrderById(orderId);
    if (!order) return buildStaleAttemptResult();

    let existingSale;
    try {
      existingSale = await findEcommerceSale({
        orderId: order.ecommerceOrderId,
        conversionKey: storedSnapshot?.ecommerceConversionKey
      });
    } catch {
      if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult();
      return failBeforeSale({
        orderId,
        code: ECOMMERCE_SALE_READ_FAILED,
        message: 'No se pudo comprobar si la venta ya fue registrada. No se liberó la reserva remota.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        expectedCheckoutAttemptId,
        preserveReservation: true,
        ownedAttemptId,
        conversionContext
      });
    }
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult();
    if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    if (existingSale || remote.convertedSaleId) {
      const saleId = existingSale?.id || remote.convertedSaleId;
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
        ecommerceConvertedSaleId: saleId,
        ecommerceRemoteConversionStatus: remote.conversionStatus || 'reserved',
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceConversionError: null
      });
      const closeResult = await checkout.handlePaymentModalClose({
        expectedOrderId: orderId,
        expectedCheckoutAttemptId
      });
      if (closeResult?.staleAttempt) return buildStaleAttemptResult(closeResult);
      return { success: true, saleId, idempotentReplay: true, confirmationPending: true };
    }

    const context = buildEligibilityContext({ order, remote, existingSale, state });
    const snapshotResult = buildSnapshotIgnoringTransientStatus(order, context);
    if (!snapshotResult.eligible) {
      return failBeforeSale({
        orderId,
        code: snapshotResult.code,
        message: snapshotResult.message,
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        expectedCheckoutAttemptId,
        releaseRemoteReservation: true,
        releaseReason: 'eligibility_changed_before_sale',
        ownedAttemptId,
        conversionContext
      });
    }

    if (!storedSnapshot || JSON.stringify(storedSnapshot) !== JSON.stringify(snapshotResult.snapshot)) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_INVENTORY_STALE',
        message: 'El pedido o su inventario cambió mientras elegías el pago.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        expectedCheckoutAttemptId,
        releaseRemoteReservation: true,
        releaseReason: 'snapshot_changed_before_sale',
        ownedAttemptId,
        conversionContext
      });
    }

    const ecommercePaymentData = {
      ...paymentData,
      saleDiscount: null,
      discount: null,
      __ecommerceCheckout: {
        origin: 'ecommerce',
        ecommerceOrderId: order.ecommerceOrderId,
        ecommerceOrderCode: order.ecommerceOrderCode || null,
        idempotencyKey: storedSnapshot.ecommerceConversionKey,
        snapshot: storedSnapshot
      }
    };

    let saleExecutionMode = 'unknown';
    try {
      const cloudDecision = await salesCloudCashierService.shouldUseCloudCashierSale({
        paymentData: ecommercePaymentData,
        cart: order.items,
        licenseDetails: state.licenseDetails
      });
      saleExecutionMode = cloudDecision?.useCloud
        ? (cloudDecision.mode || 'cloud')
        : 'local';
    } catch (error) {
      if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult();
      return failBeforeSale({
        orderId,
        code: error?.code || 'ECOMMERCE_SALE_MODE_VERIFICATION_FAILED',
        message: 'No se pudo determinar de forma segura cómo registrar la venta.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        expectedCheckoutAttemptId,
        releaseRemoteReservation: true,
        releaseReason: 'sale_mode_verification_failed',
        ownedAttemptId,
        conversionContext
      });
    }
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult();
    if (!isCheckoutTargetStillActive({ orderId })) return buildTargetChangedResult();

    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE, {
      ecommerceCheckoutGateStatus: 'authorized',
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceSaleExecutionMode: saleExecutionMode,
      ecommerceConversionRecoveryFromStatus: ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
      ecommerceConversionError: null
    });

    if (!isAttemptOwner(orderId, ownedAttemptId) || !isCheckoutTargetStillActive({ orderId })) {
      return buildStaleAttemptResult();
    }

    const saleResult = await checkout.handleProcessOrder(ecommercePaymentData, false);
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult(saleResult);

    if (saleResult?.success !== true) {
      const failureCode = saleResult?.errorType || saleResult?.code || 'PROCESS_SALE_FAILED';
      const inventoryChanged = [
        'ECOMMERCE_INVENTORY_CHANGED',
        'STOCK_WARNING',
        'RACE_CONDITION'
      ].includes(failureCode);
      const message = inventoryChanged
        ? 'El inventario cambió. Resuélvelo nuevamente.'
        : (saleResult?.message || 'No se pudo registrar la venta.');

      const latest = getOrderById(orderId);
      if (inventoryChanged && latest && isAttemptOwner(orderId, ownedAttemptId)) {
        useActiveOrders.getState().updateOrder(orderId, {
          ecommerceInventoryStatus: 'conflict',
          ecommerceInventoryResolvedAt: null,
          ecommerceInventoryError: {
            code: 'INVENTORY_CHANGED_DURING_CHECKOUT',
            message,
            occurredAt: new Date().toISOString()
          }
        });
      }

      if (failureCode === ECOMMERCE_SALE_READ_FAILED) {
        markUncertainSaleResult({
          orderId,
          code: ECOMMERCE_SALE_READ_FAILED,
          message: 'No se pudo comprobar si este pedido ya fue cobrado. La reserva se conserva.',
          ownedAttemptId
        });
        return { ...saleResult, preserveEcommerceReservation: true };
      }

      if (saleExecutionMode.startsWith('cloud')) {
        const recovery = await recoverEcommercePosConversion({ orderId });
        if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult(saleResult);
        if (recovery?.saleVerificationPending) {
          return {
            ...saleResult,
            code: ECOMMERCE_SALE_VERIFICATION_PENDING,
            errorType: ECOMMERCE_SALE_VERIFICATION_PENDING,
            preserveEcommerceReservation: true,
            recovery
          };
        }
        return { ...saleResult, recovery };
      }

      await failBeforeSale({
        orderId,
        code: failureCode,
        message,
        closeCanonicalCheckout: null,
        expectedCheckoutAttemptId,
        releaseRemoteReservation: true,
        releaseReason: inventoryChanged ? 'inventory_changed_during_sale' : 'process_sale_failed',
        ownedAttemptId,
        conversionContext
      });
      return saleResult;
    }

    const saleId = saleResult.saleId;
    order = getOrderById(orderId) || order;
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult(saleResult);

    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.SALE_CREATED, {
      ecommerceConvertedSaleId: saleId,
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceCheckoutGateStatus: 'blocked',
      ecommerceConversionError: null
    });

    const confirmation = await completeEcommercePosConversionRemote({
      order,
      saleId,
      attemptId: ownedAttemptId,
      conversionKey: storedSnapshot.ecommerceConversionKey,
      licenseDetails: state.licenseDetails
    });
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult(saleResult);

    if (confirmation.success === false) {
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
        ecommerceConvertedSaleId: saleId,
        ecommerceRemoteConversionStatus: 'reserved',
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceConversionError: {
          code: confirmation.code || 'REMOTE_CONFIRMATION_FAILED',
          message: confirmation.message || 'La venta fue registrada, pero falta confirmar el pedido online.'
        }
      });
      if (isAttemptOwner(orderId, ownedAttemptId)) {
        showMessageModal(
          'La venta fue registrada, pero falta confirmar el pedido online.',
          null,
          { type: 'warning' }
        );
      }
      return { ...saleResult, confirmationPending: true, confirmationError: confirmation };
    }

    await finalizeEcommerceConversionLocally({ orderId, saleId });
    if (getOrderById(orderId)) {
      showMessageModal('Pedido convertido en venta correctamente.', null, { type: 'success' });
    }
    return { ...saleResult, ecommerceConversionCompleted: true };
  }, [checkout]);

  const closeEcommerceCheckoutSafely = useCallback(async ({ closeCanonical, reason }) => {
    const order = getCurrentOrder();
    if (!isEcommerceOrder(order) || order.ecommerceConvertedSaleId) {
      return closeCanonical();
    }

    const orderId = order.id;
    const ownedAttemptId = order.ecommerceConversionAttemptId;
    const expectedCheckoutAttemptId = order.ecommerceCanonicalCheckoutAttemptId;
    const conversionContext = buildConversionContext({
      order,
      attemptId: ownedAttemptId,
      actorIdentity: order.ecommerceConversionActorIdentity
    });

    if (!isAttemptOwner(orderId, ownedAttemptId) || !isCheckoutTargetStillActive({ orderId })) {
      return buildStaleAttemptResult();
    }

    const cancellation = await releaseRemoteReservationBeforeSale({
      order,
      conversionContext,
      reason
    });
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult();

    const result = await closeCanonical({
      expectedOrderId: orderId,
      expectedCheckoutAttemptId
    });
    if (result?.staleAttempt) return buildStaleAttemptResult(result);
    if (!isAttemptOwner(orderId, ownedAttemptId)) return buildStaleAttemptResult(result);

    const cancellationUncertain = cancellation.success === false && cancellation.skipped !== true;
    updateEcommerceConversionState(
      orderId,
      cancellationUncertain ? ECOMMERCE_CONVERSION_STATUS.ERROR : ECOMMERCE_CONVERSION_STATUS.IDLE,
      {
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceRemoteConversionStatus: cancellationUncertain ? 'reserved' : 'idle',
        ...(cancellationUncertain ? {} : {
          ecommerceCheckoutSnapshot: null,
          ecommerceConversionAttemptId: null,
          ecommerceConversionActorIdentity: null,
          ecommerceCheckoutLockAttemptId: null,
          ecommerceCheckoutLockActorIdentity: null,
          ecommerceCanonicalCheckoutAttemptId: null
        }),
        ecommerceConversionError: cancellationUncertain ? {
          code: cancellation.code,
          message: 'El pago se cerró, pero falta liberar la reserva remota de conversión.'
        } : null
      }
    );
    return result;
  }, []);

  const handlePaymentModalClose = useCallback(() => closeEcommerceCheckoutSafely({
    closeCanonical: checkout.handlePaymentModalClose,
    reason: 'payment_cancelled'
  }), [checkout.handlePaymentModalClose, closeEcommerceCheckoutSafely]);

  const handleQuickCajaClose = useCallback(() => closeEcommerceCheckoutSafely({
    closeCanonical: checkout.handleQuickCajaClose,
    reason: 'quick_cash_cancelled'
  }), [checkout.handleQuickCajaClose, closeEcommerceCheckoutSafely]);

  const handleQuickCajaSubmit = useCallback(async (...args) => {
    const initialOrder = getCurrentOrder();
    const orderId = isEcommerceOrder(initialOrder) ? initialOrder.id : null;
    const ownedAttemptId = initialOrder?.ecommerceConversionAttemptId || null;
    const expectedCheckoutAttemptId = initialOrder?.ecommerceCanonicalCheckoutAttemptId || null;

    if (orderId && (!isAttemptOwner(orderId, ownedAttemptId) || !isCheckoutTargetStillActive({ orderId }))) {
      return buildStaleAttemptResult();
    }

    const result = await checkout.handleQuickCajaSubmit(...args);
    if (!orderId) return result;

    const order = getOrderById(orderId);
    if (
      result?.success !== false
      && isEcommerceOrder(order)
      && !order.ecommerceConvertedSaleId
      && isAttemptOwner(orderId, ownedAttemptId)
      && isCheckoutTargetStillActive({ orderId })
      && order.ecommerceCanonicalCheckoutAttemptId === expectedCheckoutAttemptId
    ) {
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING, {
        ecommerceCheckoutGateStatus: 'authorized',
        ecommerceRemoteConversionStatus: 'reserved'
      });
    }
    return result;
  }, [checkout]);

  return {
    ...checkout,
    handleInitiateCheckout,
    handleProcessOrder,
    handlePaymentModalClose,
    handleQuickCajaClose,
    handleQuickCajaSubmit
  };
}

export const ecommercePosCheckoutGateInternals = Object.freeze({
  STALE_CHECKOUT_ATTEMPT,
  createAttemptId,
  getCurrentOrder,
  getOrderById,
  isCheckoutTargetStillActive,
  isAttemptOwner,
  buildStaleAttemptResult,
  buildTargetChangedResult,
  isTargetChangedResult,
  isEcommerceOrder,
  isSameRemoteReservation,
  buildEligibilityContext,
  buildSnapshotIgnoringTransientStatus,
  buildConversionContext,
  releaseRemoteReservationBeforeSale,
  failBeforeSale,
  hasOwnedCheckoutLock,
  markUncertainSaleResult
});
