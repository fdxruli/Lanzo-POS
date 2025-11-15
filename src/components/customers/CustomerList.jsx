// src/components/customers/CustomerList.jsx
import React from 'react';
import './CustomerList.css';

// 1. Recibir 'onWhatsAppLoading'
export default function CustomerList({ customers, isLoading, onEdit, onDelete, onViewHistory, onAbonar, onWhatsApp, onWhatsAppLoading }) {

    if (isLoading) {
        return <div>Cargando clientes...</div>;
    }
    
    if (customers.length === 0) {
        return <div className="empty-message">No hay clientes registrados.</div>;
    }
    
    const sortedCustomers = [...customers].sort((a, b) => (b.debt || 0) - (a.debt || 0));

    return (
        <div className="customer-list-container">
            <div id="customer-list" className="customer-list" aria-label="Lista de clientes">
                
                {sortedCustomers.map((customer) => {
                    const hasDebt = customer.debt && customer.debt > 0;
                    
                    // 2. Verificar si ESTE botón está cargando
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
                                
                                {/* 3. BOTÓN DE WHATSAPP MODIFICADO */}
                                {customer.phone && (
                                  <button
                                    className="btn btn-whatsapp"
                                    title={hasDebt ? "Enviar recordatorio de deuda" : "Enviar WhatsApp"}
                                    onClick={() => onWhatsApp(customer)}
                                    disabled={isWhatsAppLoading} // Deshabilitar si está cargando
                                  >
                                    {/* Cambiar texto según el estado */}
                                    {isWhatsAppLoading 
                                      ? 'Generando...' 
                                      : (hasDebt ? 'Recordatorio' : 'Chat')
                                    }
                                  </button>
                                )}

                                <button 
                                    className="btn btn-history" 
                                    onClick={() => onViewHistory(customer)}
                                >
                                    Historial
                                </button>
                                <button className="btn btn-edit" onClick={() => onEdit(customer)}>
                                    Editar
                                </button>
                                <button className="btn btn-delete" onClick={() => onDelete(customer.id)}>
                                    Eliminar
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    );
}