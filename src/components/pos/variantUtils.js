import {
  getAvailableBatchStock,
  isBatchActiveForFefo
} from '../../services/products/fefoUtils';

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
  isBatchActiveForFefo(batch)
  && hasRealVariantAttributes(batch)
  && getAvailableBatchStock(batch) > 0
);

export const getAvailableVariantBatches = (batches = []) => (
  Array.isArray(batches) ? batches.filter(isAvailableVariantBatch) : []
);

// El selector deja visibles las tallas con reservas para explicar el bloqueo.
// Solo se consideran atributos de variantes reales y lotes activos.
export const getVisibleVariantBatches = (batches = []) => (
  Array.isArray(batches)
    ? batches.filter((batch) => isBatchActiveForFefo(batch)
      && hasRealVariantAttributes(batch)
      && (getAvailableBatchStock(batch) > 0 || (Number(batch.stock) > 0 && Number(batch.committedStock ?? batch.committed_stock ?? 0) > 0)))
    : []
);
