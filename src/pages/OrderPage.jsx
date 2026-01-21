// src/pages/OrderPage.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { saveDataSafe, STORES, getOrdersSince } from '../services/database';
import { showMessageModal } from '../services/utils';
import Logger from '../services/Logger';
import './OrderPage.css';

// Componente para el Temporizador Individual de cada Ticket
const TicketTimer = ({ timestamp, status }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const calculateTime = () => {
            const start = new Date(timestamp).getTime();
            const now = new Date().getTime();
            return Math.floor((now - start) / 60000); // Minutos
        };

        setElapsed(calculateTime());
        // Actualizar cada 30 segundos para no sobrecargar
        const interval = setInterval(() => setElapsed(calculateTime()), 30000);
        return () => clearInterval(interval);
    }, [timestamp]);

    // Definir urgencia (Semáforo)
    let urgencyClass = 'time-fresh';
    if (status === 'pending') {
        if (elapsed > 10) urgencyClass = 'time-warning'; // Más de 10 min
        if (elapsed > 20) urgencyClass = 'time-critical'; // Más de 20 min
    }

    return (
        <div className={`ticket-timer ${urgencyClass}`}>
            ⏰ {elapsed} min
        </div>
    );
};

export default function OrdersPage() {
    const [orders, setOrders] = useState([]);
    const [filter, setFilter] = useState('pending');
    const [isLoading, setIsLoading] = useState(true);
    
    // Referencia para detectar nuevos pedidos y sonar la campana
    const prevOrdersLength = useRef(0);
    const audioPlayer = useRef(null);

    // Sonido de campana
    const NOTIFICATION_SOUND = "https://actions.google.com/sounds/v1/cartoon/cartoon_boing.ogg"; 

    const fetchOrders = async () => {
        try {
            const yesterday = new Date();
            yesterday.setHours(yesterday.getHours() - 24);
            const isoDate = yesterday.toISOString();

            const activeOrders = await getOrdersSince(isoDate);

            // Ordenar: Los más viejos primero (FIFO - First In, First Out)
            activeOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            // --- LÓGICA DINÁMICA DE SECCIONES (AUTOPILOT) ---
            const pendingCount = activeOrders.filter(o => (o.fulfillmentStatus || 'pending') === 'pending').length;
            const readyCount = activeOrders.filter(o => o.fulfillmentStatus === 'ready').length;

            // 1. DETECCIÓN DE SONIDO (Solo si aumentan los pendientes)
            if (pendingCount > prevOrdersLength.current && prevOrdersLength.current !== 0) {
                playNotificationSound();
            }
            prevOrdersLength.current = pendingCount;

            // 2. CAMBIO AUTOMÁTICO DE PESTAÑA (PRIORIDAD: COCINA > ENTREGA > HISTORIAL)
            // "Si tenemos comandas nuevas que nos aparezca en cocina"
            if (pendingCount > 0) {
                setFilter('pending');
            } 
            // "Si ya tenemos todo listo... que se nos muestre entrega"
            else if (readyCount > 0) {
                setFilter('ready');
            } 
            // "Si no tenemos información... que se nos muestre historial"
            else {
                setFilter('history');
            }

            setOrders(activeOrders);
        } catch (error) {
            Logger.error("Error cargando pedidos:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const playNotificationSound = () => {
        if (audioPlayer.current) {
            audioPlayer.current.play().catch(e => console.log("Interacción requerida para audio"));
        }
    };

    useEffect(() => {
        fetchOrders();
        const interval = setInterval(fetchOrders, 10000); // Polling cada 10s
        return () => clearInterval(interval);
    }, []);

    const handleAdvanceStatus = async (order) => {
        const nextStatus = order.fulfillmentStatus === 'pending' ? 'ready' : 'completed';
        
        // Optimistic UI Update
        const updatedOrders = orders.map(o => 
            o.timestamp === order.timestamp ? { ...o, fulfillmentStatus: nextStatus } : o
        );
        setOrders(updatedOrders); // Actualizamos estado local inmediatamente

        // Re-evaluamos la navegación dinámica inmediatamente para que no espere 10s
        // (Opcional: Si prefieres que espere al siguiente refresh, quita este bloque,
        // pero para UX fluida es mejor que si terminas el último plato, te lleve a entrega/historial al instante)
        const pendingCount = updatedOrders.filter(o => (o.fulfillmentStatus || 'pending') === 'pending').length;
        const readyCount = updatedOrders.filter(o => o.fulfillmentStatus === 'ready').length;
        
        if (pendingCount > 0) setFilter('pending');
        else if (readyCount > 0) setFilter('ready');
        else setFilter('history');

        const updatedOrder = { ...order, fulfillmentStatus: nextStatus };
        const result = await saveDataSafe(STORES.SALES, updatedOrder);

        if (!result.success) {
            showMessageModal(`Error al guardar: ${result.error?.message}`);
            fetchOrders(); // Revertir si falló
        }
    };

    const handleCancelOrder = async (order) => {
        if (!window.confirm('¿Cancelar comanda definitivamente?')) return;
        
        const updatedOrder = { ...order, fulfillmentStatus: 'cancelled' };
        const result = await saveDataSafe(STORES.SALES, updatedOrder);
        
        if (result.success) {
            fetchOrders(); // Esto disparará la lógica dinámica nuevamente
            showMessageModal('Pedido cancelado', null, { type: 'success' });
        }
    };

    // --- LÓGICA DE FILTRADO VISUAL ---
    const displayedOrders = useMemo(() => {
        return orders.filter(order => {
            const status = order.fulfillmentStatus || 'pending';
            if (filter === 'all') return true;
            if (filter === 'history') return status === 'completed' || status === 'cancelled';
            return status === filter;
        });
    }, [orders, filter]);

    // --- RESUMEN DE PRODUCCIÓN ---
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
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5);
    }, [displayedOrders, filter]);


    return (
        <div className="kds-container">
            {/* Elemento de Audio Oculto */}
            <audio ref={audioPlayer} src={NOTIFICATION_SOUND} />

            {/* HEADER DE CONTROL */}
            <div className="kds-header">
                <div className="kds-tabs">
                    <button 
                        className={`kds-tab ${filter === 'pending' ? 'active pending' : ''}`} 
                        onClick={() => setFilter('pending')}
                    >
                        🔥 Cocina ({orders.filter(o => (o.fulfillmentStatus||'pending') === 'pending').length})
                    </button>
                    <button 
                        className={`kds-tab ${filter === 'ready' ? 'active ready' : ''}`} 
                        onClick={() => setFilter('ready')}
                    >
                        ✅ Entrega ({orders.filter(o => o.fulfillmentStatus === 'ready').length})
                    </button>
                    <button 
                        className={`kds-tab ${filter === 'history' ? 'active history' : ''}`} 
                        onClick={() => setFilter('history')}
                    >
                        📜 Historial
                    </button>
                </div>
                
                <button className="kds-refresh-btn" onClick={fetchOrders}>🔄</button>
            </div>

            {/* BARRA DE RESUMEN DE PRODUCCIÓN (Solo en vista Cocina) */}
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

            {/* GRID DE TICKETS */}
            <div className="kds-grid">
                {isLoading && <div className="kds-loading">Conectando con meseros...</div>}
                
                {!isLoading && displayedOrders.length === 0 && (
                    <div className="kds-empty">
                        <div className="empty-icon">
                            {filter === 'pending' ? '👨‍🍳' : filter === 'ready' ? '✅' : '📜'}
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
                    <div key={order.timestamp} className={`kds-ticket status-${order.fulfillmentStatus || 'pending'}`}>
                        
                        {/* ENCABEZADO DEL TICKET */}
                        <div className="ticket-header">
                            <div className="ticket-info">
                                <span className="ticket-id">#{order.timestamp.slice(-4)}</span>
                                <span className="ticket-customer">
                                    {order.customerId ? '👤 Cliente' : '🛒 Mostrador'}
                                </span>
                            </div>
                            <TicketTimer timestamp={order.timestamp} status={order.fulfillmentStatus || 'pending'} />
                        </div>

                        {/* NOTAS GENERALES */}
                        {order.notes && (
                            <div className="ticket-global-note">
                                ⚠️ {order.notes}
                            </div>
                        )}

                        {/* LISTA DE ITEMS */}
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
                                    
                                    {item.notes && <div className="item-note">📝 {item.notes}</div>}
                                </div>
                            ))}
                        </div>

                        {/* FOOTER Y ACCIONES */}
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
                                            title="Cancelar"
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