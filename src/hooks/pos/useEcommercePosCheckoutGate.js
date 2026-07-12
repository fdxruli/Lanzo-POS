import { useCallback } from 'react';
import { useActiveOrders } from './useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import { showMessageModal } from '../../services/utils';
import {
  ECOMMERCE_CONVERSION_STATUS,
  buildEcommerceCheckoutSnapshot,
  getEcommerceCheckoutEligibility
} from '../../services/ecommerce/ecommercePosCheckoutConversion';
import {
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

const buildEligibilityContext = ({ order, remote, existingSale = null, state = useAppStore.getState() }) => ({
  contextIdentity: getEcommercePosContextIdentity(state),
  permissionsAllowed: canPrepareEcommercePosDraft(state),
  claimOwned: remote?.claimOwned === true && remote?.claimValid === true,
  inventoryFresh: true,
  remoteContractVersion: remote?.remoteContractVersion || 0,
  remoteConvertedSaleId: remote?.convertedSaleId || null,
  existingSaleId: existingSale?.id || null,
  actorIdentity: getEcommerceActorIdentity(state),
  claimIdentity: getEcommerceClaimIdentity(order)
});

const buildSnapshotIgnoringTransientStatus = (order, context) => buildEcommerceCheckoutSnapshot({
  ...order,
  ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.IDLE,
  ecommerceConvertedSaleId: null
}, context);

const failBeforeSale = async ({
  orderId,
  code,
  message,
  closeCanonicalCheckout
}) => {
  if (typeof closeCanonicalCheckout === 'function') {
    await closeCanonicalCheckout();
  }
  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceCheckoutGateCode: code,
    ecommerceCheckoutGateMessage: message,
    ecommerceCheckoutSnapshot: null,
    ecommerceConversionError: { code, message }
  });
  showMessageModal(message, null, { type: 'warning' });
  return { success: false, code, message };
};

export function useEcommercePosCheckoutGate({ checkout }) {
  const handleInitiateCheckout = useCallback(async () => {
    let order = getCurrentOrder();
    if (!isEcommerceOrder(order)) return checkout.handleInitiateCheckout();

    const recovered = await recoverEcommercePosConversion({ orderId: order.id });
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

    const existingSale = await findEcommerceSale({ orderId: order.ecommerceOrderId });
    if (existingSale || remote.convertedSaleId) {
      const saleId = existingSale?.id || remote.convertedSaleId;
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
        ecommerceConvertedSaleId: saleId,
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
        closeCanonicalCheckout: null
      });
    }

    const attemptId = createAttemptId();
    updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.VALIDATING, {
      ecommerceConversionAttemptId: attemptId,
      ecommerceConversionActorIdentity: context.actorIdentity,
      ecommerceCheckoutGateStatus: 'authorized',
      ecommerceCheckoutGateCode: null,
      ecommerceCheckoutGateMessage: null,
      ecommerceRemoteContractVersion: remote.remoteContractVersion,
      ecommerceConversionError: null
    });

    const result = await checkout.handleInitiateCheckout();
    order = getCurrentOrder();
    if (result?.success === true && isEcommerceOrder(order)) {
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING, {
        ecommerceCheckoutGateStatus: 'authorized',
        ecommerceConversionError: null
      });
      return result;
    }

    if (isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.ERROR, {
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceCheckoutSnapshot: null,
        ecommerceConversionError: {
          code: result?.code || 'ECOMMERCE_CHECKOUT_START_FAILED',
          message: result?.message || result?.reason || 'No se pudo iniciar el cobro.'
        }
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

    if (
      !canPrepareEcommercePosDraft(state)
      || contextIdentity !== order.ecommerceLicenseIdentity
      || actorIdentity !== order.ecommerceConversionActorIdentity
    ) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_PERMISSION_DENIED',
        message: 'El actor o sus permisos cambiaron durante el cobro.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose
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
    ) {
      return failBeforeSale({
        orderId,
        code: remote.code || 'ECOMMERCE_CLAIM_LOST',
        message: remote.message || 'La reserva del pedido ya no pertenece a este dispositivo.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose
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
        closeCanonicalCheckout: checkout.handlePaymentModalClose
      });
    }

    order = getCurrentOrder();
    if (!order) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_DRAFT_NOT_FOUND',
        message: 'El borrador ya no está disponible.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose
      });
    }

    const existingSale = await findEcommerceSale({
      orderId: order.ecommerceOrderId,
      conversionKey: storedSnapshot?.ecommerceConversionKey
    });
    if (existingSale || remote.convertedSaleId) {
      const saleId = existingSale?.id || remote.convertedSaleId;
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
        ecommerceConvertedSaleId: saleId,
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
        closeCanonicalCheckout: checkout.handlePaymentModalClose
      });
    }

    if (!storedSnapshot || JSON.stringify(storedSnapshot) !== JSON.stringify(snapshotResult.snapshot)) {
      return failBeforeSale({
        orderId,
        code: 'ECOMMERCE_INVENTORY_STALE',
        message: 'El pedido o su inventario cambió mientras elegías el pago.',
        closeCanonicalCheckout: checkout.handlePaymentModalClose
      });
    }

    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE, {
      ecommerceCheckoutGateStatus: 'authorized',
      ecommerceConversionError: null
    });

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

    const saleResult = await checkout.handleProcessOrder(ecommercePaymentData, false);
    if (saleResult?.success !== true) {
      const inventoryChanged = [
        'ECOMMERCE_INVENTORY_CHANGED',
        'STOCK_WARNING',
        'RACE_CONDITION'
      ].includes(saleResult?.errorType || saleResult?.code);
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
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceCheckoutSnapshot: null,
        ecommerceConversionError: {
          code: saleResult?.errorType || saleResult?.code || 'PROCESS_SALE_FAILED',
          message
        }
      });
      return saleResult;
    }

    const saleId = saleResult.saleId;
    order = getCurrentOrder() || order;
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.SALE_CREATED, {
      ecommerceConvertedSaleId: saleId,
      ecommerceCheckoutGateStatus: 'blocked',
      ecommerceConversionError: null
    });

    const confirmation = await completeEcommercePosConversionRemote({
      order,
      saleId,
      conversionKey: storedSnapshot.ecommerceConversionKey,
      licenseDetails: state.licenseDetails
    });

    if (confirmation.success === false) {
      updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
        ecommerceConvertedSaleId: saleId,
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

  const handlePaymentModalClose = useCallback(async () => {
    const order = getCurrentOrder();
    const result = await checkout.handlePaymentModalClose();
    if (isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.IDLE, {
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceCheckoutSnapshot: null,
        ecommerceConversionAttemptId: null,
        ecommerceConversionActorIdentity: null,
        ecommerceConversionError: null
      });
    }
    return result;
  }, [checkout]);

  const handleQuickCajaClose = useCallback(async () => {
    const order = getCurrentOrder();
    const result = await checkout.handleQuickCajaClose();
    if (isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.IDLE, {
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceCheckoutSnapshot: null,
        ecommerceConversionAttemptId: null,
        ecommerceConversionActorIdentity: null,
        ecommerceConversionError: null
      });
    }
    return result;
  }, [checkout]);

  const handleQuickCajaSubmit = useCallback(async (...args) => {
    const result = await checkout.handleQuickCajaSubmit(...args);
    const order = getCurrentOrder();
    if (result?.success !== false && isEcommerceOrder(order) && !order.ecommerceConvertedSaleId) {
      updateEcommerceConversionState(order.id, ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING, {
        ecommerceCheckoutGateStatus: 'authorized'
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
  buildEligibilityContext,
  buildSnapshotIgnoringTransientStatus,
  failBeforeSale
});
