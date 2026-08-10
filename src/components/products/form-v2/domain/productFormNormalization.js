import { normalizeProductUnit, PRODUCE_WEIGHT_SALE_UNITS } from '../../../../utils/productUnitConfiguration';

export const toNumber = (value, fallback = 0) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeExpirationFields = (values) => {
  if (values.expirationMode === 'NONE') return { expirationMode: 'NONE', expiryDate: null, shelfLifeValue: null, shelfLifeUnit: null, manufacturerBatchId: null };
  if (values.expirationMode === 'STRICT') return { expirationMode: 'STRICT', expiryDate: values.expiryDate || null, shelfLifeValue: null, shelfLifeUnit: null, manufacturerBatchId: values.manufacturerBatchId?.trim() || null };
  return { expirationMode: 'SHELF_LIFE', expiryDate: null, shelfLifeValue: toNumber(values.shelfLifeValue, null), shelfLifeUnit: values.shelfLifeUnit || 'days', manufacturerBatchId: null };
};

export const variantKey = (variant) => `${String(variant.color || '').trim().toLowerCase()}::${String(variant.talla || '').trim().toLowerCase()}`;

const PRODUCE_WEIGHT_UNIT_VALUES = new Set(PRODUCE_WEIGHT_SALE_UNITS.map(({ value }) => value));

export const normalizeProduceSaleConfiguration = ({ saleMode, saleType, unit } = {}) => {
  const isBulk = saleMode === 'bulk' || saleType === 'bulk';
  const canonicalUnit = normalizeProductUnit(unit);

  if (!isBulk) return { saleMode: 'unit', saleType: 'unit', unit: 'pza' };

  return {
    saleMode: 'bulk',
    saleType: 'bulk',
    unit: PRODUCE_WEIGHT_UNIT_VALUES.has(canonicalUnit) ? canonicalUnit : 'kg'
  };
};
