// src/components/customers/CustomerCard.jsx
import React, { memo } from 'react';

// Envolvemos el componente en 'memo' para evitar re-renderizados innecesarios
const CustomerCard = memo(({ 
    customer, 
    isWhatsAppLoading, // Recibimos el booleano ya calculado (true/false)
    onEdit, 
    onDelete, 
    onViewHistory, 
    onAbonar, 
    onWhatsApp 
}) => {
    
    const hasDebt = customer.debt && customer.debt > 0;

    return (
        <div className={`customer-card ${hasDebt ? 'has-debt' : ''}`}>
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
                        {/* Aquí usamos el booleano directo */}
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
    );
}, (prevProps, nextProps) => {
    // Optimización adicional (opcional):
    // React.memo hace esto automáticamente, pero aquí explicamos la lógica:
    // Solo re-renderizar SI:
    // 1. El objeto cliente cambió (ej. deuda nueva)
    // 2. O el estado de loading de ESTA tarjeta cambió
    return (
        prevProps.customer === nextProps.customer &&
        prevProps.isWhatsAppLoading === nextProps.isWhatsAppLoading
    );
});

export default CustomerCard;