import { 
  Edit2, 
  Archive, 
  RefreshCw, 
  Plus, 
  Layers, 
  Package, 
  DollarSign 
} from 'lucide-react';
import { getBatchTableColumns } from './utils/tableColumns';
import { getAvailableStock, getCommittedStock } from '../../../services/db/utils';
import { getBatchManagerStatus } from '../../../services/products/batchManagerQueries';
import { isCommercialVariantProduct } from '../../../services/products/commercialVariants';

const formatDate = (isoDate) => (isoDate ? new Date(isoDate).toLocaleDateString() : '-');

export function getDisplayedBatchSalePrice(product = {}, batch = {}) {
  if (isCommercialVariantProduct({ ...product, activeBatches: [batch] })) {
    return Number(batch.price || 0);
  }

  return Number(product.price || 0);
}

export default function BatchTable({
  product,
  features,
  productBatches,
  totalStock,
  inventoryValue,
  isLoadingBatches,
  isLoadingInitial,
  isLoadingNextPage,
  isRefreshing,
  loadedCount,
  totalCount,
  hasMore,
  onRefresh,
  onLoadMore,
  onOpenNew,
  onEditBatch,
  onDeleteBatch
}) {
  const isCommercialVariant = isCommercialVariantProduct({
    ...product,
    activeBatches: product?.activeBatches?.length ? product.activeBatches : productBatches
  });
  const columns = getBatchTableColumns(features, { isCommercialVariant });

  const renderCell = (batch, columnKey) => {
    const isArchived = getBatchManagerStatus(batch) === 'archived';
    if (columnKey === 'primary') {
      if (features.hasVariants) {
        return (
          <div className="batch-primary-info">
            <strong>{batch.attributes?.talla || '-'}</strong>{' '}
            <span className="batch-color-text">{batch.attributes?.color || ''}</span>
          </div>
        );
      }
      return <span className="batch-date-text">{formatDate(batch.createdAt)}</span>;
    }

    if (columnKey === 'sku') {
      return <span className="batch-sku-badge">{batch.sku || 'N/A'}</span>;
    }

    if (columnKey === 'expiryDate') {
      return <span>{formatDate(batch.expiryDate)}</span>;
    }

    if (columnKey === 'price') {
      return <strong className="batch-price-text">${getDisplayedBatchSalePrice(product, batch).toFixed(2)}</strong>;
    }

    if (columnKey === 'location') {
      return <span className="batch-location-text">{batch.location || '-'}</span>;
    }

    if (columnKey === 'stock') {
      const availableStock = getAvailableStock(batch);
      const committed = getCommittedStock(batch);
      const hasCommitted = committed > 0;

      return (
        <div className="batch-stock-container">
          <span className={`batch-badge ${availableStock > 0 ? 'activo' : 'agotado'}`}>
            {availableStock}
          </span>
          {hasCommitted && (
            <span className="batch-committed-text">
              -{committed} reserv.
            </span>
          )}
        </div>
      );
    }

    if (columnKey === 'actions') {
      return (
        <div className="batch-actions-container">
          <button
            type="button"
            className="btn-action edit"
            title={isArchived ? "No se puede editar un lote archivado" : "Editar información"}
            onClick={() => onEditBatch(batch)}
            disabled={isArchived}
            style={{ opacity: isArchived ? 0.4 : 1, cursor: isArchived ? 'not-allowed' : 'pointer' }}
          >
            <Edit2 size={16} />
          </button>
          <button
            type="button"
            className="btn-action archive"
            title={isArchived ? "Este lote ya está archivado" : "Archivar"}
            onClick={() => onDeleteBatch(batch)}
            disabled={isArchived}
            style={{ opacity: isArchived ? 0.4 : 1, cursor: isArchived ? 'not-allowed' : 'pointer' }}
          >
            <Archive size={16} />
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="batch-details-container">
      
      {/* Nuevo panel de estadísticas detalladas */}
      <div className="batch-stats-grid">
        <div className="batch-stat-card">
          <div className="stat-icon variants"><Layers size={22} /></div>
          <div className="stat-info">
            <span className="stat-label">Registros / Variantes</span>
            <span className="stat-value">{loadedCount} de {totalCount}</span>
            <span className="stat-detail">Mostrados / totales</span>
          </div>
        </div>
        <div className="batch-stat-card">
          <div className="stat-icon stock"><Package size={22} /></div>
          <div className="stat-info">
            <span className="stat-label">Stock Total</span>
            <span className="stat-value">{totalStock}</span>
          </div>
        </div>
        <div className="batch-stat-card">
          <div className="stat-icon value"><DollarSign size={22} /></div>
          <div className="stat-info">
            <span className="stat-label">Valor en Inventario</span>
            <span className="stat-value">${inventoryValue.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="batch-controls">
        <h4 className="batch-table-title">Detalle de Inventario</h4>

        <div className="batch-action-buttons">
          <button
            type="button"
            className="btn btn-secondary btn-with-icon"
            onClick={onRefresh}
            disabled={isLoadingInitial || isRefreshing}
            title="Actualizar stock desde la base de datos"
          >
            <RefreshCw size={16} className={(isLoadingInitial || isRefreshing) ? 'icon-spin' : ''} />
            <span>{(isLoadingInitial || isRefreshing) ? 'Actualizando...' : 'Actualizar'}</span>
          </button>

          <button
            type="button"
            className="btn btn-save btn-with-icon"
            onClick={onOpenNew}
          >
            <Plus size={18} />
            <span>Nuevo Ingreso</span>
          </button>
        </div>
      </div>

      <div className="table-responsive-wrapper">
        <table className="batch-list-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productBatches.map((batch) => (
              <tr
                key={batch.id}
                className={getBatchManagerStatus(batch) === 'archived' ? 'inactive-batch' : ''}
              >
                {columns.map((column) => (
                  <td key={`${batch.id}-${column.key}`}>
                    {renderCell(batch, column.key)}
                  </td>
                ))}
              </tr>
            ))}
            {productBatches.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="empty-table-message">
                  No hay lotes o variantes registradas para este producto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="batch-load-more-container">
          <button
            type="button"
            className="btn btn-secondary btn-with-icon batch-load-more"
            onClick={onLoadMore}
            disabled={isLoadingBatches}
            aria-busy={isLoadingNextPage}
          >
            <RefreshCw size={16} className={isLoadingNextPage ? 'icon-spin' : ''} />
            <span>{isLoadingNextPage ? 'Cargando lotes...' : 'Cargar más lotes'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
