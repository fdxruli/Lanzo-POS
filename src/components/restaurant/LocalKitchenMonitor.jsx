import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Clock, Flame, CheckCircle, History, RefreshCw, ChefHat, UtensilsCrossed, User, Store, AlertTriangle, StickyNote, X } from 'lucide-react';
import { saveDataSafe, STORES, getOrdersSince } from '../../services/database';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';

const NOTIFICATION_SOUND = 'https://actions.google.com/sounds/v1/cartoon/cartoon_boing.ogg';

const normalizeOrderStatus = (status) => {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'open' || normalized === 'sent' || normalized === 'sent_to_kitchen') return 'pending';
  if (normalized === 'completed') return 'delivered';
  return normalized || 'pending';
};

const getOrderItems = (order = {}) => (Array.isArray(order.items) ? order.items : []);
const getItemName = (item = {}) => item.productName || item.name || item.product_name || 'Producto';
const getItemQuantity = (item = {}) => item.quantity ?? item.qty ?? 1;
const STATUS_LABELS = { pending: 'Pendiente', preparing: 'En preparación', ready: 'Listo', delivered: 'Entregado', cancelled: 'Cancelado' };

const normalizeModifiers = (modifiers) => {
  if (!Array.isArray(modifiers)) return [];
  return modifiers.map((modifier) => typeof modifier === 'string' ? modifier : modifier?.name || modifier?.label || modifier?.modifierName || null).filter(Boolean);
};

const countLocalOrderBuckets = (orders = []) => {
  const counts = { pending: 0, ready: 0, history: 0 };
  orders.forEach((order) => {
    const status = normalizeOrderStatus(order.fulfillmentStatus || 'pending');
    if (status === 'pending') counts.pending += 1;
    if (status === 'ready') counts.ready += 1;
    if (status === 'delivered' || status === 'cancelled') counts.history += 1;
  });
  return counts;
};

const countItemsInOrders = (orders = []) => orders.reduce((total, order) => total + getOrderItems(order).length, 0);

const KdsCommandCenter = ({ metrics, tabs, onRefresh, isLoading }) => (
  <section className="kds-command-center mode-local">
    <div className="kds-command-main">
      <div className="kds-title-block"><span className="kds-mode-pill mode-local">FREE local</span><h1>Monitor de cocina</h1><p>Pedidos locales</p></div>
      <button type="button" className={`kds-refresh-btn ${isLoading ? 'loading' : ''}`} onClick={onRefresh} disabled={isLoading} aria-label="Actualizar cocina" title="Actualizar cocina"><RefreshCw size={20} strokeWidth={2.2} /><span>Actualizar</span></button>
    </div>
    <div className="kds-metrics" aria-label="Resumen de cocina">{metrics.map((metric) => <div key={metric.label} className={`kds-metric tone-${metric.tone || 'neutral'}`}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div>
    <div className="kds-tabs" role="tablist" aria-label="Estados de cocina">{tabs.map(({ key, label, count, Icon, tone, active, onClick }) => <button key={key} type="button" className={`kds-tab tone-${tone} ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}><Icon size={18} /><span>{label}</span><strong>{count}</strong></button>)}</div>
  </section>
);

const ProductionSummary = ({ items }) => {
  if (!items || items.length === 0) return null;
  return <section className="production-bar" aria-label="Resumen a producir"><div className="prod-heading"><span>Producción</span><strong>Ahora</strong></div><div className="prod-list">{items.map(([name, count]) => <div key={name} className="prod-badge"><span className="prod-count">{count}</span><span className="prod-name">{name}</span></div>)}</div></section>;
};

const TicketTimer = ({ timestamp, status }) => {
  const [now, setNow] = useState(() => Date.now());
  const [fallbackStartedAt] = useState(() => Date.now());
  const startedAt = useMemo(() => new Date(timestamp || fallbackStartedAt).getTime(), [fallbackStartedAt, timestamp]);
  const elapsed = Number.isFinite(startedAt) ? Math.max(Math.floor((now - startedAt) / 60000), 0) : 0;
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(interval); }, []);
  let urgencyClass = 'time-fresh';
  const normalizedStatus = normalizeOrderStatus(status);
  if (normalizedStatus === 'pending' || normalizedStatus === 'preparing') { if (elapsed > 10) urgencyClass = 'time-warning'; if (elapsed > 20) urgencyClass = 'time-critical'; }
  return <div className={`ticket-timer ${urgencyClass}`}><Clock size={14} /><span>{elapsed} min</span></div>;
};

export default function LocalKitchenMonitor() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [isLoading, setIsLoading] = useState(true);
  const prevOrdersLength = useRef(0);
  const audioPlayer = useRef(null);

  const playNotificationSound = useCallback(() => { if (audioPlayer.current) audioPlayer.current.play().catch(() => Logger.info('Interacción requerida para audio')); }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);
      const activeOrders = await getOrdersSince(yesterday.toISOString());
      activeOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const pendingCount = activeOrders.filter((order) => ['pending', 'open'].includes(order.fulfillmentStatus || 'pending')).length;
      const readyCount = activeOrders.filter((order) => order.fulfillmentStatus === 'ready').length;
      if (pendingCount > prevOrdersLength.current && prevOrdersLength.current !== 0) playNotificationSound();
      prevOrdersLength.current = pendingCount;
      if (pendingCount > 0) setFilter('pending'); else if (readyCount > 0) setFilter('ready'); else setFilter('history');
      setOrders(activeOrders);
    } catch (error) {
      Logger.error('Error cargando pedidos:', error);
    } finally {
      setIsLoading(false);
    }
  }, [playNotificationSound]);

  useEffect(() => { fetchOrders(); const interval = setInterval(fetchOrders, 10000); return () => clearInterval(interval); }, [fetchOrders]);

  const handleAdvanceStatus = async (order) => {
    const currentStatus = order.fulfillmentStatus || 'pending';
    const nextStatus = ['pending', 'open'].includes(currentStatus) ? 'ready' : 'completed';
    const updatedOrders = orders.map((item) => item.timestamp === order.timestamp ? { ...item, fulfillmentStatus: nextStatus } : item);
    setOrders(updatedOrders);
    const pendingCount = updatedOrders.filter((item) => ['pending', 'open'].includes(item.fulfillmentStatus || 'pending')).length;
    const readyCount = updatedOrders.filter((item) => item.fulfillmentStatus === 'ready').length;
    if (pendingCount > 0) setFilter('pending'); else if (readyCount > 0) setFilter('ready'); else setFilter('history');
    const result = await saveDataSafe(STORES.SALES, { ...order, fulfillmentStatus: nextStatus });
    if (!result.success) { showMessageModal(`Error al guardar: ${result.error?.message}`); fetchOrders(); }
  };

  const handleCancelOrder = async (order) => {
    if (!(await showConfirmModal('¿Rechazar esta comanda en cocina? (El cajero deberá gestionar la cancelación financiera si aplica)', { title: 'Rechazar comanda', confirmButtonText: 'Sí, rechazar', cancelButtonText: 'Cancelar' }))) return;
    const result = await saveDataSafe(STORES.SALES, { ...order, fulfillmentStatus: 'cancelled' });
    if (result.success) { fetchOrders(); showMessageModal('Comanda rechazada en cocina', null, { type: 'success' }); }
  };

  const displayedOrders = useMemo(() => orders.filter((order) => { const status = order.fulfillmentStatus || 'pending'; if (filter === 'history') return status === 'completed' || status === 'cancelled'; if (filter === 'pending') return status === 'pending' || status === 'open'; return status === filter; }), [orders, filter]);
  const localStatusCounts = useMemo(() => countLocalOrderBuckets(orders), [orders]);
  const visibleItemsCount = useMemo(() => countItemsInOrders(displayedOrders), [displayedOrders]);
  const productionSummary = useMemo(() => {
    if (filter !== 'pending') return null;
    const summary = {};
    displayedOrders.forEach((order) => getOrderItems(order).forEach((item) => { const key = getItemName(item); summary[key] = (summary[key] || 0) + Number(getItemQuantity(item) || 1); }));
    return Object.entries(summary).sort(([, a], [, b]) => b - a).slice(0, 5);
  }, [displayedOrders, filter]);

  const localMetrics = [{ label: 'En cocina', value: localStatusCounts.pending, tone: 'pending' }, { label: 'Listas', value: localStatusCounts.ready, tone: 'ready' }, { label: 'Visibles', value: displayedOrders.length, tone: 'active' }, { label: 'Items', value: visibleItemsCount, tone: 'station' }];
  const localTabs = [{ key: 'pending', label: 'Cocina', count: localStatusCounts.pending, Icon: Flame, tone: 'pending', active: filter === 'pending', onClick: () => setFilter('pending') }, { key: 'ready', label: 'Entrega', count: localStatusCounts.ready, Icon: CheckCircle, tone: 'ready', active: filter === 'ready', onClick: () => setFilter('ready') }, { key: 'history', label: 'Historial', count: localStatusCounts.history, Icon: History, tone: 'history', active: filter === 'history', onClick: () => setFilter('history') }];

  return <div className="kds-container mode-local"><audio ref={audioPlayer} src={NOTIFICATION_SOUND} /><KdsCommandCenter metrics={localMetrics} tabs={localTabs} onRefresh={fetchOrders} isLoading={isLoading} /><ProductionSummary items={productionSummary} /><div className="kds-grid">
    {isLoading && <div className="kds-loading">Conectando con meseros...</div>}
    {!isLoading && displayedOrders.length === 0 && <div className="kds-empty"><div className="empty-icon">{filter === 'pending' ? <ChefHat size={64} /> : filter === 'ready' ? <CheckCircle size={64} /> : <History size={64} />}</div><h3>{filter === 'pending' ? 'Cocina despejada' : filter === 'ready' ? 'Todo entregado' : 'Sin historial reciente'}</h3><p>{filter === 'pending' ? 'Esperando nuevas comandas...' : filter === 'ready' ? 'No hay pedidos esperando entrega.' : 'Las comandas de las últimas 24h aparecerán aquí.'}</p></div>}
    {displayedOrders.map((order) => { const displayStatus = normalizeOrderStatus(order.fulfillmentStatus || 'pending'); const ticketItems = getOrderItems(order); return <div key={order.id || order.timestamp} className={`kds-ticket status-${displayStatus}`} role="article"><div className="ticket-header"><div className="ticket-info"><span className="ticket-kicker">Comanda</span><span className="ticket-id">#{String(order.timestamp || order.id || '').slice(-4)}</span><span className="ticket-customer">{order.tableData ? <><UtensilsCrossed size={14} /> {order.tableData}</> : order.customerId ? <><User size={14} /> Cliente</> : <><Store size={14} /> Mostrador</>}</span></div><div className="ticket-header-side"><span className={`kds-status-badge status-${displayStatus}`}>{STATUS_LABELS[displayStatus] || displayStatus}</span><TicketTimer timestamp={order.timestamp} status={displayStatus} /></div></div><div className="ticket-progress-row"><span>{ticketItems.length} productos</span><span>{filter === 'pending' ? 'Preparar' : filter === 'ready' ? 'Entregar' : STATUS_LABELS[displayStatus] || displayStatus}</span></div>{order.notes && <div className="ticket-global-note"><AlertTriangle size={16} /><span>{order.notes}</span></div>}<div className="ticket-body">{ticketItems.map((item, idx) => { const modifiers = normalizeModifiers(item.selectedModifiers); return <div key={idx} className="ticket-item"><div className="item-main"><span className="item-qty">{getItemQuantity(item)}</span><span className="item-name">{getItemName(item)}</span></div>{modifiers.length > 0 && <div className="item-modifiers">{modifiers.map((name, i) => <span key={`${name}-${i}`} className="modifier-tag">{name}</span>)}</div>}{item.notes && <div className="item-note"><StickyNote size={14} /><span>{item.notes}</span></div>}</div>; })}</div><div className="ticket-footer"><div className="ticket-meta">{new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><div className="ticket-actions">{filter === 'pending' && <><button type="button" className="btn-kds-cancel" onClick={() => handleCancelOrder(order)} title="Rechazar" aria-label="Rechazar comanda"><X size={18} /></button><button type="button" className="btn-kds-action advance" onClick={() => handleAdvanceStatus(order)}>¡LISTO!</button></>}{filter === 'ready' && <button type="button" className="btn-kds-action deliver" onClick={() => handleAdvanceStatus(order)}>ENTREGADO</button>}</div></div></div>; })}
  </div></div>;
}
