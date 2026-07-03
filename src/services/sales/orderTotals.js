import { calculateDiscountedTotals, validateDiscount } from './discounts';

const money = (value) => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
};

const itemsOf = (orderOrItems) => {
  if (Array.isArray(orderOrItems)) return orderOrItems;
  if (Array.isArray(orderOrItems && orderOrItems.items)) return orderOrItems.items;
  return [];
};

const saleDiscountOf = (orderOrItems, givenDiscount) => {
  if (givenDiscount !== undefined) return givenDiscount;
  if (!orderOrItems || Array.isArray(orderOrItems)) return null;
  return orderOrItems.saleDiscount || null;
};

const grossLineSubtotal = (item = {}) => (
  item.price !== undefined && item.quantity !== undefined
    ? money((item.price || 0) * (item.quantity || 0))
    : money(item.lineSubtotal ?? item.exactTotal ?? item.subtotal ?? 0)
);

const itemsForTotals = (items = []) => (
  (Array.isArray(items) ? items : []).map((item) => {
    const subtotal = grossLineSubtotal(item);
    return { ...item, lineSubtotal: subtotal, exactTotal: subtotal };
  })
);

export const getLineKey = (item = {}, index = 0) => (
  item.lineId || item.cartLineId || item.uniqueLineId || `${item.id || item.productId || 'item'}-${index}`
);

export const getLineSubtotalNumber = (item = {}) => grossLineSubtotal(item);

export const orderTotals = (orderOrItems = {}, givenDiscount = undefined) => {
  const items = itemsForTotals(itemsOf(orderOrItems));
  if (!items.some((item) => Number(item && item.quantity) > 0)) {
    return { items, subtotal: 0, lineDiscountTotal: 0, subtotalAfterLineDiscounts: 0, saleDiscount: null, saleDiscountAmount: 0, discountTotal: 0, total: 0 };
  }
  try { return calculateDiscountedTotals(items, saleDiscountOf(orderOrItems, givenDiscount)); }
  catch { return calculateDiscountedTotals(items, null); }
};

export const makeSaleDiscount = (orderOrItems = {}, input = {}, options = {}) => {
  const base = orderTotals(orderOrItems, null);
  return validateDiscount(input, { subtotal: base.subtotalAfterLineDiscounts, scope: 'sale', now: options.now || new Date().toISOString(), actor: options.actor || {} });
};

export const makeLineDiscount = (item = {}, input = {}, options = {}) => validateDiscount(input, {
  subtotal: getLineSubtotalNumber(item),
  scope: 'line',
  now: options.now || new Date().toISOString(),
  actor: options.actor || {}
});

export const withLineDiscount = (items = [], lineId, input = {}, options = {}) => (
  (Array.isArray(items) ? items : []).map((item, index) => {
    if (![getLineKey(item, index), item.lineId, item.cartLineId, item.uniqueLineId].includes(lineId)) return item;
    const discount = makeLineDiscount(item, input, options);
    const subtotal = getLineSubtotalNumber(item);
    const amount = money(discount?.amount || 0);
    const lineTotal = Math.max(0, money(subtotal - amount));
    return { ...item, discount, discountAmount: amount, discount_amount: amount, lineSubtotal: subtotal, exactTotal: subtotal, lineTotal, line_total: lineTotal };
  })
);

export const withoutLineDiscount = (items = [], lineId) => (
  (Array.isArray(items) ? items : []).map((item, index) => {
    if (![getLineKey(item, index), item.lineId, item.cartLineId, item.uniqueLineId].includes(lineId)) return item;
    const subtotal = getLineSubtotalNumber(item);
    return { ...item, discount: null, discountAmount: 0, discount_amount: 0, lineSubtotal: subtotal, exactTotal: subtotal, lineTotal: subtotal, line_total: subtotal };
  })
);

export const withOrderTotals = (order = {}, givenDiscount = undefined) => {
  const totals = orderTotals(order, givenDiscount);
  const discountTotal = money(totals.discountTotal);
  const subtotal = money(totals.subtotal);
  return { ...order, items: totals.items, subtotal, grossSubtotal: subtotal, subtotalAfterLineDiscounts: money(totals.subtotalAfterLineDiscounts), lineDiscountTotal: money(totals.lineDiscountTotal), saleDiscount: totals.saleDiscount || null, discountTotal, discount_total: discountTotal, total: money(totals.total) };
};

export const orderTotalsForSave = (order = {}) => {
  const normalized = withOrderTotals(order);
  return { subtotal: normalized.subtotal, grossSubtotal: normalized.grossSubtotal, subtotalAfterLineDiscounts: normalized.subtotalAfterLineDiscounts, lineDiscountTotal: normalized.lineDiscountTotal, saleDiscount: normalized.saleDiscount || null, discountTotal: normalized.discountTotal || 0, discount_total: normalized.discount_total || 0, total: normalized.total || 0 };
};

const discountSignature = (discount = null) => {
  if (!discount) return null;
  return {
    type: discount.type || null,
    value: money(discount.value),
    amount: money(discount.amount),
    reason: String(discount.reason ?? ''),
    scope: discount.scope || null,
    appliedAt: discount.appliedAt || discount.applied_at || null,
    appliedByRole: discount.appliedByRole || discount.applied_by_role || null,
    appliedByStaffUserId: discount.appliedByStaffUserId || discount.applied_by_staff_user_id || null,
    appliedByDeviceId: discount.appliedByDeviceId || discount.applied_by_device_id || null
  };
};

const sameDiscount = (current, next) => JSON.stringify(discountSignature(current)) === JSON.stringify(discountSignature(next));

const lineFinancialSignature = (item = {}, index = 0) => {
  const subtotal = grossLineSubtotal(item);
  const discountAmount = money(item.discountAmount ?? item.discount_amount ?? item.discount?.amount ?? 0);
  const fallbackLineTotal = Math.max(0, money(subtotal - discountAmount));

  return {
    key: getLineKey(item, index),
    subtotal,
    lineSubtotal: money(item.lineSubtotal ?? item.exactTotal ?? item.subtotal ?? subtotal),
    exactTotal: money(item.exactTotal ?? item.lineSubtotal ?? item.subtotal ?? subtotal),
    discountAmount,
    lineTotal: money(item.lineTotal ?? item.line_total ?? fallbackLineTotal),
    discount: discountSignature(item.discount || null)
  };
};

const hasSameLineFinancials = (currentItems = [], nextItems = []) => {
  const current = Array.isArray(currentItems) ? currentItems : [];
  const next = Array.isArray(nextItems) ? nextItems : [];
  if (current.length !== next.length) return false;

  return current.every((item, index) => (
    JSON.stringify(lineFinancialSignature(item, index)) === JSON.stringify(lineFinancialSignature(next[index], index))
  ));
};

export const hasSameFinancialTotals = (current = {}, next = {}) => (
  money(current.subtotal) === money(next.subtotal)
  && money(current.grossSubtotal ?? current.subtotal) === money(next.grossSubtotal ?? next.subtotal)
  && money(current.subtotalAfterLineDiscounts) === money(next.subtotalAfterLineDiscounts)
  && money(current.lineDiscountTotal) === money(next.lineDiscountTotal)
  && money(current.discountTotal ?? current.discount_total) === money(next.discountTotal ?? next.discount_total)
  && money(current.total) === money(next.total)
  && sameDiscount(current.saleDiscount, next.saleDiscount)
  && hasSameLineFinancials(current.items, next.items)
);
