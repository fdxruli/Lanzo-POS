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

const releaseRemoteReservationBeforeSale = async ({ order, reason }) => {
  if (
    !isEcommerceOrder(order)
    || order.ecommerceConvertedSaleId
    || !order.ecommerceConversionAttemptId
    || !order.ecommerceCheckoutSnapshot?.ecommerceConversionKey
  ) {
    return { success: true, skipped: true };
  }

  return cancelEcommercePosConversionRemote({
    order,
    attemptId: order.ecommerceConversionAttemptId,
    saleId: order.id,
    conversionKey: order.ecommerceCheckoutSnapshot.ecommerceConversionKey,
    reason
  });
};

const failBeforeSale = async ({
  orderId,
  code,
  message,
  closeCanonicalCheckout,
  releaseRemoteReservation = false,
  releaseReason = 'failed_before_sale',
  preserveReservation = false
}) => {
  const order = useActiveOrders.getState().activeOrders.get(orderId) || null;
  let cancellation = { success: true, skipped: true };

  if (releaseRemoteReservation) {
    cancellation = await releaseRemoteReservationBeforeSale({ order, reason: releaseReason });
  }

  if (typeof closeCanonicalCheckout === 'function') {
    await closeCanonicalCheckout();
  }

  const cancellationUncertain = cancellation.success === false && cancellation.skipped !== true;
  const mustPreserve = preserveReservation || cancellationUncertain;
  const finalMessage = cancellationUncertain
    ? `${message} La reserva remota quedó pendiente de recuperación.`
    : message;

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
      ecommerceCheckoutLockActorIdentity: null
    }),
    ecommerceConversionError: {
      code: cancellationUncertain ? cancellation.code : code,
      message: finalMessage
    }
  });
  showMessageModal(finalMessage, null, { type: 'warning' });
  return { success: false, code, message: finalMessage, cancellation };
};

const hasOwnedCheckoutLock = (order, actorIdentity) => (
  order?.isLockedForCheckout === true
  && Boolean(order?.ecommerceConversionAttemptId)
  && order?.ecommerceCheckoutLockAttemptId === order.ecommerceConversionAttemptId
  && order?.ecommerceCheckoutLockActorIdentity === actorIdentity
  && order?.ecommerceConversionActorIdentity === actorIdentity
);

const markUncertainSaleResult = ({ orderId, code, message }) => {
  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceCheckoutGateCode: code,
    ecommerceCheckoutGateMessage: message,
    ecommerceRemoteConversionStatus: 'reserved',
    ecommerceConversionRecoveryFromStatus: ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
    ecommerceConversionError: { code, message }
  });
  showMessageModal(message, null, { type: 'warning' });
  return { success: false, code, message, saleVerificationPending: true };
};

export function useEcommercePosCheckoutGate({ checkout }) {
  const handleInitiateCheckout = useCallback(async () => {
    let order = getCurrentOrder();
    if (!isEcommerceOrder(order)) return checkout.handleInitiateCheckout();

    const recovered = await recoverEcommercePosConversion({ orderId: order.id });
    if (recovered?.success === false) {
      const message = recovered.message
        || order.ecommerceConversionError?.message
        || 'No se pudo recuperar el intento anterior de conversión.';
      showMessageModal(message, null, { type: 'warning' });
      return recovered;
    }

    order = getCurrentOrder();
    if (!order) return recovered;

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
    if (remote.success === false) {
      return failBeforeSale({
        orderId: order.id,
        code: remote.code,
        message: remote.message || 'No se pudo comprobar el pedido online.',
        closeCanonicalCheckout: null
      });
    }

    let existingSale;
    try {
      existingSale = await findEcommerceSale({ orderId: order.ecommerceOrderId });
    } catch {
      return failBeforeSale({
        orderId: order.id,
        code: ECOMMERCE_SALE_READ_FAILED,
        message: 'No se pudo comprobar si el pedido ya tiene una venta registrada.',
        closeCanonicalCheckout: null,
        preserveReservation: remote.conversionStatus === 'reserved'
      });
    }

    if (existingSale || remote.convertedSaleId) {
      const saleId = existingSale?.id || remote.convertedSaleId;
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
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
        orderId: order.id,
        code: eligibility.code,
        message: eligibility.message,
        closeCanonicalCheckout: null,
        preserveReservation: remote.conversionStatus === 'reserved'
      });
    }

    const attemptId = createAttemptId();
    const actorIdentity = context.actorIdentity;
    updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.VALIDATING, {
      ecommerceConversionAttemptId: attemptId,
      ecommerceConversionActorIdentity: actorIdentity,
      ecommerceCheckoutGateStatus: 'authorized',
      ecommerceCheckoutGateCode: null,
      ecommerceCheckoutGateMessage: null,
      ecommerceRemoteContractVersion: remote.remoteContractVersion,
      ecommerceRemoteConversionStatus: 'idle',
      ecommerceSaleExecutionMode: 'unknown',
      ecommerceConversionError: null
    });

    const result = await checkout.handleInitiateCheckout();
    order = getCurrentOrder();
    if (result?.success === true && isEcommerceOrder(order)) {
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING, {
        ecommerceCheckoutGateStatus: 'authorized',
        ecommerceRemoteConversionStatus: 'reserved',
        ecommerceCheckoutLockAttemptId: order.ecommerceConversionAttemptId,
        ecommerceCheckoutLockActorIdentity: order.ecommerceConversionActorIdentity,
        ecommerceConversionError: null
      });
      return result;
    }

    if (isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      return failBeforeSale({
        orderId: order.id,
        code: result?.code || 'ECOMMERCE_CHECKOUT_START_FAILED',
        message: result?.message || result?.reason || 'No se pudo iniciar el cobro.',
        closeCanonicalCheckout: null,
        releaseRemoteReservation: ['reserved', 'reserving', 'unknown'].includes(
          order.ecommerceRemoteConversionStatus
        ),
        releaseReason: 'checkout_start_failed'
      });
    }
    return result;
  }, [checkout]);

  const handleProcessOrder = useCallback(async (paymentData) => {
    let order = getCurrentOrder();
    if (!isEcommerceOrder(order)) return checkout.handleProcessOrder(paymentData);

    const orderId = order.id;
    const storedSnapshot = order.ecommerceCheckoutSnapshot;
    const state = useAppStore.getState();
    const contextIdentity = getEcommercePosContextIdentity(state);
    const actorIdentity = getEcommerceActorIdentity(state);

    if (!hasOwnedCheckoutLock(order, actorIdentity)) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_CHECKOUT_LOCK_LOST',
        message: 'El lock de cobro ya no pertenece a este intento.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        releaseRemoteReservation: true,
        releaseReason: 'checkout_lock_lost'
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
        releaseRemoteReservation: true,
        releaseReason: 'actor_or_permission_changed'
      });
    }

    const remote = await getEcommercePosConversionRemoteState({
      order,
      licenseDetails: state.licenseDetails
    });
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
        releaseRemoteReservation: sameOwnedReservation,
        releaseReason: 'remote_claim_or_reservation_lost',
        preserveReservation: remote.success === false
          || (remote.conversionStatus === 'reserved' && !sameOwnedReservation)
      });
    }

    const inventoryResult = await revalidateEcommerceDraftInventory({ orderId });
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
        releaseRemoteReservation: true,
        releaseReason: 'inventory_changed_before_sale'
      });
    }

    order = getCurrentOrder();
    if (!order) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_DRAFT_NOT_FOUND',
        message: 'El borrador ya no está disponible.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        preserveReservation: true
      });
    }

    let existingSale;
    try {
      existingSale = await findEcommerceSale({
        orderId: order.ecommerceOrderId,
        conversionKey: storedSnapshot?.ecommerceConversionKey
      });
    } catch {
      return failBeforeSale({
        orderId,
        code: ECOMMERCE_SALE_READ_FAILED,
        message: 'No se pudo comprobar si la venta ya fue registrada. No se liberó la reserva remota.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        preserveReservation: true
      });
    }

    if (existingSale || remote.convertedSaleId) {
      const saleId = existingSale?.id || remote.convertedSaleId;
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
        ecommerceConvertedSaleId: saleId,
        ecommerceRemoteConversionStatus: remote.conversionStatus || 'reserved',
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceConversionError: null
      });
      await checkout.handlePaymentModalClose();
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
        releaseRemoteReservation: true,
        releaseReason: 'eligibility_changed_before_sale'
      });
    }

    if (!storedSnapshot || JSON.stringify(storedSnapshot) !== JSON.stringify(snapshotResult.snapshot)) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_INVENTORY_STALE',
        message: 'El pedido o su inventario cambió mientras elegías el pago.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        releaseRemoteReservation: true,
        releaseReason: 'snapshot_changed_before_sale'
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
      return failBeforeSale({
        orderId,
        code: error?.code || 'ECOMMERCE_SALE_MODE_VERIFICATION_FAILED',
        message: 'No se pudo determinar de forma segura cómo registrar la venta.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose,
        releaseRemoteReservation: true,
        releaseReason: 'sale_mode_verification_failed'
      });
    }

    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE, {
      ecommerceCheckoutGateStatus: 'authorized',
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceSaleExecutionMode: saleExecutionMode,
      ecommerceConversionRecoveryFromStatus: ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
      ecommerceConversionError: null
    });

    const saleResult = await checkout.handleProcessOrder(ecommercePaymentData, false);
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

      const latest = getCurrentOrder();
      if (inventoryChanged && latest) {
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
          message: 'No se pudo comprobar si este pedido ya fue cobrado. La reserva se conserva.'
        });
        return { ...saleResult, preserveEcommerceReservation: true };
      }

      if (saleExecutionMode.startsWith('cloud')) {
        const recovery = await recoverEcommercePosConversion({ orderId });
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
        releaseRemoteReservation: true,
        releaseReason: inventoryChanged ? 'inventory_changed_during_sale' : 'process_sale_failed'
      });
      return saleResult;
    }

    const saleId = saleResult.saleId;
    order = getCurrentOrder() || order;
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.SALE_CREATED, {
      ecommerceConvertedSaleId: saleId,
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceCheckoutGateStatus: 'blocked',
      ecommerceConversionError: null
    });

    const confirmation = await completeEcommercePosConversionRemote({
      order,
      saleId,
      attemptId: order.ecommerceConversionAttemptId,
      conversionKey: storedSnapshot.ecommerceConversionKey,
      licenseDetails: state.licenseDetails
    });

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
      showMessageModal(
        'La venta fue registrada, pero falta confirmar el pedido online.',
        null,
        { type: 'warning' }
      );
      return { ...saleResult, confirmationPending: true, confirmationError: confirmation };
    }

    await finalizeEcommerceConversionLocally({ orderId, saleId });
    showMessageModal('Pedido convertido en venta correctamente.', null, { type: 'success' });
    return { ...saleResult, ecommerceConversionCompleted: true };
  }, [checkout]);

  const closeEcommerceCheckoutSafely = useCallback(async ({ closeCanonical, reason }) => {
    const order = getCurrentOrder();
    let cancellation = { success: true, skipped: true };
    if (isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      cancellation = await releaseRemoteReservationBeforeSale({ order, reason });
    }

    const result = await closeCanonical();
    if (isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      const cancellationUncertain = cancellation.success === false && cancellation.skipped !== true;
      updateEcommerceConversionState(
        order.id,
        cancellationUncertain ? ECOMMERCE_CONVERSION_STATUS.ERROR : ECOMMERCE_CONVERSION_STATUS.IDLE,
        {
          ecommerceCheckoutGateStatus: 'blocked',
          ecommerceRemoteConversionStatus: cancellationUncertain ? 'reserved' : 'idle',
          ...(cancellationUncertain ? {} : {
            ecommerceCheckoutSnapshot: null,
            ecommerceConversionAttemptId: null,
            ecommerceConversionActorIdentity: null,
            ecommerceCheckoutLockAttemptId: null,
            ecommerceCheckoutLockActorIdentity: null
          }),
          ecommerceConversionError: cancellationUncertain ? {
            code: cancellation.code,
            message: 'El pago se cerró, pero falta liberar la reserva remota de conversión.'
          } : null
        }
      );
    }
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
    const result = await checkout.handleQuickCajaSubmit(...args);
    const order = getCurrentOrder();
    if (result?.success !== false && isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING, {
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
  createAttemptId,
  getCurrentOrder,
  isEcommerceOrder,
  isSameRemoteReservation,
  buildEligibilityContext,
  buildSnapshotIgnoringTransientStatus,
  releaseRemoteReservationBeforeSale,
  failBeforeSale,
  hasOwnedCheckoutLock,
  markUncertainSaleResult
});
