import { useCallback } from 'react';
import { useProductStore } from '../store/useProductStore';
import {
  loadBatchesForProduct as loadBatchesForProductService,
  removeProductBatch as removeProductBatchService,
  scanProductFast as scanProductFastService,
  updateProductBatch as updateProductBatchService
} from '../services/inventoryMovement';

export function useInventoryMovement() {
  const refreshProducts = useProductStore((state) => state.loadInitialProducts);

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
    await refreshProducts();
    return result;
  }, [refreshProducts]);

  const removeProductBatch = useCallback(async (productId, batchId) => {
    const result = await removeProductBatchService(productId, batchId);
    await refreshProducts();
    return result;
  }, [refreshProducts]);

  return {
    scanProductFast,
    loadBatchesForProduct,
    updateProductBatch,
    removeProductBatch
  };
}

