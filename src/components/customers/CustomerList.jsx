// src/components/customers/CustomerList.jsx
import React, { useState, useMemo, useEffect } from 'react';
import './CustomerList.css';

export default function CustomerList({ customers, isLoading, onEdit, onDelete, onViewHistory, onAbonar, onWhatsApp, onWhatsAppLoading }) {
    // 1. Estado para controlar cuántos se muestran
    const [displayLimit, setDisplayLimit] = useState(20);

    // Si cambia la lista de clientes (filtro o recarga), reseteamos el límite
    useEffect(() => {
        setDisplayLimit(20);
    }, [customers]);

    // 2. Ordenar clientes (Memoria)
    // Usamos useMemo para no reordenar cada vez que damos clic en "ver más"
    const sortedCustomers = useMemo(() => {
        return [...customers].sort((a, b) => (b.debt || 0) - (a.debt || 0));
    }, [customers]);

    // 3. Cortar la lista para el renderizado (DOM)
    const visibleCustomers = sortedCustomers.slice(0, displayLimit);
    const hasMore = displayLimit < sortedCustomers.length;

    const handleLoadMore = () => {
        setDisplayLimit(prev => prev + 20);
    };

    if (isLoading) {
        return <div style={{ padding: '20px', textAlign: 'center' }}>Cargando clientes...</div>;
    }
    
    if (customers.length === 0) {
        return <div className="empty-message">No hay clientes registrados.</div>;
    }
    
    return (
        <div className="customer-list-container">
            {/* Renderizamos SOLO los visibles */}
            <div id="customer-list" className="customer-list" aria-label="Lista de clientes">
                {visibleCustomers.map((customer) => {
                    const hasDebt = customer.debt && customer.debt > 0;
                    const isWhatsAppLoading = onWhatsAppLoading === customer.id;
                    
                    return (
                        <div key={customer.id} className={`customer-card ${hasDebt ? 'has-debt' : ''}`}>
                            <div className="customer-info">
                                <h4>{customer.name}</h4>
                                <p><strong>Teléfono:</strong> {customer.phone}</p>
                                <p><strong>Dirección:</strong> {customer.address}</p>
                                
                                {hasDebt && (
                                    <p className="customer-debt">
                                        <strong>Deuda:</strong> ${customer.debt.toFixed(2)}
                                    </p>
                                )}
                            </div>

                            <div className="customer-actions">
                                {hasDebt && (
                                    <button 
                                        className="btn btn-abono" 
                                        onClick={() => onAbonar(customer)}
                                    >
                                        Abonar
                                    </button>
                                )}
                                
                                {customer.phone && (
                                  <button
                                    className="btn btn-whatsapp"
                                    title={hasDebt ? "Enviar recordatorio" : "Chat"}
                                    onClick={() => onWhatsApp(customer)}
                                    disabled={isWhatsAppLoading}
                                  >
                                    {isWhatsAppLoading ? '...' : (hasDebt ? 'Cobrar' : 'Chat')}
                                  </button>
                                )}

                                <button 
                                    className="btn btn-history" 
                                    onClick={() => onViewHistory(customer)}
                                >
                                    Historial
                                </button>
                                <button className="btn btn-edit" onClick={() => onEdit(customer)}>
                                    ✏️
                                </button>
                                <button className="btn btn-delete" onClick={() => onDelete(customer.id)}>
                                    🗑️
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* 4. Botón "Cargar Más" si hay más elementos */}
            {hasMore && (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                    <button 
                        onClick={handleLoadMore}
                        className="btn btn-secondary"
                        style={{ minWidth: '200px' }}
                    >
                        Mostrar más clientes ({sortedCustomers.length - displayLimit} restantes)
                    </button>
                </div>
            )}

            <div style={{ textAlign: 'center', color: '#999', fontSize: '0.8rem', marginTop: '10px' }}>
                Mostrando {visibleCustomers.length} de {sortedCustomers.length} clientes
            </div>
        </div>
    );
}