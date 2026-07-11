import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import { useProductStore } from '../../store/useProductStore';
import {
  claimEcommerceOrderPosDraft,
  confirmEcommerceOrderPosDraft,
  releaseEcommerceOrderPosDraft
} from './ecommerceOrderService';

const PREPARE_FAILED = 'ECOMMERCE_POS_DRAFT_PREPARE_FAILED';
const PRODUCT_MISSING = 'ECOMMERCE_POS_DRAFT_PRODUCT_MISSING';
const preparePromises = new Map();

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
  code: 'ECOMMERCE_ORDERS_STALE_RESPONSE',
  message: 'La sesión cambió antes de completar la preparación.'
});

const releaseClaimSafely = async ({ licenseDetails, orderId, claimToken, reason }) => (
  releaseEcommerceOrderPosDraft({ licenseDetails, orderId, claimToken, reason })
);

async function runPrepareEcommerceOrderPosDraft({ order } = {}) {
  if (!order?.id || order.status !== 'accepted') {
    return { success: false, code: PREPARE_FAILED, message: 'Solo los pedidos aceptados pueden prepararse.' };
  }

  const startState = useAppStore.getState();
  const licenseIdentity = getEcommercePosContextIdentity(startState);
  if (!licenseIdentity) {
    return { success: false, code: 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' };
  }

  const isContextCurrent = () => getEcommercePosContextIdentity(useAppStore.getState()) === licenseIdentity;
  const licenseDetails = startState.licenseDetails;
  const draftId = getEcommercePosDraftId(order.id);
  const existing = useActiveOrders.getState().activeOrders.get(draftId);
  if (existing?.origin === 'ecommerce' && existing.ecommerceLicenseIdentity === licenseIdentity) {
    useActiveOrders.getState().switchOrder(draftId);
    return { success: true, created: false, draftId, order: existing };
  }

  let claimedOrder = order;
  let claimToken = order.posDraft?.isClaimedByCurrentActor ? order.posDraft?.claimToken : null;
  const canRecoverExisting = ['claimed', 'prepared'].includes(order.posDraft?.status) && claimToken;

  if (!canRecoverExisting) {
    const claimResult = await claimEcommerceOrderPosDraft({
      licenseDetails,
      orderId: order.id,
      requestKey: createRequestKey(order.id)
    });
    if (claimResult.success === false) return claimResult;
    claimedOrder = claimResult.order;
    claimToken = claimedOrder?.posDraft?.claimToken;
  }

  if (!claimToken) return { success: false, code: PREPARE_FAILED };
  if (!isContextCurrent()) {
    await releaseClaimSafely({ licenseDetails, orderId: order.id, claimToken, reason: 'stale_context' });
    return staleResult();
  }

  const mapped = mapEcommerceOrderToPosDraft({
    order: claimedOrder,
    products: useProductStore.getState().menu,
    licenseIdentity,
    claimToken
  });
  if (mapped.success === false) {
    await releaseClaimSafely({ licenseDetails, orderId: order.id, claimToken, reason: 'product_missing' });
    return mapped;
  }

  const upsertResult = useActiveOrders.getState().upsertEcommerceDraft(mapped.draft);
  if (upsertResult.success === false) {
    await releaseClaimSafely({ licenseDetails, orderId: order.id, claimToken, reason: 'local_prepare_failed' });
    return upsertResult;
  }

  if (!isContextCurrent()) {
    const releaseResult = await releaseClaimSafely({ licenseDetails, orderId: order.id, claimToken, reason: 'stale_context' });
    if (releaseResult.success !== false) useActiveOrders.getState().removeEcommerceDraftLocal(draftId);
    return staleResult();
  }

  if (claimedOrder.posDraft?.status !== 'prepared') {
    const confirmResult = await confirmEcommerceOrderPosDraft({
      licenseDetails,
      orderId: order.id,
      claimToken,
      draftId
    });
    if (confirmResult.success === false) {
      const releaseResult = await releaseClaimSafely({ licenseDetails, orderId: order.id, claimToken, reason: 'confirm_failed' });
      if (releaseResult.success !== false) useActiveOrders.getState().removeEcommerceDraftLocal(draftId);
      return confirmResult;
    }
  }

  if (!isContextCurrent()) {
    const releaseResult = await releaseClaimSafely({ licenseDetails, orderId: order.id, claimToken, reason: 'stale_context' });
    if (releaseResult.success !== false) useActiveOrders.getState().removeEcommerceDraftLocal(draftId);
    return staleResult();
  }

  useActiveOrders.getState().updateEcommerceDraftStatus(draftId, 'prepared');
  return { success: true, created: upsertResult.created, draftId, order: useActiveOrders.getState().activeOrders.get(draftId) };
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
