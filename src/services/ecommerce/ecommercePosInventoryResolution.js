import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import {
  revalidateEcommerceDraftInventory as revalidateRecipeInventory
} from './ecommercePosInventoryResolutionRecipeBase';

export * from './ecommercePosInventoryResolutionRecipeBase';

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? '').trim();

const getLineKey = (item = {}, index = 0) => asText(
  item.lineId
  ?? item.uniqueLineId
  ?? item.ecommerceOrderItemId
  ?? `${item.parentId || item.id || 'item'}:${index}`
);

const comparableResolution = (resolution = null) => resolution ? {
  mode: resolution.mode || null,
  status: resolution.status || null,
  code: resolution.code || null,
  requestedSaleQuantity: resolution.requestedSaleQuantity ?? null,
  requiredInventoryQuantity: resolution.requiredInventoryQuantity ?? null,
  requestedQuantity: resolution.requestedQuantity ?? null,
  availableQuantitySnapshot: resolution.availableQuantitySnapshot ?? null,
  batchId: resolution.batchId || null,
  batchNumber: resolution.batchNumber || null,
  expirationDate: resolution.expirationDate || null,
  selectionMode: resolution.selectionMode || null,
  sourceProductUpdatedAt: resolution.sourceProductUpdatedAt || null,
  details: resolution.details || null
} : null;

const comparableInventory = (order = {}) => ({
  ecommerceInventoryStatus: order.ecommerceInventoryStatus || 'pending',
  ecommerceInventoryConflictCount: Number(order.ecommerceInventoryConflictCount) || 0,
  ecommerceInventoryResolutionVersion: order.ecommerceInventoryResolutionVersion || null,
  ecommerceInventoryError: order.ecommerceInventoryError || null,
  items: asArray(order.items).map((item, index) => ({
    lineKey: getLineKey(item, index),
    productId: asText(item.parentId ?? item.id),
    quantity: Number(item.quantity) || 0,
    batchId: item.batchId || null,
    needsInventoryResolution: Boolean(item.needsInventoryResolution),
    inventoryResolution: comparableResolution(item.inventoryResolution)
  }))
});

const withoutVolatileInventoryTimes = (order = {}) => ({
  ...order,
  revision: null,
  updatedAt: null,
  ecommerceInventoryResolvedAt: null,
  items: asArray(order.items).map((item) => ({
    ...item,
    inventoryResolution: item.inventoryResolution ? {
      ...item.inventoryResolution,
      resolvedAt: null
    } : item.inventoryResolution
  }))
});

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const restoreStableInventoryTimestamps = ({ before, after }) => {
  if (!before || !after || !sameJson(comparableInventory(before), comparableInventory(after))) {
    return null;
  }

  const beforeByLine = new Map(asArray(before.items).map((item, index) => [
    getLineKey(item, index),
    item
  ]));
  const items = asArray(after.items).map((item, index) => {
    const previous = beforeByLine.get(getLineKey(item, index));
    if (!previous || !item.inventoryResolution) return item;
    if (!sameJson(
      comparableResolution(previous.inventoryResolution),
      comparableResolution(item.inventoryResolution)
    )) return item;

    const previousResolvedAt = previous.inventoryResolution?.resolvedAt || null;
    if ((item.inventoryResolution?.resolvedAt || null) === previousResolvedAt) return item;
    return {
      ...item,
      inventoryResolution: {
        ...item.inventoryResolution,
        resolvedAt: previousResolvedAt
      }
    };
  });

  return {
    ...after,
    items,
    ecommerceInventoryResolvedAt: before.ecommerceInventoryResolvedAt || null
  };
};

const persistStableInventoryTimestamps = ({ orderId, order }) => {
  const state = useActiveOrders.getState();
  const current = state.activeOrders?.get?.(orderId) || null;
  if (!current || typeof state.updateOrder !== 'function') return order;

  const timestampsChanged = current.ecommerceInventoryResolvedAt !== order.ecommerceInventoryResolvedAt
    || asArray(current.items).some((item, index) => (
      (item.inventoryResolution?.resolvedAt || null)
      !== (order.items?.[index]?.inventoryResolution?.resolvedAt || null)
    ));
  if (!timestampsChanged) return current;

  state.updateOrder(orderId, {
    items: order.items,
    ecommerceInventoryResolvedAt: order.ecommerceInventoryResolvedAt
  });
  return useActiveOrders.getState().activeOrders?.get?.(orderId) || order;
};

export const revalidateEcommerceDraftInventory = async (args = {}) => {
  const orderId = args.orderId;
  const before = orderId
    ? useActiveOrders.getState().activeOrders?.get?.(orderId) || null
    : null;
  const result = await revalidateRecipeInventory(args);
  if (!orderId || result?.success !== true || !before) return result;

  const after = result.order
    || useActiveOrders.getState().activeOrders?.get?.(orderId)
    || null;
  const restored = restoreStableInventoryTimestamps({ before, after });
  if (!restored) return result;

  const stableOrder = persistStableInventoryTimestamps({ orderId, order: restored });
  const onlyVolatileTimesChanged = sameJson(
    withoutVolatileInventoryTimes(before),
    withoutVolatileInventoryTimes(after)
  );

  return {
    ...result,
    changed: onlyVolatileTimesChanged ? false : result.changed,
    order: stableOrder,
    resolution: result.resolution ? {
      ...result.resolution,
      items: stableOrder.items,
      ecommerceInventoryResolvedAt: stableOrder.ecommerceInventoryResolvedAt
    } : result.resolution
  };
};

export const ecommercePosInventoryRevalidationStabilityInternals = Object.freeze({
  getLineKey,
  comparableResolution,
  comparableInventory,
  withoutVolatileInventoryTimes,
  restoreStableInventoryTimestamps
});