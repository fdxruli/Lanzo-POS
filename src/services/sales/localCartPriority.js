import { normalizeStock } from '../db/utils';
import { getOperationalStockSnapshot } from '../inventoryStock';
import { getCartProductId } from '../../utils/cartLineIdentity';

/**
 * This is a provisional, per-runtime cart claim, NOT an inventory reservation.
 * Persisted OPEN sales are already represented by committedStock and must not
 * be subtracted twice. Only direct, individually sold stock is handled here.
 */
export const isDirectUnitCartItem = (item) => Boolean(
  item?.trackStock === true
  && (!item.saleType || item.saleType === 'unit')
  && !item.batchId
  && item.batchManagement?.enabled !== true
  && item.conversionFactor?.enabled !== true
  && !item.isVariant
  && !item.parentId
  && !item.recipeId
  && !item.recipe?.length
);

const keyOf = (item) => {
  if (!isDirectUnitCartItem(item)) return null;
  const productId = getCartProductId(item) || item.id;
  return productId == null ? null : String(productId);
};

const quantity = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const itemsFor = (order, productKey) => (order?.items || []).filter(
  (item) => keyOf(item) === productKey && quantity(item.quantity) > 0
);

const count = (items) => normalizeStock(items.reduce(
  (sum, item) => sum + quantity(item.quantity), 0
));

const priority = (order, items) => {
  const times = items.map((item) => item.provisionalAddedAt)
    .filter((time) => typeof time === 'string' && !Number.isNaN(Date.parse(time)));
  // Legacy drafts never stored the first item-add time. Their fallback is
  // deterministic, not a claim that their true historical order is known.
  return times.sort()[0] || order.updatedAt || order.createdAt || '';
};

const compareClaims = (a, b) => (
  a.priority.localeCompare(b.priority) || String(a.orderId).localeCompare(String(b.orderId))
);

const findStockRecord = (productKey, item, catalog = []) => {
  const fresh = Array.isArray(catalog)
    ? catalog.find((record) => String(record?.id) === productKey
      && record.trackStock === true && Number.isFinite(Number(record.stock)))
    : null;
  return fresh || item;
};

const stockSnapshot = (productKey, item, catalog) => {
  const stock = findStockRecord(productKey, item, catalog);
  // Cart line quantity is a request, never a substitute for missing physical stock.
  // getOperationalStockSnapshot accepts quantity for other record types, so fail
  // closed here unless the catalog/cart snapshot explicitly includes stock.
  if (stock?.stock == null || stock.stock === '') {
    return { physical: null, committed: null, available: null };
  }
  const snapshot = getOperationalStockSnapshot(stock);
  if (!snapshot.valid || snapshot.physicalStock < 0
    || snapshot.committedStock > snapshot.physicalStock + 0.00001) {
    return { physical: null, committed: null, available: null };
  }
  return {
    physical: snapshot.physicalStock,
    committed: snapshot.committedStock,
    available: snapshot.availableStock
  };
};

const claimsFor = (state, productKey, excludedOrderId = null) => {
  const claims = [];
  for (const [orderId, order] of state.activeOrders || []) {
    if (orderId === excludedOrderId || order?.isSaved || order?.origin === 'ecommerce') continue;
    const items = itemsFor(order, productKey);
    if (!items.length) continue;
    claims.push({
      orderId,
      order,
      items,
      quantity: count(items),
      priority: priority(order, items)
    });
  }
  return claims.sort(compareClaims);
};

const stockFailure = (product, snapshot, requested) => ({
  success: false,
  code: snapshot.physical === null ? 'LOCAL_STOCK_UNKNOWN'
    : requested > snapshot.physical ? 'LOCAL_NO_PHYSICAL_STOCK' : 'LOCAL_FORMAL_RESERVATION',
  product,
  requested,
  ...snapshot
});

const isSimpleDonorLine = (item) => (
  isDirectUnitCartItem(item)
  && (!Array.isArray(item.wholesaleTiers) || item.wholesaleTiers.length === 0)
  && !item.forceWholesale && !item.forceSafePrice
);

/** Evaluates an increase before ANY cart update; no side effects. */
export const evaluateProvisionalCartChange = ({
  state, orderId, nextItems, catalog = []
}) => {
  const destination = state.activeOrders?.get(orderId);
  if (!destination || destination.isSaved || destination.origin === 'ecommerce') return null;
  const previous = destination.items || [];
  const changedProductKeys = new Set((nextItems || []).map(keyOf).filter(Boolean));

  for (const productKey of changedProductKeys) {
    const before = count(previous.filter((item) => keyOf(item) === productKey));
    const targetItems = (nextItems || []).filter((item) => keyOf(item) === productKey);
    const after = count(targetItems);
    if (after <= before) continue;

    const product = targetItems[0];
    const snapshot = stockSnapshot(productKey, product, catalog);
    const others = claimsFor(state, productKey, orderId);
    const otherTotal = normalizeStock(others.reduce((sum, other) => sum + other.quantity, 0));

    if (snapshot.available === null || after > snapshot.available) {
      return stockFailure(product, snapshot, after);
    }
    const shortfall = normalizeStock(after + otherTotal - snapshot.available);
    if (shortfall <= 0) continue;
    if (!others.length) return stockFailure(product, snapshot, after);

    const donors = [];
    let remaining = shortfall;
    for (const claim of [...others].reverse()) {
      const locked = claim.order.isLockedForCheckout
        || claim.order.isSaved
        || claim.order.origin === 'ecommerce';
      const sameActor = Boolean(destination.actorKey && claim.order.actorKey
        && destination.actorKey === claim.order.actorKey);
      if (locked || !sameActor || claim.items.some((item) => !isSimpleDonorLine(item))) {
        return {
          success: false,
          code: locked ? 'LOCAL_SOURCE_CHECKOUT_LOCKED' : 'LOCAL_SOURCE_NOT_TRANSFERABLE',
          product, productKey, requested: after - before, ...snapshot
        };
      }
      for (let index = claim.order.items.length - 1; index >= 0 && remaining > 0; index--) {
        const item = claim.order.items[index];
        if (keyOf(item) !== productKey || !quantity(item.quantity)) continue;
        const units = Math.min(remaining, quantity(item.quantity));
        donors.push({
          orderId: claim.orderId, order: claim.order, lineIndex: index,
          units, name: claim.order.tableData || claim.order.name || String(claim.orderId)
        });
        remaining = normalizeStock(remaining - units);
      }
      if (remaining <= 0) break;
    }
    if (remaining > 0) return stockFailure(product, snapshot, after);

    return {
      success: false, code: 'LOCAL_PRIORITY_CONFLICT', product, productKey,
      requested: normalizeStock(after - before), before, after,
      shortfall, donors, ...snapshot
    };
  }
  return null;
};

/**
 * Only an EARLIER provisional cart can prevent this checkout. Normal physical
 * insufficiency stays with the existing inventory/finance checkout authority.
 * This guard is deliberately independent of the existing forceSale flag.
 */
export const validateCartCheckoutPriority = ({
  state, orderId, catalog = []
}) => {
  const target = state.activeOrders?.get(orderId);
  if (!target || target.isSaved || target.origin === 'ecommerce') return null;
  const keys = new Set((target.items || []).map(keyOf).filter(Boolean));

  for (const key of keys) {
    const targetItems = itemsFor(target, key);
    if (!targetItems.length) continue;
    const ownPriority = priority(target, targetItems);
    const ownQuantity = count(targetItems);
    const { available } = stockSnapshot(key, targetItems[0], catalog);
    if (available === null) continue; // Existing checkout engine validates unknown inventory.

    const earlier = claimsFor(state, key, orderId).filter((claim) => (
      compareClaims(claim, { orderId, priority: ownPriority }) < 0
    ));
    const earlierQuantity = normalizeStock(earlier.reduce((sum, claim) => sum + claim.quantity, 0));
    if (earlierQuantity > 0 && ownQuantity + earlierQuantity > available) {
      return {
        success: false,
        code: 'LOCAL_PRIORITY_CHECKOUT_BLOCKED',
        product: targetItems[0], available, ownQuantity, earlierQuantity,
        origin: earlier[0].order.tableData || earlier[0].order.name || earlier[0].orderId
      };
    }
  }
  return null;
};
