import { memo } from 'react';
import {
    AlertCircle,
    Edit,
    History,
    MapPin,
    MessageCircle,
    Package,
    Phone,
    Trash2,
    Wallet
} from 'lucide-react';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { formatCustomerDebt, getSafeCustomerDebt } from '../../utils/customerUtils';

const SYNC_BADGES = {
    pending: { label: 'Pendiente', className: 'warning' },
    synced: { label: 'Sincronizado', className: 'success' },
    conflict: { label: 'Conflicto', className: 'danger' },
    error: { label: 'Error sync', className: 'danger' }
};

const CustomerCard = memo(({
    customer,
    isWhatsAppLoading,
    onEdit,
    onDelete,
    onViewHistory,
    onAbonar,
    onWhatsApp,
    onViewLayaways,
    globalLimit = 0
}) => {
    const { hasLayaway } = useFeatureConfig();
    const parsedDebt = getSafeCustomerDebt(customer.debt);
    const hasDebt = parsedDebt > 0;
    const hasCustomerLimit = customer.creditLimit !== undefined && customer.creditLimit !== null;
    const creditLimit = hasCustomerLimit
        ? Number(customer.creditLimit) || 0
        : Number(globalLimit) || 0;
    const creditUsage = creditLimit > 0 ? Math.round((parsedDebt / creditLimit) * 100) : 0;
    const isOverLimit = creditLimit > 0 && parsedDebt > creditLimit;
    const syncBadge = SYNC_BADGES[customer.syncStatus] || null;
    const initials = customer.name
        ?.split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || 'CL';

    return (
        <article className={`ui-card ui-card--interactive customer-card ${hasDebt ? 'has-debt' : ''} ${isOverLimit ? 'is-over-limit' : ''}`}>
            <div className="customer-content">
                <div className="customer-identity">
                    <span className="customer-avatar" aria-hidden="true">{initials}</span>
                    <div>
                        <h3 className="customer-name">{customer.name}</h3>
                        <span className="customer-record-label">Cliente registrado</span>
                        {syncBadge && (
                            <span
                                className={`ui-badge ui-badge--${syncBadge.className === 'danger' ? 'danger' : syncBadge.className} customer-status-badge ${syncBadge.className}`}
                                title={customer.conflictReason || 'Estado de sincronizacion'}
                            >
                                {syncBadge.label}
                            </span>
                        )}
                    </div>
                </div>

                <div className="customer-details">
                    <p title="Telefono">
                        <Phone size={16} className="icon-muted" aria-hidden="true" />
                        <span>{customer.phone || 'Sin telefono'}</span>
                    </p>
                    <p title="Direccion">
                        <MapPin size={16} className="icon-muted" aria-hidden="true" />
                        <span className="address-text">{customer.address || 'Sin direccion'}</span>
                    </p>
                </div>

                <div className="customer-credit-status">
                    <span className={`ui-badge ${isOverLimit ? 'ui-badge--warning' : hasDebt ? 'ui-badge--danger' : 'ui-badge--success'} customer-status-badge ${isOverLimit ? 'warning' : hasDebt ? 'danger' : 'success'}`}>
                        {isOverLimit && <AlertCircle size={14} aria-hidden="true" />}
                        {isOverLimit ? 'Limite excedido' : hasDebt ? 'Con deuda' : 'Al corriente'}
                    </span>
                    <span className="customer-limit-copy">
                        {creditLimit > 0
                            ? `Limite: $${creditLimit.toFixed(2)}`
                            : 'Sin limite configurado'}
                    </span>
                    {creditLimit > 0 && (
                        <div className="customer-credit-progress">
                            <progress
                                max={Math.max(100, creditUsage)}
                                value={creditUsage}
                                aria-label={`Uso de credito: ${creditUsage}%`}
                            />
                            <span>{creditUsage}%</span>
                        </div>
                    )}
                </div>

                <div className={`customer-debt ${hasDebt ? 'has-value' : ''}`}>
                    <span>Deuda actual</span>
                    <strong>${formatCustomerDebt(parsedDebt)}</strong>
                </div>
            </div>

            <div className="customer-actions-container">
                <div className="actions-primary">
                    {hasDebt && (
                        <button
                            type="button"
                            className="ui-button ui-button--success btn btn-abono"
                            onClick={() => onAbonar(customer)}
                        >
                            <Wallet size={18} aria-hidden="true" />
                            <span>Abonar</span>
                        </button>
                    )}

                    {hasLayaway && (
                        <button
                            type="button"
                            className="ui-button ui-button--neutral btn btn-layaway"
                            onClick={() => onViewLayaways(customer)}
                            title="Ver apartados activos"
                        >
                            <Package size={18} aria-hidden="true" />
                            <span>Apartados</span>
                        </button>
                    )}

                    {customer.phone && (
                        <button
                            type="button"
                            className="ui-button ui-button--secondary btn btn-whatsapp"
                            onClick={() => onWhatsApp(customer)}
                            disabled={isWhatsAppLoading}
                        >
                            <MessageCircle size={18} aria-hidden="true" />
                            <span>{isWhatsAppLoading ? '...' : 'Chat'}</span>
                        </button>
                    )}
                </div>

                <div className="actions-secondary">
                    <button
                        type="button"
                        className="ui-button ui-button--ghost ui-button--sm btn-icon-text"
                        onClick={() => onViewHistory(customer)}
                        title="Ver historial"
                    >
                        <History size={16} aria-hidden="true" />
                        <span>Historial</span>
                    </button>

                    <button
                        type="button"
                        className="ui-button ui-button--ghost ui-button--sm btn-icon-text info"
                        onClick={() => onEdit(customer)}
                        title="Editar"
                    >
                        <Edit size={16} aria-hidden="true" />
                        <span>Editar</span>
                    </button>

                    <button
                        type="button"
                        className="ui-button ui-button--danger ui-button--sm btn-icon-text danger"
                        onClick={() => onDelete(customer.id)}
                        title="Borrar"
                    >
                        <Trash2 size={16} aria-hidden="true" />
                        <span>Borrar</span>
                    </button>
                </div>
            </div>
        </article>
    );
}, (prevProps, nextProps) => (
    prevProps.customer === nextProps.customer
    && prevProps.isWhatsAppLoading === nextProps.isWhatsAppLoading
    && prevProps.globalLimit === nextProps.globalLimit
));

CustomerCard.displayName = 'CustomerCard';

export default CustomerCard;
