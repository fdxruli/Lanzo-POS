import { useMemo } from 'react';
import { ArrowLeft, Layers3 } from 'lucide-react';
import { useInventoryCatalogStore } from '../../store/useInventoryCatalogStore';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import BatchProductSearch from './batch/BatchProductSearch';
import BatchProductDirectory from './batch/BatchProductDirectory';
import BatchTable from './batch/BatchTable';
import BatchFormModal from './batch/BatchFormModal';
import { useBatchManagerController } from './batch/hooks/useBatchManagerController';
import {
  resolveBatchRubroGroup,
  resolveFeatureRubroContext
} from './batch/utils/resolveBatchRubroGroup';
import './BatchManager.css';

export default function BatchManager({ selectedProductId, onProductSelect }) {
  const menu = useInventoryCatalogStore((state) => state.menu);
  const refreshData = useInventoryCatalogStore((state) => state.loadInitialProducts);

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
  const clearSelection = () => {
    controller.setSearchTerm('');
    controller.setShowSuggestions(false);
    onProductSelect(null);
  };

  return (
    <div className="batch-manager-container">
      <header className="batch-manager-header">
        <div className="batch-manager-title">
          <Layers3 size={24} aria-hidden="true" />
          <div>
            <h2>Lotes y variantes</h2>
            <p>Consulta y administra ingresos de inventario por producto.</p>
          </div>
        </div>
      </header>

      <div className="batch-manager-search">
        <label className="form-label" htmlFor="batch-product-search">Buscar producto</label>
        <BatchProductSearch
          inputId="batch-product-search"
          searchTerm={controller.searchTerm}
          onSearchTermChange={controller.setSearchTerm}
          onClearSelection={clearSelection}
          showSuggestions={controller.showSuggestions}
          onSetShowSuggestions={controller.setShowSuggestions}
          filteredProducts={controller.filteredProducts}
          onSelectProduct={controller.handleSelectProduct}
        />
        <small>Puedes buscar cualquier producto, aunque aún no tenga lotes.</small>
      </div>

      {!selectedProductId && (
        <BatchProductDirectory onSelectProduct={controller.handleSelectProduct} />
      )}

      {selectedProductId && !selectedProduct && (
        <p className="batch-state-message" role="status">Cargando producto...</p>
      )}

      {selectedProduct && (
        <section className="batch-selected-product" aria-label={`Lotes de ${selectedProduct.name}`}>
          <button type="button" className="batch-back-button" onClick={clearSelection}>
            <ArrowLeft size={17} aria-hidden="true" /> Ver otros productos
          </button>
          <div className="batch-selected-heading">
            <h3>{selectedProduct.name}</h3>
            <p>Existencias, historial y movimientos de sus lotes.</p>
          </div>
          <BatchTable
            product={selectedProduct}
            features={features}
            productBatches={controller.productBatches}
            totalStock={controller.totalStock}
            inventoryValue={controller.inventoryValue}
            isLoadingBatches={controller.isLoadingBatches}
            isLoadingInitial={controller.isLoadingInitial}
            isLoadingNextPage={controller.isLoadingNextPage}
            isRefreshing={controller.isRefreshing}
            loadedCount={controller.loadedCount}
            totalCount={controller.totalCount}
            hasMore={controller.hasMore}
            onRefresh={controller.refreshBatches}
            onLoadMore={controller.loadMoreBatches}
            onOpenNew={controller.openNewBatchModal}
            onEditBatch={controller.handleEditBatch}
            onDeleteBatch={controller.handleDeleteBatch}
          />
        </section>
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
