// src/components/pos/PosFloatingBar.jsx
import PropTypes from 'prop-types';

/**
 * Barra flotante dual del POS para móvil.
 * Muestra botones de acceso rápido a mesas y carrito.
 */
export default function PosFloatingBar({
    hasTables,
    activeTablesCount,
    totalItemsCount,
    total,
    onOpenTables,
    onOpenCart
}) {
    const showBar = (hasTables && activeTablesCount > 0) || totalItemsCount > 0;
    if (!showBar) return null;

    return (
        <div className="floating-pos-bar">
            {/* Botón de Mesas (solo si hay mesas activas) */}
            {hasTables && activeTablesCount > 0 && (
                <button
                    className="floating-btn tables-btn"
                    onClick={onOpenTables}
                >
                    <span className="btn-label">Mesas</span>
                    <span className="tables-badge">{activeTablesCount}</span>
                </button>
            )}

            {/* Botón de Carrito (solo si hay productos) */}
            {totalItemsCount > 0 && (
                <button
                    className="floating-btn cart-btn active"
                    onClick={onOpenCart}
                >
                    <div className="cart-summary-content">
                        <span className="cart-count">{totalItemsCount}</span>
                        <span className="cart-total">${total.toFixed(2)}</span>
                    </div>
                </button>
            )}
        </div>
    );
}

PosFloatingBar.propTypes = {
    hasTables: PropTypes.bool.isRequired,
    activeTablesCount: PropTypes.number.isRequired,
    totalItemsCount: PropTypes.number.isRequired,
    total: PropTypes.number.isRequired,
    onOpenTables: PropTypes.func.isRequired,
    onOpenCart: PropTypes.func.isRequired
};
