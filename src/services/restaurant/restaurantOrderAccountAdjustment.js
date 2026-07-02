import { db, STORES } from '../db/dexie';
import { SALE_STATUS } from '../sales/financialStats';
import { getCartLineId } from '../../utils/cartLineIdentity';
import {
  getCancelledRestaurantCloudItems,
  getRestaurantCloudItemLocalLineId,
  reconcileCartWithCancelledRestaurantItems
} from './restaurantOrderReconciliation';

export const KITCHEN_CANCELLED_ITEMS_REASON = 'kitchen_cancelled_items';

const normalizeText = (value) => String(value || '').trim();

const normalizeLineId = (value) => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};

const countSellableItems = (items = []) => (
  (Array.isArray(items) ? items : []).filter((item) => Number(item?.quantity) > 0).length
);

const getCloudItemId = (item = {}) => normalizeLineId(
  item.id || item.orderItemId || item.order_item_id || item.cloudItemId || item.cloud_item_id
);

const getCloudProductName = (item = {}) => normalizeText(
  item.productName || item.product_name || item.name || item.product?.name || 'Producto'
);

const getCloudStationName = (item = {}) => normalizeText(
  item.stationName || item.station_name || item.stationCode || item.station_code || 'Cocina'
);

const getLocalProductName = (item = {}) => normalizeText(
  item.name || item.productName || item.product_name || 'Producto'
);

const getUnitPrice = (item = {}) => {
  const price = Number(item.price ?? item.unitPrice ?? item.unit_price ?? 0);
  return Number.isFinite(price) ? price : 0;
};

const buildCancelledCloudItemMap = (cloudItems = []) => {
  const cancelledByLineId = new Map();

  getCancelledRestaurantCloudItems(cloudItems).forEach((item) => {
    const lineId = getRestaurantCloudItemLocalLineId(item);
    if (lineId && !cancelledByLineId.has(lineId)) {
      cancelledByLineId.set(lineId, item);
    }
  });

  return cancelledByLineId;
};

const buildRemovedAuditItems = ({ orderItems = [], removed = [], cloudItems = [] } = {}) => {
  const removedSet = new Set(Array.isArray(removed) ? removed : []);
  const cancelledCloudByLineId = buildCancelledCloudItemMap(cloudItems);

  return (Array.isArray(orderItems) ? orderItems : [])
    .map((item, index) => {
      const localLineId = normalizeLineId(getCartLineId(item, index));
      if (!localLineId || !removedSet.has(item)) return null;

      const cloudItem = cancelledCloudByLineId.get(localLineId) || {};

      return {
        localLineId,
        productName: getLocalProductName(item) || getCloudProductName(cloudItem),
        quantity: Number(item?.quantity || cloudItem?.quantity || 0),
        unitPrice: getUnitPrice(item),
        cloudItemId: getCloudItemId(cloudItem),
        stationName: getCloudStationName(cloudItem),
        status: 'cancelled'
      };
    })
    .filter(Boolean);
};

const buildHumanNote = (removedItems = []) => {
  const count = removedItems.length;
  const names = removedItems
    .map((item) => item.productName)
    .filter(Boolean)
    .slice(0, 5)
    .join(', ');
  const suffix = names ? `: ${names}` : '';
  return `Sistema: Se retiraron ${count} item(s) cancelados por cocina${suffix}.`;
};

export const applyKitchenCancelledItemsAdjustment = ({
  orderId,
  orderItems,
  cloudItems,
  reason = KITCHEN_CANCELLED_ITEMS_REASON
} = {}) => {
  const reconciliation = reconcileCartWithCancelledRestaurantItems(orderItems, cloudItems);

  if (reconciliation.hasUnmatchedCancelledItems) {
    return {
      success: false,
      code: 'KITCHEN_CANCELLED_ITEMS_UNMATCHED',
      message: 'Hay items cancelados en cocina que no se pudieron empatar con la cuenta local.',
      kept: Array.isArray(orderItems) ? orderItems : [],
      removed: [],
      removedCount: 0,
      reconciliation
    };
  }

  if (!reconciliation.hasRemovableCancelledItems) {
    return {
      success: true,
      changed: false,
      kept: Array.isArray(orderItems) ? orderItems : [],
      removed: [],
      removedCount: 0,
      audit: null,
      reconciliation
    };
  }

  if (countSellableItems(reconciliation.kept) === 0) {
    return {
      success: false,
      code: 'KITCHEN_CANCELLED_ITEMS_EMPTY_ACCOUNT',
      message: 'No quedan productos activos para cobrar. Anula la venta si cocina canceló toda la comanda.',
      kept: reconciliation.kept,
      removed: reconciliation.removed,
      removedCount: reconciliation.removedCount,
      reconciliation
    };
  }

  const removedItems = buildRemovedAuditItems({
    orderItems,
    removed: reconciliation.removed,
    cloudItems
  });
  const appliedAt = new Date().toISOString();
  const audit = {
    orderId: orderId || null,
    appliedAt,
    reason,
    removedItems,
    removedCount: reconciliation.removedCount,
    note: buildHumanNote(removedItems)
  };

  return {
    success: true,
    changed: true,
    kept: reconciliation.kept,
    removed: reconciliation.removed,
    removedCount: reconciliation.removedCount,
    audit,
    reconciliation
  };
};

const getRemovedItemKey = (item = {}) => (
  item.cloudItemId || item.localLineId || `${item.productName || 'item'}:${item.quantity || 0}:${item.stationName || 'Cocina'}`
);

const mergeRemovedItems = (previousItems = [], nextItems = []) => {
  const merged = [];
  const seen = new Set();

  [...(Array.isArray(previousItems) ? previousItems : []), ...(Array.isArray(nextItems) ? nextItems : [])]
    .forEach((item) => {
      const key = getRemovedItemKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });

  return merged;
};

const appendUniqueNote = (currentNotes, noteLine) => {
  const note = normalizeText(noteLine);
  if (!note) return currentNotes || '';

  const existing = typeof currentNotes === 'string' ? currentNotes.trim() : '';
  if (!existing) return note;
  if (existing.split('\n').map((line) => line.trim()).includes(note)) return existing;
  return `${existing}\n${note}`;
};

export const persistKitchenCancelledItemsAdjustment = async ({ orderId, audit } = {}) => {
  if (!orderId || !audit?.removedItems?.length) {
    return { success: true, skipped: true };
  }

  const salesTable = db.table(STORES.SALES);
  const existingSale = await salesTable.get(orderId);

  if (!existingSale) {
    return { success: false, message: 'No se encontró la venta abierta para guardar la auditoría.' };
  }

  if (existingSale.status !== SALE_STATUS.OPEN) {
    return { success: false, message: 'Solo se puede auditar el ajuste en ventas abiertas.' };
  }

  const previous = existingSale.restaurantKitchenReconciliation || {};
  const history = Array.isArray(previous.history) ? previous.history : [];
  const removedItems = mergeRemovedItems(previous.removedItems, audit.removedItems);

  await salesTable.update(orderId, {
    restaurantKitchenReconciliation: {
      ...previous,
      lastAppliedAt: audit.appliedAt,
      reason: audit.reason,
      removedItems,
      history: [...history, audit]
    },
    notes: appendUniqueNote(existingSale.notes, audit.note),
    updatedAt: new Date().toISOString()
  });

  return { success: true };
};
