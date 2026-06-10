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

  let finalExpiryDate = values.expiryDate ? new Date(values.expiryDate).toISOString() : null;

  if (product?.expirationMode === 'SHELF_LIFE') {
    if (!values.expiryDate) {
      const now = new Date();
      const shelfValue = Number(product.shelfLifeValue) || 0;
      const unit = (product.shelfLifeUnit || 'days').toLowerCase();
      
      if (unit === 'hours') {
        now.setHours(now.getHours() + shelfValue);
      } else if (unit === 'months') {
        now.setMonth(now.getMonth() + shelfValue);
      } else { // default to days
        now.setDate(now.getDate() + shelfValue);
      }
      finalExpiryDate = now.toISOString();
    } else {
      const baseDate = new Date(values.expiryDate);
      const shelfValue = Number(product.shelfLifeValue) || 0;
      const unit = (product.shelfLifeUnit || 'days').toLowerCase();
      
      if (unit === 'hours') {
        baseDate.setHours(baseDate.getHours() + shelfValue);
      } else if (unit === 'months') {
        baseDate.setMonth(baseDate.getMonth() + shelfValue);
      } else {
        baseDate.setDate(baseDate.getDate() + shelfValue);
      }
      finalExpiryDate = baseDate.toISOString();
    }
  }

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
    alertType: finalExpiryDate ? 'CADUCIDAD_LEGAL' : null,
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
