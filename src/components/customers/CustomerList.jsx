import React, { useState } from 'react';
import PurchaseHistoryModal from './PurchaseHistoryModal';
import './CustomerList.css';

export default function CustomerList({ customers, isLoading, onEdit, onDelete }) {
    const [showHistory, setShowHistory] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState(null);

    const handleViewHistory = (customer) => {
        setSelectedCustomer(customer);
        setShowHistory(true);
    };

    if (isLoading) {
        return <div>Cargando clientes...</div>;
    }

    if (customers.length === 0) {
        return <div className="empty-message">No hay clientes registrados.</div>;
    }

    return (
        <>
            <div className="customer-list-container">
                <div id="customer-list" className="customer-list" aria-label="Lista de clientes">
                    {customers.map((customer) => (
                        <div key={customer.id} className="customer-card">
                            <div className="customer-info">
                                <h4>{customer.name}</h4>
                                <p><strong>Teléfono:</strong> {customer.phone}</p>
                                <p><strong>Dirección:</strong> {customer.address}</p>
                            </div>
                            <div className="customer-actions">
                                <button className="btn btn-edit" onClick={() => onEdit(customer)}>
                                    Editar
                                </button>
                                <button className="btn btn-delete" onClick={() => onDelete(customer.id)}>
                                    Eliminar
                                </button>
                                {/* 5. Conecta el botón */}
                                <button className="btn btn-history" onClick={() => handleShowHistory(customer)}>
                                    Ver Historial
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* 6. Renderiza el modal */}
            <PurchaseHistoryModal
                show={showHistory}
                onClose={() => setShowHistory(false)}
                customer={selectedCustomer}
            />
        </>
    );
}