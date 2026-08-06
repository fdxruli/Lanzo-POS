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
