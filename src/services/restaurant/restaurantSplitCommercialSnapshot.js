import { Money } from '../../utils/moneyMath';

export const RESTAURANT_SPLIT_COMMERCIAL_SNAPSHOT_VERSION = 1;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isBlank = (value) => typeof value === 'string' && value.trim() === '';

const normalizeScalar = (value, kind) => {
  if (value === undefined) return { state: 'absent' };
  if (value === null) return { state: 'null' };
  if (isBlank(value)) return { state: 'empty', kind };

  if (kind === 'money' || kind === 'decimal') {
    if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value))) {
      return { state: 'invalid' };
    }
    try {
      return {
        state: 'value',
        value: kind === 'money' ? Money.toCents(value) : Money.toExactString(value)
      };
    } catch {
      return { state: 'invalid' };
    }
  }

  if (kind === 'boolean') {
    return typeof value === 'boolean'
      ? { state: 'value', value }
      : { state: 'invalid' };
  }

  if (kind === 'currency') {
    return typeof value === 'string'
      ? { state: 'value', value: value.trim().toUpperCase() }
      : { state: 'invalid' };
  }

  if (kind === 'lowerText' || kind === 'text') {
    return typeof value === 'string'
      ? { state: 'value', value: kind === 'lowerText' ? value.trim().toLowerCase() : value.trim() }
      : { state: 'invalid' };
  }

  return { state: 'value', value };
};

const snapshotField = (source, key, kind = 'raw') => (
  hasOwn(source, key) ? normalizeScalar(source[key], kind) : { state: 'absent' }
);

const canonicalModifierValue = (value, key = '') => {
  if (Array.isArray(value)) {
    const rows = value.map((entry) => canonicalModifierValue(entry));
    return key === 'selectedModifiers'
      ? rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : rows;
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((entryKey) => [
      entryKey,
      canonicalModifierValue(value[entryKey], entryKey)
    ]));
  }

  const normalizedKey = String(key).toLowerCase();
  if (['price', 'extra_price', 'extraprice', 'modifier_price', 'modifierprice', 'unit_price', 'unitprice', 'amount', 'discount_amount', 'discountamount'].includes(normalizedKey)) {
    return normalizeScalar(value, 'money');
  }
  if (['quantity', 'ingredient_quantity', 'ingredientquantity', 'unit_quantity', 'unitquantity'].includes(normalizedKey)) {
    return normalizeScalar(value, 'decimal');
  }
  return normalizeScalar(value, 'raw');
};

const snapshotModifiers = (item) => {
  if (!hasOwn(item, 'selectedModifiers')) return { state: 'absent' };
  const value = item.selectedModifiers;
  if (value === null) return { state: 'null' };
  if (!Array.isArray(value)) return { state: 'invalid' };
  return { state: 'value', value: canonicalModifierValue(value, 'selectedModifiers') };
};

const snapshotDiscount = (value) => {
  if (value === undefined) return { state: 'absent' };
  if (value === null) return { state: 'null' };
  if (typeof value === 'number' || typeof value === 'string') {
    return { state: 'scalar', value: normalizeScalar(value, 'money') };
  }
  if (!isRecord(value)) return { state: 'invalid' };

  const type = snapshotField(value, 'type', 'lowerText');
  const normalizedType = type.state === 'value' ? type.value : null;
  const valueKind = normalizedType === 'amount' ? 'money' : 'decimal';
  return {
    state: 'object',
    fields: {
      type,
      value: snapshotField(value, 'value', valueKind),
      amount: snapshotField(value, 'amount', 'money'),
      scope: snapshotField(value, 'scope', 'lowerText'),
      reason: snapshotField(value, 'reason', 'text')
    }
  };
};

const snapshotDiscountAliases = (source, keys) => Object.fromEntries(
  keys.map((key) => [key, hasOwn(source, key) ? snapshotDiscount(source[key]) : { state: 'absent' }])
);

const ORDER_AMOUNT_FIELDS = Object.freeze([
  'subtotal', 'grossSubtotal', 'gross_subtotal', 'subtotalAfterLineDiscounts', 'subtotal_after_line_discounts',
  'lineDiscountTotal', 'line_discount_total', 'saleDiscountAmount', 'sale_discount_amount',
  'discountTotal', 'discount_total', 'taxTotal', 'tax_total', 'taxAmount', 'tax_amount',
  'deliveryFee', 'delivery_fee', 'serviceFee', 'service_fee', 'tipAmount', 'tip_amount',
  'roundingAdjustment', 'rounding_adjustment'
]);

const LINE_AMOUNT_FIELDS = Object.freeze([
  'price', 'unitPrice', 'unit_price', 'lineTotal', 'line_total', 'lineSubtotal', 'line_subtotal', 'exactTotal',
  'discountAmount', 'discount_amount', 'taxAmount', 'tax_amount', 'tax', 'splitBasePrice', 'split_base_price',
  'splitRoundingAdjustment', 'split_rounding_adjustment'
]);

const LINE_QUANTITY_FIELDS = Object.freeze(['quantity']);
const VARIANT_FIELDS = Object.freeze(['batchId', 'batch_id', 'variantId', 'variant_id', 'isVariant']);

export const buildRestaurantOrderCommercialSnapshot = (sale = {}) => ({
  version: RESTAURANT_SPLIT_COMMERCIAL_SNAPSHOT_VERSION,
  currency: snapshotField(sale, 'currency', 'currency'),
  amounts: Object.fromEntries(ORDER_AMOUNT_FIELDS.map((key) => [key, snapshotField(sale, key, 'money')])),
  saleDiscounts: {
    ...snapshotDiscountAliases(sale, ['saleDiscount', 'sale_discount']),
    metadataDiscount: snapshotDiscount(sale?.metadata?.discount),
    legacyDiscount: hasOwn(sale, 'discount') ? snapshotDiscount(sale.discount) : { state: 'absent' }
  }
});

export const buildRestaurantOrderLineCommercialSnapshot = (item = {}) => ({
  version: RESTAURANT_SPLIT_COMMERCIAL_SNAPSHOT_VERSION,
  amounts: Object.fromEntries(LINE_AMOUNT_FIELDS.map((key) => [key, snapshotField(item, key, 'money')])),
  quantities: Object.fromEntries(LINE_QUANTITY_FIELDS.map((key) => [key, snapshotField(item, key, 'decimal')])),
  discounts: {
    discount: hasOwn(item, 'discount') ? snapshotDiscount(item.discount) : { state: 'absent' },
    discountAmount: snapshotField(item, 'discountAmount', 'money'),
    discount_amount: snapshotField(item, 'discount_amount', 'money'),
    discountReason: snapshotField(item, 'discountReason', 'text'),
    discount_reason: snapshotField(item, 'discount_reason', 'text')
  },
  variants: Object.fromEntries(VARIANT_FIELDS.map((key) => [
    key,
    snapshotField(item, key, key === 'isVariant' ? 'boolean' : 'raw')
  ])),
  selectedModifiers: snapshotModifiers(item)
});

export const hasInvalidRestaurantSplitCommercialSnapshot = (value) => {
  if (Array.isArray(value)) return value.some(hasInvalidRestaurantSplitCommercialSnapshot);
  if (!isRecord(value)) return false;
  if (value.state === 'invalid' || (value.state === 'empty' && ['money', 'decimal', 'currency'].includes(value.kind))) return true;
  return Object.values(value).some(hasInvalidRestaurantSplitCommercialSnapshot);
};

export const stableRestaurantSplitCommercialStringify = (value) => {
  const sortKeys = (entry) => {
    if (Array.isArray(entry)) return entry.map(sortKeys);
    if (!isRecord(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, sortKeys(entry[key])]));
  };
  return JSON.stringify(sortKeys(value));
};
