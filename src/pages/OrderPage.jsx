import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Clock, Flame, CheckCircle, History, RefreshCw, ChefHat, UtensilsCrossed, User, Store, AlertTriangle, StickyNote, X } from 'lucide-react';
import { saveDataSafe, STORES, getOrdersSince } from '../services/database';
import { showConfirmModal, showMessageModal } from '../services/utils';
import Logger from '../services/Logger';
import useKitchenOrdersCloud from '../hooks/restaurant/useKitchenOrdersCloud';
import './OrderPage.css';
import './OrderPageCloud.css';

const NOTIFICATION_SOUND = 'https://actions.google.com/sounds/v1/cartoon/cartoon_boing.ogg';

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

const formatCurrency = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount.toLocaleString('es-MX', {
        style: 'currency',
        currency: 'MXN'
    });
};

const STATUS_LABELS = {
    pending: 'Pendiente',
    preparing: 'En preparación',
    ready: 'Listo',
    delivered: 'Entregado',
    cancelled: 'Cancelado'
};

const TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);
const CANCELLABLE_ITEM_STATUSES = new Set(['pending', 'preparing']);
const ACTIVE_ITEM_TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);
const CANCELLED_ITEM_STATUSES = new Set(['cancelled']);

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
            label: progress.hasPreparingItems || progress.readyItems.length > 0 ? 'Preparar faltantes' : 'Marcar en preparacion',
            className: 'advance'
        };
    }

    if (progress.hasPreparingItems) return { nextStatus: 'ready', label: 'Marcar listo', className: 'advance' };
    if (progress.allReady) return { nextStatus: 'ready', label: 'Marcar listo', className: 'advance' };

    return null;
};

const getCloudItemStatusAction = (item) => {
    const status = getItemStatus(item);
    if (status === 'pending') return { nextStatus: 'preparing', label: 'Preparar', className: 'prepare' };
    if (status === 'preparing') return { nextStatus: 'ready', label: 'Listo', className: 'ready' };
    return null;
};

const shouldAdvanceItemForOrderStatus = (item, nextStatus) => {
    const itemStatus = getItemStatus(item);
    if (itemStatus === nextStatus || itemStatus === 'cancelled') return false;

    if (nextStatus === 'preparing') return itemStatus === 'pending';
    if (nextStatus === 'ready') return itemStatus === 'preparing';
    if (nextStatus === 'delivered') return !ACTIVE_ITEM_TERMINAL_STATUSES.has(itemStatus);

    return false;
};

const getItemsToAdvanceForOrderStatus = (order, nextStatus) => (
    getOrderItems(order).filter((item) => getItemId(item) && shouldAdvanceItemForOrderStatus(item, nextStatus))
);

const getTicketId = (order = {}) => {
    const id = order.id || order.localOrderId || order.saleId || order.timestamp || '';
    const shortId = String(id).replace(/-/g, '').slice(-4).toUpperCase();
    return shortId || 'KDS';
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

const KdsCommandCenter = ({
    modeLabel,
    modeTone = 'local',
    title,
    statusText,
    metrics,
    tabs,
    onRefresh,
    isLoading,
    canRefresh = true
}) => (
    <section className={`kds-command-center mode-${modeTone}`}>
        <div className="kds-command-main">
            <div className="kds-title-block">
                <span className={`kds-mode-pill mode-${modeTone}`}>{modeLabel}</span>
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

        <div className="kds-metrics" aria-label="Resumen de cocina">
            {metrics.map((metric) => (
                <div key={metric.label} className={`kds-metric tone-${metric.tone || 'neutral'}`}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                </div>
            ))}
        </div>

        <div className="kds-tabs" role="tablist" aria-label="Estados de cocina">
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

const ProductionSummary = ({ items }) => {
    if (!items || items.length === 0) return null;

    return (
        <section className="production-bar" aria-label="Resumen a producir">
            <div className="prod-heading">
                <span>Produccion</span>
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
    const [now, setNow] = useState(() => Date.now());
    const [fallbackStartedAt] = useState(() => Date.now());
    const startedAt = useMemo(() => new Date(timestamp || fallbackStartedAt).getTime(), [fallbackStartedAt, timestamp]);
    const elapsed = Number.isFinite(startedAt) ? Math.max(Math.floor((now - startedAt) / 60000), 0) : 0;

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(interval);
    }, []);

    let urgencyClass = 'time-fresh';
    const normalizedStatus = normalizeOrderStatus(status);
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

const CloudKitchenMonitor = ({ kitchenCloud, onAdvanceStatus, onCancelOrder, onChangeItemStatus, onCancelItemStatus }) => {
    const {
        displayedOrders,
        orders,
        statusFilter,
        setStatusFilter,
        selectedStationCode,
        setSelectedStationCode,
        stationOptions,
        statusCounts,
        isLoading,
        isUpdating,
        updatingOrderId,
        updatingItemId,
        error,
        hasReadPermission,
        hasWritePermission,
        lastUpdatedAt,
        refreshKitchenOrders
    } = kitchenCloud;

    const productionSummary = useMemo(() => {
        if (statusFilter !== 'pending') return null;

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
        { label: 'En cocina', value: statusCounts.pending, tone: 'pending' },
        { label: 'Listas', value: statusCounts.ready, tone: 'ready' },
        { label: 'Visibles', value: displayedOrders.length, tone: 'active' },
        { label: 'Estaciones', value: stationCount, tone: 'station' }
    ];
    const commandTabs = [
        {
            key: 'pending',
            label: 'Cocina',
            count: statusCounts.pending,
            Icon: Flame,
            tone: 'pending',
            active: statusFilter === 'pending',
            onClick: () => setStatusFilter('pending')
        },
        {
            key: 'ready',
            label: 'Entrega',
            count: statusCounts.ready,
            Icon: CheckCircle,
            tone: 'ready',
            active: statusFilter === 'ready',
            onClick: () => setStatusFilter('ready')
        },
        {
            key: 'history',
            label: 'Historial',
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
                modeTone="cloud"
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
                    <span>{selectedStation?.name ? `Estacion: ${selectedStation.name}` : 'Estacion: todas'}</span>
                </div>
                <small>{displayedOrders.length} comandas visibles</small>
            </div>

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

            {error && (
                <div className="kds-alert" role="alert">
                    <AlertTriangle size={18} />
                    <span>{error}</span>
                </div>
            )}

            <ProductionSummary items={productionSummary} />

            <div className="kds-grid">
                {isLoading && orders.length === 0 && <div className="kds-loading">Actualizando cocina cloud...</div>}

                {showEmptyState && (
                    <div className="kds-empty">
                        <div className="empty-icon">
                            {statusFilter === 'pending' ? <ChefHat size={64} /> : statusFilter === 'ready' ? <CheckCircle size={64} /> : <History size={64} />}
                        </div>
                        <h3>
                            {statusFilter === 'pending' ? 'Cocina despejada' :
                                statusFilter === 'ready' ? 'Nada esperando entrega' : 'Sin historial reciente'}
                        </h3>
                        <p>
                            {statusFilter === 'pending' ? 'Las nuevas comandas cloud aparecerán aquí.' :
                                statusFilter === 'ready' ? 'Las comandas listas para entregar aparecerán aquí.' : 'Activa historial para revisar entregadas o canceladas recientes.'}
                        </p>
                    </div>
                )}

                {displayedOrders.map((order) => {
                    const status = getOrderStatus(order);
                    const displayStatus = getDisplayOrderStatus(order);
                    const action = getCloudStatusAction(order);
                    const ticketTotal = formatCurrency(order.total);
                    const isCurrentOrderUpdating = updatingOrderId === order.id;
                    const isTerminal = TERMINAL_STATUSES.has(status);
                    const progress = getCloudOrderProgress(order);
                    const totalActiveItems = progress.activeItems.length;

                    return (
                        <div key={order.id || order.localOrderId || order.saleId} className={`kds-ticket status-${displayStatus}`} role="article">
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
                                    <span className={`kds-status-badge status-${displayStatus}`}>{STATUS_LABELS[displayStatus] || displayStatus}</span>
                                    <TicketTimer timestamp={getOrderTimestamp(order)} status={displayStatus} />
                                </div>
                            </div>

                            <div className="ticket-progress-row">
                                <span>{progress.pendingItems.length} pendientes</span>
                                <span>{progress.preparingItems.length} preparando</span>
                                <span>{progress.readyItems.length}/{totalActiveItems || getOrderItems(order).length} listos</span>
                            </div>

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
                                    const itemAction = getCloudItemStatusAction(item);
                                    const isCurrentItemUpdating = itemId && updatingItemId === itemId;
                                    const showItemAction = Boolean(itemAction && itemId && hasWritePermission && !isTerminal);
                                    const showCancelItemAction = Boolean(itemId && hasWritePermission && !isTerminal && CANCELLABLE_ITEM_STATUSES.has(itemStatus));

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
                                    {!isTerminal && hasWritePermission && (
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
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
};

export default function OrdersPage() {
    const kitchenCloud = useKitchenOrdersCloud();
    const shouldUseCloudKds = kitchenCloud.isCloudKdsEnabled;

    const [orders, setOrders] = useState([]);
    const [filter, setFilter] = useState('pending');
    const [isLoading, setIsLoading] = useState(true);

    const prevOrdersLength = useRef(0);
    const audioPlayer = useRef(null);

    const playNotificationSound = useCallback(() => {
        if (audioPlayer.current) {
            audioPlayer.current.play().catch(() => Logger.info('Interacción requerida para audio'));
        }
    }, []);

    const fetchOrders = useCallback(async () => {
        if (shouldUseCloudKds) return;

        try {
            const yesterday = new Date();
            yesterday.setHours(yesterday.getHours() - 24);
            const isoDate = yesterday.toISOString();

            const activeOrders = await getOrdersSince(isoDate);
            activeOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            const pendingCount = activeOrders.filter(o => {
                const status = o.fulfillmentStatus || 'pending';
                return status === 'pending' || status === 'open';
            }).length;
            const readyCount = activeOrders.filter(o => o.fulfillmentStatus === 'ready').length;

            if (pendingCount > prevOrdersLength.current && prevOrdersLength.current !== 0) {
                playNotificationSound();
            }
            prevOrdersLength.current = pendingCount;

            if (pendingCount > 0) {
                setFilter('pending');
            } else if (readyCount > 0) {
                setFilter('ready');
            } else {
                setFilter('history');
            }

            setOrders(activeOrders);
        } catch (error) {
            Logger.error('Error cargando pedidos:', error);
        } finally {
            setIsLoading(false);
        }
    }, [playNotificationSound, shouldUseCloudKds]);

    useEffect(() => {
        if (shouldUseCloudKds) {
            setIsLoading(false);
            return undefined;
        }

        fetchOrders();
        const interval = setInterval(fetchOrders, 10000);
        return () => clearInterval(interval);
    }, [fetchOrders, shouldUseCloudKds]);

    useEffect(() => {
        if (!shouldUseCloudKds) return;

        const pendingCount = kitchenCloud.statusCounts.pending;
        if (pendingCount > prevOrdersLength.current && prevOrdersLength.current !== 0) {
            playNotificationSound();
        }
        prevOrdersLength.current = pendingCount;
    }, [kitchenCloud.statusCounts.pending, playNotificationSound, shouldUseCloudKds]);

    const handleAdvanceStatus = async (order) => {
        const currentStatus = order.fulfillmentStatus || 'pending';
        const nextStatus = ['pending', 'open'].includes(currentStatus) ? 'ready' : 'completed';

        const updatedOrders = orders.map(o =>
            o.timestamp === order.timestamp ? { ...o, fulfillmentStatus: nextStatus } : o
        );
        setOrders(updatedOrders);

        const pendingCount = updatedOrders.filter(o => {
            const status = o.fulfillmentStatus || 'pending';
            return status === 'pending' || status === 'open';
        }).length;
        const readyCount = updatedOrders.filter(o => o.fulfillmentStatus === 'ready').length;

        if (pendingCount > 0) setFilter('pending');
        else if (readyCount > 0) setFilter('ready');
        else setFilter('history');

        const updatedOrder = { ...order, fulfillmentStatus: nextStatus };
        const result = await saveDataSafe(STORES.SALES, updatedOrder);

        if (!result.success) {
            showMessageModal(`Error al guardar: ${result.error?.message}`);
            fetchOrders();
        }
    };

    const handleCancelOrder = async (order) => {
        if (!(await showConfirmModal('¿Rechazar esta comanda en cocina? (El cajero deberá gestionar la cancelación financiera si aplica)', {
            title: 'Rechazar comanda',
            confirmButtonText: 'Sí, rechazar',
            cancelButtonText: 'Cancelar'
        }))) return;

        const updatedOrder = {
            ...order,
            fulfillmentStatus: 'cancelled'
        };
        const result = await saveDataSafe(STORES.SALES, updatedOrder);

        if (result.success) {
            fetchOrders();
            showMessageModal('Comanda rechazada en cocina', null, { type: 'success' });
        }
    };

    const handleCloudAdvanceStatus = async (order) => {
        const action = getCloudStatusAction(order);
        if (!action) return;

        const itemsToAdvance = getItemsToAdvanceForOrderStatus(order, action.nextStatus);

        for (const item of itemsToAdvance) {
            const itemId = getItemId(item);
            const itemResult = await kitchenCloud.changeOrderItemStatus({
                restaurantOrderId: order.id,
                restaurantOrderItemId: itemId,
                status: action.nextStatus
            });

            if (itemResult?.success === false) {
                showMessageModal(
                    itemResult.message || kitchenCloud.error || 'No pudimos actualizar todos los items de la comanda.',
                    null,
                    { type: 'error' }
                );
                return;
            }
        }

        const result = await kitchenCloud.changeOrderStatus({
            restaurantOrderId: order.id,
            status: action.nextStatus
        });

        if (result?.success === false) {
            showMessageModal(result.message || kitchenCloud.error || 'No pudimos actualizar la comanda.', null, { type: 'error' });
        }
    };

    const handleCloudItemStatusChange = async (order, item, status) => {
        const itemId = getItemId(item);
        if (!order?.id || !itemId) {
            showMessageModal('No pudimos identificar el item de la comanda. Actualiza cocina e intenta de nuevo.', null, { type: 'error' });
            return;
        }

        const result = await kitchenCloud.changeOrderItemStatus({
            restaurantOrderId: order.id,
            restaurantOrderItemId: itemId,
            status
        });

        if (result?.success === false) {
            showMessageModal(result.message || kitchenCloud.error || 'No pudimos actualizar el item.', null, { type: 'error' });
        }
    };

    const handleCloudCancelItemStatus = async (order, item) => {
        const itemId = getItemId(item);
        if (!order?.id || !itemId) {
            showMessageModal('No pudimos identificar el item de la comanda. Actualiza cocina e intenta de nuevo.', null, { type: 'error' });
            return;
        }

        if (!(await showConfirmModal('¿Cancelar este item en cocina? Esto no cobra, no devuelve dinero y no ajusta inventario. El cajero deberá corregir la cuenta si aplica.', {
            title: 'Cancelar item',
            confirmButtonText: 'Sí, cancelar item',
            cancelButtonText: 'Volver'
        }))) return;

        const result = await kitchenCloud.changeOrderItemStatus({
            restaurantOrderId: order.id,
            restaurantOrderItemId: itemId,
            status: 'cancelled'
        });

        if (result?.success === false) {
            showMessageModal(result.message || kitchenCloud.error || 'No pudimos cancelar el item.', null, { type: 'error' });
        } else {
            showMessageModal('Item cancelado en cocina. Recuerda ajustar la cuenta si aplica.', null, { type: 'success' });
        }
    };

    const handleCloudCancelOrder = async (order) => {
        if (!(await showConfirmModal('¿Cancelar esta comanda en cocina? Esto no cobra ni descuenta inventario.', {
            title: 'Cancelar comanda',
            confirmButtonText: 'Sí, cancelar',
            cancelButtonText: 'Volver'
        }))) return;

        const result = await kitchenCloud.changeOrderStatus({
            restaurantOrderId: order.id,
            status: 'cancelled'
        });

        if (result?.success === false) {
            showMessageModal(result.message || kitchenCloud.error || 'No pudimos cancelar la comanda.', null, { type: 'error' });
        } else {
            showMessageModal('Comanda cancelada en cocina', null, { type: 'success' });
        }
    };

    const displayedOrders = useMemo(() => {
        return orders.filter(order => {
            const status = order.fulfillmentStatus || 'pending';
            if (filter === 'all') return true;
            if (filter === 'history') return status === 'completed' || status === 'cancelled';
            if (filter === 'pending') return status === 'pending' || status === 'open';
            return status === filter;
        });
    }, [orders, filter]);

    const localStatusCounts = useMemo(() => countLocalOrderBuckets(orders), [orders]);
    const visibleItemsCount = useMemo(() => countItemsInOrders(displayedOrders), [displayedOrders]);

    const productionSummary = useMemo(() => {
        if (filter !== 'pending') return null;

        const summary = {};
        displayedOrders.forEach(order => {
            getOrderItems(order).forEach(item => {
                const key = getItemName(item);
                summary[key] = (summary[key] || 0) + Number(getItemQuantity(item) || 1);
            });
        });

        return Object.entries(summary)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
    }, [displayedOrders, filter]);

    const localMetrics = [
        { label: 'En cocina', value: localStatusCounts.pending, tone: 'pending' },
        { label: 'Listas', value: localStatusCounts.ready, tone: 'ready' },
        { label: 'Visibles', value: displayedOrders.length, tone: 'active' },
        { label: 'Items', value: visibleItemsCount, tone: 'station' }
    ];
    const localTabs = [
        {
            key: 'pending',
            label: 'Cocina',
            count: localStatusCounts.pending,
            Icon: Flame,
            tone: 'pending',
            active: filter === 'pending',
            onClick: () => setFilter('pending')
        },
        {
            key: 'ready',
            label: 'Entrega',
            count: localStatusCounts.ready,
            Icon: CheckCircle,
            tone: 'ready',
            active: filter === 'ready',
            onClick: () => setFilter('ready')
        },
        {
            key: 'history',
            label: 'Historial',
            count: localStatusCounts.history,
            Icon: History,
            tone: 'history',
            active: filter === 'history',
            onClick: () => setFilter('history')
        }
    ];

    if (shouldUseCloudKds) {
        return (
            <div className="kds-container mode-cloud">
                <audio ref={audioPlayer} src={NOTIFICATION_SOUND} />
                <CloudKitchenMonitor
                    kitchenCloud={kitchenCloud}
                    onAdvanceStatus={handleCloudAdvanceStatus}
                    onCancelOrder={handleCloudCancelOrder}
                    onChangeItemStatus={handleCloudItemStatusChange}
                    onCancelItemStatus={handleCloudCancelItemStatus}
                />
            </div>
        );
    }

    return (
        <div className="kds-container mode-local">
            <audio ref={audioPlayer} src={NOTIFICATION_SOUND} />

            <KdsCommandCenter
                modeLabel="FREE local"
                modeTone="local"
                title="Monitor de cocina"
                statusText="Pedidos locales"
                metrics={localMetrics}
                tabs={localTabs}
                onRefresh={fetchOrders}
                isLoading={isLoading}
            />

            <ProductionSummary items={productionSummary} />

            <div className="kds-grid">
                {isLoading && <div className="kds-loading">Conectando con meseros...</div>}

                {!isLoading && displayedOrders.length === 0 && (
                    <div className="kds-empty">
                        <div className="empty-icon">
                            {filter === 'pending' ? <ChefHat size={64} /> : filter === 'ready' ? <CheckCircle size={64} /> : <History size={64} />}
                        </div>
                        <h3>
                            {filter === 'pending' ? 'Cocina despejada' :
                                filter === 'ready' ? 'Todo entregado' : 'Sin historial reciente'}
                        </h3>
                        <p>
                            {filter === 'pending' ? 'Esperando nuevas comandas...' :
                                filter === 'ready' ? 'No hay pedidos esperando entrega.' : 'Las comandas de las últimas 24h aparecerán aquí.'}
                        </p>
                    </div>
                )}

                {displayedOrders.map(order => {
                    const displayStatus = normalizeOrderStatus(order.fulfillmentStatus || 'pending');
                    const ticketItems = getOrderItems(order);

                    return (
                    <div key={order.id || order.timestamp} className={`kds-ticket status-${displayStatus}`} role="article">
                        <div className="ticket-header">
                            <div className="ticket-info">
                                <span className="ticket-kicker">Comanda</span>
                                <span className="ticket-id">#{String(order.timestamp || order.id || '').slice(-4)}</span>
                                <span className="ticket-customer">
                                    {order.tableData ? (
                                        <><UtensilsCrossed size={14} /> {order.tableData}</>
                                    ) : order.customerId ? (
                                        <><User size={14} /> Cliente</>
                                    ) : (
                                        <><Store size={14} /> Mostrador</>
                                    )}
                                </span>
                            </div>
                            <div className="ticket-header-side">
                                <span className={`kds-status-badge status-${displayStatus}`}>{STATUS_LABELS[displayStatus] || displayStatus}</span>
                                <TicketTimer timestamp={order.timestamp} status={displayStatus} />
                            </div>
                        </div>

                        <div className="ticket-progress-row">
                            <span>{ticketItems.length} productos</span>
                            <span>{filter === 'pending' ? 'Preparar' : filter === 'ready' ? 'Entregar' : STATUS_LABELS[displayStatus] || displayStatus}</span>
                        </div>

                        {order.notes && (
                            <div className="ticket-global-note">
                                <AlertTriangle size={16} />
                                <span>{order.notes}</span>
                            </div>
                        )}

                        <div className="ticket-body">
                            {ticketItems.map((item, idx) => {
                                const modifiers = normalizeModifiers(item.selectedModifiers);

                                return (
                                    <div key={idx} className="ticket-item">
                                        <div className="item-main">
                                            <span className="item-qty">{getItemQuantity(item)}</span>
                                            <span className="item-name">{getItemName(item)}</span>
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
                                    </div>
                                );
                            })}
                        </div>

                        <div className="ticket-footer">
                            <div className="ticket-meta">
                                {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>

                            <div className="ticket-actions">
                                {filter === 'pending' && (
                                    <>
                                        <button
                                            type="button"
                                            className="btn-kds-cancel"
                                            onClick={() => handleCancelOrder(order)}
                                            title="Rechazar"
                                            aria-label="Rechazar comanda"
                                        >
                                            <X size={18} />
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-kds-action advance"
                                            onClick={() => handleAdvanceStatus(order)}
                                        >
                                            ¡LISTO!
                                        </button>
                                    </>
                                )}

                                {filter === 'ready' && (
                                    <button
                                        type="button"
                                        className="btn-kds-action deliver"
                                        onClick={() => handleAdvanceStatus(order)}
                                    >
                                        ENTREGADO
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    );
                })}
            </div>
        </div>
    );
}
