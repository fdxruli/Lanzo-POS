import Big from 'big.js';
import { buildMinimalConfiguredOrderItem } from './ecommerceConfiguredProduct';

const MONEY_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const MAX_MONEY = new Big('9999999999.99');
const MIN_MONEY = MAX_MONEY.times(-1);
const MAX_QUANTITY = 9999999999.99;

const asMoney = (value, { allowNegative = false } = {}) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!text || text.length > 64 || !MONEY_PATTERN.test(text)) return null;
  try {
    const amount = new Big(text);
    if ((!allowNegative && amount.lt(0)) || amount.gt(MAX_MONEY) || amount.lt(MIN_MONEY)) {
      return null;
    }
    return amount.round(2).toFixed(2);
  } catch {
    return null;
  }
};

const asQuantity = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!text || text.length > 32 || !MONEY_PATTERN.test(text)) return null;
  const quantity = Number(text);
  return Number.isFinite(quantity) && quantity > 0 && quantity <= MAX_QUANTITY
    ? quantity
    : null;
};

const normalizeAcceptedPricing = (pricing = {}) => {
  const pricingMode = pricing?.pricingMode;
  if (!['standard', 'wholesale'].includes(pricingMode)) return null;

  const baseUnitPrice = asMoney(pricing.baseUnitPrice);
  const appliedUnitPrice = asMoney(pricing.appliedUnitPrice);
  const variantAdjustment = asMoney(pricing.variantAdjustment, { allowNegative: true });
  const optionsAdjustment = asMoney(pricing.optionsAdjustment, { allowNegative: true });
  const hasWholesaleBase = pricing.wholesaleBaseUnitPrice !== null
    && pricing.wholesaleBaseUnitPrice !== undefined;
  const wholesaleBaseUnitPrice = hasWholesaleBase
    ? asMoney(pricing.wholesaleBaseUnitPrice)
    : null;
  if (
    baseUnitPrice === null
    || appliedUnitPrice === null
    || variantAdjustment === null
    || optionsAdjustment === null
    || (hasWholesaleBase && wholesaleBaseUnitPrice === null)
    || (pricingMode === 'wholesale' && wholesaleBaseUnitPrice === null)
  ) return null;

  const rawWholesaleMinQuantity = pricing.wholesaleMinQuantity;
  let wholesaleMinQuantity = null;
  if (rawWholesaleMinQuantity !== null && rawWholesaleMinQuantity !== undefined) {
    const candidate = Number(rawWholesaleMinQuantity);
    if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > 2147483647) {
      return null;
    }
    wholesaleMinQuantity = candidate;
  }

  const rawWholesaleTierRef = pricing.wholesaleTierRef;
  if (
    rawWholesaleTierRef !== null
    && rawWholesaleTierRef !== undefined
    && typeof rawWholesaleTierRef !== 'string'
  ) return null;
  const wholesaleTierRef = typeof rawWholesaleTierRef === 'string'
    ? rawWholesaleTierRef.trim() || null
    : null;

  return {
    pricingMode,
    baseUnitPrice,
    wholesaleBaseUnitPrice,
    appliedUnitPrice,
    wholesaleTierRef,
    wholesaleMinQuantity,
    variantAdjustment,
    optionsAdjustment
  };
};

export function buildAcceptedEcommerceOrderItems(cartItems = []) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return null;
  const acceptedItems = [];

  for (const item of cartItems) {
    if (
      item?.product?.pricingValid === false
      || item?.product?.configurationLine?.configurationSnapshot?.pricingValid === false
    ) return null;

    const minimalItem = buildMinimalConfiguredOrderItem(item);
    const productId = String(minimalItem?.productId || '').trim();
    const quantity = asQuantity(item?.quantity);
    const acceptedPricing = normalizeAcceptedPricing(item);
    const lineTotal = asMoney(item?.lineTotal);
    if (!productId || quantity === null || acceptedPricing === null || lineTotal === null) {
      return null;
    }

    const expectedLineTotal = new Big(acceptedPricing.appliedUnitPrice)
      .times(quantity)
      .round(2)
      .toFixed(2);
    if (expectedLineTotal !== lineTotal) return null;

    acceptedItems.push({
      ...minimalItem,
      quantity,
      acceptedPricing: {
        ...acceptedPricing,
        lineTotal
      }
    });
  }

  return acceptedItems;
}

const stableSelections = (selections = []) => (Array.isArray(selections) ? selections : [])
  .map((selection) => ({
    groupId: String(selection?.groupId || ''),
    optionIds: (Array.isArray(selection?.optionIds) ? selection.optionIds : [])
      .map((optionId) => String(optionId || ''))
      .sort()
  }))
  .sort((left, right) => left.groupId.localeCompare(right.groupId));

const economicIdentity = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const identity = [];

  for (const item of items) {
    const productId = String(item?.productId || '').trim();
    const quantity = asQuantity(item?.quantity);
    const acceptedPricing = normalizeAcceptedPricing(item?.acceptedPricing || item);
    const lineTotal = asMoney(item?.acceptedPricing?.lineTotal ?? item?.lineTotal);
    if (!productId || quantity === null || acceptedPricing === null || lineTotal === null) {
      return null;
    }
    const expectedLineTotal = new Big(acceptedPricing.appliedUnitPrice)
      .times(quantity)
      .round(2)
      .toFixed(2);
    if (expectedLineTotal !== lineTotal) return null;

    identity.push({
      productId,
      quantity,
      variantId: item?.variantId || null,
      selections: stableSelections(item?.selections),
      acceptedPricing: { ...acceptedPricing, lineTotal }
    });
  }

  return identity.sort((left, right) => (
    left.productId.localeCompare(right.productId)
    || String(left.variantId || '').localeCompare(String(right.variantId || ''))
    || JSON.stringify(left.selections).localeCompare(JSON.stringify(right.selections))
    || left.quantity - right.quantity
  ));
};

export function haveSameAcceptedEcommerceEconomics(acceptedItems, currentItems) {
  const acceptedIdentity = economicIdentity(acceptedItems);
  const currentIdentity = economicIdentity(buildAcceptedEcommerceOrderItems(currentItems));
  return acceptedIdentity !== null
    && currentIdentity !== null
    && JSON.stringify(acceptedIdentity) === JSON.stringify(currentIdentity);
}

export function getAcceptedEcommerceSubtotal(items = []) {
  if (!Array.isArray(items) || items.length === 0) return null;
  try {
    const subtotal = items.reduce((total, item) => {
      const lineTotal = asMoney(item?.acceptedPricing?.lineTotal ?? item?.lineTotal);
      if (lineTotal === null) throw new Error('ECOMMERCE_PRICE_DATA_INVALID');
      return total.plus(new Big(lineTotal));
    }, new Big(0));
    if (subtotal.gt(MAX_MONEY)) return null;
    return subtotal.toFixed(2);
  } catch {
    return null;
  }
}
