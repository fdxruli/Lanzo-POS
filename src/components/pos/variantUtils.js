import { getAvailableStock } from '../../services/db/utils';

const VARIANT_ATTRIBUTE_KEYS = ['talla', 'color', 'modelo', 'marca'];

const hasMeaningfulValue = (value) => (
  (typeof value === 'string' || typeof value === 'number')
  && String(value).trim() !== ''
);

export const hasRealVariantAttributes = (batch) => {
  const attributes = batch?.attributes;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return false;
  }

  return VARIANT_ATTRIBUTE_KEYS.some((key) => hasMeaningfulValue(attributes[key]));
};

export const isAvailableVariantBatch = (batch) => (
  batch?.isActive === true
  && hasRealVariantAttributes(batch)
  && getAvailableStock(batch) > 0
);

export const getAvailableVariantBatches = (batches = []) => (
  Array.isArray(batches) ? batches.filter(isAvailableVariantBatch) : []
);
