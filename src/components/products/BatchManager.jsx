import React, { useMemo } from 'react';
import { useProductStore } from '../../store/useProductStore';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import BatchProductSearch from './batch/BatchProductSearch';
import BatchTable from './batch/BatchTable';
import BatchFormModal from './batch/BatchFormModal';
import { useBatchManagerController } from './batch/hooks/useBatchManagerController';
import {
  resolveBatchRubroGroup,
  resolveFeatureRubroContext
} from './batch/utils/resolveBatchRubroGroup';
import './BatchManager.css';

export default function BatchManager({ selectedProductId, onProductSelect }) {
  const menu = useProductStore((state) => state.menu);
  const refreshData = useProductStore((state) => state.loadInitialProducts);

  const selectedProductFromMenu = useMemo(
    () => menu.find((product) => product.id === selectedProductId),
    [menu, selectedProductId]
  );

  const controller = useBatchManagerController({
    selectedProduct: selectedProductFromMenu,
    selectedProductId,
    onProductSelect,
    refreshData
  });
  const selectedProduct = controller.selectedProduct;

  const specificRubro = resolveFeatureRubroContext(selectedProduct?.rubroContext);
  const rubroGroup = resolveBatchRubroGroup(selectedProduct?.rubroContext);
  const features = useFeatureConfig(specificRubro);

  return (
    <div className="batch-manager-container">
      <div className="form-group">
        <label className="form-label" htmlFor="batch-product-search">
          Buscar Producto
        </label>
        <BatchProductSearch
          inputId="batch-product-search"
          searchTerm={controller.searchTerm}
          onSearchTermChange={controller.setSearchTerm}
          onClearSelection={() => {
            controller.setSearchTerm('');
            controller.setShowSuggestions(false);
            onProductSelect(null);
          }}
          showSuggestions={controller.showSuggestions}
          onSetShowSuggestions={controller.setShowSuggestions}
          filteredProducts={controller.filteredProducts}
          onSelectProduct={controller.handleSelectProduct}
        />
      </div>

      {!selectedProduct && !controller.isLoadingBatches && (
        <p style={{ textAlign: 'center', color: '#888', marginTop: '20px' }}>
          Selecciona un producto para comenzar.
        </p>
      )}

      {selectedProduct && (
        <BatchTable
          features={features}
          productBatches={controller.productBatches}
          totalStock={controller.totalStock}
          inventoryValue={controller.inventoryValue}
          isLoadingBatches={controller.isLoadingBatches}
          onRefresh={controller.refreshBatches}
          onOpenNew={controller.openNewBatchModal}
          onEditBatch={controller.handleEditBatch}
          onDeleteBatch={controller.handleDeleteBatch}
        />
      )}

      {controller.isModalOpen && selectedProduct && (
        <BatchFormModal
          product={selectedProduct}
          batchToEdit={controller.batchToEdit}
          onClose={controller.closeModal}
          onSave={controller.handleSaveBatch}
          features={features}
          menu={menu}
          rubroGroup={rubroGroup}
        />
      )}
    </div>
  );
}
