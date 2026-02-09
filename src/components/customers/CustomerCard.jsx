// src/components/customers/CustomerCard.jsx
import React, { memo } from 'react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig'; // <--- 1. IMPORTAR EL HOOK
import {
    Edit,
    Trash2,
    History,
    MessageCircle,
    Wallet,
    Phone,
    MapPin,
    AlertCircle,
    Package
} from 'lucide-react';

const CustomerCard = memo(({
    customer,
    isWhatsAppLoading,
    onEdit,
    onDelete,
    onViewHistory,
    onAbonar,
    onWhatsApp,
    onViewLayaways
}) => {
    // 2. OBTENER LA CONFIGURACIÓN
    const { hasLayaway } = useFeatureConfig(); 

    const hasDebt = (customer.debt || 0) > 0;

    return (
        <div className={`customer-card ${hasDebt ? 'has-debt' : ''}`}>
            {/* ... (Encabezado se mantiene igual) ... */}
            <div className="customer-content">
               {/* ... (Contenido se mantiene igual) ... */}
               <div className="customer-header">
                    <h4 className="customer-name">{customer.name}</h4>
                    {hasDebt && (
                        <div className="debt-badge">
                            <AlertCircle size={14} />
                            <span>Deuda: ${customer.debt.toFixed(2)}</span>
                        </div>
                    )}
                </div>

                <div className="customer-details">
                    <p title="Teléfono">
                        <Phone size={16} className="icon-muted" />
                        <span>{customer.phone || 'Sin teléfono'}</span>
                    </p>
                    <p title="Dirección">
                        <MapPin size={16} className="icon-muted" />
                        <span className="address-text">{customer.address || 'Sin dirección'}</span>
                    </p>
                </div>
            </div>

            {/* Acciones */}
            <div className="customer-actions-container">

                {/* Acciones Primarias */}
                <div className="actions-primary">
                    {hasDebt && (
                        <button
                            className="btn btn-abono"
                            onClick={() => onAbonar(customer)}
                        >
                            <Wallet size={18} />
                            <span>Abonar</span>
                        </button>
                    )}

                    {/* 3. AGREGAR LA CONDICIÓN AQUÍ */}
                    {hasLayaway && (
                        <button
                            className="btn btn-layaway"
                            onClick={() => onViewLayaways(customer)}
                            title="Ver apartados activos"
                        >
                            <Package size={18} />
                            <span>Apartados</span>
                        </button>
                    )}

                    {customer.phone && (
                        <button
                            className="btn btn-whatsapp"
                            onClick={() => onWhatsApp(customer)}
                            disabled={isWhatsAppLoading}
                        >
                            <MessageCircle size={18} />
                            <span>{isWhatsAppLoading ? '...' : 'Chat'}</span>
                        </button>
                    )}
                </div>

                {/* ... Resto del componente igual ... */}
                <div className="actions-secondary">
                    {/* ... Botones secundarios ... */}
                     <button
                        className="btn-icon-text"
                        onClick={() => onViewHistory(customer)}
                        title="Ver historial"
                    >
                        <History size={16} />
                        <span>Historial</span>
                    </button>

                    <button
                        className="btn-icon-text info"
                        onClick={() => onEdit(customer)}
                        title="Editar"
                    >
                        <Edit size={16} />
                        <span>Editar</span>
                    </button>

                    <button
                        className="btn-icon-text danger"
                        onClick={() => onDelete(customer.id)}
                        title="Borrar"
                    >
                        <Trash2 size={16} />
                        <span>Borrar</span>
                    </button>
                </div>
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.customer === nextProps.customer &&
        prevProps.isWhatsAppLoading === nextProps.isWhatsAppLoading
    );
});

export default CustomerCard;
