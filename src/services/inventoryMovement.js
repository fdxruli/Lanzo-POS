import {
  loadData,
  queryByIndex,
  queryBatchesByProductIdAndActive,
  saveBatchAndSyncProductSafe,
  searchProductByBarcode,
  searchProductBySKU,
  STORES
} from './database';
import Logger from './Logger';

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sortByFifo = (a, b) => {
  const aCreatedAt = parseDate(a?.createdAt)?.getTime() ?? 0;
  const bCreatedAt = parseDate(b?.createdAt)?.getTime() ?? 0;
  return aCreatedAt - bCreatedAt;
};

export const sortBatchesByStrategy = (batches = [], strategy = 'fifo') => {
  const normalizedStrategy = String(strategy || 'fifo').toLowerCase();
  const isFefo = normalizedStrategy === 'fefo';

  return [...batches].sort((a, b) => {
    if (isFefo) {
      const aExpiry = parseDate(a?.expiryDate);
      const bExpiry = parseDate(b?.expiryDate);

      if (aExpiry && bExpiry) {
        if (aExpiry.getTime() !== bExpiry.getTime()) {
          return aExpiry.getTime() - bExpiry.getTime();
        }
      } else if (aExpiry || bExpiry) {
        return aExpiry ? -1 : 1;
      }
    }

    return sortByFifo(a, b);
  });
};

const ensureBatchBelongsToProduct = (batch, productId) => {
  if (!batch) {
    throw new Error('Lote no encontrado.');
  }

  if (batch.productId !== productId) {
    throw new Error('El lote no pertenece al producto seleccionado.');
  }
};

export const loadBatchesForProduct = async (productId, options = {}) => {
  if (!productId) return [];

  const { onlyActive = false, includeArchived = true } = options;
  const batches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);
  let result = Array.isArray(batches) ? batches : [];

  if (onlyActive) {
    result = result.filter((batch) => batch?.isActive && Number(batch?.stock) > 0);
  }

  if (!includeArchived) {
    result = result.filter((batch) => !batch?.isArchived);
  }

  return result;
};

export const scanProductFast = async (barcode) => {
  if (!barcode) return null;

  try {
    let product = await searchProductByBarcode(barcode);
    if (!product) {
      product = await searchProductBySKU(barcode);
    }

    if (!product) return null;
    if (product?.isVariant || product?.batchId) return product;
    if (!product?.batchManagement?.enabled) return product;

    const activeBatches = await queryBatchesByProductIdAndActive(product.id, true);
    const availableBatches = (activeBatches || [])
      .filter((batch) => Number(batch?.stock) > 0 && batch?.isActive !== false);

    if (availableBatches.length === 0) return product;

    const strategy = product?.batchManagement?.selectionStrategy || 'fifo';
    const [selectedBatch] = sortBatchesByStrategy(availableBatches, strategy);

    if (!selectedBatch) return product;

    return {
      ...product,
      price: parseFloat(selectedBatch.price) || product.price,
      cost: parseFloat(selectedBatch.cost) || product.cost,
      batchId: selectedBatch.id,
      stock: Number(selectedBatch.stock) || 0
    };
  } catch (error) {
    Logger.error('Error en Fast Scan:', error);
    return null;
  }
};

export const updateProductBatch = async (productId, batchId, patch = {}) => {
  const existingBatch = await loadData(STORES.PRODUCT_BATCHES, batchId);
  ensureBatchBelongsToProduct(existingBatch, productId);

  const updatedBatch = {
    ...existingBatch,
    ...patch,
    id: existingBatch.id,
    productId: existingBatch.productId,
    updatedAt: new Date().toISOString()
  };

  if (Object.prototype.hasOwnProperty.call(patch, 'expiryDate') && patch.expiryDate === '') {
    updatedBatch.expiryDate = null;
  }

  const result = await saveBatchAndSyncProductSafe(updatedBatch);
  if (!result?.success) {
    throw result?.error || new Error(result?.message || 'No se pudo actualizar el lote.');
  }

  return updatedBatch;
};

export const removeProductBatch = async (productId, batchId) => {
  const existingBatch = await loadData(STORES.PRODUCT_BATCHES, batchId);
  ensureBatchBelongsToProduct(existingBatch, productId);

  const archivedBatch = {
    ...existingBatch,
    isActive: false,
    isArchived: true,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const result = await saveBatchAndSyncProductSafe(archivedBatch);
  if (!result?.success) {
    throw result?.error || new Error(result?.message || 'No se pudo archivar el lote.');
  }

  return archivedBatch;
};

