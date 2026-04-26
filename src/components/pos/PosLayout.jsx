// src/components/pos/PosLayout.jsx
import PropTypes from 'prop-types';

/**
 * Layout principal del POS.
 * Contiene la estructura base con ProductMenu y OrderSummary.
 */
export default function PosLayout({
    children,
    productMenuProps,
    orderSummaryProps
}) {
    return (
        <div className="pos-page-layout">
            <div className="pos-grid">
                {productMenuProps && (
                    <ProductMenu {...productMenuProps} />
                )}
                {orderSummaryProps && (
                    <OrderSummary {...orderSummaryProps} />
                )}
            </div>
            {children}
        </div>
    );
}

// Importamos los componentes aquí para evitar que el padre los importe
import ProductMenu from './ProductMenu';
import OrderSummary from './OrderSummary';

PosLayout.propTypes = {
    children: PropTypes.node,
    productMenuProps: PropTypes.object,
    orderSummaryProps: PropTypes.object
};
