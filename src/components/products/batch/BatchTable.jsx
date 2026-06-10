import React from 'react';
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

const formatDate = (isoDate) => (isoDate ? new Date(isoDate).toLocaleDateString() : '-');

export default function BatchTable({
  features,
  productBatches,
  totalStock,
  inventoryValue,
  isLoadingBatches,
  onRefresh,
  onOpenNew,
  onEditBatch,
  onDeleteBatch
}) {
  const columns = getBatchTableColumns(features);

  const renderCell = (batch, columnKey) => {
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
      return <strong className="batch-price-text">${Number(batch.price || 0).toFixed(2)}</strong>;
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
            title={batch.isArchived ? "No se puede editar un lote archivado" : "Editar información"}
            onClick={() => onEditBatch(batch)}
            disabled={batch.isArchived}
            style={{ opacity: batch.isArchived ? 0.4 : 1, cursor: batch.isArchived ? 'not-allowed' : 'pointer' }}
          >
            <Edit2 size={16} />
          </button>
          <button
            type="button"
            className="btn-action archive"
            title={batch.isArchived ? "Este lote ya está archivado" : "Archivar"}
            onClick={() => onDeleteBatch(batch)}
            disabled={batch.isArchived}
            style={{ opacity: batch.isArchived ? 0.4 : 1, cursor: batch.isArchived ? 'not-allowed' : 'pointer' }}
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
            <span className="stat-value">{productBatches.length}</span>
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
            disabled={isLoadingBatches}
            title="Actualizar stock desde la base de datos"
          >
            <RefreshCw size={16} className={isLoadingBatches ? 'icon-spin' : ''} />
            <span>{isLoadingBatches ? 'Actualizando...' : 'Actualizar'}</span>
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
              <tr key={batch.id} className={!batch.isActive ? 'inactive-batch' : ''}>
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
    </div>
  );
}