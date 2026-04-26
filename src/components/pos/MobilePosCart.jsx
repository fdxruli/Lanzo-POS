// src/components/pos/MobilePosCart.jsx
import PropTypes from 'prop-types';
import OrderSummary from './OrderSummary';

/**
 * Componente para el modal móvil del carrito en el POS.
 * Maneja la navegación por historial para el botón "Atrás".
 */
export default function MobilePosCart({
    isOpen,
    onClose,
    onOpenPayment,
    onOpenSplit,
    onOpenLayaway,
    onSaveOpenOrder,
    onOpenTables,
    showRestaurantActions,
    canSplitOrder,
    activeTablesCount
}) {
    if (!isOpen) return null;

    return (
        <div 
            className="modal" 
            style={{ display: 'flex', zIndex: 10005, alignItems: 'flex-end' }}
            onClick={onClose}
        >
            <div
                className="modal-content"
                style={{
                    borderRadius: '20px 20px 0 0',
                    width: '100%',
                    height: '85vh',
                    maxWidth: '100%',
                    padding: '0',
                    animation: 'slideUp 0.3s ease-out',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <OrderSummary
                    onOpenPayment={onOpenPayment}
                    onOpenSplit={onOpenSplit}
                    isMobileModal={true}
                    onClose={onClose}
                    onOpenLayaway={onOpenLayaway}
                    showRestaurantActions={showRestaurantActions}
                    canSplitOrder={canSplitOrder}
                    onSaveOpenOrder={onSaveOpenOrder}
                    onOpenTables={onOpenTables}
                    activeTablesCount={activeTablesCount}
                />
            </div>
        </div>
    );
}

MobilePosCart.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    onOpenPayment: PropTypes.func.isRequired,
    onOpenSplit: PropTypes.func.isRequired,
    onOpenLayaway: PropTypes.func.isRequired,
    onSaveOpenOrder: PropTypes.func,
    onOpenTables: PropTypes.func.isRequired,
    showRestaurantActions: PropTypes.bool.isRequired,
    canSplitOrder: PropTypes.bool.isRequired,
    activeTablesCount: PropTypes.number.isRequired
};
