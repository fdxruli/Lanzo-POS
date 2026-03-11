import React from 'react';
import { getBatchTableColumns } from './utils/tableColumns';

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
          <>
            <strong>{batch.attributes?.talla || '-'}</strong>{' '}
            {batch.attributes?.color || ''}
          </>
        );
      }
      return <>{formatDate(batch.createdAt)}</>;
    }

    if (columnKey === 'sku') {
      return <small>{batch.sku || '-'}</small>;
    }

    if (columnKey === 'expiryDate') {
      return <>{formatDate(batch.expiryDate)}</>;
    }

    if (columnKey === 'price') {
      return <>${Number(batch.price || 0).toFixed(2)}</>;
    }

    if (columnKey === 'location') {
      return <small>{batch.location || '-'}</small>;
    }

    if (columnKey === 'stock') {
      return (
        <span className={`batch-badge ${batch.stock > 0 ? 'activo' : 'agotado'}`}>
          {batch.stock}
        </span>
      );
    }

    if (columnKey === 'actions') {
      return (
        <>
          <button
            type="button"
            className="btn-action"
            title="Editar lote"
            onClick={() => onEditBatch(batch)}
          >
            E
          </button>
          <button
            type="button"
            className="btn-action"
            title="Archivar lote"
            onClick={() => onDeleteBatch(batch)}
          >
            A
          </button>
        </>
      );
    }

    return null;
  };

  return (
    <div className="batch-details-container">
      <div className="batch-controls">
        <h4 style={{ margin: 0, fontSize: '1rem' }}>
          Lotes/Variantes: {productBatches.length}
          <br />
          <span style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>
            Stock Total: {totalStock} | Valor: ${inventoryValue.toFixed(2)}
          </span>
        </h4>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefresh}
            disabled={isLoadingBatches}
            title="Actualizar stock desde la base de datos"
          >
            {isLoadingBatches ? 'Actualizando...' : 'Actualizar'}
          </button>

          <button
            type="button"
            className="btn btn-save"
            onClick={onOpenNew}
          >
            + Nuevo Ingreso
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
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
          </tbody>
        </table>
      </div>
    </div>
  );
}

