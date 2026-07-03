// src/components/pos/MobilePosCart.jsx
import PropTypes from 'prop-types';
import OrderSummary from './OrderSummary';
import OrderDiscountPanel from './OrderDiscountPanel';

export default function MobilePosCart(props) {
    if (!props.isOpen) return null;

    return (
        <div className="modal mobile-pos-cart-modal" style={{ display: 'flex', zIndex: 'var(--z-modal-base)', alignItems: 'flex-end' }} onClick={props.onClose}>
            <div className="modal-content" style={{ borderRadius: '20px 20px 0 0', width: '100%', height: '85vh', maxWidth: '100%', padding: '0', animation: 'slideUp 0.3s ease-out', overflow: 'hidden' }} onClick={(event) => event.stopPropagation()}>
                <div className="mobile-pos-cart-stack">
                    <OrderSummary
                        onOpenPayment={props.onOpenPayment}
                        onOpenSplit={props.onOpenSplit}
                        isMobileModal={true}
                        onClose={props.onClose}
                        onOpenLayaway={props.onOpenLayaway}
                        showRestaurantActions={props.showRestaurantActions}
                        canSplitOrder={props.canSplitOrder}
                        onSaveOpenOrder={props.onSaveOpenOrder}
                        onOpenTables={props.onOpenTables}
                        activeTablesCount={props.activeTablesCount}
                        kitchenRejectedOpenCount={props.kitchenRejectedOpenCount}
                    />
                    <OrderDiscountPanel compact />
                </div>
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
    activeTablesCount: PropTypes.number.isRequired,
    kitchenRejectedOpenCount: PropTypes.number.isRequired
};
