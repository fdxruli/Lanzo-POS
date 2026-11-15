import Big from 'big.js';
import { buildMinimalConfiguredOrderItem } from './ecommerceConfiguredProduct';

const asMoney = (value) => {
  try {
    return new Big(value ?? 0).round(2).toFixed(2);
  } catch {
    return '0.00';
  }
};

const asNullableMoney = (value) => (
  value === null || value === undefined ? null : asMoney(value)
);

const normalizeAcceptedPricing = (pricing = {}) => ({
  pricingMode: pricing.pricingMode === 'wholesale' ? 'wholesale' : 'standard',
  baseUnitPrice: asMoney(pricing.baseUnitPrice),
  wholesaleBaseUnitPrice: asNullableMoney(pricing.wholesaleBaseUnitPrice),
  appliedUnitPrice: asMoney(pricing.appliedUnitPrice),
  wholesaleTierRef: typeof pricing.wholesaleTierRef === 'string'
    ? pricing.wholesaleTierRef.trim() || null
    : null,
  wholesaleMinQuantity: pricing.wholesaleMinQuantity !== null
    && pricing.wholesaleMinQuantity !== undefined
    && Number.isInteger(Number(pricing.wholesaleMinQuantity))
    ? Number(pricing.wholesaleMinQuantity)
    : null,
  variantAdjustment: asMoney(pricing.variantAdjustment),
  optionsAdjustment: asMoney(pricing.optionsAdjustment)
});

export function buildAcceptedEcommerceOrderItems(cartItems = []) {
  return (Array.isArray(cartItems) ? cartItems : []).map((item) => ({
    ...buildMinimalConfiguredOrderItem(item),
    acceptedPricing: {
      ...normalizeAcceptedPricing(item),
      lineTotal: asMoney(item?.lineTotal)
    }
  }));
}

const stableSelections = (selections = []) => (Array.isArray(selections) ? selections : [])
  .map((selection) => ({
    groupId: String(selection?.groupId || ''),
    optionIds: (Array.isArray(selection?.optionIds) ? selection.optionIds : [])
      .map((optionId) => String(optionId || ''))
      .sort()
  }))
  .sort((left, right) => left.groupId.localeCompare(right.groupId));

const economicIdentity = (items = []) => (Array.isArray(items) ? items : [])
  .map((item) => ({
    productId: String(item?.productId || ''),
    quantity: Number(item?.quantity),
    variantId: item?.variantId || null,
    selections: stableSelections(item?.selections),
    acceptedPricing: normalizeAcceptedPricing(item?.acceptedPricing || item)
  }))
  .sort((left, right) => (
    left.productId.localeCompare(right.productId)
    || String(left.variantId || '').localeCompare(String(right.variantId || ''))
    || JSON.stringify(left.selections).localeCompare(JSON.stringify(right.selections))
    || left.quantity - right.quantity
  ));

export function haveSameAcceptedEcommerceEconomics(acceptedItems, currentItems) {
  return JSON.stringify(economicIdentity(acceptedItems))
    === JSON.stringify(economicIdentity(buildAcceptedEcommerceOrderItems(currentItems)));
}

export function getAcceptedEcommerceSubtotal(items = []) {
  try {
    return (Array.isArray(items) ? items : []).reduce(
      (total, item) => total.plus(new Big(item?.acceptedPricing?.lineTotal ?? item?.lineTotal ?? 0)),
      new Big(0)
    ).toFixed(2);
  } catch {
    return '0.00';
  }
}
