import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Clock, Flame, CheckCircle, History, RefreshCw, ChefHat, UtensilsCrossed, User, Store, AlertTriangle, StickyNote } from 'lucide-react';
import { saveDataSafe, STORES, getOrdersSince } from '../services/database';
import { showMessageModal } from '../services/utils';
import Logger from '../services/Logger';
import './OrderPage.css';

// Componente para el Temporizador Individual de cada Ticket
const TicketTimer = ({ timestamp, status }) => {
    const [now, setNow] = useState(() => Date.now());
    const elapsed = Math.floor((now - new Date(timestamp).getTime()) / 60000);

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(interval);
    }, []);

    let urgencyClass = 'time-fresh';
    if (status === 'pending' || status === 'open') {
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

export default function OrdersPage() {
    const [orders, setOrders] = useState([]);
    const [filter, setFilter] = useState('pending');
    const [isLoading, setIsLoading] = useState(true);

    const prevOrdersLength = useRef(0);
    const audioPlayer = useRef(null);

    const NOTIFICATION_SOUND = "https://actions.google.com/sounds/v1/cartoon/cartoon_boing.ogg";

    const playNotificationSound = useCallback(() => {
        if (audioPlayer.current) {
            audioPlayer.current.play().catch(() => Logger.info("Interacción requerida para audio"));
        }
    }, []);

    const fetchOrders = useCallback(async () => {
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
            Logger.error("Error cargando pedidos:", error);
        } finally {
            setIsLoading(false);
        }
    }, [playNotificationSound]);

    useEffect(() => {
        fetchOrders();
        const interval = setInterval(fetchOrders, 10000);
        return () => clearInterval(interval);
    }, [fetchOrders]);

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
        if (!window.confirm('¿Rechazar esta comanda en cocina? (El cajero deberá gestionar la cancelación financiera si aplica)')) return;

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
                const key = item.name;
                summary[key] = (summary[key] || 0) + (item.quantity || 1);
            });
        });

        return Object.entries(summary)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
    }, [displayedOrders, filter]);

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