import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Clock3,
  CreditCard,
  Pencil,
  ReceiptText,
  Search,
  Split,
  UtensilsCrossed,
  X
} from 'lucide-react';
import { db, STORES } from '../../services/db';
import { SALE_STATUS } from '../../services/sales/financialStats';
import {
  buildRestaurantCloudStatusSummary,
  getRestaurantOrderCloudStatusSnapshot,
  RESTAURANT_CLOUD_STATUS_EVENT,
  useRestaurantOrderCloudStatus
} from '../../hooks/restaurant/useRestaurantOrderCloudStatus';
import {
  applyKitchenCancelledItemsAdjustment,
  persistKitchenCancelledItemsAdjustment
} from '../../services/restaurant/restaurantOrderAccountAdjustment';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { formatSelectedModifiersForDisplay } from '../../utils/restaurantModifierDisplay';
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

const getLocalItemIdentity = (item = {}) => String(
  item.lineId
  || item.line_id
  || item.cartItemId
  || item.cart_item_id
  || item.id
  || item.productId
  || item.product_id
  || ''
);

const getCloudItemIdentity = (item = {}) => String(
  item.orderItemId
  || item.order_item_id
  || item.localLineId
  || item.local_line_id
  || item.lineId
  || item.line_id
  || item.cartItemId
  || item.cart_item_id
  || item.productId
  || item.product_id
  || item.id
  || ''
);

const normalizeItemName = (value) => String(value || '').trim().toLowerCase();

const getItemQuantity = (item = {}) => Number(item.quantity ?? item.qty ?? 0) || 0;

const getCloudItemName = (item = {}) => item.productName || item.product_name || item.name || 'Producto';

const getCloudItemStation = (item = {}) => item.stationName || item.station_name || item.stationCode || item.station_code || 'Cocina';

const getItemLineTotal = (item = {}) => {
  const quantity = getItemQuantity(item);
  const unitPrice = Number(item.price ?? item.unitPrice ?? item.unit_price ?? 0);
  return unitPrice * quantity;
};

const getItemSelectedModifiers = (item = {}) => {
  if (!item || typeof item !== 'object') return [];

  const modifiers = item.selectedModifiers
    || item.selected_modifiers
    || item.metadata?.selectedModifiers
    || item.metadata?.selected_modifiers;

  return Array.isArray(modifiers) ? modifiers : [];
};

const getItemNotes = (item = {}) => String(
  item && typeof item === 'object' ? (
  item.notes
  || item.kitchenNotes
  || item.kitchen_notes
  || item.specifications
  || item.especificaciones
  || ''
  ) : ''
).trim();

const getRowModifierLabels = (item, cloudItem) => {
  const localModifiers = getItemSelectedModifiers(item);
  const cloudModifiers = getItemSelectedModifiers(cloudItem);
  const selectedModifiers = localModifiers.length > 0 ? localModifiers : cloudModifiers;
  return formatSelectedModifiersForDisplay(selectedModifiers);
};

const getRowNotes = (item, cloudItem) => getItemNotes(item) || getItemNotes(cloudItem);

const mergeOrderItemsWithCloudStatus = (items, cloudItems) => {
  const usedCloudIndexes = new Set();

  const rows = items.map((item, index) => {
    const localIdentity = getLocalItemIdentity(item);
    const localName = normalizeItemName(item.name);
    const localQty = getItemQuantity(item);
    const cloudIndex = cloudItems.findIndex((cloudItem, candidateIndex) => {
      if (usedCloudIndexes.has(candidateIndex)) return false;
      const cloudIdentity = getCloudItemIdentity(cloudItem);
      if (localIdentity && cloudIdentity && localIdentity === cloudIdentity) return true;
      return localName
        && normalizeItemName(getCloudItemName(cloudItem)) === localName
        && getItemQuantity(cloudItem) === localQty;
    });

    const cloudItem = cloudIndex >= 0 ? cloudItems[cloudIndex] : null;
    if (cloudIndex >= 0) usedCloudIndexes.add(cloudIndex);

    return {
      key: localIdentity || `${item.name || 'item'}-${index}`,
      type: 'local',
      item,
      cloudItem
    };
  });

  cloudItems.forEach((cloudItem, index) => {
    if (usedCloudIndexes.has(index)) return;
    rows.push({
      key: getCloudItemIdentity(cloudItem) || `${getCloudItemName(cloudItem)}-cloud-${index}`,
      type: 'cloud-only',
      item: null,
      cloudItem
    });
  });

  return rows;
};

const dispatchRestaurantCloudStatusRefresh = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RESTAURANT_CLOUD_STATUS_EVENT));
  }
};

const TableCard = ({
  order,
  onSelectOrder,
  onCheckoutOrder,
  onSplitOrder,
  cancelledFromKitchen = false,
  onAnnulKitchenRejected,
  annulSubmitting = false,
  onAdjustKitchenCancelled,
  adjustSubmitting = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const orderId = order?.id;
  const rawItems = order?.items;
  const items = useMemo(
    () => (Array.isArray(rawItems) ? rawItems : []),
    [rawItems]
  );
  const cloudStatus = useRestaurantOrderCloudStatus({
    localOrderId: orderId,
    enabled: Boolean(orderId)
  });
  const rawCloudItems = cloudStatus.items;
  const cloudItems = useMemo(
    () => (Array.isArray(rawCloudItems) ? rawCloudItems : []),
    [rawCloudItems]
  );
  const mergedOrderItems = useMemo(
    () => mergeOrderItemsWithCloudStatus(items, cloudItems),
    [cloudItems, items]
  );
  const cancelledKitchenAdjustmentPreview = useMemo(
    () => applyKitchenCancelledItemsAdjustment({
      orderId,
      orderItems: items,
      cloudItems
    }),
    [cloudItems, items, orderId]
  );
  const isAccountAdjustedForKitchenCancelledItems = Boolean(
    cloudStatus.hasCancelledItems
    && cancelledKitchenAdjustmentPreview.success
    && !cancelledKitchenAdjustmentPreview.changed
  );
  const isKitchenCancelled = cancelledFromKitchen || cloudStatus.isCancelled;
  const showCloudPanel = cloudStatus.isCloudStatusEnabled && (
    (cloudStatus.isLoading && !cloudStatus.cloudOrder)
    || cloudStatus.error
    || (cloudStatus.hasCancelledItems && !isAccountAdjustedForKitchenCancelledItems)
  );
  const showProductsToggle = mergedOrderItems.length > 0;

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
        cloudStatus.hasCancelledItems && !isAccountAdjustedForKitchenCancelledItems ? 'table-card--cloud-cancelled-items' : '',
        cloudStatus.isCancelled ? 'table-card--cloud-cancelled' : '',
        order.requiresReview ? 'table-card--requires-review' : ''
      ].filter(Boolean).join(' ')}
    >
      <div className="table-card-body">
        <div className="table-card-topline">
          <span className="table-card-kicker">
            <UtensilsCrossed size={14} aria-hidden="true" />
            Mesa activa
          </span>
          <span className="table-time">
            <Clock3 size={13} aria-hidden="true" />
            {formatOrderDate(order.updatedAt || order.timestamp)}
          </span>
        </div>

        <div className="table-card-title">
          <h3>{getTableLabel(order)}</h3>
          {cloudStatus.cloudOrder && (
            <span className={`table-cloud-status-badge ${getCloudStatusClass(cloudStatus.status)}`}>
              {cloudStatus.isCancelled ? 'Cancelada' : cloudStatus.statusLabel}
            </span>
          )}
        </div>

        <div className="table-card-command-panel">
          <div className="table-card-stats">
            <div className="stat-item">
              <span className="stat-label">Productos</span>
              <span className="stat-value">{getItemsCount(order.items)}</span>
            </div>
            <div className="stat-item stat-item--total">
              <span className="stat-label">Total</span>
              <span className="stat-value total-highlight">${formatCurrency(order.total)}</span>
            </div>
            {showProductsToggle && (
              <button
                type="button"
                className="btn-accordion-toggle btn-accordion-toggle--stats"
                onClick={handleToggleAccordion}
                aria-expanded={isExpanded}
              >
                <ReceiptText size={16} aria-hidden="true" />
                <span>{isExpanded ? 'Ocultar comanda' : 'Ver comanda'}</span>
                {isExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </button>
            )}
          </div>

          <div className={`table-card-accordion ${isExpanded ? 'expanded' : ''}`}>
            <div className="accordion-items-list">
              {mergedOrderItems.map((row, index) => {
                const displayItem = row.item || row.cloudItem || {};
                const cloudItem = row.cloudItem;
                const itemStatus = cloudItem ? String(cloudItem?.status || 'pending').toLowerCase() : 'local';
                const statusLabel = cloudItem ? cloudStatus.getItemStatusLabel(cloudItem?.status) : 'En cuenta';
                const isCancelledItem = itemStatus === 'cancelled';
                const quantity = getItemQuantity(displayItem);
                const itemName = row.item?.name || getCloudItemName(cloudItem);
                const lineTotal = row.item ? getItemLineTotal(row.item) : null;
                const modifierLabels = getRowModifierLabels(row.item, cloudItem);
                const itemNotes = getRowNotes(row.item, cloudItem);

                return (
                  <div
                    key={row.key || index}
                    className={[
                      'accordion-item-row',
                      row.type === 'cloud-only' ? 'accordion-item-row--cloud-only' : '',
                      isCancelledItem ? 'accordion-item-row--cancelled' : ''
                    ].filter(Boolean).join(' ')}
                  >
                    <div className="accordion-item-main">
                      <span className="item-qty">{quantity || 1}x</span>
                      <span className="item-name">{itemName}</span>
                      {lineTotal !== null && (
                        <span className="item-price">${formatCurrency(lineTotal)}</span>
                      )}
                    </div>

                    {(modifierLabels.length > 0 || itemNotes) && (
                      <div className="accordion-item-details">
                        {modifierLabels.length > 0 && (
                          <div className="accordion-item-modifiers" aria-label="Extras seleccionados">
                            <span className="accordion-item-details-label">Extras</span>
                            <div className="accordion-item-modifier-tags">
                              {modifierLabels.map((label, modifierIndex) => (
                                <span
                                  key={`${row.key || index}-modifier-${label}-${modifierIndex}`}
                                  className="accordion-item-modifier-tag"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {itemNotes && (
                          <div className="accordion-item-note">
                            <span className="accordion-item-details-label">Nota</span>
                            <span>{itemNotes}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="accordion-item-meta">
                      {cloudItem && <span className="item-station">{getCloudItemStation(cloudItem)}</span>}
                      <span className={`table-cloud-item-badge table-cloud-item-badge--${itemStatus}`}>
                        {statusLabel}
                      </span>
                    </div>

                    {isCancelledItem && (
                      <div className="accordion-cloud-item-warning">
                        {isAccountAdjustedForKitchenCancelledItems
                          ? 'Ya fue retirado de la cuenta local.'
                          : 'Se ajustará la cuenta antes de cobrar.'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {isKitchenCancelled && (
          <div className="table-card-kitchen-banner" role="status">
            <Ban size={16} aria-hidden="true" />
            <span>Cancelada desde cocina. Anula la venta o abre POS para corregir cobro.</span>
          </div>
        )}
        {order.requiresReview && !cancelledFromKitchen && (
          <div className="table-card-review-banner" role="status">
            <Ban size={16} aria-hidden="true" />
            <span>{order.reviewReason || 'Orden inactiva. Revise si debe cobrarse o anularse.'}</span>
          </div>
        )}

        {showCloudPanel && (
          <div className="table-cloud-status table-cloud-status--compact" role={cloudStatus.error ? 'alert' : 'status'}>
            {cloudStatus.isLoading && !cloudStatus.cloudOrder && (
              <span className="table-cloud-status-muted">Sincronizando cocina cloud...</span>
            )}
            {cloudStatus.error && (
              <span className="table-cloud-status-warning">{cloudStatus.error}</span>
            )}
            {cloudStatus.hasCancelledItems && !isAccountAdjustedForKitchenCancelledItems && (
              <>
                <p className="table-cloud-status-hint table-cloud-status-hint--warning">
                  Cocina canceló {cloudStatus.cancelledItems.length} item(s). Puedes retirarlos de la cuenta antes de cobrar.
                </p>
                <button
                  type="button"
                  className="table-cloud-adjust-btn"
                  disabled={adjustSubmitting}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdjustKitchenCancelled?.(order);
                  }}
                >
                  {adjustSubmitting ? 'Ajustando...' : 'Retirar cancelados'}
                </button>
              </>
            )}
          </div>
        )}

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
            <Ban size={16} aria-hidden="true" />
            {annulSubmitting ? 'Anulando...' : 'Anular venta'}
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
          <Pencil size={16} aria-hidden="true" />
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
              <Split size={16} aria-hidden="true" />
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
              <CreditCard size={16} aria-hidden="true" />
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
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const [openSalesRows, setOpenSalesRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [annullingOrderId, setAnnullingOrderId] = useState(null);
  const [adjustingOrderId, setAdjustingOrderId] = useState(null);

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

  const handleAdjustKitchenCancelled = useCallback(
    async (order) => {
      if (!order?.id) return;

      setAdjustingOrderId(order.id);
      try {
        const response = await getRestaurantOrderCloudStatusSnapshot({
          licenseDetails,
          localOrderId: order.id,
          force: true
        });

        if (response?.success === false) {
          showMessageModal(
            response.message || 'No se pudo verificar cocina cloud. Intenta de nuevo antes de ajustar la cuenta.',
            null,
            { type: 'warning' }
          );
          return;
        }

        const summary = response?.summary || buildRestaurantCloudStatusSummary(response?.order || null);
        if (!summary.hasCancelledItems) {
          showMessageModal('Cocina ya no reporta items cancelados para esta mesa.', null, { type: 'success' });
          dispatchRestaurantCloudStatusRefresh();
          return;
        }

        const confirmed = await showConfirmModal(
          `Cocina canceló ${summary.cancelledItems.length} item(s). ¿Quieres retirarlos de la cuenta local?`,
          {
            title: 'Retirar cancelados de la cuenta',
            type: 'warning',
            confirmButtonText: 'Sí, retirar',
            cancelButtonText: 'Volver'
          }
        );

        if (!confirmed) return;

        const sale = await db.table(STORES.SALES).get(order.id);
        if (!sale || sale.status !== SALE_STATUS.OPEN) {
          showMessageModal('La mesa ya no está abierta. Recarga Mesas antes de ajustar.', null, { type: 'warning' });
          await loadOpenSalesRows(false);
          return;
        }

        const adjustment = applyKitchenCancelledItemsAdjustment({
          orderId: order.id,
          orderItems: Array.isArray(sale.items) ? sale.items : order.items,
          cloudItems: summary.items
        });

        if (!adjustment.success) {
          showMessageModal(adjustment.message, null, { type: 'warning' });
          return;
        }

        if (!adjustment.changed) {
          showMessageModal('Los items cancelados por cocina ya no están en la cuenta.', null, { type: 'success' });
          await loadOpenSalesRows(false);
          dispatchRestaurantCloudStatusRefresh();
          return;
        }

        const saveResult = await useActiveOrders.getState().saveOrderAsOpen(order.id, {
          ...sale,
          id: order.id,
          items: adjustment.kept,
          isSaved: true
        });

        if (!saveResult?.success) {
          showMessageModal(saveResult?.message || 'No se pudo guardar la mesa ajustada.', null, { type: 'error' });
          return;
        }

        const auditResult = await persistKitchenCancelledItemsAdjustment({
          orderId: order.id,
          audit: adjustment.audit
        });
        if (auditResult?.success === false) {
          console.warn('[REST.6] No se pudo guardar auditoría local de ajuste:', auditResult.message);
        }

        const persistedSale = await db.table(STORES.SALES).get(order.id);
        const persistedItems = Array.isArray(persistedSale?.items) ? persistedSale.items : adjustment.kept;
        const activeOrdersState = useActiveOrders.getState();
        if (activeOrdersState.activeOrders.has(order.id)) {
          activeOrdersState.updateOrderItems(order.id, persistedItems);
        }

        await loadOpenSalesRows(false);
        dispatchRestaurantCloudStatusRefresh();
        showMessageModal(
          `Cuenta actualizada. Se retiraron ${adjustment.removedCount} item(s) cancelados por cocina.`,
          null,
          { type: 'success' }
        );
      } catch (error) {
        console.error('[REST.6] Error ajustando cancelados desde Mesas:', error);
        showMessageModal(error?.message || 'No se pudo ajustar la cuenta.', null, { type: 'error' });
      } finally {
        setAdjustingOrderId(null);
      }
    },
    [licenseDetails, loadOpenSalesRows]
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
        <div className="tables-modal-shell">
          <header className="tables-header">
            <div className="tables-header-info">
              <div className="tables-title-block">
                <span className="tables-header-kicker">Restaurante</span>
                <h2 id="tables-modal-title">Mesas activas</h2>
              </div>
              <div className="tables-header-summary" aria-label="Resumen de mesas">
                <span className="tables-summary-chip tables-summary-chip--active">
                  <UtensilsCrossed size={15} aria-hidden="true" />
                  {filteredInService.length} en servicio
                </span>
                {ordersCancelledInKitchen.length > 0 && (
                  <span className="tables-summary-chip tables-summary-chip--danger">
                    <Ban size={15} aria-hidden="true" />
                    {filteredCancelledKitchen.length} rechazadas
                  </span>
                )}
              </div>
              <div className="tables-search-container">
                <Search size={17} aria-hidden="true" />
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
              aria-label="Cerrar mesas"
              onClick={onClose}
            >
              <X size={18} aria-hidden="true" />
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
                      onAdjustKitchenCancelled={handleAdjustKitchenCancelled}
                      adjustSubmitting={adjustingOrderId === order.id}
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
                      onAdjustKitchenCancelled={handleAdjustKitchenCancelled}
                      adjustSubmitting={adjustingOrderId === order.id}
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
