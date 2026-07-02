import { useEffect, useState, useMemo, useCallback } from 'react';
import { db, STORES } from '../../services/db';
import { SALE_STATUS } from '../../services/sales/financialStats';
import { useRestaurantOrderCloudStatus } from '../../hooks/restaurant/useRestaurantOrderCloudStatus';
import './TablesView.css';

const getTableLabel = (order) => {
  const tableName = typeof order?.tableData === 'string' ? order.tableData.trim() : '';
  if (tableName) return tableName;

  const orderId = String(order?.id || '');
  const shortId = orderId.slice(-6) || 'N/A';
  return `Orden #${shortId}`;
};

const formatOrderDate = (value) => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
  return parsed.toLocaleString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
};

const getItemsCount = (items) => {
  if (!Array.isArray(items)) return 0;
  return items.length;
};

const isCancelledFromKitchen = (order) => order?.fulfillmentStatus === 'cancelled';

const filterOrdersBySearch = (orders, searchTerm) => {
  if (!searchTerm.trim()) return orders;
  const lowerSearch = searchTerm.toLowerCase();
  return orders.filter((order) => getTableLabel(order).toLowerCase().includes(lowerSearch));
};

const getCloudStatusClass = (status) => `table-cloud-status-badge--${String(status || 'pending').replace(/[^a-z0-9_-]/gi, '-')}`;

const TableCard = ({
  order,
  onSelectOrder,
  onCheckoutOrder,
  onSplitOrder,
  cancelledFromKitchen = false,
  onAnnulKitchenRejected,
  annulSubmitting = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const items = Array.isArray(order.items) ? order.items : [];
  const cloudStatus = useRestaurantOrderCloudStatus({
    localOrderId: order?.id,
    enabled: Boolean(order?.id)
  });
  const cloudItems = Array.isArray(cloudStatus.items) ? cloudStatus.items : [];
  const isKitchenCancelled = cancelledFromKitchen || cloudStatus.isCancelled;
  const showCloudPanel = cloudStatus.isCloudStatusEnabled && (
    cloudStatus.isLoading || cloudStatus.error || cloudStatus.cloudOrder
  );
  const hasCloudItems = cloudStatus.cloudOrder && cloudItems.length > 0;
  const showProductsToggle = items.length > 0 || hasCloudItems;

  const handleToggleAccordion = (e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      className={[
        'table-card',
        isKitchenCancelled ? 'table-card--kitchen-cancelled' : '',
        cloudStatus.isReady ? 'table-card--cloud-ready' : '',
        cloudStatus.hasCancelledItems ? 'table-card--cloud-cancelled-items' : '',
        cloudStatus.isCancelled ? 'table-card--cloud-cancelled' : '',
        order.requiresReview ? 'table-card--requires-review' : ''
      ].filter(Boolean).join(' ')}
    >
      {isKitchenCancelled && (
        <div className="table-card-kitchen-banner" role="status">
          Cancelada desde cocina: esta comanda ya no se prepara. Use &quot;Anular venta&quot; para
          cerrarla en sistema o abra en POS si debe ajustar cobro.
        </div>
      )}
      {order.requiresReview && !cancelledFromKitchen && (
        <div className="table-card-review-banner" role="status">
          {order.reviewReason || 'Orden inactiva. Revise si debe cobrarse o anularse.'}
        </div>
      )}
      {/* ERROR CORREGIDO: Se eliminó el onClick del body para evitar toques accidentales al hacer scroll en móvil */}
      <div className="table-card-body">
        <div className="table-card-title">
          <h3>{getTableLabel(order)}</h3>
          <span className="table-time">{formatOrderDate(order.updatedAt || order.timestamp)}</span>
        </div>
        <div className="table-card-stats">
          <div className="stat-item">
            <span className="stat-label">Items</span>
            <span className="stat-value">{getItemsCount(order.items)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total</span>
            <span className="stat-value total-highlight">${formatCurrency(order.total)}</span>
          </div>
        </div>

        {showCloudPanel && (
          <div className="table-cloud-status" role={cloudStatus.error ? 'alert' : 'status'}>
            {cloudStatus.isLoading && !cloudStatus.cloudOrder && (
              <span className="table-cloud-status-muted">Verificando cocina cloud…</span>
            )}
            {cloudStatus.error && (
              <span className="table-cloud-status-warning">{cloudStatus.error}</span>
            )}
            {cloudStatus.cloudOrder && (
              <>
                <div className="table-cloud-status-row">
                  <span className={`table-cloud-status-badge ${getCloudStatusClass(cloudStatus.status)}`}>
                    {cloudStatus.isCancelled ? 'Comanda cancelada' : cloudStatus.statusLabel}
                  </span>
                  {cloudStatus.hasCancelledItems && (
                    <span className="table-cloud-status-badge table-cloud-status-badge--cancelled-items">
                      Con items cancelados
                    </span>
                  )}
                </div>
                {cloudStatus.isReady && !cloudStatus.hasCancelledItems && (
                  <p className="table-cloud-status-hint">Lista para entregar/cobrar.</p>
                )}
                {cloudStatus.hasCancelledItems && (
                  <p className="table-cloud-status-hint table-cloud-status-hint--warning">
                    Cocina canceló {cloudStatus.cancelledItems.length} item(s). Se ajustará la cuenta antes de cobrar.
                  </p>
                )}
                {cloudStatus.isCancelled && (
                  <p className="table-cloud-status-hint table-cloud-status-hint--danger">
                    Todos los items activos fueron cancelados en cocina.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {showProductsToggle && (
        <button
          type="button"
          className="btn-accordion-toggle"
          onClick={handleToggleAccordion}
        >
          {isExpanded ? 'Ocultar productos ▲' : 'Ver productos ▼'}
        </button>
      )}

      <div className={`table-card-accordion ${isExpanded ? 'expanded' : ''}`}>
        <div className="accordion-items-list">
          {items.length > 0 && (
            <div className="accordion-local-items">
              {items.map((item, idx) => (
                <div key={`${item.id}-${idx}`} className="accordion-item-row">
                  <span className="item-qty">{item.quantity}x</span>
                  <span className="item-name">{item.name}</span>
                  <span className="item-price">${formatCurrency(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
          )}

          {hasCloudItems && (
            <div className="accordion-cloud-items">
              <div className="accordion-cloud-title">Estado de cocina cloud</div>
              {cloudItems.map((item) => {
                const statusLabel = cloudStatus.getItemStatusLabel(item?.status);
                const itemStatus = String(item?.status || 'pending').toLowerCase();
                const isCancelledItem = itemStatus === 'cancelled';
                const cloudItemKey = item.id
                  || item.orderItemId
                  || item.order_item_id
                  || item.localLineId
                  || item.local_line_id
                  || item.lineId
                  || item.line_id
                  || item.cartItemId
                  || `${item.productName || item.name || 'producto'}-${item.stationName || item.stationId || 'cocina'}-${itemStatus}-${item.quantity || 0}`;
                return (
                  <div
                    key={cloudItemKey}
                    className={`accordion-cloud-item-row${isCancelledItem ? ' accordion-cloud-item-row--cancelled' : ''}`}
                  >
                    <div className="accordion-cloud-item-main">
                      <span className="item-qty">{item.quantity}x</span>
                      <span className="item-name">{item.productName || item.name || 'Producto'}</span>
                    </div>
                    <div className="accordion-cloud-item-meta">
                      <span>{item.stationName || item.station_code || 'Cocina'}</span>
                      <span className={`table-cloud-item-badge table-cloud-item-badge--${itemStatus}`}>
                        {statusLabel}
                      </span>
                    </div>
                    {isCancelledItem && (
                      <div className="accordion-cloud-item-warning">Se ajustará la cuenta antes de cobrar.</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className={`table-card-actions${isKitchenCancelled ? ' table-card-actions--with-annul' : ''}`}
      >
        {isKitchenCancelled && onAnnulKitchenRejected && (
          <button
            type="button"
            className="btn-annull-kitchen"
            disabled={annulSubmitting}
            onClick={(e) => {
              e.stopPropagation();
              onAnnulKitchenRejected(order);
            }}
          >
            {annulSubmitting ? 'Anulando…' : 'Anular venta'}
          </button>
        )}
        <button
          type="button"
          className="btn-quick-edit"
          onClick={(e) => {
            e.stopPropagation();
            onSelectOrder?.(order.id);
          }}
        >
          {cancelledFromKitchen ? 'Abrir en POS' : 'Editar / Añadir'}
        </button>

        {!isKitchenCancelled && (
          <>
        <button
          type="button"
          className="btn-quick-split"
          onClick={(e) => {
            e.stopPropagation();
            onSplitOrder?.(order);
          }}
        >
          Separar
        </button>
        <button
          type="button"
          className="btn-quick-checkout"
          onClick={(e) => {
            e.stopPropagation();
            onCheckoutOrder?.(order);
          }}
        >
          Cobrar
        </button>
          </>
        )}
      </div>
    </div>
  );
};

export default function TablesView({
  show,
  onClose,
  onSelectOrder,
  onCheckoutOrder,
  onSplitOrder,
  onAfterTablesLoad,
  onAnnulKitchenRejectedOrder,
}) {
  const [openSalesRows, setOpenSalesRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [annullingOrderId, setAnnullingOrderId] = useState(null);

  const { ordersInService, ordersCancelledInKitchen } = useMemo(() => {
    const inService = [];
    const cancelledKitchen = [];
    openSalesRows.forEach((row) => {
      if (isCancelledFromKitchen(row)) cancelledKitchen.push(row);
      else inService.push(row);
    });
    return { ordersInService: inService, ordersCancelledInKitchen: cancelledKitchen };
  }, [openSalesRows]);

  const filteredInService = useMemo(
    () => filterOrdersBySearch(ordersInService, searchTerm),
    [ordersInService, searchTerm]
  );

  const filteredCancelledKitchen = useMemo(
    () => filterOrdersBySearch(ordersCancelledInKitchen, searchTerm),
    [ordersCancelledInKitchen, searchTerm]
  );

  const hasSearchHits =
    filteredInService.length > 0 || filteredCancelledKitchen.length > 0;
  const hasStoredRows = openSalesRows.length > 0;

  const loadOpenSalesRows = useCallback(
    async (withLoadingOverlay) => {
      if (withLoadingOverlay) {
        setIsLoading(true);
        setErrorMessage('');
      }
      try {
        const rows = await db
          .table(STORES.SALES)
          .where('status')
          .equals(SALE_STATUS.OPEN)
          .toArray();

        rows.sort((left, right) => {
          const leftDate = new Date(left?.updatedAt || left?.timestamp || 0).getTime();
          const rightDate = new Date(right?.updatedAt || right?.timestamp || 0).getTime();
          return rightDate - leftDate;
        });

        setOpenSalesRows(rows);
        try {
          onAfterTablesLoad?.();
        } catch {
          /* opcional */
        }
      } catch (error) {
        if (withLoadingOverlay) {
          setOpenSalesRows([]);
          setErrorMessage(error?.message || 'Error al cargar las mesas activas.');
        }
      } finally {
        if (withLoadingOverlay) setIsLoading(false);
      }
    },
    [onAfterTablesLoad]
  );

  useEffect(() => {
    if (!show) {
      setSearchTerm('');
      return undefined;
    }

    let isActive = true;

    (async () => {
      await loadOpenSalesRows(true);
      if (!isActive) return;
    })();

    return () => {
      isActive = false;
    };
  }, [show, loadOpenSalesRows]);

  const handleAnnulKitchenRejected = useCallback(
    async (order) => {
      if (!onAnnulKitchenRejectedOrder) return;
      setAnnullingOrderId(order.id);
      try {
        const result = await onAnnulKitchenRejectedOrder(order);
        if (result?.success) {
          await loadOpenSalesRows(false);
        }
      } finally {
        setAnnullingOrderId(null);
      }
    },
    [onAnnulKitchenRejectedOrder, loadOpenSalesRows]
  );

  const handleSelectAndClose = useCallback(
    (orderId) => {
      onSelectOrder?.(orderId);
      onClose?.();
    },
    [onSelectOrder, onClose]
  );

  const handleCheckoutAndClose = useCallback(
    (order) => {
      onCheckoutOrder?.(order);
      onClose?.();
    },
    [onCheckoutOrder, onClose]
  );

  const handleSplitAndClose = useCallback(
    (order) => {
      onSplitOrder?.(order);
      onClose?.();
    },
    [onSplitOrder, onClose]
  );

  if (!show) return null;

  return (
    <div
      className="modal tables-modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-content tables-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tables-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tables-modal-handle" aria-hidden="true" />
        <div className="tables-modal-shell">
          <header className="tables-header">
            <div className="tables-header-info">
              <h2 id="tables-modal-title">Mesas</h2>
              <p className="tables-header-summary">
                En servicio: {filteredInService.length}
                {ordersCancelledInKitchen.length > 0 && (
                  <>
                    {' '}
                    · Rechazadas en cocina: {filteredCancelledKitchen.length}
                  </>
                )}
              </p>
              <div className="tables-search-container">
                <input
                  type="search"
                  enterKeyHint="search"
                  placeholder="Buscar mesa u orden..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="tables-search-input"
                  autoComplete="off"
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-cancel tables-modal-close"
              onClick={onClose}
            >
              Cerrar
            </button>
          </header>

          <div className="tables-modal-body">
            {isLoading && <div className="tables-loading">Cargando mesas…</div>}
            {!isLoading && errorMessage && (
              <div className="tables-error" role="alert">
                {errorMessage}
              </div>
            )}
            {!isLoading && !errorMessage && !hasStoredRows && (
              <div className="tables-empty">No hay mesas activas en este momento.</div>
            )}
            {!isLoading && !errorMessage && hasStoredRows && !hasSearchHits && (
              <div className="tables-empty">No se encontraron mesas con esa búsqueda.</div>
            )}

            {!isLoading && !errorMessage && filteredCancelledKitchen.length > 0 && (
              <div className="tables-kitchen-cancelled-block">
                <h3 className="tables-subsection-title">
                  Rechazadas en cocina ({filteredCancelledKitchen.length})
                </h3>
                <p className="tables-subsection-hint">
                  Cocina canceló la preparación. Para quitarla del listado use &quot;Anular venta&quot;
                  (libera stock y cierra la venta sin cobro). Si debe cobrar o corregir, use Abrir en
                  POS.
                </p>
                <div className="tables-grid">
                  {filteredCancelledKitchen.map((order) => (
                    <TableCard
                      key={order.id}
                      order={order}
                      cancelledFromKitchen
                      onSelectOrder={handleSelectAndClose}
                      onCheckoutOrder={handleCheckoutAndClose}
                      onSplitOrder={handleSplitAndClose}
                      onAnnulKitchenRejected={handleAnnulKitchenRejected}
                      annulSubmitting={annullingOrderId === order.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {!isLoading && !errorMessage && filteredInService.length > 0 && (
              <div className="tables-in-service-block">
                <h3 className="tables-subsection-title">
                  En servicio ({filteredInService.length})
                </h3>
                <div className="tables-grid">
                  {filteredInService.map((order) => (
                    <TableCard
                      key={order.id}
                      order={order}
                      onSelectOrder={handleSelectAndClose}
                      onCheckoutOrder={handleCheckoutAndClose}
                      onSplitOrder={handleSplitAndClose}
                      onAnnulKitchenRejected={handleAnnulKitchenRejected}
                      annulSubmitting={annullingOrderId === order.id}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
