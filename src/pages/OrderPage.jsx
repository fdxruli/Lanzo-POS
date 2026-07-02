import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Clock, Flame, CheckCircle, History, RefreshCw, ChefHat, UtensilsCrossed, User, Store, AlertTriangle, StickyNote } from 'lucide-react';
import { saveDataSafe, STORES, getOrdersSince } from '../services/database';
import { showConfirmModal, showMessageModal } from '../services/utils';
import Logger from '../services/Logger';
import useKitchenOrdersCloud from '../hooks/restaurant/useKitchenOrdersCloud';
import './OrderPage.css';

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

const getItemName = (item = {}) => item.productName || item.name || item.product_name || 'Producto';
const getItemQuantity = (item = {}) => item.quantity ?? item.qty ?? 1;

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

const getCloudStatusAction = (order) => {
    const status = getOrderStatus(order);
    if (status === 'pending') return { nextStatus: 'preparing', label: 'Marcar en preparación', className: 'advance' };
    if (status === 'preparing') return { nextStatus: 'ready', label: 'Marcar listo', className: 'advance' };
    if (status === 'ready') return { nextStatus: 'delivered', label: 'Marcar entregado', className: 'deliver' };
    return null;
};

const getTicketId = (order = {}) => {
    const id = order.id || order.localOrderId || order.saleId || order.timestamp || '';
    const shortId = String(id).replace(/-/g, '').slice(-4).toUpperCase();
    return shortId || 'KDS';
};

// Componente para el Temporizador Individual de cada Ticket
const TicketTimer = ({ timestamp, status }) => {
    const [now, setNow] = useState(() => Date.now());
    const startedAt = new Date(timestamp || Date.now()).getTime();
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

const CloudKitchenMonitor = ({ kitchenCloud, onAdvanceStatus, onCancelOrder }) => {
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
                const key = getItemName(item);
                summary[key] = (summary[key] || 0) + Number(getItemQuantity(item) || 1);
            });
        });

        return Object.entries(summary)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
    }, [displayedOrders, statusFilter]);

    const showEmptyState = !isLoading && !error && displayedOrders.length === 0;

    return (
        <>
            <div className="kds-header cloud">
                <div className="kds-tabs">
                    <button
                        className={`kds-tab ${statusFilter === 'pending' ? 'active pending' : ''}`}
                        onClick={() => setStatusFilter('pending')}
                    >
                        <Flame size={18} />
                        <span>Cocina ({statusCounts.pending})</span>
                    </button>
                    <button
                        className={`kds-tab ${statusFilter === 'ready' ? 'active ready' : ''}`}
                        onClick={() => setStatusFilter('ready')}
                    >
                        <CheckCircle size={18} />
                        <span>Entrega ({statusCounts.ready})</span>
                    </button>
                    <button
                        className={`kds-tab ${statusFilter === 'history' ? 'active history' : ''}`}
                        onClick={() => setStatusFilter('history')}
                    >
                        <History size={18} />
                        <span>Historial</span>
                    </button>
                </div>

                <button
                    className={`kds-refresh-btn ${isLoading ? 'loading' : ''}`}
                    onClick={() => refreshKitchenOrders({ force: true })}
                    disabled={isLoading || !hasReadPermission}
                    title="Actualizar cocina"
                >
                    <RefreshCw size={24} strokeWidth={2} />
                </button>
            </div>

            <div className="kds-cloud-status-bar">
                <div>
                    <strong>Monitor cloud de cocina</strong>
                    <span>Vista operativa por estación. No es venta final ni reporte financiero.</span>
                </div>
                {lastUpdatedAt && <small>Actualizado {formatTime(lastUpdatedAt)}</small>}
            </div>

            <div className="kds-station-filter" aria-label="Filtro por estación de preparación">
                {stationOptions.map((station) => (
                    <button
                        key={station.code || 'all'}
                        className={`kds-station-tab ${selectedStationCode === station.code ? 'active' : ''}`}
                        onClick={() => setSelectedStationCode(station.code)}
                    >
                        {station.name}
                    </button>
                ))}
            </div>

            {error && (
                <div className="kds-alert" role="alert">
                    <AlertTriangle size={18} />
                    <span>{error}</span>
                </div>
            )}

            {productionSummary && productionSummary.length > 0 && (
                <div className="production-bar">
                    <span className="prod-title">A PRODUCIR:</span>
                    {productionSummary.map(([name, count]) => (
                        <div key={name} className="prod-badge">
                            <span className="prod-count">{count}</span>
                            <span className="prod-name">{name}</span>
                        </div>
                    ))}
                </div>
            )}

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
                    const action = getCloudStatusAction(order);
                    const ticketTotal = formatCurrency(order.total);
                    const isCurrentOrderUpdating = updatingOrderId === order.id;
                    const isTerminal = TERMINAL_STATUSES.has(status);

                    return (
                        <div key={order.id || order.localOrderId || order.saleId} className={`kds-ticket status-${status}`}>
                            <div className="ticket-header">
                                <div className="ticket-info">
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
                                    <span className={`kds-status-badge status-${status}`}>{STATUS_LABELS[status] || status}</span>
                                    <TicketTimer timestamp={getOrderTimestamp(order)} status={status} />
                                </div>
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

                                    return (
                                        <div key={item.id || item.localLineId || idx} className="ticket-item">
                                            <div className="item-main">
                                                <span className="item-qty">{getItemQuantity(item)}</span>
                                                <span className="item-name">{getItemName(item)}</span>
                                            </div>

                                            <div className="item-station-row">
                                                <span className="item-station-badge">{stationName}</span>
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
                                <div className="ticket-meta cloud">
                                    <span>Creada {formatTime(getOrderTimestamp(order))}</span>
                                    <span>Actualizada {formatTime(getOrderUpdatedTimestamp(order))}</span>
                                    {ticketTotal && <span>Total ref. {ticketTotal}</span>}
                                </div>

                                <div className="ticket-actions">
                                    {!isTerminal && hasWritePermission && (
                                        <button
                                            className="btn-kds-cancel"
                                            onClick={() => onCancelOrder(order)}
                                            title="Cancelar comanda"
                                            disabled={isUpdating}
                                        >
                                            ✕
                                        </button>
                                    )}

                                    {action && hasWritePermission && (
                                        <button
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

        const result = await kitchenCloud.changeOrderStatus({
            restaurantOrderId: order.id,
            status: action.nextStatus
        });

        if (result?.success === false) {
            showMessageModal(result.message || kitchenCloud.error || 'No pudimos actualizar la comanda.', null, { type: 'error' });
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

    const productionSummary = useMemo(() => {
        if (filter !== 'pending') return null;

        const summary = {};
        displayedOrders.forEach(order => {
            order.items.forEach(item => {
                const key = getItemName(item);
                summary[key] = (summary[key] || 0) + (item.quantity || 1);
            });
        });

        return Object.entries(summary)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
    }, [displayedOrders, filter]);

    if (shouldUseCloudKds) {
        return (
            <div className="kds-container">
                <audio ref={audioPlayer} src={NOTIFICATION_SOUND} />
                <CloudKitchenMonitor
                    kitchenCloud={kitchenCloud}
                    onAdvanceStatus={handleCloudAdvanceStatus}
                    onCancelOrder={handleCloudCancelOrder}
                />
            </div>
        );
    }

    return (
        <div className="kds-container">
            <audio ref={audioPlayer} src={NOTIFICATION_SOUND} />

            <div className="kds-header">
                <div className="kds-tabs">
                    <button
                        className={`kds-tab ${filter === 'pending' ? 'active pending' : ''}`}
                        onClick={() => setFilter('pending')}
                    >
                        <Flame size={18} />
                        <span>Cocina ({orders.filter(o => ['pending', 'open'].includes(o.fulfillmentStatus || 'pending')).length})</span>
                    </button>
                    <button
                        className={`kds-tab ${filter === 'ready' ? 'active ready' : ''}`}
                        onClick={() => setFilter('ready')}
                    >
                        <CheckCircle size={18} />
                        <span>Entrega ({orders.filter(o => o.fulfillmentStatus === 'ready').length})</span>
                    </button>
                    <button
                        className={`kds-tab ${filter === 'history' ? 'active history' : ''}`}
                        onClick={() => setFilter('history')}
                    >
                        <History size={18} />
                        <span>Historial</span>
                    </button>
                </div>

                <button className="kds-refresh-btn" onClick={fetchOrders}>
                    <RefreshCw size={24} strokeWidth={2} />
                </button>
            </div>

            {productionSummary && productionSummary.length > 0 && (
                <div className="production-bar">
                    <span className="prod-title">A PRODUCIR:</span>
                    {productionSummary.map(([name, count]) => (
                        <div key={name} className="prod-badge">
                            <span className="prod-count">{count}</span>
                            <span className="prod-name">{name}</span>
                        </div>
                    ))}
                </div>
            )}

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

                {displayedOrders.map(order => (
                    <div key={order.id} className={`kds-ticket status-${order.fulfillmentStatus || 'pending'}`}>

                        <div className="ticket-header">
                            <div className="ticket-info">
                                <span className="ticket-id">#{order.timestamp.slice(-4)}</span>
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
                            <TicketTimer timestamp={order.timestamp} status={order.fulfillmentStatus || 'pending'} />
                        </div>

                        {order.notes && (
                            <div className="ticket-global-note">
                                <AlertTriangle size={16} />
                                <span>{order.notes}</span>
                            </div>
                        )}

                        <div className="ticket-body">
                            {order.items.map((item, idx) => (
                                <div key={idx} className="ticket-item">
                                    <div className="item-main">
                                        <span className="item-qty">{item.quantity}</span>
                                        <span className="item-name">{item.name}</span>
                                    </div>

                                    {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                                        <div className="item-modifiers">
                                            {item.selectedModifiers.map((m, i) => (
                                                <span key={i} className="modifier-tag">{m.name}</span>
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
                            ))}
                        </div>

                        <div className="ticket-footer">
                            <div className="ticket-meta">
                                {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>

                            <div className="ticket-actions">
                                {filter === 'pending' && (
                                    <>
                                        <button
                                            className="btn-kds-cancel"
                                            onClick={() => handleCancelOrder(order)}
                                            title="Rechazar"
                                        >
                                            ✕
                                        </button>
                                        <button
                                            className="btn-kds-action advance"
                                            onClick={() => handleAdvanceStatus(order)}
                                        >
                                            ¡LISTO!
                                        </button>
                                    </>
                                )}

                                {filter === 'ready' && (
                                    <button
                                        className="btn-kds-action deliver"
                                        onClick={() => handleAdvanceStatus(order)}
                                    >
                                        ENTREGADO
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
