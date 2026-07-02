import { getCartLineId } from '../../utils/cartLineIdentity';

const normalizeLineId = (value) => {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeRestaurantCloudStatus = (status) => {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'sent' || normalized === 'sent_to_kitchen') return 'pending';
  if (normalized === 'completed') return 'delivered';
  return normalized || 'pending';
};

export const getRestaurantCloudItemLocalLineId = (item = {}) => normalizeLineId(
  item.localLineId ||
  item.local_line_id ||
  item.lineId ||
  item.line_id ||
  item.cartItemId ||
  item.orderItemId ||
  item.uniqueLineId
);

export const getCancelledRestaurantCloudItems = (cloudItems = []) => (
  (Array.isArray(cloudItems) ? cloudItems : []).filter((item) => (
    normalizeRestaurantCloudStatus(item?.status) === 'cancelled'
  ))
);

export const buildCancelledRestaurantLineIdSet = (cloudItems = []) => {
  const ids = new Set();

  getCancelledRestaurantCloudItems(cloudItems).forEach((item) => {
    const lineId = getRestaurantCloudItemLocalLineId(item);
    if (lineId) ids.add(lineId);
  });

  return ids;
};

export const isCartItemCancelledByKitchen = (cartItem, index, cloudItems = []) => {
  const lineId = normalizeLineId(getCartLineId(cartItem, index));
  return Boolean(lineId && buildCancelledRestaurantLineIdSet(cloudItems).has(lineId));
};

export const reconcileCartWithCancelledRestaurantItems = (cartItems = [], cloudItems = []) => {
  const cancelledLineIds = buildCancelledRestaurantLineIdSet(cloudItems);
  const cancelledCloudItems = getCancelledRestaurantCloudItems(cloudItems);
  const removedLineIds = new Set();
  const removed = [];
  const kept = [];

  (Array.isArray(cartItems) ? cartItems : []).forEach((item, index) => {
    const lineId = normalizeLineId(getCartLineId(item, index));
    if (lineId && cancelledLineIds.has(lineId)) {
      removed.push(item);
      removedLineIds.add(lineId);
      return;
    }

    kept.push(item);
  });

  const unmatchedCancelledItems = cancelledCloudItems.filter((item) => {
    const lineId = getRestaurantCloudItemLocalLineId(item);
    return !lineId;
  });

  return {
    kept,
    removed,
    cancelledCloudItems,
    unmatchedCancelledItems,
    removedCount: removed.length,
    hasRemovableCancelledItems: removed.length > 0,
    hasUnmatchedCancelledItems: unmatchedCancelledItems.length > 0
  };
};
