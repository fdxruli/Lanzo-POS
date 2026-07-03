import { useMemo } from 'react';
import {
  Archive,
  AlertTriangle,
  CheckCircle,
  ChefHat,
  Clock,
  Flame,
  History,
  RefreshCw,
  StickyNote,
  Store,
  User,
  UtensilsCrossed,
  X
} from 'lucide-react';

const STATUS_LABELS = {
  pending: 'Pendiente',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};

const PAYMENT_LABELS = {
  paid: 'Pagada',
  unpaid: 'Sin cobrar',
  pending: 'Pago pendiente',
  partial: 'Pago parcial'
};

const TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);
const CANCELLABLE_ITEM_STATUSES = new Set(['pending', 'preparing']);
const ACTIVE_ITEM_TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);
const CANCELLED_ITEM_STATUSES = new Set(['cancelled']);

const HISTORY_RANGE_OPTIONS = [
  { key: 'today', label: 'Hoy' },
  { key: '24h', label: 'Últimas 24 horas' },
  { key: '7d', label: 'Últimos 7 días' }
];

const HISTORY_STATUS_OPTIONS = [
  { key: null, label: 'Todos' },
  { key: 'delivered', label: 'Entregadas' },
  { key: 'cancelled', label: 'Canceladas' }
];

const normalizeOrderStatus = (status) => {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'sent' || normalized === 'sent_to_kitchen') return 'pending';
  if (normalized === 'completed') return 'delivered';
  return normalized || 'pending';
};

const getOrderStatus = (order = {}) => normalizeOrderStatus(order.fulfillmentStatus || order.status);
const getOrderTimestamp = (order = {}) => order.createdAt || order.timestamp || order.updatedAt || new Date().toISOString();
const getOrderUpdatedTimestamp = (order = {}) => order.updatedAt || order.createdAt || order.timestamp || new Date().toISOString();
const getOrderItems = (order = {}) => (Array.isArray(order.items) ? order.items : []);
const getPaymentStatus = (order = {}) => String(order.paymentStatus || 'unpaid').trim().toLowerCase();
const isArchivedOrder = (order = {}) => Boolean(order.archivedAt);
const isPaidPendingKitchen = (order = {}) => getPaymentStatus(order) === 'paid' && ['pending', 'preparing'].includes(getOrderStatus(order));

const getItemId = (item = {}) => item.id || item.restaurantOrderItemId || item.restaurant_order_item_id || null;
const getItemName = (item = {}) => item.productName || item.name || item.product_name || 'Producto';
const getItemQuantity = (item = {}) => item.quantity ?? item.qty ?? 1;
const getItemStatus = (item = {}) => normalizeOrderStatus(item.status || item.fulfillmentStatus || item.fulfillment_status || 'pending');

const normalizeModifiers = (modifiers) => {
  if (!Array.isArray(modifiers)) return [];
  return modifiers
    .map((modifier) => {
      if (typeof modifier === 'string') return modifier;
      return modifier?.name || modifier?.label || modifier?.modifierName || null;
    })
    .filter(Boolean);
};

const formatTime = (value) => {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN'
  });
};

const getActiveOrderItems = (order = {}) => (
  getOrderItems(order).filter((item) => !CANCELLED_ITEM_STATUSES.has(getItemStatus(item)))
);

const getCloudOrderProgress = (order = {}) => {
  const activeItems = getActiveOrderItems(order);
  const pendingItems = activeItems.filter((item) => getItemStatus(item) === 'pending');
  const preparingItems = activeItems.filter((item) => getItemStatus(item) === 'preparing');
  const readyItems = activeItems.filter((item) => getItemStatus(item) === 'ready');

  return {
    activeItems,
    pendingItems,
    preparingItems,
    readyItems,
    hasActiveItems: activeItems.length > 0,
    hasPendingItems: pendingItems.length > 0,
    hasPreparingItems: preparingItems.length > 0,
    allReady: activeItems.length > 0 && readyItems.length === activeItems.length
  };
};

const getDisplayOrderStatus = (order = {}) => {
  const status = getOrderStatus(order);
  if (TERMINAL_STATUSES.has(status)) return status;

  const progress = getCloudOrderProgress(order);
  if (!progress.hasActiveItems) return status;
  if (progress.allReady) return 'ready';
  if (progress.hasPreparingItems || progress.readyItems.length > 0) return 'preparing';
  if (progress.hasPendingItems) return 'pending';

  return status;
};

const getCloudStatusAction = (order) => {
  const status = getOrderStatus(order);
  if (TERMINAL_STATUSES.has(status)) return null;

  const progress = getCloudOrderProgress(order);
  if (status === 'ready' && (!progress.hasActiveItems || progress.allReady)) {
    return { nextStatus: 'delivered', label: 'Marcar entregado', className: 'deliver' };
  }

  if (progress.hasPendingItems) {
    return {
      nextStatus: 'preparing',
      label: progress.hasPreparingItems || progress.readyItems.length > 0 ? 'Preparar faltantes' : 'Marcar en preparación',
      className: 'advance'
    };
  }

  if (progress.hasPreparingItems) return { nextStatus: 'ready', label: 'Marcar listo', className: 'advance' };
  if (progress.allReady) return { nextStatus: 'ready', label: 'Marcar listo', className: 'advance' };

  return null;
};

const getTicketId = (order = {}) => {
  const id = order.paidSaleFolio || order.id || order.localOrderId || order.saleId || order.timestamp || '';
  const shortId = String(id).replace(/-/g, '').slice(-4).toUpperCase();
  return shortId || 'KDS';
};

const getHistoryFinalTimestamp = (order = {}) => (
  order.archivedAt || order.checkoutClosedAt || order.deliveredAt || order.cancelledAt || order.updatedAt || order.createdAt
);

const ProductionSummary = ({ items }) => {
  if (!items || items.length === 0) return null;

  return (
    <section className="production-bar" aria-label="Resumen a producir">
      <div className="prod-heading">
        <span>Producción</span>
        <strong>Ahora</strong>
      </div>
      <div className="prod-list">
        {items.map(([name, count]) => (
          <div key={name} className="prod-badge">
            <span className="prod-count">{count}</span>
            <span className="prod-name">{name}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

const TicketTimer = ({ timestamp, status }) => {
  const normalizedStatus = normalizeOrderStatus(status);
  if (TERMINAL_STATUSES.has(normalizedStatus)) return null;

  const startedAt = new Date(timestamp || Date.now()).getTime();
  const elapsed = Number.isFinite(startedAt) ? Math.max(Math.floor((Date.now() - startedAt) / 60000), 0) : 0;
  let urgencyClass = 'time-fresh';
  if (normalizedStatus === 'pending' || normalizedStatus === 'preparing') {
    if (elapsed > 10) urgencyClass = 'time-warning';
    if (elapsed > 20) urgencyClass = 'time-critical';
  }

  return (
    <div className={`ticket-timer ${urgencyClass}`}>
      <Clock size={14} />
      <span>{elapsed} min</span>
    </div>
  );
};

const KdsCommandCenter = ({ modeLabel, title, statusText, metrics, tabs, onRefresh, isLoading, canRefresh = true }) => (
  <section className="kds-command-center mode-cloud">
    <div className="kds-command-main">
      <div className="kds-title-block">
        <span className="kds-mode-pill mode-cloud">{modeLabel}</span>
        <h1>{title}</h1>
        {statusText && <p>{statusText}</p>}
      </div>

      <button
        type="button"
        className={`kds-refresh-btn ${isLoading ? 'loading' : ''}`}
        onClick={onRefresh}
        disabled={isLoading || !canRefresh}
        aria-label="Actualizar cocina"
        title="Actualizar cocina"
      >
        <RefreshCw size={20} strokeWidth={2.2} />
        <span>Actualizar</span>
      </button>
    </div>

    <div className="kds-metrics" aria-label="Resumen de cocina cloud">
      {metrics.map((metric) => (
        <div key={metric.label} className={`kds-metric tone-${metric.tone || 'neutral'}`}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>

    <div className="kds-tabs" role="tablist" aria-label="Vistas de cocina cloud">
      {tabs.map(({ key, label, count, Icon, tone, active, onClick }) => (
        <button
          key={key}
          type="button"
          className={`kds-tab tone-${tone} ${active ? 'active' : ''}`}
          onClick={onClick}
          aria-pressed={active}
        >
          <Icon size={18} />
          <span>{label}</span>
          {typeof count !== 'undefined' && <strong>{count}</strong>}
        </button>
      ))}
    </div>
  </section>
);

const HistoryDetail = ({ label, value }) => {
  if (!value) return null;
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
};

const HistoryFilters = ({ filters, setFilters, disabled }) => (
  <section className="kds-history-filters" aria-label="Filtros de historial de comandas">
    <div className="kds-history-filter">
      <span>Periodo</span>
      <div>
        {HISTORY_RANGE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={filters.range === option.key ? 'active' : ''}
            disabled={disabled}
            onClick={() => setFilters({ range: option.key })}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>

    <div className="kds-history-filter">
      <span>Estado</span>
      <div>
        {HISTORY_STATUS_OPTIONS.map((option) => (
          <button
            key={option.key || 'all'}
            type="button"
            className={(filters.status || null) === option.key ? 'active' : ''}
            disabled={disabled}
            onClick={() => setFilters({ status: option.key })}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  </section>
);

export default function CloudKitchenMonitorRest8({
  kitchenCloud,
  onAdvanceStatus,
  onCancelOrder,
  onChangeItemStatus,
  onCancelItemStatus,
  onArchiveOrder
}) {
  const {
    displayedOrders,
    orders,
    statusFilter,
    setStatusFilter,
    selectedStationCode,
    setSelectedStationCode,
    stationOptions,
    statusCounts,
    historyFilters,
    setHistoryFilters,
    isLoading,
    isUpdating,
    isArchiving,
    archivingOrderId,
    updatingOrderId,
    updatingItemId,
    error,
    hasReadPermission,
    hasWritePermission,
    lastUpdatedAt,
    refreshKitchenOrders
  } = kitchenCloud;

  const isHistoryView = statusFilter === 'history';

  const productionSummary = useMemo(() => {
    if (!['active', 'paid_pending'].includes(statusFilter)) return null;

    const summary = {};
    displayedOrders.forEach((order) => {
      getOrderItems(order).forEach((item) => {
        const itemStatus = getItemStatus(item);
        if (itemStatus === 'ready' || itemStatus === 'delivered' || itemStatus === 'cancelled') return;
        const key = getItemName(item);
        summary[key] = (summary[key] || 0) + Number(getItemQuantity(item) || 1);
      });
    });

    return Object.entries(summary)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
  }, [displayedOrders, statusFilter]);

  const showEmptyState = !isLoading && !error && displayedOrders.length === 0;
  const stationCount = stationOptions.filter((station) => !station.isAll).length;
  const selectedStation = stationOptions.find((station) => station.code === selectedStationCode);
  const commandMetrics = [
    { label: 'Activas', value: statusCounts.active ?? 0, tone: 'pending' },
    { label: 'Pagadas pendientes', value: statusCounts.paid_pending ?? 0, tone: 'ready' },
    { label: 'Historial', value: statusCounts.history ?? 0, tone: 'history' },
    { label: 'Estaciones', value: stationCount, tone: 'station' }
  ];
  const commandTabs = [
    {
      key: 'active',
      label: 'Activas',
      count: statusCounts.active ?? 0,
      Icon: Flame,
      tone: 'pending',
      active: statusFilter === 'active',
      onClick: () => setStatusFilter('active')
    },
    {
      key: 'paid_pending',
      label: 'Pagadas pendientes',
      count: statusCounts.paid_pending ?? 0,
      Icon: CheckCircle,
      tone: 'ready',
      active: statusFilter === 'paid_pending',
      onClick: () => setStatusFilter('paid_pending')
    },
    {
      key: 'history',
      label: 'Historial',
      count: statusCounts.history ?? 0,
      Icon: History,
      tone: 'history',
      active: statusFilter === 'history',
      onClick: () => setStatusFilter('history')
    }
  ];

  return (
    <>
      <KdsCommandCenter
        modeLabel={hasWritePermission ? 'PRO cloud' : 'PRO lectura'}
        title="Monitor de cocina"
        statusText={lastUpdatedAt ? `Actualizado ${formatTime(lastUpdatedAt)}` : 'Sincronizando cocina'}
        metrics={commandMetrics}
        tabs={commandTabs}
        onRefresh={() => refreshKitchenOrders({ force: true })}
        isLoading={isLoading}
        canRefresh={hasReadPermission}
      />

      <div className="kds-cloud-status-bar">
        <div>
          <strong>{hasWritePermission ? 'Cloud activo' : 'Modo consulta'}</strong>
          <span>
            {isHistoryView
              ? 'Historial operativo de comandas terminales'
              : selectedStation?.name ? `Estación: ${selectedStation.name}` : 'Estación: todas'}
          </span>
        </div>
        <small>{displayedOrders.length} comandas visibles</small>
      </div>

      {!isHistoryView && (
        <div className="kds-station-shell">
          <div className="kds-station-heading">
            <span>Estaciones</span>
            <strong>{selectedStation?.name || 'Todas'}</strong>
          </div>
          <div className="kds-station-filter" aria-label="Filtro por estación de preparación">
            {stationOptions.map((station) => (
              <button
                key={station.code || 'all'}
                type="button"
                className={`kds-station-tab ${selectedStationCode === station.code ? 'active' : ''}`}
                onClick={() => setSelectedStationCode(station.code)}
              >
                {station.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {isHistoryView && (
        <HistoryFilters
          filters={historyFilters || {}}
          setFilters={setHistoryFilters}
          disabled={isLoading || isArchiving}
        />
      )}

      {error && (
        <div className="kds-alert" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      <ProductionSummary items={productionSummary} />

      <div className="kds-grid">
        {isLoading && (orders.length === 0 || displayedOrders.length === 0) && (
          <div className="kds-loading">Actualizando cocina cloud...</div>
        )}

        {showEmptyState && (
          <div className="kds-empty">
            <div className="empty-icon">
              {statusFilter === 'active' ? <ChefHat size={64} /> : statusFilter === 'paid_pending' ? <CheckCircle size={64} /> : <History size={64} />}
            </div>
            <h3>
              {statusFilter === 'active' ? 'Cocina despejada' :
                statusFilter === 'paid_pending' ? 'Sin pagadas pendientes' : 'Sin historial reciente'}
            </h3>
            <p>
              {statusFilter === 'active' ? 'Las nuevas comandas cloud aparecerán aquí.' :
                statusFilter === 'paid_pending' ? 'Las mesas ya cobradas pero pendientes de cocina aparecerán aquí.' : 'Las comandas entregadas, canceladas o archivadas aparecerán aquí.'}
            </p>
          </div>
        )}

        {displayedOrders.map((order) => {
          const status = getOrderStatus(order);
          const displayStatus = getDisplayOrderStatus(order);
          const action = isHistoryView ? null : getCloudStatusAction(order);
          const ticketTotal = formatCurrency(order.paidTotal ?? order.total);
          const isCurrentOrderUpdating = updatingOrderId === order.id;
          const isCurrentArchiveUpdating = archivingOrderId === order.id;
          const isTerminal = TERMINAL_STATUSES.has(status);
          const archived = isArchivedOrder(order);
          const paymentStatus = getPaymentStatus(order);
          const paid = paymentStatus === 'paid';
          const paidPending = isPaidPendingKitchen(order);
          const progress = getCloudOrderProgress(order);
          const totalActiveItems = progress.activeItems.length;
          const canArchive = Boolean(isHistoryView && isTerminal && !archived && hasWritePermission);

          return (
            <div key={order.id || order.localOrderId || order.saleId} className={`kds-ticket status-${displayStatus} ${archived ? 'is-archived' : ''}`} role="article">
              <div className="ticket-header">
                <div className="ticket-info">
                  <span className="ticket-kicker">Comanda</span>
                  <span className="ticket-id">#{getTicketId(order)}</span>
                  <span className="ticket-customer">
                    {order.tableLabel ? (
                      <><UtensilsCrossed size={14} /> {order.tableLabel}</>
                    ) : order.customerName ? (
                      <><User size={14} /> {order.customerName}</>
                    ) : (
                      <><Store size={14} /> Mostrador</>
                    )}
                  </span>
                </div>
                <div className="ticket-header-side">
                  <div className="ticket-badges">
                    <span className={`kds-status-badge status-${displayStatus}`}>{STATUS_LABELS[displayStatus] || displayStatus}</span>
                    {paid && <span className="kds-payment-badge">Pagada</span>}
                    {paidPending && <span className="kds-payment-badge pending">Pendiente de cocina</span>}
                    {archived && <span className="kds-archive-badge">Archivada</span>}
                  </div>
                  <TicketTimer timestamp={getOrderTimestamp(order)} status={displayStatus} />
                </div>
              </div>

              <div className="ticket-progress-row">
                <span>{progress.pendingItems.length} pendientes</span>
                <span>{progress.preparingItems.length} preparando</span>
                <span>{progress.readyItems.length}/{totalActiveItems || getOrderItems(order).length} listos</span>
              </div>

              {isHistoryView && (
                <div className="ticket-history-details">
                  <HistoryDetail label="Folio" value={order.paidSaleFolio || order.saleId || order.localOrderId} />
                  <HistoryDetail label="Pago" value={PAYMENT_LABELS[paymentStatus] || paymentStatus} />
                  <HistoryDetail label="Total" value={ticketTotal} />
                  <HistoryDetail label="Creada" value={formatDateTime(getOrderTimestamp(order))} />
                  <HistoryDetail label="Pagada" value={formatDateTime(order.paidAt)} />
                  <HistoryDetail label={status === 'cancelled' ? 'Cancelada' : 'Cerrada'} value={formatDateTime(getHistoryFinalTimestamp(order))} />
                  <HistoryDetail label="Archivada" value={formatDateTime(order.archivedAt)} />
                </div>
              )}

              {order.notes && (
                <div className="ticket-global-note">
                  <AlertTriangle size={16} />
                  <span>{order.notes}</span>
                </div>
              )}

              <div className="ticket-body">
                {getOrderItems(order).map((item, idx) => {
                  const modifiers = normalizeModifiers(item.selectedModifiers);
                  const stationName = item.stationName || item.station_name || 'Cocina';
                  const itemId = getItemId(item);
                  const itemStatus = getItemStatus(item);
                  const itemAction = isHistoryView ? null : getCloudStatusAction({ ...order, items: [item], status: itemStatus, fulfillmentStatus: itemStatus });
                  const isCurrentItemUpdating = itemId && updatingItemId === itemId;
                  const showItemAction = Boolean(itemAction && itemId && hasWritePermission && !isTerminal && !isHistoryView);
                  const showCancelItemAction = Boolean(itemId && hasWritePermission && !isTerminal && !isHistoryView && CANCELLABLE_ITEM_STATUSES.has(itemStatus));

                  return (
                    <div key={itemId || item.localLineId || idx} className={`ticket-item cloud-item status-${itemStatus} ${itemStatus === 'ready' ? 'is-ready' : ''} ${itemStatus === 'cancelled' ? 'is-cancelled' : ''}`}>
                      <div className="item-main">
                        <span className="item-qty">{getItemQuantity(item)}</span>
                        <span className="item-name">{getItemName(item)}</span>
                      </div>

                      <div className="item-station-row cloud">
                        <span className="item-station-badge">{stationName}</span>
                        <span className={`item-status-badge status-${itemStatus}`}>{STATUS_LABELS[itemStatus] || itemStatus}</span>
                      </div>

                      {modifiers.length > 0 && (
                        <div className="item-modifiers">
                          {modifiers.map((modifierName, i) => (
                            <span key={`${modifierName}-${i}`} className="modifier-tag">{modifierName}</span>
                          ))}
                        </div>
                      )}

                      {item.notes && (
                        <div className="item-note">
                          <StickyNote size={14} />
                          <span>{item.notes}</span>
                        </div>
                      )}

                      <div className="item-actions-row">
                        {showItemAction && (
                          <button
                            type="button"
                            className={`btn-kds-item-action ${itemAction.className}`}
                            onClick={() => onChangeItemStatus(order, item, itemAction.nextStatus)}
                            disabled={isUpdating || isCurrentItemUpdating}
                          >
                            {isCurrentItemUpdating ? 'Actualizando...' : itemAction.label}
                          </button>
                        )}

                        {showCancelItemAction && (
                          <button
                            type="button"
                            className="btn-kds-item-cancel"
                            onClick={() => onCancelItemStatus(order, item)}
                            disabled={isUpdating || isCurrentItemUpdating}
                            title="Cancelar item en cocina"
                          >
                            <X size={14} /> Cancelar item
                          </button>
                        )}

                        {itemStatus === 'ready' && (
                          <span className="item-ready-lock">
                            <CheckCircle size={14} />
                            Ya listo
                          </span>
                        )}

                        {itemStatus === 'cancelled' && (
                          <span className="item-cancelled-lock">
                            Cancelado en cocina
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="ticket-footer">
                <div className="ticket-meta cloud">
                  <span>Creada {formatTime(getOrderTimestamp(order))}</span>
                  <span>Actualizada {formatTime(getOrderUpdatedTimestamp(order))}</span>
                  {ticketTotal && <span>Total ref. {ticketTotal}</span>}
                </div>

                <div className="ticket-actions">
                  {!isTerminal && !isHistoryView && hasWritePermission && (
                    <button
                      type="button"
                      className="btn-kds-cancel"
                      onClick={() => onCancelOrder(order)}
                      title="Cancelar comanda"
                      aria-label="Cancelar comanda"
                      disabled={isUpdating}
                    >
                      <X size={18} />
                    </button>
                  )}

                  {action && hasWritePermission && (
                    <button
                      type="button"
                      className={`btn-kds-action ${action.className}`}
                      onClick={() => onAdvanceStatus(order)}
                      disabled={isUpdating}
                    >
                      {isCurrentOrderUpdating ? 'Actualizando...' : action.label}
                    </button>
                  )}

                  {canArchive && (
                    <button
                      type="button"
                      className="btn-kds-archive"
                      onClick={() => onArchiveOrder(order)}
                      disabled={isUpdating || isCurrentArchiveUpdating}
                    >
                      <Archive size={16} />
                      {isCurrentArchiveUpdating ? 'Archivando...' : 'Archivar'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
