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

export const orderTotals = (orderOrItems = {}, givenDiscount = undefined) => {
  const items = itemsOf(orderOrItems);
  if (!items.some((item) => Number(item && item.quantity) > 0)) {
    return { items, subtotal: 0, lineDiscountTotal: 0, subtotalAfterLineDiscounts: 0, saleDiscount: null, saleDiscountAmount: 0, discountTotal: 0, total: 0 };
  }

  try {
    return calculateDiscountedTotals(items, saleDiscountOf(orderOrItems, givenDiscount));
  } catch {
    return calculateDiscountedTotals(items, null);
  }
};

export const makeSaleDiscount = (orderOrItems = {}, input = {}, options = {}) => {
  const base = orderTotals(orderOrItems, null);
  return validateDiscount(input, {
    subtotal: base.subtotalAfterLineDiscounts,
    scope: 'sale',
    now: options.now || new Date().toISOString(),
    actor: options.actor || {}
  });
};

export const withOrderTotals = (order = {}, givenDiscount = undefined) => {
  const totals = orderTotals(order, givenDiscount);
  const discountTotal = money(totals.discountTotal);
  const subtotal = money(totals.subtotal);
  return {
    ...order,
    items: totals.items,
    subtotal,
    grossSubtotal: subtotal,
    subtotalAfterLineDiscounts: money(totals.subtotalAfterLineDiscounts),
    lineDiscountTotal: money(totals.lineDiscountTotal),
    saleDiscount: totals.saleDiscount || null,
    discountTotal,
    discount_total: discountTotal,
    total: money(totals.total)
  };
};

export const orderTotalsForSave = (order = {}) => {
  const normalized = withOrderTotals(order);
  return {
    subtotal: normalized.subtotal,
    grossSubtotal: normalized.grossSubtotal,
    subtotalAfterLineDiscounts: normalized.subtotalAfterLineDiscounts,
    lineDiscountTotal: normalized.lineDiscountTotal,
    saleDiscount: normalized.saleDiscount || null,
    discountTotal: normalized.discountTotal || 0,
    discount_total: normalized.discount_total || 0,
    total: normalized.total || 0
  };
};
