// src/pages/OrdersPage.jsx
import React, { useState, useEffect } from 'react';
import { loadData, saveDataSafe, STORES, getOrdersSince } from '../services/database';
import { showMessageModal } from '../services/utils';
import './OrderPage.css';

export default function OrdersPage() {
    const [orders, setOrders] = useState([]);
    const [filter, setFilter] = useState('pending');
    const [isLoading, setIsLoading] = useState(true);

    const fetchOrders = async () => {
        try {
            // Calculamos la fecha de ayer (hace 24 horas)
            const yesterday = new Date();
            yesterday.setHours(yesterday.getHours() - 24);
            const isoDate = yesterday.toISOString();

            // --- CAMBIO CRÍTICO ---
            // ANTES: const allSales = await loadData(STORES.SALES); (Cargaba TODO)
            // AHORA: Solo cargamos lo que necesitamos
            const activeOrders = await getOrdersSince(isoDate);

            // El resto de tu lógica de filtrado se mantiene igual, 
            // pero ahora trabaja sobre un array pequeño (ej. 50 items) en lugar de miles.
            const filteredOrders = activeOrders.filter(sale => {
                const status = sale.fulfillmentStatus || 'completed';

                if (filter === 'all') return true; // Ya viene filtrado por fecha desde la BD

                // Ocultamos 'cancelled' y 'completed' de las vistas activas
                return status === filter;
            });

            filteredOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            setOrders(filteredOrders);
        } catch (error) {
            console.error("Error cargando pedidos:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
        const interval = setInterval(fetchOrders, 15000);
        return () => clearInterval(interval);
    }, [filter]);

    const handleAdvanceStatus = async (order) => {
        const nextStatus = order.fulfillmentStatus === 'pending' ? 'ready' : 'completed';
        const updatedOrder = { ...order, fulfillmentStatus: nextStatus };

        // CAMBIO: saveDataSafe
        const result = await saveDataSafe(STORES.SALES, updatedOrder);

        if (result.success) {
            if (filter !== 'all') {
                setOrders(prev => prev.filter(o => o.timestamp !== order.timestamp));
            } else {
                fetchOrders();
            }
        } else {
            showMessageModal(`Error al actualizar: ${result.error?.message}`);
        }
    };

    // --- NUEVA FUNCIÓN: CANCELAR PEDIDO ---
    const handleCancelOrder = async (order) => {
        if (!window.confirm('¿Seguro que deseas CANCELAR este pedido?')) return;

        const updatedOrder = { ...order, fulfillmentStatus: 'cancelled' };

        // CAMBIO: saveDataSafe
        const result = await saveDataSafe(STORES.SALES, updatedOrder);

        if (result.success) {
            if (filter !== 'all') {
                setOrders(prev => prev.filter(o => o.timestamp !== order.timestamp));
            } else {
                fetchOrders();
            }
            showMessageModal('Pedido cancelado.');
        } else {
            showMessageModal(`Error al cancelar: ${result.error?.message}`);
        }
    };

    const getStatusLabel = (status) => {
        switch (status) {
            case 'pending': return '🔥 Cocinando';
            case 'ready': return '✅ Listo para Entrega';
            case 'completed': return 'Entregado';
            case 'cancelled': return '❌ Cancelado'; // Etiqueta nueva
            default: return 'Completado';
        }
    };

    return (
        <div className="orders-page-container">
            <div className="orders-header">
                <div className="orders-filters">
                    <button className={`filter-btn ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>Pendientes</button>
                    <button className={`filter-btn ${filter === 'ready' ? 'active' : ''}`} onClick={() => setFilter('ready')}>Listos</button>
                    {/* Botón opcional para ver cancelados si quisieras */}
                    <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Todos (24h)</button>
                    <button className="btn-refresh" onClick={fetchOrders}>🔄</button>
                </div>
            </div>

            {isLoading ? (
                <div className="loader-container">Cargando pedidos...</div>
            ) : (
                <div className="orders-grid">
                    {orders.length === 0 ? (
                        <div className="empty-kitchen">
                            <h3>🎉 Todo tranquilo</h3>
                            <p>No hay pedidos en este estado.</p>
                        </div>
                    ) : (
                        orders.map(order => (
                            <div key={order.timestamp} className={`order-card status-${order.fulfillmentStatus || 'completed'}`}>
                                <div className="order-card-header">
                                    <span className="order-time">
                                        {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <span className="order-id">#{order.timestamp.slice(-4)}</span>
                                </div>

                                {order.customerId && (
                                    <div className="order-customer">👤 Cliente Registrado</div>
                                )}

                                <ul className="order-items-list">
                                    {order.items.map((item, idx) => (
                                        <li key={idx} className="order-item-line">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                                                <span>{item.quantity}x {item.name}</span>
                                            </div>
                                            {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                                                <div className="kitchen-modifiers">
                                                    {item.selectedModifiers.map(m => m.name).join(', ')}
                                                </div>
                                            )}
                                            {item.notes && <div className="kitchen-notes">📝 {item.notes}</div>}
                                        </li>
                                    ))}
                                </ul>

                                <div className="order-card-footer">
                                    <div className="status-indicator">
                                        {getStatusLabel(order.fulfillmentStatus || 'pending')}
                                    </div>

                                    {/* BOTONES DE ACCIÓN */}
                                    {order.fulfillmentStatus !== 'completed' && order.fulfillmentStatus !== 'cancelled' && (
                                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                            {/* Botón de Cancelar (pequeño y rojo) */}
                                            <button
                                                className="btn-cancel-order"
                                                onClick={() => handleCancelOrder(order)}
                                                title="Cancelar Pedido"
                                            >
                                                ✖
                                            </button>

                                            {/* Botón de Avanzar (grande) */}
                                            <button
                                                className="btn-advance-order"
                                                onClick={() => handleAdvanceStatus(order)}
                                            >
                                                {order.fulfillmentStatus === 'pending' ? 'Marcar LISTO' : 'Entregar'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}