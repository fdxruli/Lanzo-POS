import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from '../../../../hooks/useDebounce';
import { useInventoryCatalogStore } from '../../../../store/useInventoryCatalogStore';
import {
  executeBatchWithPaymentSafe,
  executeProductionBatchSafe,
  loadData,
  searchProductsInDB,
  STORES
} from '../../../../services/database';
import { productRepository } from '../../../../services/products/productRepository';
import { showMessageModal } from '../../../../services/utils';
import {
  loadBatchesForManager,
  loadNextBatchManagerPage
} from '../../../../services/inventoryMovement';
import { BATCH_MANAGER_PAGE_SIZE } from '../../../../services/products/batchManagerQueries';
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
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [isLoadingNextPage, setIsLoadingNextPage] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [batchSummary, setBatchSummary] = useState({
    totalRecords: 0,
    activeRecords: 0,
    archivedRecords: 0,
    totalPhysicalStock: 0,
    totalAvailableStock: 0,
    totalCommittedStock: 0,
    inventoryValue: 0
  });
  const requestVersionRef = useRef(0);
  const selectedProductIdRef = useRef(selectedProductId);
  const initialRequestRef = useRef(null);
  const nextPageRequestRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [selectedProductSnapshot, setSelectedProductSnapshot] = useState(null);
  const adjustInventoryValue = useStatsStore((state) => state.adjustInventoryValue);
  selectedProductIdRef.current = selectedProductId;

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
  }, [resolvedSelectedProduct]);

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

  const resetBatchView = useCallback(() => {
    setLocalBatches([]);
    setNextCursor(null);
    setHasMore(false);
    setBatchSummary({
      totalRecords: 0,
      activeRecords: 0,
      archivedRecords: 0,
      totalPhysicalStock: 0,
      totalAvailableStock: 0,
      totalCommittedStock: 0,
      inventoryValue: 0
    });
  }, []);

  const fetchBatches = useCallback(async ({ refresh = false } = {}) => {
    if (!selectedProductId) {
      requestVersionRef.current += 1;
      resetBatchView();
      return;
    }

    if (initialRequestRef.current?.productId === selectedProductId) {
      return initialRequestRef.current.promise;
    }

    const productId = selectedProductId;
    const requestVersion = ++requestVersionRef.current;
    nextPageRequestRef.current = null;
    setIsLoadingNextPage(false);
    if (refresh) setIsRefreshing(true);
    else setIsLoadingInitial(true);

    const request = (async () => {
      try {
        const data = await loadBatchesForManager(productId, {
          pageSize: BATCH_MANAGER_PAGE_SIZE
        });
        if (
          requestVersion !== requestVersionRef.current
          || selectedProductIdRef.current !== productId
        ) return;

        setLocalBatches(data.items);
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
        setBatchSummary(data.summary);
      } catch (error) {
        if (
          requestVersion !== requestVersionRef.current
          || selectedProductIdRef.current !== productId
        ) return;
        Logger.error('Error cargando lotes:', error);
        resetBatchView();
      } finally {
        if (
          requestVersion === requestVersionRef.current
          && selectedProductIdRef.current === productId
        ) {
          setIsLoadingInitial(false);
          setIsRefreshing(false);
        }
      }
    })();

    initialRequestRef.current = { productId, promise: request };
    request.finally(() => {
      if (initialRequestRef.current?.promise === request) initialRequestRef.current = null;
    });
    return request;
  }, [resetBatchView, selectedProductId]);

  const loadMoreBatches = useCallback(async () => {
    if (!selectedProductId || !hasMore || !nextCursor || nextPageRequestRef.current) return;

    const productId = selectedProductId;
    const cursor = nextCursor;
    const requestVersion = requestVersionRef.current;
    setIsLoadingNextPage(true);

    const request = (async () => {
      try {
        const page = await loadNextBatchManagerPage(productId, {
          cursor,
          pageSize: BATCH_MANAGER_PAGE_SIZE
        });
        if (
          requestVersion !== requestVersionRef.current
          || selectedProductIdRef.current !== productId
        ) return;

        setLocalBatches((current) => {
          const byId = new Map(current.map((batch) => [String(batch.id), batch]));
          page.items.forEach((batch) => byId.set(String(batch.id), batch));
          return Array.from(byId.values());
        });
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (error) {
        if (
          requestVersion === requestVersionRef.current
          && selectedProductIdRef.current === productId
        ) Logger.error('Error cargando más lotes:', error);
      } finally {
        if (
          requestVersion === requestVersionRef.current
          && selectedProductIdRef.current === productId
        ) setIsLoadingNextPage(false);
      }
    })();

    nextPageRequestRef.current = request;
    request.finally(() => {
      if (nextPageRequestRef.current === request) nextPageRequestRef.current = null;
    });
    return request;
  }, [hasMore, nextCursor, selectedProductId]);

  useEffect(() => {
    requestVersionRef.current += 1;
    initialRequestRef.current = null;
    nextPageRequestRef.current = null;
    setIsLoadingInitial(Boolean(selectedProductId));
    setIsLoadingNextPage(false);
    setIsRefreshing(false);
    resetBatchView();
    fetchBatches();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [fetchBatches, resetBatchView, selectedProductId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && selectedProductId) fetchBatches({ refresh: true });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchBatches, selectedProductId]);

  const productBatches = localBatches;
  const totalStock = batchSummary.totalPhysicalStock;
  const inventoryValue = batchSummary.inventoryValue;
  const isLoadingBatches = isLoadingInitial || isLoadingNextPage || isRefreshing;

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
        await useInventoryCatalogStore.getState().loadInitialProducts();
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

      await fetchBatches({ refresh: true });
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

      await fetchBatches({ refresh: true });
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
    isLoadingInitial,
    isLoadingNextPage,
    isRefreshing,
    nextCursor,
    hasMore,
    loadedCount: productBatches.length,
    totalCount: batchSummary.totalRecords,
    activeCount: batchSummary.activeRecords,
    archivedCount: batchSummary.archivedRecords,
    requestVersion: requestVersionRef.current,
    setSearchTerm,
    setShowSuggestions,
    setBatchToEdit,
    handleSelectProduct,
    handleSaveBatch,
    handleEditBatch,
    handleDeleteBatch,
    openNewBatchModal,
    closeModal,
    refreshBatches: () => fetchBatches({ refresh: true }),
    loadMoreBatches
  };
}
