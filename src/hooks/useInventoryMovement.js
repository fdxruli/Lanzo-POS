import { useCallback } from 'react';
import {
  loadBatchesForProduct as loadBatchesForProductService,
  removeProductBatch as removeProductBatchService,
  scanProductFast as scanProductFastService,
  updateProductBatch as updateProductBatchService
} from '../services/inventoryMovement';
import { notifyProductsChanged } from '../services/products/productEvents';

export function useInventoryMovement() {
  const scanProductFast = useCallback(
    async (barcode) => scanProductFastService(barcode),
    []
  );

  const loadBatchesForProduct = useCallback(
    async (productId, options) => loadBatchesForProductService(productId, options),
    []
  );

  const updateProductBatch = useCallback(async (productId, batchId, patch) => {
    const result = await updateProductBatchService(productId, batchId, patch);
    notifyProductsChanged({ source: 'inventoryMovement.updateProductBatch', productIds: [productId] });
    return result;
  }, []);

  const removeProductBatch = useCallback(async (productId, batchId) => {
    const result = await removeProductBatchService(productId, batchId);
    notifyProductsChanged({ source: 'inventoryMovement.removeProductBatch', productIds: [productId] });
    return result;
  }, []);

  return {
    scanProductFast,
    loadBatchesForProduct,
    updateProductBatch,
    removeProductBatch
  };
}
