import {
  Archive, Edit2, Plus, RefreshCw
} from 'lucide-react';
import { getAvailableStock, getCommittedStock } from '../../../services/db/utils';
import { getBatchManagerStatus } from '../../../services/products/batchManagerQueries';
import { isCommercialVariantProduct } from '../../../services/products/commercialVariants';

const formatDate = (isoDate) => {
  if (!isoDate) return 'Sin fecha';
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-MX');
};

const formatMoney = (amount) => Number(amount || 0).toLocaleString('es-MX', {
  style: 'currency',
  currency: 'MXN'
});

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
  const showExpiry = Boolean(features.hasLots || features.hasExpiry);
  const showVariants = Boolean(features.hasVariants);

  return (
    <div className="batch-details-container">
      <dl className="batch-stats-grid" aria-label="Resumen de inventario del producto">
        <div className="batch-stat-card">
          <dt>Registros</dt>
          <dd>{loadedCount} <span>de {totalCount}</span></dd>
        </div>
        <div className="batch-stat-card">
          <dt>Existencias físicas</dt>
          <dd>{totalStock}</dd>
        </div>
        <div className="batch-stat-card">
          <dt>Valor en inventario</dt>
          <dd>{formatMoney(inventoryValue)}</dd>
        </div>
      </dl>

      <div className="batch-controls">
        <div>
          <h4 className="batch-table-title">Detalle de lotes</h4>
          <p className="batch-table-hint">Edita, registra ingresos o consulta el historial del producto.</p>
        </div>
        <div className="batch-action-buttons">
          <button
            type="button"
            className="ui-button ui-button--secondary batch-control-button"
            onClick={onRefresh}
            disabled={isLoadingInitial || isRefreshing}
            aria-label="Actualizar lotes"
            title="Volver a consultar los lotes guardados"
          >
            <RefreshCw size={16} className={(isLoadingInitial || isRefreshing) ? 'icon-spin' : ''} aria-hidden="true" />
            <span>{(isLoadingInitial || isRefreshing) ? 'Actualizando...' : 'Actualizar'}</span>
          </button>
          <button type="button" className="ui-button ui-button--primary batch-control-button" onClick={onOpenNew}>
            <Plus size={17} aria-hidden="true" />
            <span>Nuevo ingreso</span>
          </button>
        </div>
      </div>

      {isLoadingInitial && (
        <p role="status" className="batch-state-message">Consultando lotes...</p>
      )}

      {!isLoadingInitial && productBatches.length === 0 && (
        <div className="batch-detail-empty">
          <strong>Sin lotes registrados</strong>
          <p>Registra el primer ingreso para comenzar a controlar su inventario.</p>
        </div>
      )}

      {productBatches.length > 0 && (
        <div className="batch-entry-list" role="list" aria-label="Lotes registrados">
          {productBatches.map((batch) => {
            const archived = getBatchManagerStatus(batch) === 'archived';
            const available = getAvailableStock(batch);
            const committed = getCommittedStock(batch);
            const primaryLabel = showVariants
              ? [batch.attributes?.talla, batch.attributes?.color].filter(Boolean).join(' · ') || 'Variante sin atributos'
              : `Ingreso del ${formatDate(batch.createdAt)}`;
            const supplier = typeof batch.supplier === 'string'
              ? batch.supplier
              : (batch.supplierName || '');
            return (
              <article
                key={batch.id}
                role="listitem"
                className={`batch-entry ${archived ? 'batch-entry--archived' : ''}`}
              >
                <div className="batch-entry-header">
                  <div className="batch-entry-identity">
                    <strong>{primaryLabel}</strong>
                    {batch.sku && <span className="batch-entry-sku">SKU {batch.sku}</span>}
                  </div>
                  <span className={`batch-entry-status ${archived ? 'is-archived' : 'is-active'}`}>
                    {archived ? 'Archivado' : 'Activo'}
                  </span>
                </div>

                <div className="batch-entry-body">
                  <div className="batch-entry-stock">
                    <span>Disponible</span>
                    <strong>{available}</strong>
                    {committed > 0 && <small>{committed} reservadas</small>}
                  </div>
                  <dl className="batch-entry-meta">
                    {showExpiry && (
                      <div><dt>Caducidad</dt><dd>{formatDate(batch.expiryDate)}</dd></div>
                    )}
                    <div><dt>Precio de venta</dt><dd>{formatMoney(getDisplayedBatchSalePrice(product, batch))}</dd></div>
                    {supplier && <div><dt>Proveedor</dt><dd>{supplier}</dd></div>}
                    {batch.location && <div><dt>Ubicación</dt><dd>{batch.location}</dd></div>}
                  </dl>
                </div>

                <div className="batch-entry-actions">
                  <button
                    type="button"
                    className="ui-button ui-button--ghost ui-button--sm"
                    onClick={() => onEditBatch(batch)}
                    disabled={archived}
                    aria-label={`Editar ${primaryLabel}`}
                  >
                    <Edit2 size={15} aria-hidden="true" /> Editar
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--ghost ui-button--sm batch-entry-archive"
                    onClick={() => onDeleteBatch(batch)}
                    disabled={archived}
                    aria-label={`Archivar ${primaryLabel}`}
                  >
                    <Archive size={15} aria-hidden="true" /> Archivar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="batch-load-more-container">
          <button
            type="button"
            className="ui-button ui-button--secondary batch-load-more"
            onClick={onLoadMore}
            disabled={isLoadingBatches}
            aria-busy={isLoadingNextPage}
          >
            <RefreshCw size={16} className={isLoadingNextPage ? 'icon-spin' : ''} aria-hidden="true" />
            {isLoadingNextPage ? 'Cargando lotes...' : 'Cargar más lotes'}
          </button>
        </div>
      )}
    </div>
  );
}
