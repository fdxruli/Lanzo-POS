// src/components/pos/PosFloatingBar.jsx
import PropTypes from 'prop-types';

/**
 * Barra flotante dual del POS para móvil.
 * Muestra botones de acceso rápido a mesas y carrito.
 * Incluye ventas abiertas rechazadas en cocina en el acceso a Mesas (badge y visibilidad).
 */
export default function PosFloatingBar({
    hasTables,
    activeTablesCount,
    kitchenRejectedOpenCount = 0,
    totalItemsCount,
    total,
    onOpenTables,
    onOpenCart
}) {
    const openTablesShortcutTotal = activeTablesCount + kitchenRejectedOpenCount;
    const showBar = (hasTables && openTablesShortcutTotal > 0) || totalItemsCount > 0;
    if (!showBar) return null;

    const tablesTitle =
        kitchenRejectedOpenCount > 0
            ? `Mesas: hay ${kitchenRejectedOpenCount} comanda(s) rechazada(s) en cocina. Toque para anular o gestionar.`
            : 'Mesas';

    return (
        <div className="floating-pos-bar">
            {hasTables && openTablesShortcutTotal > 0 && (
                <button
                    type="button"
                    className={`floating-btn tables-btn${kitchenRejectedOpenCount > 0 ? ' tables-btn--kitchen-rejected' : ''}`}
                    title={tablesTitle}
                    onClick={onOpenTables}
                >
                    <span className="btn-label">Mesas</span>
                    <span className="tables-badge">{openTablesShortcutTotal}</span>
                </button>
            )}

            {totalItemsCount > 0 && (
                <button
                    type="button"
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
    kitchenRejectedOpenCount: PropTypes.number.isRequired,
    totalItemsCount: PropTypes.number.isRequired,
    total: PropTypes.number.isRequired,
    onOpenTables: PropTypes.func.isRequired,
    onOpenCart: PropTypes.func.isRequired
};
