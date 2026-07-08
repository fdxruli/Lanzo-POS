import { useMemo } from 'react';
import { Archive, AlertTriangle, CheckCircle, ChefHat, Clock3, History, MapPin, RefreshCw, StickyNote, Utensils, X } from 'lucide-react';
import { formatSelectedModifiersForDisplay } from '../../utils/restaurantModifierDisplay';
import './CloudKitchenMonitorRest8.css';

const TERMINAL = new Set(['delivered', 'cancelled']);
const CANCELLABLE_ITEM = new Set(['pending', 'preparing']);
const STATUS_LABELS = { pending: 'Pendiente', preparing: 'Preparando', ready: 'Listo', delivered: 'Entregado', cancelled: 'Cancelado' };

const normalizeStatus = (value) => {
  const status = String(value || 'pending').trim().toLowerCase();
  if (status === 'open' || status === 'sent' || status === 'sent_to_kitchen') return 'pending';
  if (status === 'completed') return 'delivered';
  return status || 'pending';
};

const getOrderStatus = (order = {}) => normalizeStatus(order.fulfillmentStatus || order.status);
const getItemStatus = (item = {}) => normalizeStatus(item.status || item.fulfillmentStatus || item.fulfillment_status || 'pending');
const getItems = (order = {}) => (Array.isArray(order.items) ? order.items : []);
const getItemId = (item = {}) => item.id || item.restaurantOrderItemId || item.restaurant_order_item_id || null;
const getItemName = (item = {}) => item.productName || item.name || item.product_name || 'Producto';
const getItemQty = (item = {}) => item.quantity ?? item.qty ?? 1;
const getItemNotes = (item = {}) => item.notes || item.kitchenNotes || item.kitchen_notes || null;
const getPaymentStatus = (order = {}) => String(order.paymentStatus || 'unpaid').toLowerCase();
const isArchivedOrder = (order = {}) => Boolean(order.archivedAt);

const formatTime = (value) => {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const formatMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
};

const getItemAction = (item) => {
  const status = getItemStatus(item);
  if (status === 'pending') return { nextStatus: 'preparing', label: 'Preparar', className: 'prepare' };
  if (status === 'preparing') return { nextStatus: 'ready', label: 'Listo', className: 'ready' };
  return null;
};

const getProgress = (order = {}) => {
  const activeItems = getItems(order).filter((item) => getItemStatus(item) !== 'cancelled');
  const pendingItems = activeItems.filter((item) => getItemStatus(item) === 'pending');
  const preparingItems = activeItems.filter((item) => getItemStatus(item) === 'preparing');
  const readyItems = activeItems.filter((item) => getItemStatus(item) === 'ready');
  return {
    activeItems,
    pendingItems,
    preparingItems,
    readyItems,
    allReady: activeItems.length > 0 && activeItems.length === readyItems.length
  };
};

const getDisplayStatus = (order = {}) => {
  const status = getOrderStatus(order);
  if (TERMINAL.has(status)) return status;
  const progress = getProgress(order);
  if (status === 'ready' || progress.allReady) return 'ready';
  if (status === 'preparing' || progress.preparingItems.length > 0 || progress.readyItems.length > 0) return 'preparing';
  return 'pending';
};

const getOrderActionLabel = (order = {}) => {
  const status = getOrderStatus(order);
  if (TERMINAL.has(status)) return null;
  const progress = getProgress(order);
  if (status === 'ready' || progress.allReady) return 'Entregar';
  if (progress.pendingItems.length > 0) return 'Preparar pedido';
  if (progress.preparingItems.length > 0) return 'Pedido listo';
  return null;
};

const ticketId = (order = {}) => String(order.paidSaleFolio || order.id || order.localOrderId || order.saleId || '').replace(/-/g, '').slice(-4).toUpperCase() || 'KDS';
const rangeOptions = [{ key: 'today', label: 'Hoy' }, { key: '24h', label: '24 h' }, { key: '7d', label: '7 dias' }];
const statusOptions = [{ key: null, label: 'Todos' }, { key: 'delivered', label: 'Entregados' }, { key: 'cancelled', label: 'Cancelados' }];

function MonitorHeader({ statusFilter, statusCounts, isLoading, hasReadPermission, lastUpdatedAt, onRefresh, onStatusFilter }) {
  const tabs = [
    { key: 'active', label: 'Pedidos', count: statusCounts.active ?? 0, icon: Utensils },
    { key: 'paid_pending', label: 'Pagados', count: statusCounts.paid_pending ?? 0, icon: CheckCircle },
    { key: 'history', label: 'Historial', count: statusCounts.history ?? 0, icon: History }
  ];

  return (
    <section className="kds-command-center">
      <div className="kds-command-main">
        <div className="kds-title-block">
          <span className="kds-mode-pill">Cocina</span>
          <h1>Monitor</h1>
          <p>{lastUpdatedAt ? `Actualizado ${formatTime(lastUpdatedAt)}` : 'Listo para recibir pedidos'}</p>
        </div>
        <button type="button" className={`kds-refresh-btn ${isLoading ? 'loading' : ''}`} onClick={onRefresh} disabled={isLoading || !hasReadPermission}>
          <RefreshCw size={18} />
          <span>Actualizar</span>
        </button>
      </div>

      <div className="kds-tabs" role="tablist" aria-label="Estado de pedidos">
        {tabs.map(({ key, label, count, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`kds-tab ${statusFilter === key ? 'active' : ''}`}
            onClick={() => onStatusFilter(key)}
          >
            <Icon size={17} />
            <span>{label}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function StationFilter({ stationOptions, selectedStationCode, selectedStation, onSelect }) {
  return (
    <section className="kds-station-shell" aria-label="Areas de cocina">
      <div className="kds-station-heading">
        <span>Areas</span>
        <strong>{selectedStation?.name || 'Todas'}</strong>
      </div>
      <div className="kds-station-filter">
        {stationOptions.map((station) => (
          <button
            key={station.code || 'all'}
            type="button"
            className={`kds-station-tab ${selectedStationCode === station.code ? 'active' : ''}`}
            onClick={() => onSelect(station.code)}
          >
            <MapPin size={14} />
            {station.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function HistoryFilters({ historyFilters, setHistoryFilters, isLoading, isArchiving }) {
  return (
    <section className="kds-history-filters">
      <div className="kds-history-filter">
        <span>Periodo</span>
        <div>{rangeOptions.map((option) => (
          <button key={option.key} type="button" className={historyFilters.range === option.key ? 'active' : ''} disabled={isLoading || isArchiving} onClick={() => setHistoryFilters({ range: option.key })}>
            {option.label}
          </button>
        ))}</div>
      </div>
      <div className="kds-history-filter">
        <span>Estado</span>
        <div>{statusOptions.map((option) => (
          <button key={option.key || 'all'} type="button" className={(historyFilters.status || null) === option.key ? 'active' : ''} disabled={isLoading || isArchiving} onClick={() => setHistoryFilters({ status: option.key })}>
            {option.label}
          </button>
        ))}</div>
      </div>
    </section>
  );
}

function ProgressRow({ progress }) {
  return (
    <div className="ticket-progress-row">
      <span>{progress.pendingItems.length} pendientes</span>
      <span>{progress.preparingItems.length} preparando</span>
      <span>{progress.readyItems.length}/{progress.activeItems.length} listos</span>
    </div>
  );
}

function HistoryDetails({ order, status, paymentStatus, total }) {
  const details = [
    ['Folio', order.paidSaleFolio || order.saleId || order.localOrderId],
    ['Pago', paymentStatus],
    ['Total', total],
    ['Creada', formatDate(order.createdAt || order.timestamp)],
    ['Cerrada', formatDate(order.archivedAt || order.checkoutClosedAt || order.deliveredAt || order.cancelledAt || order.updatedAt)],
    ['Estado', STATUS_LABELS[status] || status]
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="ticket-history-details">
      {details.map(([label, value]) => (
        <span key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </span>
      ))}
    </div>
  );
}

function OrderItem({ order, item, itemContext, onChangeItemStatus, onCancelItemStatus }) {
  const { isTerminal, isHistory, hasWritePermission, isUpdating, updatingItemId } = itemContext;
  const itemId = getItemId(item);
  const itemStatus = getItemStatus(item);
  const itemAction = isHistory ? null : getItemAction(item);
  const itemUpdating = itemId && updatingItemId === itemId;
  const showItemAction = Boolean(itemAction && itemId && hasWritePermission && !isTerminal && !isHistory);
  const showCancelItemAction = Boolean(itemId && hasWritePermission && !isTerminal && !isHistory && CANCELLABLE_ITEM.has(itemStatus));
  const modifiers = formatSelectedModifiersForDisplay(item.selectedModifiers, { showPrice: false });
  const itemNotes = getItemNotes(item);

  return (
    <div className={`ticket-item cloud-item status-${itemStatus} ${itemStatus === 'ready' ? 'is-ready' : ''} ${itemStatus === 'cancelled' ? 'is-cancelled' : ''}`}>
      <div className="item-main">
        <span className="item-qty">{getItemQty(item)}</span>
        <span className="item-name">{getItemName(item)}</span>
      </div>

      {modifiers.length > 0 && (
        <div className="item-modifiers">{modifiers.map((name, i) => <span key={`${name}-${i}`} className="modifier-tag">{name}</span>)}</div>
      )}

      {itemNotes && (
        <div className="item-note">
          <StickyNote size={14} />
          <span>{itemNotes}</span>
        </div>
      )}

      <div className="item-station-row cloud">
        <span className="item-station-badge">{item.stationName || item.station_name || 'Cocina'}</span>
        <span className={`item-status-badge status-${itemStatus}`}>{STATUS_LABELS[itemStatus] || itemStatus}</span>
      </div>

      <div className="item-actions-row">
        {showItemAction && (
          <button type="button" className={`btn-kds-item-action ${itemAction.className}`} onClick={() => onChangeItemStatus(order, item, itemAction.nextStatus)} disabled={isUpdating || itemUpdating}>
            {itemUpdating ? 'Actualizando...' : itemAction.label}
          </button>
        )}
        {showCancelItemAction && (
          <button type="button" className="btn-kds-item-cancel" onClick={() => onCancelItemStatus(order, item)} disabled={isUpdating || itemUpdating}>
            <X size={14} />
            Cancelar
          </button>
        )}
        {itemStatus === 'ready' && <span className="item-ready-lock"><CheckCircle size={14} /> Listo</span>}
        {itemStatus === 'cancelled' && <span className="item-cancelled-lock">Cancelado</span>}
      </div>
    </div>
  );
}

function OrderCard({ order, isHistory, hasWritePermission, isUpdating, updatingOrderId, updatingItemId, archivingOrderId, onAdvanceStatus, onCancelOrder, onChangeItemStatus, onCancelItemStatus, onArchiveOrder }) {
  const status = getOrderStatus(order);
  const displayStatus = getDisplayStatus(order);
  const progress = getProgress(order);
  const paymentStatus = getPaymentStatus(order);
  const paid = paymentStatus === 'paid';
  const archived = isArchivedOrder(order);
  const isTerminal = TERMINAL.has(status);
  const total = formatMoney(order.paidTotal ?? order.total);
  const actionLabel = isHistory ? null : getOrderActionLabel(order);
  const canArchive = Boolean(isHistory && isTerminal && !archived && hasWritePermission);
  const itemContext = useMemo(() => ({
    isTerminal,
    isHistory,
    hasWritePermission,
    isUpdating,
    updatingItemId
  }), [isTerminal, isHistory, hasWritePermission, isUpdating, updatingItemId]);

  return (
    <article className={`kds-ticket status-${displayStatus} ${archived ? 'is-archived' : ''}`}>
      <header className="ticket-header">
        <div className="ticket-info">
          <span className="ticket-kicker">Pedido</span>
          <span className="ticket-id">#{ticketId(order)}</span>
          <span className="ticket-customer">{order.tableLabel || order.customerName || 'Mostrador'}</span>
        </div>
        <div className="ticket-header-side">
          <span className={`kds-status-badge status-${displayStatus}`}>{STATUS_LABELS[displayStatus] || displayStatus}</span>
          <span className="ticket-time"><Clock3 size={14} /> {formatTime(order.createdAt || order.timestamp)}</span>
        </div>
      </header>

      <ProgressRow progress={progress} />

      {paid && <span className="kds-payment-badge">Pagado</span>}
      {archived && <span className="kds-archive-badge">Archivado</span>}
      {isHistory && <HistoryDetails order={order} status={status} paymentStatus={paymentStatus} total={total} />}
      {order.notes && <div className="ticket-global-note"><AlertTriangle size={16} /><span>{order.notes}</span></div>}

      <div className="ticket-body">
        {getItems(order).map((item, idx) => (
          <OrderItem
            key={getItemId(item) || idx}
            order={order}
            item={item}
            itemContext={itemContext}
            onChangeItemStatus={onChangeItemStatus}
            onCancelItemStatus={onCancelItemStatus}
          />
        ))}
      </div>

      <footer className="ticket-footer">
        <div className="ticket-meta cloud">
          {total ? <span>{total}</span> : null}
          <span>{getItems(order).length} producto{getItems(order).length === 1 ? '' : 's'}</span>
        </div>
        <div className="ticket-actions">
          {!isTerminal && !isHistory && hasWritePermission && (
            <button type="button" className="btn-kds-cancel" onClick={() => onCancelOrder(order)} disabled={isUpdating} aria-label="Cancelar pedido">
              <X size={18} />
            </button>
          )}
          {actionLabel && hasWritePermission && (
            <button type="button" className={`btn-kds-action ${displayStatus === 'ready' ? 'deliver' : 'advance'}`} onClick={() => onAdvanceStatus(order)} disabled={isUpdating}>
              {updatingOrderId === order.id ? 'Actualizando...' : actionLabel}
            </button>
          )}
          {canArchive && (
            <button type="button" className="btn-kds-archive" onClick={() => onArchiveOrder(order)} disabled={isUpdating || archivingOrderId === order.id}>
              <Archive size={16} />
              {archivingOrderId === order.id ? 'Archivando...' : 'Archivar'}
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

export default function CloudKitchenMonitorRest8({ kitchenCloud, onAdvanceStatus, onCancelOrder, onChangeItemStatus, onCancelItemStatus, onArchiveOrder }) {
  const {
    displayedOrders = [],
    orders = [],
    statusFilter,
    setStatusFilter,
    selectedStationCode,
    setSelectedStationCode,
    stationOptions = [],
    statusCounts = {},
    historyFilters = {},
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

  const isHistory = statusFilter === 'history';
  const selectedStation = useMemo(
    () => stationOptions.find((station) => station.code === selectedStationCode),
    [stationOptions, selectedStationCode]
  );

  return (
    <>
      <MonitorHeader
        statusFilter={statusFilter}
        statusCounts={statusCounts}
        isLoading={isLoading}
        hasReadPermission={hasReadPermission}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={() => refreshKitchenOrders({ force: true })}
        onStatusFilter={setStatusFilter}
      />

      {!isHistory && (
        <StationFilter
          stationOptions={stationOptions}
          selectedStationCode={selectedStationCode}
          selectedStation={selectedStation}
          onSelect={setSelectedStationCode}
        />
      )}

      {isHistory && (
        <HistoryFilters
          historyFilters={historyFilters}
          setHistoryFilters={setHistoryFilters}
          isLoading={isLoading}
          isArchiving={isArchiving}
        />
      )}

      {error && <div className="kds-alert"><AlertTriangle size={18} /><span>{error}</span></div>}

      <div className="kds-grid">
        {isLoading && (orders.length === 0 || displayedOrders.length === 0) && <div className="kds-loading">Actualizando...</div>}
        {!isLoading && !error && displayedOrders.length === 0 && (
          <div className="kds-empty">
            <div className="empty-icon"><ChefHat size={58} /></div>
            <h3>{isHistory ? 'Sin historial' : 'Sin pedidos'}</h3>
            <p>{isHistory ? 'Los pedidos cerrados apareceran aqui.' : 'Cuando llegue un pedido, aparecera en esta vista.'}</p>
          </div>
        )}
        {displayedOrders.map((order) => (
          <OrderCard
            key={order.id || order.localOrderId || order.saleId}
            order={order}
            isHistory={isHistory}
            hasWritePermission={hasWritePermission}
            isUpdating={isUpdating}
            updatingOrderId={updatingOrderId}
            updatingItemId={updatingItemId}
            archivingOrderId={archivingOrderId}
            onAdvanceStatus={onAdvanceStatus}
            onCancelOrder={onCancelOrder}
            onChangeItemStatus={onChangeItemStatus}
            onCancelItemStatus={onCancelItemStatus}
            onArchiveOrder={onArchiveOrder}
          />
        ))}
      </div>
    </>
  );
}
