import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounce } from '../../../../hooks/useDebounce';
import { useProductStore } from '../../../../store/useProductStore';
import {
  executeBatchWithPaymentSafe,
  executeProductionBatchSafe,
  loadData,
  searchProductsInDB,
  STORES
} from '../../../../services/database';
import { productRepository } from '../../../../services/products/productRepository';
import { showMessageModal } from '../../../../services/utils';
import { loadBatchesForManager } from '../../../../services/inventoryMovement';
import { useStatsStore } from '../../../../store/useStatsStore';
import Logger from '../../../../services/Logger';
import { showInputPromptModal } from '../../../common/InputPromptModal';

/**
 * @param {Object} params
 * @param {Object | undefined} params.selectedProduct
 * @param {string | null} params.selectedProductId
 * @param {(productId: string | null) => void} params.onProductSelect
 * @param {() => Promise<void> | void} params.refreshData
 */
export function useBatchManagerController({
  selectedProduct,
  selectedProductId,
  onProductSelect,
  refreshData
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [batchToEdit, setBatchToEdit] = useState(null);
  const [localBatches, setLocalBatches] = useState([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [selectedProductSnapshot, setSelectedProductSnapshot] = useState(null);
  const adjustInventoryValue = useStatsStore((state) => state.adjustInventoryValue);
  const [inventoryValue, setInventoryValue] = useState(0);

  const resolvedSelectedProduct = useMemo(() => {
    if (!selectedProductId) return null;
    if (selectedProduct?.id === selectedProductId) return selectedProduct;
    if (selectedProductSnapshot?.id === selectedProductId) return selectedProductSnapshot;
    return null;
  }, [selectedProduct, selectedProductId, selectedProductSnapshot]);

  useEffect(() => {
    let isActive = true;

    const hydrateSelectedProduct = async () => {
      if (!selectedProductId) {
        if (isActive) setSelectedProductSnapshot(null);
        return;
      }

      if (selectedProduct?.id === selectedProductId) {
        if (isActive) setSelectedProductSnapshot(selectedProduct);
        return;
      }

      try {
        const productFromDB = await loadData(STORES.MENU, selectedProductId);
        if (isActive) setSelectedProductSnapshot(productFromDB || null);
      } catch (error) {
        Logger.error('Error hidratando producto seleccionado en lotes:', error);
        if (isActive) setSelectedProductSnapshot(null);
      }
    };

    hydrateSelectedProduct();

    return () => {
      isActive = false;
    };
  }, [selectedProduct, selectedProductId]);

  useEffect(() => {
    if (resolvedSelectedProduct) setSearchTerm(resolvedSelectedProduct.name);
    else setSearchTerm('');
  }, [resolvedSelectedProduct?.id, resolvedSelectedProduct?.name]);

  useEffect(() => {
    let isActive = true;

    const fetchSearchResults = async () => {
      const term = debouncedSearchTerm.trim();

      if (!term) {
        if (isActive) setFilteredProducts([]);
        return;
      }

      const selectedName = (resolvedSelectedProduct?.name || '').trim().toLowerCase();
      if (selectedName && term.toLowerCase() === selectedName) {
        if (isActive) setFilteredProducts([]);
        return;
      }

      try {
        const results = await searchProductsInDB(term);
        if (isActive) setFilteredProducts(results.slice(0, 10));
      } catch (error) {
        Logger.error('Error buscando productos para lotes:', error);
        if (isActive) setFilteredProducts([]);
      }
    };

    fetchSearchResults();

    return () => {
      isActive = false;
    };
  }, [debouncedSearchTerm, resolvedSelectedProduct?.name]);

  const fetchBatches = useCallback(async () => {
    if (!selectedProductId) {
      setLocalBatches([]);
      setInventoryValue(0);
      return;
    }

    setIsLoadingBatches(true);
    try {
      const data = await loadBatchesForManager(selectedProductId);
      setLocalBatches(data.batches);
      setInventoryValue(data.inventoryValue);
    } catch (error) {
      Logger.error('Error cargando lotes:', error);
      setLocalBatches([]);
      setInventoryValue(0);
    } finally {
      setIsLoadingBatches(false);
    }
  }, [selectedProductId]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && selectedProductId) fetchBatches();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchBatches, selectedProductId]);

  const productBatches = localBatches;
  const totalStock = resolvedSelectedProduct?.stock || 0;

  const handleSelectProduct = useCallback((product) => {
    setSearchTerm(product.name);
    setSelectedProductSnapshot(product);
    setFilteredProducts([]);
    setShowSuggestions(false);
    onProductSelect(product.id);
  }, [onProductSelect]);

  const openNewBatchModal = useCallback(() => {
    setBatchToEdit(null);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleEditBatch = useCallback((batch) => {
    setBatchToEdit(batch);
    setIsModalOpen(true);
  }, []);

  const handleSaveBatch = useCallback(async (batchData, paymentInfo = null, isEditing = false) => {
    if (!resolvedSelectedProduct || !selectedProductId) return false;

    try {
      if (!resolvedSelectedProduct.trackStock || !resolvedSelectedProduct.batchManagement?.enabled) {
        const updatedProduct = {
          ...resolvedSelectedProduct,
          trackStock: true,
          batchManagement: {
            ...(resolvedSelectedProduct.batchManagement || {}),
            enabled: true,
            selectionStrategy: resolvedSelectedProduct.batchManagement?.selectionStrategy || 'fifo'
          }
        };

        const updateProductResult = await productRepository.saveProduct(updatedProduct, {
          existingProduct: resolvedSelectedProduct
        });

        if (!updateProductResult?.success) {
          throw updateProductResult?.error || new Error(updateProductResult?.message || 'No se pudo actualizar el producto.');
        }

        setSelectedProductSnapshot(updatedProduct);
        await useProductStore.getState().loadInitialProducts();
      }

      let saveBatchResult;
      const isNewProduction =
        !isEditing &&
        Array.isArray(resolvedSelectedProduct.recipe) &&
        resolvedSelectedProduct.recipe.length > 0;

      if (paymentInfo) {
        saveBatchResult = await executeBatchWithPaymentSafe(batchData, paymentInfo);
      } else if (isNewProduction) {
        saveBatchResult = await executeProductionBatchSafe(batchData, resolvedSelectedProduct.recipe);
      } else {
        saveBatchResult = await productRepository.saveBatch(batchData, {
          existingBatch: isEditing ? batchToEdit : null
        });
      }

      if (!saveBatchResult?.success) {
        throw saveBatchResult?.error || new Error(saveBatchResult?.message || 'No se pudo guardar el lote.');
      }

      await fetchBatches();
      await refreshData();
      showMessageModal(
        isNewProduction
          ? 'Lote producido e ingredientes descontados correctamente.'
          : (saveBatchResult.pending ? 'Lote guardado localmente. Se sincronizará al volver internet.' : 'Lote guardado y stock actualizado.')
      );
      return { success: true, rawMaterialsCost: saveBatchResult.rawMaterialsCost || 0 };
    } catch (error) {
      Logger.error(error);
      showMessageModal(`Error: ${error.message}`);
      return false;
    }
  }, [batchToEdit, fetchBatches, refreshData, resolvedSelectedProduct, selectedProductId]);

  const handleDeleteBatch = useCallback(async (batch) => {
    const stockNumber = Number(batch.stock);
    const hasStock = stockNumber > 0;
    const hasNegativeStock = stockNumber < 0;

    let confirmMessage = '¿Archivar este lote? (Se mantendrá en el historial para reportes)';
    let actionType = 'Normal';

    if (hasStock) {
      confirmMessage = `ATENCIÓN: Este lote aún tiene ${stockNumber} unidades. Si lo archivas, se registrará como MERMA (pérdida). El stock pasará a 0 y perderás el valor invertido. ¿Proceder?`;
      actionType = 'Merma';
    } else if (hasNegativeStock) {
      confirmMessage = `ATENCIÓN: Este lote tiene un descuadre de ${stockNumber} unidades (Stock Negativo). Al archivarlo, se ajustará a 0 para corregir el error contable sin afectar el historial de compras. ¿Proceder?`;
      actionType = 'Corrección de Descuadre';
    }

    const userNote = await showInputPromptModal({
      title: 'Archivar lote',
      message: `${confirmMessage}\n\nOpcional: puedes escribir una nota o motivo para archivar este lote.`,
      placeholder: 'Motivo o nota opcional',
      confirmButtonText: 'Archivar lote',
      cancelButtonText: 'Cancelar',
      required: false
    });

    if (userNote === null) return;

    const finalNote = userNote.trim() ? ` - Nota del usuario: ${userNote.trim()}` : '';

    try {
      const archivedBatch = {
        ...batch,
        stock: 0,
        isActive: false,
        isArchived: true,
        status: 'archived',
        deletedAt: new Date().toISOString(),
        notes: (hasStock || hasNegativeStock)
          ? `[${actionType.toUpperCase()} - ${new Date().toLocaleDateString()}] Stock original antes de archivar: ${stockNumber}. ${batch.notes || ''}${finalNote}`
          : `${batch.notes || ''}${finalNote}`
      };

      const archiveResult = await productRepository.deleteBatch(archivedBatch);
      if (!archiveResult?.success) {
        throw archiveResult?.error || new Error(archiveResult?.message || 'No se pudo archivar el lote.');
      }

      if (stockNumber !== 0) {
        const valueDifference = -(stockNumber * Number(batch.cost || 0));
        if (valueDifference !== 0) await adjustInventoryValue(valueDifference);
      }

      await fetchBatches();
      await refreshData();

      showMessageModal(
        archiveResult.pending
          ? 'Lote archivado localmente. Se sincronizará al volver internet.'
          : (actionType === 'Normal' ? 'Lote archivado correctamente.' : `Lote archivado (${actionType} registrada).`)
      );
    } catch (error) {
      Logger.error(error);
      showMessageModal(`Error: ${error.message}`);
    }
  }, [fetchBatches, refreshData, adjustInventoryValue]);

  return {
    isModalOpen,
    batchToEdit,
    selectedProduct: resolvedSelectedProduct,
    searchTerm,
    showSuggestions,
    filteredProducts,
    productBatches,
    totalStock,
    inventoryValue,
    isLoadingBatches,
    setSearchTerm,
    setShowSuggestions,
    setBatchToEdit,
    handleSelectProduct,
    handleSaveBatch,
    handleEditBatch,
    handleDeleteBatch,
    openNewBatchModal,
    closeModal,
    refreshBatches: fetchBatches
  };
}
