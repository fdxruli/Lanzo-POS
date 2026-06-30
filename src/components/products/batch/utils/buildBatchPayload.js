import { generateID } from '../../../../services/utils';
import { calculateShelfLifeTargetDate } from '../../../../utils/expirationPolicy';

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

  const explicitExpiryDate = values.expiryDate
    ? new Date(values.expiryDate).toISOString()
    : null;
  const shelfLifeGeneratedExpiryDate = !explicitExpiryDate && product?.expirationMode === 'SHELF_LIFE'
    ? calculateShelfLifeTargetDate({
      baseDate: new Date(),
      shelfLifeValue: product.shelfLifeValue,
      shelfLifeUnit: product.shelfLifeUnit
    })
    : null;
  const finalExpiryDate = explicitExpiryDate || shelfLifeGeneratedExpiryDate;
  const finalAlertType = finalExpiryDate
    ? (shelfLifeGeneratedExpiryDate ? 'VIDA_UTIL_ESTIMADA' : 'CADUCIDAD_LEGAL')
    : null;

  if (product?.expirationMode === 'STRICT') {
    if (!values.manufacturerBatchId || !String(values.manufacturerBatchId).trim()) {
      throw new Error("El Lote de Fabricante es obligatorio bajo el modo Estricto.");
    }
  }

  return {
    id: isEditing ? batchToEdit.id : generateID('batch'),
    productId: product.id,
    cost: nCost,
    price: nPrice,
    stock: nStock,
    committedStock: isEditing ? Number(batchToEdit?.committedStock) || 0 : 0,
    notes: values.notes || null,
    trackStock: nStock > 0,
    isActive: nStock > 0,
    createdAt: isEditing ? batchToEdit.createdAt : new Date().toISOString(),
    expiryDate: finalExpiryDate,
    alertTargetDate: finalExpiryDate || null,
    alertType: finalAlertType,
    sku: finalSku,
    supplier: values.supplier ? String(values.supplier).trim() : null,
    manufacturerBatchId: values.manufacturerBatchId ? String(values.manufacturerBatchId).trim() : null,
    attributes: features?.hasVariants
      ? {
        talla: values.attribute1,
        color: values.attribute2,
        ...(values.pao ? { pao: values.pao } : {})
      }
      : values.pao ? { pao: values.pao } : null,
    location: values.location || '',
    updateGlobalPrice: features?.hasVariants ? false : Boolean(values.updateGlobalPrice)
  };
}
