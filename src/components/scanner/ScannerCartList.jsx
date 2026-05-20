// src/components/scanner/ScannerCartList.jsx
/**
 * Icono de menos (stroke-width: 2, fill: none)
 */
const MinusIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="scanner-action-icon"
    aria-hidden="true"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * Icono de basura/trash (stroke-width: 2, fill: none)
 */
const TrashIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="scanner-action-icon"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

/**
 * Icono de más/plus (stroke-width: 2, fill: none)
 */
const PlusIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="scanner-action-icon"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * Icono de carrito vacío
 */
const EmptyCartIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="empty-cart-icon"
    aria-hidden="true"
  >
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

export function ScannerCartList({
  items,
  total,
  isConfirming,
  onAddQuantity,
  onRemoveQuantity,
}) {
  if (items.length === 0) {
    return (
      <div className="empty-cart-message">
        <EmptyCartIcon />
        <p>Escanea tu primer producto</p>
      </div>
    );
  }

  return (
    <>
      <div className="scanned-items-list">
        {items.map((item, index) => (
          <div
            key={item.uniqueLineId || `${item.id}-${item.batchId ?? index}`}
            className="scanned-item"
          >
            <span className="scanned-item-name">
              {item.name}
            </span>

            <div className="scanned-item-controls">
              <button
                type="button"
                className="scanner-qty-btn scanner-qty-btn--action"
                onClick={() => onRemoveQuantity(item.id, item.batchId)}
                disabled={isConfirming}
                title={item.quantity === 1 ? 'Eliminar producto' : 'Reducir cantidad'}
                aria-label={item.quantity === 1 ? 'Eliminar producto' : 'Reducir cantidad'}
              >
                {item.quantity === 1 ? <TrashIcon /> : <MinusIcon />}
              </button>

              <span className="scanner-qty-value" aria-label={`Cantidad: ${item.quantity}`}>
                {item.quantity}
              </span>

              <button
                type="button"
                className="scanner-qty-btn scanner-qty-btn--action"
                onClick={() => onAddQuantity(item)}
                disabled={isConfirming}
                title="Aumentar cantidad"
                aria-label="Aumentar cantidad"
              >
                <PlusIcon />
              </button>
            </div>

            <span className="scanned-item-price">
              ${(item.price * item.quantity).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div className="scanner-total-container">
        <span className="scanner-total-label">Total:</span>
        <span className="scanner-total-amount">${total.toFixed(2)}</span>
      </div>
    </>
  );
}
