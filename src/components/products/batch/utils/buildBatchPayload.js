import { generateID } from '../../../../services/utils';

/**
 * @param {Object} params
 * @param {Object | null} params.batchToEdit
 * @param {Object} params.product
 * @param {import('./validateBatchInput').BatchFormValues} params.values
 * @param {{ nStock: number, nCost: number, nPrice: number }} params.parsed
 * @param {{ hasVariants?: boolean }} params.features
 * @param {string | null} params.finalSku
 * @returns {Object}
 */
export function buildBatchPayload({
  batchToEdit,
  product,
  values,
  parsed,
  features,
  finalSku
}) {
  const isEditing = Boolean(batchToEdit);
  const { nStock, nCost, nPrice } = parsed;

  return {
    id: isEditing ? batchToEdit.id : generateID('batch'),
    productId: product.id,
    cost: nCost,
    price: nPrice,
    stock: nStock,
    notes: values.notes || null,
    trackStock: nStock > 0,
    isActive: nStock > 0,
    createdAt: isEditing ? batchToEdit.createdAt : new Date().toISOString(),
    expiryDate: values.expiryDate ? values.expiryDate : null,
    sku: finalSku,
    supplier: values.supplier ? String(values.supplier).trim() : null, // <-- NUEVO
    attributes: features?.hasVariants
      ? {
        talla: values.attribute1,
        color: values.attribute2
      }
      : null,
    location: values.location || '',
  updateGlobalPrice: features?.hasVariants ? false : Boolean(values.updateGlobalPrice)
  };
}

