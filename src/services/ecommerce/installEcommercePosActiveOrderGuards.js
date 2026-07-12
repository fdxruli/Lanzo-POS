import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import {
  ECOMMERCE_CONVERSION_STATUS,
  buildEcommerceCheckoutSnapshot,
  getEcommerceCheckoutEligibility
} from './ecommercePosCheckoutConversion';
import {
  beginEcommercePosConversionRemote,
  findEcommerceSale,
  getEcommerceActorIdentity,
  getEcommerceClaimIdentity,
  getEcommercePosConversionRemoteState,
  updateEcommerceConversionState
} from './ecommercePosConversionService';
import {
  canPrepareEcommercePosDraft,
  getEcommercePosContextIdentity
} from './ecommercePosDraftService';
import {
  ECOMMERCE_INVENTORY_STALE_RESPONSE,
  revalidateEcommerceDraftInventory
} from './ecommercePosInventoryResolution';
import {
  getEcommercePosBlockedResult,
  isEcommercePosDraft,
  isEcommercePosEffectBlocked
} from './ecommercePosDraftGuards';

let installed = false;

const resolveOrder = (orderId, orderSnapshot = null) => {
  if (orderSnapshot) return orderSnapshot;
  const state = useActiveOrders.getState();
  const targetOrderId = orderId || state.currentOrderId;
  return targetOrderId ? state.activeOrders.get(targetOrderId) || null : null;
};

const failLockedEcommerceCheckout = async ({
  orderId,
  code,
  message,
  originalUnlockOrder,
  preserveAttempt = false,
  remoteConversionStatus = 'idle',
  snapshot = null
}) => {
  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.ERROR, {
    ecommerceCheckoutGateStatus: 'blocked',
    ecommerceCheckoutGateCode: code,
    ecommerceCheckoutGateMessage: message,
    ecommerceRemoteConversionStatus: remoteConversionStatus,
    ecommerceCheckoutSnapshot: preserveAttempt ? snapshot : null,
    ...(preserveAttempt ? {} : {
      ecommerceConversionAttemptId: null,
      ecommerceConversionActorIdentity: null
    }),
    ecommerceConversionError: { code, message }
  });
  await originalUnlockOrder(orderId);
  return { success: false, code, reason: message, message };
};

const isSameRemoteReservation = ({ remote, order }) => (
  remote?.conversionStatus === 'reserved'
  && remote?.conversionOwned === true
  && remote?.conversionAttemptId === order?.ecommerceConversionAttemptId
  && remote?.reservedSaleId === order?.id
);

const revalidateLockedEcommerceCheckout = async ({
  orderId,
  originalUnlockOrder
}) => {
  const state = useAppStore.getState();
  let order = resolveOrder(orderId);
  const contextIdentity = getEcommercePosContextIdentity(state);
  const permissionsAllowed = canPrepareEcommercePosDraft(state);

  if (!order || order.ecommerceCheckoutGateStatus !== 'authorized') {
    const blocked = getEcommercePosBlockedResult(order);
    return failLockedEcommerceCheckout({
      orderId,
      code: blocked.code,
      message: blocked.message,
      originalUnlockOrder
    });
  }

  const remote = await getEcommercePosConversionRemoteState({
    order,
    licenseDetails: state.licenseDetails
  });
  if (remote.success === false) {
    return failLockedEcommerceCheckout({
      orderId,
      code: remote.code,
      message: remote.message || 'No se pudo comprobar la propiedad remota del pedido.',
      originalUnlockOrder
    });
  }

  let existingSale;
  try {
    existingSale = await findEcommerceSale({
      orderId: order.ecommerceOrderId,
      conversionKey: order.ecommerceCheckoutSnapshot?.ecommerceConversionKey
    });
  } catch {
    return failLockedEcommerceCheckout({
      orderId,
      code: 'ECOMMERCE_SALE_READ_FAILED',
      message: 'No se pudo comprobar si el pedido ya tiene una venta registrada.',
      originalUnlockOrder,
      preserveAttempt: remote.conversionStatus === 'reserved',
      remoteConversionStatus: remote.conversionStatus || 'unknown',
      snapshot: order.ecommerceCheckoutSnapshot || null
    });
  }

  if (existingSale || remote.convertedSaleId) {
    const saleId = existingSale?.id || remote.convertedSaleId;
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
      ecommerceConvertedSaleId: saleId,
      ecommerceConversionAttemptId: order.ecommerceConversionAttemptId || remote.conversionAttemptId || null,
      ecommerceRemoteConversionStatus: remote.conversionStatus || 'reserved',
      ecommerceCheckoutGateStatus: 'blocked',
      ecommerceCheckoutGateCode: 'ECOMMERCE_ALREADY_CONVERTED',
      ecommerceCheckoutGateMessage: 'La venta ya existe; solo falta confirmar el pedido online.',
      ecommerceConversionError: null
    });
    await originalUnlockOrder(orderId);
    return {
      success: false,
      code: 'ECOMMERCE_ALREADY_CONVERTED',
      reason: 'La venta ya existe; no se volverá a cobrar.',
      saleId
    };
  }

  const sameRemoteReservation = isSameRemoteReservation({ remote, order });
  if (remote.conversionStatus === 'reserved' && !sameRemoteReservation) {
    return failLockedEcommerceCheckout({
      orderId,
      code: 'ECOMMERCE_POS_CONVERSION_IN_PROGRESS',
      message: 'Este pedido ya está reservado por otro intento de cobro.',
      originalUnlockOrder,
      preserveAttempt: true,
      remoteConversionStatus: 'reserved',
      snapshot: order.ecommerceCheckoutSnapshot || null
    });
  }

  const inventoryResult = await revalidateEcommerceDraftInventory({ orderId });
  if (
    inventoryResult?.success !== true
    || inventoryResult?.stale === true
    || inventoryResult?.code === ECOMMERCE_INVENTORY_STALE_RESPONSE
  ) {
    return failLockedEcommerceCheckout({
      orderId,
      code: inventoryResult?.code || 'ECOMMERCE_INVENTORY_NOT_READY',
      message: inventoryResult?.stale
        ? 'La orden cambió durante la comprobación. Vuelve a resolver el inventario.'
        : (inventoryResult?.message || 'El inventario cambió. Resuélvelo nuevamente.'),
      originalUnlockOrder
    });
  }

  order = resolveOrder(orderId);
  const eligibilityOrder = {
    ...order,
    ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.IDLE,
    ecommerceConvertedSaleId: null
  };
  const eligibilityContext = {
    contextIdentity,
    permissionsAllowed,
    claimOwned: remote.claimOwned === true && remote.claimValid === true,
    inventoryFresh: true,
    remoteContractVersion: remote.remoteContractVersion,
    remoteConvertedSaleId: remote.convertedSaleId || null,
    conversionInProgress: remote.conversionStatus === 'reserved' && !sameRemoteReservation,
    actorIdentity: getEcommerceActorIdentity(state),
    claimIdentity: getEcommerceClaimIdentity(order)
  };
  const eligibility = getEcommerceCheckoutEligibility(eligibilityOrder, eligibilityContext);
  if (!eligibility.eligible) {
    return failLockedEcommerceCheckout({
      orderId,
      code: eligibility.code,
      message: eligibility.message,
      originalUnlockOrder
    });
  }

  const snapshotResult = buildEcommerceCheckoutSnapshot(eligibilityOrder, eligibilityContext);
  if (!snapshotResult.eligible) {
    return failLockedEcommerceCheckout({
      orderId,
      code: snapshotResult.code,
      message: snapshotResult.message,
      originalUnlockOrder
    });
  }

  if (!order.ecommerceConversionAttemptId) {
    return failLockedEcommerceCheckout({
      orderId,
      code: 'ECOMMERCE_CONVERSION_ATTEMPT_MISSING',
      message: 'No se pudo identificar el intento de cobro.',
      originalUnlockOrder
    });
  }

  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.VALIDATING, {
    total: snapshotResult.snapshot.expectedTotal,
    ecommerceCheckoutGateStatus: 'authorized',
    ecommerceCheckoutGateCode: null,
    ecommerceCheckoutGateMessage: null,
    ecommerceRemoteContractVersion: remote.remoteContractVersion,
    ecommerceRemoteConversionStatus: sameRemoteReservation ? 'reserved' : 'reserving',
    ecommerceCheckoutSnapshot: snapshotResult.snapshot,
    ecommerceConversionError: null
  });
  order = resolveOrder(orderId);

  let reservation = sameRemoteReservation
    ? {
        success: true,
        remoteContractVersion: remote.remoteContractVersion,
        conversionStatus: 'reserved',
        conversionAttemptId: remote.conversionAttemptId,
        reservedSaleId: remote.reservedSaleId,
        conversionStartedAt: remote.conversionStartedAt,
        conversionKey: remote.conversionKey
      }
    : await beginEcommercePosConversionRemote({
        order,
        attemptId: order.ecommerceConversionAttemptId,
        saleId: order.id,
        conversionKey: snapshotResult.snapshot.ecommerceConversionKey,
        licenseDetails: state.licenseDetails
      });

  if (reservation.success === false) {
    const confirmed = await getEcommercePosConversionRemoteState({
      order,
      licenseDetails: state.licenseDetails
    });
    if (confirmed.success === true && isSameRemoteReservation({ remote: confirmed, order })) {
      reservation = {
        success: true,
        remoteContractVersion: confirmed.remoteContractVersion,
        conversionStatus: confirmed.conversionStatus,
        conversionAttemptId: confirmed.conversionAttemptId,
        reservedSaleId: confirmed.reservedSaleId,
        conversionStartedAt: confirmed.conversionStartedAt,
        conversionKey: confirmed.conversionKey
      };
    } else {
      const remoteStatus = confirmed.success === true
        ? confirmed.conversionStatus
        : 'unknown';
      return failLockedEcommerceCheckout({
        orderId,
        code: reservation.code || 'ECOMMERCE_POS_CONVERSION_RESERVATION_FAILED',
        message: reservation.message || 'No se pudo reservar el pedido para cobro.',
        originalUnlockOrder,
        preserveAttempt: remoteStatus !== 'idle',
        remoteConversionStatus: remoteStatus,
        snapshot: snapshotResult.snapshot
      });
    }
  }

  if (reservation.alreadyCompleted || reservation.convertedSaleId) {
    const saleId = reservation.convertedSaleId || order.id;
    updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING, {
      ecommerceConvertedSaleId: saleId,
      ecommerceRemoteConversionStatus: 'completed',
      ecommerceCheckoutGateStatus: 'blocked',
      ecommerceConversionError: null
    });
    await originalUnlockOrder(orderId);
    return {
      success: false,
      code: 'ECOMMERCE_ALREADY_CONVERTED',
      reason: 'El pedido ya fue convertido; no se volverá a cobrar.',
      saleId
    };
  }

  updateEcommerceConversionState(orderId, ECOMMERCE_CONVERSION_STATUS.VALIDATING, {
    total: snapshotResult.snapshot.expectedTotal,
    ecommerceRemoteContractVersion: reservation.remoteContractVersion,
    ecommerceRemoteConversionStatus: 'reserved',
    ecommerceRemoteConversionAttemptId: reservation.conversionAttemptId,
    ecommerceRemoteReservedSaleId: reservation.reservedSaleId,
    ecommerceRemoteConversionStartedAt: reservation.conversionStartedAt,
    ecommerceCheckoutSnapshot: snapshotResult.snapshot,
    ecommerceConversionError: null
  });

  return { success: true, ecommerceSnapshot: snapshotResult.snapshot };
};

export function installEcommercePosActiveOrderGuards() {
  if (installed) return;

  const initialState = useActiveOrders.getState();
  const originalUpdateOrderItems = initialState.updateOrderItems;
  const originalSaveOrderAsOpen = initialState.saveOrderAsOpen;
  const originalPauseOrder = initialState.pauseOrder;
  const originalCloseOrder = initialState.closeOrder;
  const originalLockOrderForCheckout = initialState.lockOrderForCheckout;
  const originalUnlockOrder = initialState.unlockOrder;
  const originalRemoveOrder = initialState.removeOrder;

  useActiveOrders.setState({
    updateOrderItems: (orderId, updater) => {
      const order = resolveOrder(orderId);
      if (isEcommercePosDraft(order)) return false;
      return originalUpdateOrderItems(orderId, updater);
    },
    saveOrderAsOpen: async (orderId, orderSnapshot = null) => {
      const order = resolveOrder(orderId, orderSnapshot);
      if (isEcommercePosEffectBlocked(order, 'save_open')) return getEcommercePosBlockedResult(order);
      return originalSaveOrderAsOpen(orderId, orderSnapshot);
    },
    pauseOrder: async (orderId) => {
      const order = resolveOrder(orderId);
      if (isEcommercePosEffectBlocked(order, 'pause')) return getEcommercePosBlockedResult(order);
      return originalPauseOrder(orderId);
    },
    closeOrder: async (orderId, paymentData) => {
      const order = resolveOrder(orderId);
      if (isEcommercePosEffectBlocked(order, 'close')) return getEcommercePosBlockedResult(order);
      return originalCloseOrder(orderId, paymentData);
    },
    lockOrderForCheckout: async (orderId) => {
      const order = resolveOrder(orderId);
      if (isEcommercePosEffectBlocked(order, 'checkout')) {
        const blocked = getEcommercePosBlockedResult(order);
        return { ...blocked, reason: blocked.message };
      }

      const lockResult = await originalLockOrderForCheckout(orderId);
      if (!lockResult?.success || !isEcommercePosDraft(order)) return lockResult;

      return revalidateLockedEcommerceCheckout({ orderId, originalUnlockOrder });
    },
    removeOrder: async (orderId) => {
      const order = resolveOrder(orderId);
      const status = order?.ecommerceConversionStatus;
      if (
        isEcommercePosDraft(order)
        && [
          ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
          ECOMMERCE_CONVERSION_STATUS.SALE_CREATED,
          ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
        ].includes(status)
      ) {
        return { success: true, preservedForEcommerceConfirmation: true };
      }
      return originalRemoveOrder(orderId);
    }
  });

  installed = true;
}

export const ecommercePosActiveOrderGuardsInternals = Object.freeze({
  resolveOrder,
  failLockedEcommerceCheckout,
  isSameRemoteReservation,
  revalidateLockedEcommerceCheckout,
  resetForTests: () => {
    installed = false;
  }
});
