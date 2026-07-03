import { useMemo } from 'react';
import { Archive, AlertTriangle, CheckCircle, ChefHat, Flame, History, RefreshCw, StickyNote, X } from 'lucide-react';
import { formatSelectedModifiersForDisplay } from '../../utils/restaurantModifierDisplay';
import './CloudKitchenMonitorRest8.css';

const TERMINAL = new Set(['delivered', 'cancelled']);
const CANCELLABLE_ITEM = new Set(['pending', 'preparing']);
const STATUS_LABELS = { pending: 'Pendiente', preparing: 'En preparación', ready: 'Listo', delivered: 'Entregado', cancelled: 'Cancelado' };

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

const getCloudItemStatusAction = (item) => {
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
  return { activeItems, pendingItems, preparingItems, readyItems, allReady: activeItems.length > 0 && activeItems.length === readyItems.length };
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
  if (status === 'ready' || progress.allReady) return 'Marcar entregado';
  if (progress.pendingItems.length > 0) return 'Marcar en preparación';
  if (progress.preparingItems.length > 0) return 'Marcar listo';
  return null;
};
const ticketId = (order = {}) => String(order.paidSaleFolio || order.id || order.localOrderId || order.saleId || '').replace(/-/g, '').slice(-4).toUpperCase() || 'KDS';
const HistoryDetail = ({ label, value }) => value ? <span><small>{label}</small><strong>{value}</strong></span> : null;
const rangeOptions = [{ key: 'today', label: 'Hoy' }, { key: '24h', label: 'Últimas 24 horas' }, { key: '7d', label: 'Últimos 7 días' }];
const statusOptions = [{ key: null, label: 'Todos' }, { key: 'delivered', label: 'Entregadas' }, { key: 'cancelled', label: 'Canceladas' }];

export default function CloudKitchenMonitorRest8({ kitchenCloud, onAdvanceStatus, onCancelOrder, onChangeItemStatus, onCancelItemStatus, onArchiveOrder }) {
  const {
    displayedOrders = [], orders = [], statusFilter, setStatusFilter, selectedStationCode, setSelectedStationCode,
    stationOptions = [], statusCounts = {}, historyFilters = {}, setHistoryFilters, isLoading, isUpdating,
    isArchiving, archivingOrderId, updatingOrderId, updatingItemId, error, hasReadPermission,
    hasWritePermission, lastUpdatedAt, refreshKitchenOrders
  } = kitchenCloud;
  const isHistory = statusFilter === 'history';
  const selectedStation = stationOptions.find((station) => station.code === selectedStationCode);
  const stationCount = stationOptions.filter((station) => !station.isAll).length;
  const productionSummary = useMemo(() => {
    if (!['active', 'paid_pending'].includes(statusFilter)) return null;
    const summary = {};
    displayedOrders.forEach((order) => getItems(order).forEach((item) => {
      const status = getItemStatus(item);
      if (status === 'ready' || status === 'delivered' || status === 'cancelled') return;
      summary[getItemName(item)] = (summary[getItemName(item)] || 0) + Number(getItemQty(item));
    }));
    return Object.entries(summary).sort(([, a], [, b]) => b - a).slice(0, 5);
  }, [displayedOrders, statusFilter]);

  return <>
    <section className="kds-command-center mode-cloud">
      <div className="kds-command-main"><div className="kds-title-block"><span className="kds-mode-pill mode-cloud">{hasWritePermission ? 'PRO cloud' : 'PRO lectura'}</span><h1>Monitor de cocina</h1><p>{lastUpdatedAt ? `Actualizado ${formatTime(lastUpdatedAt)}` : 'Sincronizando cocina'}</p></div><button type="button" className={`kds-refresh-btn ${isLoading ? 'loading' : ''}`} onClick={() => refreshKitchenOrders({ force: true })} disabled={isLoading || !hasReadPermission}><RefreshCw size={20} /><span>Actualizar</span></button></div>
      <div className="kds-metrics"><div className="kds-metric tone-pending"><span>Activas</span><strong>{statusCounts.active ?? 0}</strong></div><div className="kds-metric tone-ready"><span>Pagadas pendientes</span><strong>{statusCounts.paid_pending ?? 0}</strong></div><div className="kds-metric tone-history"><span>Historial</span><strong>{statusCounts.history ?? 0}</strong></div><div className="kds-metric tone-station"><span>Estaciones</span><strong>{stationCount}</strong></div></div>
      <div className="kds-tabs" role="tablist"><button type="button" className={`kds-tab tone-pending ${statusFilter === 'active' ? 'active' : ''}`} onClick={() => setStatusFilter('active')}><Flame size={18} /><span>Activas</span><strong>{statusCounts.active ?? 0}</strong></button><button type="button" className={`kds-tab tone-ready ${statusFilter === 'paid_pending' ? 'active' : ''}`} onClick={() => setStatusFilter('paid_pending')}><CheckCircle size={18} /><span>Pagadas pendientes</span><strong>{statusCounts.paid_pending ?? 0}</strong></button><button type="button" className={`kds-tab tone-history ${isHistory ? 'active' : ''}`} onClick={() => setStatusFilter('history')}><History size={18} /><span>Historial</span><strong>{statusCounts.history ?? 0}</strong></button></div>
    </section>
    <div className="kds-cloud-status-bar"><div><strong>{hasWritePermission ? 'Cloud activo' : 'Modo consulta'}</strong><span>{isHistory ? 'Historial operativo de comandas terminales' : selectedStation?.name ? `Estación: ${selectedStation.name}` : 'Estación: todas'}</span></div><small>{displayedOrders.length} comandas visibles</small></div>
    {!isHistory && <div className="kds-station-shell"><div className="kds-station-heading"><span>Estaciones</span><strong>{selectedStation?.name || 'Todas'}</strong></div><div className="kds-station-filter">{stationOptions.map((station) => <button key={station.code || 'all'} type="button" className={`kds-station-tab ${selectedStationCode === station.code ? 'active' : ''}`} onClick={() => setSelectedStationCode(station.code)}>{station.name}</button>)}</div></div>}
    {isHistory && <section className="kds-history-filters"><div className="kds-history-filter"><span>Periodo</span><div>{rangeOptions.map((option) => <button key={option.key} type="button" className={historyFilters.range === option.key ? 'active' : ''} disabled={isLoading || isArchiving} onClick={() => setHistoryFilters({ range: option.key })}>{option.label}</button>)}</div></div><div className="kds-history-filter"><span>Estado</span><div>{statusOptions.map((option) => <button key={option.key || 'all'} type="button" className={(historyFilters.status || null) === option.key ? 'active' : ''} disabled={isLoading || isArchiving} onClick={() => setHistoryFilters({ status: option.key })}>{option.label}</button>)}</div></div></section>}
    {error && <div className="kds-alert"><AlertTriangle size={18} /><span>{error}</span></div>}
    {productionSummary?.length > 0 && <section className="production-bar"><div className="prod-heading"><span>Producción</span><strong>Ahora</strong></div><div className="prod-list">{productionSummary.map(([name, count]) => <div key={name} className="prod-badge"><span className="prod-count">{count}</span><span className="prod-name">{name}</span></div>)}</div></section>}
    <div className="kds-grid">
      {isLoading && (orders.length === 0 || displayedOrders.length === 0) && <div className="kds-loading">Actualizando cocina cloud...</div>}
      {!isLoading && !error && displayedOrders.length === 0 && <div className="kds-empty"><div className="empty-icon"><ChefHat size={64} /></div><h3>{isHistory ? 'Sin historial reciente' : 'Cocina despejada'}</h3><p>{isHistory ? 'Las comandas entregadas, canceladas o archivadas aparecerán aquí.' : 'Las comandas cloud aparecerán aquí.'}</p></div>}
      {displayedOrders.map((order) => {
        const status = getOrderStatus(order); const displayStatus = getDisplayStatus(order); const progress = getProgress(order);
        const paymentStatus = getPaymentStatus(order); const paid = paymentStatus === 'paid'; const paidPending = paid && ['pending', 'preparing'].includes(status);
        const archived = isArchivedOrder(order); const isTerminal = TERMINAL.has(status); const total = formatMoney(order.paidTotal ?? order.total);
        const actionLabel = isHistory ? null : getOrderActionLabel(order); const canArchive = Boolean(isHistory && isTerminal && !archived && hasWritePermission);
        return <div key={order.id || order.localOrderId || order.saleId} className={`kds-ticket status-${displayStatus} ${archived ? 'is-archived' : ''}`}>
          <div className="ticket-header"><div className="ticket-info"><span className="ticket-kicker">Comanda</span><span className="ticket-id">#{ticketId(order)}</span><span className="ticket-customer">{order.tableLabel || order.customerName || 'Mostrador'}</span></div><div className="ticket-header-side"><div className="ticket-badges"><span className={`kds-status-badge status-${displayStatus}`}>{STATUS_LABELS[displayStatus] || displayStatus}</span>{paid && <span className="kds-payment-badge">Pagada</span>}{paidPending && <span className="kds-payment-badge pending">Pendiente de cocina</span>}{archived && <span className="kds-archive-badge">Archivada</span>}</div></div></div>
          <div className="ticket-progress-row"><span>{progress.pendingItems.length} pendientes</span><span>{progress.preparingItems.length} preparando</span><span>{progress.readyItems.length}/{progress.activeItems.length || getItems(order).length} listos</span></div>
          {isHistory && <div className="ticket-history-details"><HistoryDetail label="Folio" value={order.paidSaleFolio || order.saleId || order.localOrderId} /><HistoryDetail label="Pago" value={paymentStatus} /><HistoryDetail label="Total" value={total} /><HistoryDetail label="Creada" value={formatDate(order.createdAt || order.timestamp)} /><HistoryDetail label="Pagada" value={formatDate(order.paidAt)} /><HistoryDetail label={status === 'cancelled' ? 'Cancelada' : 'Cerrada'} value={formatDate(order.archivedAt || order.checkoutClosedAt || order.deliveredAt || order.cancelledAt || order.updatedAt)} /><HistoryDetail label="Archivada" value={formatDate(order.archivedAt)} /></div>}
          {order.notes && <div className="ticket-global-note"><AlertTriangle size={16} /><span>{order.notes}</span></div>}
          <div className="ticket-body">{getItems(order).map((item, idx) => {
            const itemId = getItemId(item); const itemStatus = getItemStatus(item); const itemAction = isHistory ? null : getCloudItemStatusAction(item); const itemUpdating = itemId && updatingItemId === itemId; const showItemAction = Boolean(itemAction && itemId && hasWritePermission && !isTerminal && !isHistory); const showCancelItemAction = Boolean(itemId && hasWritePermission && !isTerminal && !isHistory && CANCELLABLE_ITEM.has(itemStatus));
            const modifiers = formatSelectedModifiersForDisplay(item.selectedModifiers, { showPrice: false });
            const itemNotes = getItemNotes(item);
            return <div key={itemId || idx} className={`ticket-item cloud-item status-${itemStatus} ${itemStatus === 'ready' ? 'is-ready' : ''} ${itemStatus === 'cancelled' ? 'is-cancelled' : ''}`}><div className="item-main"><span className="item-qty">{getItemQty(item)}</span><span className="item-name">{getItemName(item)}</span></div>{modifiers.length > 0 && <div className="item-modifiers">{modifiers.map((name, i) => <span key={`${name}-${i}`} className="modifier-tag">{name}</span>)}</div>}{itemNotes && <div className="item-note"><StickyNote size={14} /><span>{itemNotes}</span></div>}<div className="item-station-row cloud"><span className="item-station-badge">{item.stationName || item.station_name || 'Cocina'}</span><span className={`item-status-badge status-${itemStatus}`}>{STATUS_LABELS[itemStatus] || itemStatus}</span></div><div className="item-actions-row">{showItemAction && <button type="button" className={`btn-kds-item-action ${itemAction.className}`} onClick={() => onChangeItemStatus(order, item, itemAction.nextStatus)} disabled={isUpdating || itemUpdating}>{itemUpdating ? 'Actualizando...' : itemAction.label}</button>}{showCancelItemAction && <button type="button" className="btn-kds-item-cancel" onClick={() => onCancelItemStatus(order, item)} disabled={isUpdating || itemUpdating}><X size={14} /> Cancelar item</button>}{itemStatus === 'ready' && <span className="item-ready-lock"><CheckCircle size={14} /> Ya listo</span>}{itemStatus === 'cancelled' && <span className="item-cancelled-lock">Cancelado en cocina</span>}</div></div>;
          })}</div>
          <div className="ticket-footer"><div className="ticket-meta cloud"><span>Creada {formatTime(order.createdAt || order.timestamp)}</span><span>Actualizada {formatTime(order.updatedAt || order.createdAt || order.timestamp)}</span>{total && <span>Total ref. {total}</span>}</div><div className="ticket-actions">{!isTerminal && !isHistory && hasWritePermission && <button type="button" className="btn-kds-cancel" onClick={() => onCancelOrder(order)} disabled={isUpdating}><X size={18} /></button>}{actionLabel && hasWritePermission && <button type="button" className={`btn-kds-action ${displayStatus === 'ready' ? 'deliver' : 'advance'}`} onClick={() => onAdvanceStatus(order)} disabled={isUpdating}>{updatingOrderId === order.id ? 'Actualizando...' : actionLabel}</button>}{canArchive && <button type="button" className="btn-kds-archive" onClick={() => onArchiveOrder(order)} disabled={isUpdating || archivingOrderId === order.id}><Archive size={16} />{archivingOrderId === order.id ? 'Archivando...' : 'Archivar'}</button>}</div></div>
        </div>;
      })}
    </div>
  </>;
}
