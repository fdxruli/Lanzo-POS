import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import { useProductStore } from '../../store/useProductStore';
import {
  claimEcommerceOrderPosDraft,
  confirmEcommerceOrderPosDraft,
  getEcommerceOrder,
  releaseEcommerceOrderPosDraft
} from './ecommerceOrderService';

const PREPARE_FAILED = 'ECOMMERCE_POS_DRAFT_PREPARE_FAILED';
const PRODUCT_MISSING = 'ECOMMERCE_POS_DRAFT_PRODUCT_MISSING';
const REMOTE_CONFLICT = 'ECOMMERCE_POS_DRAFT_REMOTE_CONFLICT';
const preparePromises = new Map();
const releaseRecoveryClaims = new Map();

const stableHash = (value) => {
  const text = String(value || '');
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1, h2, h3, h4].map((part) => (part >>> 0).toString(36).padStart(7, '0')).join('');
};

const getLicenseKey = (licenseDetails = {}) => {
  const details = licenseDetails || {};
  return (
    details.license_key ||
    details.licenseKey ||
    details.details?.license_key ||
    details.details?.licenseKey ||
    ''
  );
};

const getStaffId = (state = {}) => {
  const staff = state.currentStaffUser || {};
  return staff.id || staff.staff_user_id || staff.user_id || staff.username || 'none';
};

export const canPrepareEcommercePosDraft = (state = useAppStore.getState()) => {
  if (state.currentDeviceRole === 'admin') return true;
  if (state.currentDeviceRole !== 'staff') return false;
  return state.currentStaffUser?.permissions?.ecommerce === true
    && state.currentStaffUser?.permissions?.pos === true;
};

export const getEcommercePosContextIdentity = (state = useAppStore.getState()) => {
  const licenseKey = getLicenseKey(state.licenseDetails);
  if (!licenseKey || !canPrepareEcommercePosDraft(state)) return null;

  const actor = [
    state.currentDeviceRole,
    getStaffId(state),
    state.currentStaffUser?.permissions?.ecommerce === true ? 'e1' : 'e0',
    state.currentStaffUser?.permissions?.pos === true ? 'p1' : 'p0'
  ].join(':');
  return `ecomctx-${stableHash(`${licenseKey}:${actor}`)}`;
};

export const getEcommercePosDraftId = (orderId) => `ecom-${String(orderId || '').trim()}`;

const isDeletedOrInactive = (product = {}) => (
  product.isActive === false ||
  product.is_active === false ||
  Boolean(product.deletedAt || product.deleted_at || product.deletedTimestamp) ||
  ['inactive', 'deleted', 'archived'].includes(String(product.status || '').toLowerCase())
);

const needsInventoryResolution = (product = {}) => Boolean(
  product.batchManagement?.enabled ||
  product.batch_management?.enabled ||
  product.expirationMode === 'batch' ||
  product.expiration_mode === 'batch'
);

export const mapEcommerceOrderToPosDraft = ({ order, products, licenseIdentity, claimToken }) => {
  const productMap = new Map((Array.isArray(products) ? products : []).map((product) => [String(product?.id || ''), product]));
  const missingProducts = [];
  const lines = [];

  for (const item of order?.items || []) {
    const sourceProductId = String(item?.sourceProductId || '').trim();
    const product = sourceProductId ? productMap.get(sourceProductId) : null;
    if (!sourceProductId || !product || isDeletedOrInactive(product)) {
      missingProducts.push({
        orderItemId: item?.id || null,
        sourceProductId: sourceProductId || null,
        productName: item?.productName || 'Producto'
      });
      continue;
    }

    const currentPosPrice = Number(product.price) || 0;
    const snapshotPrice = Number(item.unitPrice) || 0;
    lines.push({
      ...product,
      lineId: `ecom-${order.id}-${item.id}`,
      uniqueLineId: `ecom-${order.id}-${item.id}`,
      quantity: Number(item.quantity) || 0,
      price: snapshotPrice,
      currentPosPrice,
      ecommerceOrderItemId: item.id,
      ecommerceSnapshotName: item.productName,
      ecommerceSnapshotPrice: snapshotPrice,
      ecommerceOptions: item.options || {},
      priceSource: 'ecommerce_snapshot',
      origin: 'ecommerce',
      needsInventoryResolution: needsInventoryResolution(product),
      batchId: undefined
    });
  }

  if (missingProducts.length > 0 || lines.length !== (order?.items || []).length) {
    return { success: false, code: PRODUCT_MISSING, missingProducts };
  }

  const draftId = getEcommercePosDraftId(order.id);
  return {
    success: true,
    draft: {
      id: draftId,
      items: lines,
      origin: 'ecommerce',
      ecommerceOrderId: order.id,
      ecommerceOrderCode: order.code,
      ecommerceLicenseIdentity: licenseIdentity,
      ecommerceDraftStatus: order.posDraft?.status === 'prepared' ? 'prepared' : 'claimed',
      ecommerceClaimToken: claimToken,
      fulfillmentMethod: order.fulfillmentMethod,
      expectedSubtotal: order.totals?.subtotal,
      expectedDeliveryFee: order.totals?.deliveryFee,
      expectedDiscountTotal: order.totals?.discountTotal,
      expectedTaxTotal: order.totals?.taxTotal,
      expectedTotal: order.totals?.total,
      currency: order.totals?.currency || 'MXN'
    }
  };
};

const createRequestKey = (orderId) => {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ecom-pos-1:${orderId}:${randomPart}`;
};

const staleResult = () => ({
  success: false,
  stale: true,
  refreshRequired: true,
  code: 'ECOMMERCE_ORDERS_STALE_RESPONSE',
  message: 'La sesión cambió antes de completar la preparación.'
});

const conflictResult = (message = 'El estado del borrador cambió. Recarga el pedido antes de continuar.') => ({
  success: false,
  refreshRequired: true,
  code: REMOTE_CONFLICT,
  message
});

const releaseClaimSafely = async ({ licenseDetails, orderId, claimToken, reason }) => (
  releaseEcommerceOrderPosDraft({ licenseDetails, orderId, claimToken, reason })
);

const removeLocalDraft = (draftId) => {
  const local = useActiveOrders.getState().activeOrders.get(draftId);
  if (local?.origin === 'ecommerce') {
    useActiveOrders.getState().removeEcommerceDraftLocal(draftId);
  }
};

const rememberReleaseRecovery = ({ orderId, draftId, claimToken, licenseIdentity }) => {
  if (!orderId || !claimToken) return;
  releaseRecoveryClaims.set(orderId, { orderId, draftId, claimToken, licenseIdentity });

  const local = draftId ? useActiveOrders.getState().activeOrders.get(draftId) : null;
  if (local?.origin === 'ecommerce') {
    useActiveOrders.getState().updateOrder(draftId, {
      ecommerceDraftStatus: 'error_releasing',
      ecommerceClaimToken: claimToken,
      ecommerceReleaseRecoveryRequired: true
    });
  }
};

const cleanupClaimAfterFailure = async ({
  licenseDetails,
  orderId,
  draftId,
  claimToken,
  licenseIdentity,
  reason
}) => {
  const releaseResult = await releaseClaimSafely({ licenseDetails, orderId, claimToken, reason });
  if (releaseResult.success !== false) {
    releaseRecoveryClaims.delete(orderId);
    removeLocalDraft(draftId);
    return { released: true, releaseResult };
  }

  rememberReleaseRecovery({ orderId, draftId, claimToken, licenseIdentity });
  return { released: false, releaseResult };
};

const localMatchesPreparedRemote = ({ local, remoteOrder, draftId, licenseIdentity }) => (
  local?.origin === 'ecommerce'
  && remoteOrder?.status === 'accepted'
  && remoteOrder?.posDraft?.status === 'prepared'
  && remoteOrder?.posDraft?.isClaimedByCurrentActor === true
  && Boolean(remoteOrder?.posDraft?.claimToken)
  && remoteOrder.posDraft.draftId === draftId
  && local.id === draftId
  && local.ecommerceOrderId === remoteOrder.id
  && local.ecommerceLicenseIdentity === licenseIdentity
  && local.ecommerceClaimToken === remoteOrder.posDraft.claimToken
  && local.ecommerceDraftStatus === 'prepared'
);

export async function retryReleaseEcommerceDraft({ orderId, draftId } = {}) {
  const state = useAppStore.getState();
  const licenseIdentity = getEcommercePosContextIdentity(state);
  if (!licenseIdentity) {
    return { success: false, code: 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' };
  }

  const resolvedDraftId = draftId || getEcommercePosDraftId(orderId);
  const local = useActiveOrders.getState().activeOrders.get(resolvedDraftId);
  const recovery = releaseRecoveryClaims.get(orderId) || (
    local?.origin === 'ecommerce'
      ? {
          orderId: local.ecommerceOrderId,
          draftId: resolvedDraftId,
          claimToken: local.ecommerceClaimToken,
          licenseIdentity: local.ecommerceLicenseIdentity
        }
      : null
  );

  if (!recovery?.orderId || !recovery?.claimToken || recovery.licenseIdentity !== licenseIdentity) {
    return conflictResult('No existe una reserva local válida para reintentar la liberación.');
  }

  const result = await releaseClaimSafely({
    licenseDetails: state.licenseDetails,
    orderId: recovery.orderId,
    claimToken: recovery.claimToken,
    reason: 'retry_release'
  });

  if (result.success === false) {
    rememberReleaseRecovery(recovery);
    return result;
  }

  releaseRecoveryClaims.delete(recovery.orderId);
  removeLocalDraft(recovery.draftId);
  return result;
}

async function runPrepareEcommerceOrderPosDraft({ order } = {}) {
  if (!order?.id) {
    return { success: false, code: PREPARE_FAILED, message: 'No se encontró el pedido.' };
  }

  const startState = useAppStore.getState();
  const licenseIdentity = getEcommercePosContextIdentity(startState);
  if (!licenseIdentity) {
    return { success: false, code: 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' };
  }

  const isContextCurrent = () => getEcommercePosContextIdentity(useAppStore.getState()) === licenseIdentity;
  const licenseDetails = startState.licenseDetails;
  const draftId = getEcommercePosDraftId(order.id);

  const detailResult = await getEcommerceOrder({ licenseDetails, orderId: order.id });
  if (detailResult.success === false) return detailResult;
  if (!isContextCurrent()) return staleResult();

  let remoteOrder = detailResult.order;
  const activeOrders = useActiveOrders.getState();
  const existing = activeOrders.activeOrders.get(draftId);

  if (remoteOrder?.status !== 'accepted') {
    removeLocalDraft(draftId);
    return {
      success: false,
      refreshRequired: true,
      code: 'ECOMMERCE_ORDER_INVALID_TRANSITION',
      message: 'Solo los pedidos aceptados pueden prepararse.'
    };
  }

  const remoteStatus = remoteOrder?.posDraft?.status || 'none';
  const isRemoteOwner = remoteOrder?.posDraft?.isClaimedByCurrentActor === true;
  const remoteToken = remoteOrder?.posDraft?.claimToken || null;

  if (localMatchesPreparedRemote({ existing, remoteOrder, draftId, licenseIdentity })) {
    activeOrders.switchOrder(draftId);
    return { success: true, created: false, draftId, order: existing };
  }

  if (existing?.origin === 'ecommerce') {
    removeLocalDraft(draftId);
  }

  if (remoteStatus === 'prepared' && isRemoteOwner && remoteOrder?.posDraft?.draftId !== draftId) {
    return conflictResult('El identificador remoto del borrador no coincide con la copia local. Recarga el pedido.');
  }

  if (remoteStatus === 'prepared' && !isRemoteOwner) {
    return {
      success: false,
      refreshRequired: true,
      code: 'ECOMMERCE_POS_DRAFT_ALREADY_PREPARED',
      message: 'Este pedido fue preparado en otro dispositivo.'
    };
  }

  if (remoteStatus === 'claimed' && !isRemoteOwner) {
    return {
      success: false,
      refreshRequired: true,
      code: 'ECOMMERCE_POS_DRAFT_IN_PROGRESS',
      message: 'Este pedido está en preparación en otro dispositivo.'
    };
  }

  if (!['none', 'released', 'claimed', 'prepared'].includes(remoteStatus)) {
    return conflictResult();
  }

  if (['claimed', 'prepared'].includes(remoteStatus) && (!isRemoteOwner || !remoteToken)) {
    return conflictResult();
  }

  let claimToken = isRemoteOwner ? remoteToken : null;

  if (!claimToken) {
    const claimResult = await claimEcommerceOrderPosDraft({
      licenseDetails,
      orderId: remoteOrder.id,
      requestKey: createRequestKey(remoteOrder.id)
    });
    if (claimResult.success === false) return claimResult;
    remoteOrder = claimResult.order;
    claimToken = remoteOrder?.posDraft?.claimToken;
  }

  if (!claimToken) return { success: false, code: PREPARE_FAILED };
  if (!isContextCurrent()) {
    await cleanupClaimAfterFailure({
      licenseDetails,
      orderId: remoteOrder.id,
      draftId,
      claimToken,
      licenseIdentity,
      reason: 'stale_context'
    });
    return staleResult();
  }

  const mapped = mapEcommerceOrderToPosDraft({
    order: remoteOrder,
    products: useProductStore.getState().menu,
    licenseIdentity,
    claimToken
  });
  if (mapped.success === false) {
    const cleanup = await cleanupClaimAfterFailure({
      licenseDetails,
      orderId: remoteOrder.id,
      draftId,
      claimToken,
      licenseIdentity,
      reason: 'product_missing'
    });
    return { ...mapped, releaseRecoveryRequired: !cleanup.released };
  }

  const upsertResult = useActiveOrders.getState().upsertEcommerceDraft(mapped.draft);
  if (upsertResult.success === false) {
    const cleanup = await cleanupClaimAfterFailure({
      licenseDetails,
      orderId: remoteOrder.id,
      draftId,
      claimToken,
      licenseIdentity,
      reason: 'local_prepare_failed'
    });
    return { ...upsertResult, releaseRecoveryRequired: !cleanup.released };
  }

  if (!isContextCurrent()) {
    const cleanup = await cleanupClaimAfterFailure({
      licenseDetails,
      orderId: remoteOrder.id,
      draftId,
      claimToken,
      licenseIdentity,
      reason: 'stale_context'
    });
    return { ...staleResult(), releaseRecoveryRequired: !cleanup.released };
  }

  if (remoteOrder.posDraft?.status !== 'prepared') {
    const confirmResult = await confirmEcommerceOrderPosDraft({
      licenseDetails,
      orderId: remoteOrder.id,
      claimToken,
      draftId
    });
    if (confirmResult.success === false) {
      const cleanup = await cleanupClaimAfterFailure({
        licenseDetails,
        orderId: remoteOrder.id,
        draftId,
        claimToken,
        licenseIdentity,
        reason: 'confirm_failed'
      });
      return { ...confirmResult, releaseRecoveryRequired: !cleanup.released };
    }
  }

  if (!isContextCurrent()) {
    const cleanup = await cleanupClaimAfterFailure({
      licenseDetails,
      orderId: remoteOrder.id,
      draftId,
      claimToken,
      licenseIdentity,
      reason: 'stale_context'
    });
    return { ...staleResult(), releaseRecoveryRequired: !cleanup.released };
  }

  releaseRecoveryClaims.delete(remoteOrder.id);
  useActiveOrders.getState().updateEcommerceDraftStatus(draftId, 'prepared');
  return {
    success: true,
    created: upsertResult.created,
    draftId,
    order: useActiveOrders.getState().activeOrders.get(draftId)
  };
}

export function prepareEcommerceOrderPosDraft({ order } = {}) {
  const contextIdentity = getEcommercePosContextIdentity(useAppStore.getState());
  const key = `${contextIdentity || 'none'}:${order?.id || 'missing'}`;
  if (preparePromises.has(key)) return preparePromises.get(key);

  const request = runPrepareEcommerceOrderPosDraft({ order });
  preparePromises.set(key, request);
  return request.finally(() => {
    if (preparePromises.get(key) === request) preparePromises.delete(key);
  });
}
