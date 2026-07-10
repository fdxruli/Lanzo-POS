import { useEffect, useRef } from 'react';
import { Minus, Plus, ShoppingCart, Trash2, X } from 'lucide-react';

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

export function PublicMobileCartBar({ totalUnits, subtotal, currency, onOpen }) {
  if (totalUnits <= 0) return null;

  return (
    <button
      type="button"
      className="public-cart-bar"
      onClick={onOpen}
      aria-label={`Ver carrito, ${totalUnits} unidades, subtotal ${formatCurrency(subtotal, currency)}`}
    >
      <span className="public-cart-bar__count"><ShoppingCart aria-hidden="true" size={19} />{totalUnits}</span>
      <span>Ver carrito</span>
      <strong>{formatCurrency(subtotal, currency)}</strong>
    </button>
  );
}

function PublicCartDrawer({
  isOpen,
  onClose,
  items,
  totalUnits,
  subtotal,
  currency,
  minOrderTotal,
  minimumRemaining,
  minimumReached,
  isReconciled,
  orderingEnabled,
  orderInboxEnabled,
  pickupEnabled,
  deliveryEnabled,
  isCheckoutLoading,
  onIncrement,
  onDecrement,
  onSetQuantity,
  onRemove,
  onClear,
  onCheckout,
}) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const minimum = Math.max(0, Number(minOrderTotal) || 0);
  const progress = minimum > 0
    ? Math.min(100, Math.max(0, (Number(subtotal) / minimum) * 100))
    : 100;
  const hasFulfillmentMethod = pickupEnabled === true || deliveryEnabled === true;
  const checkoutDisabled = (
    items.length === 0
    || !isReconciled
    || isCheckoutLoading
    || !minimumReached
    || orderingEnabled !== true
    || orderInboxEnabled !== true
    || !hasFulfillmentMethod
  );

  let checkoutNotice = 'Tus productos y el total se confirmarán nuevamente al enviar.';
  if (!isReconciled || isCheckoutLoading) {
    checkoutNotice = 'Actualizando carrito...';
  } else if (orderingEnabled !== true || orderInboxEnabled !== true) {
    checkoutNotice = 'Este negocio no está recibiendo pedidos por ahora.';
  } else if (!hasFulfillmentMethod) {
    checkoutNotice = 'Este negocio no tiene una modalidad de entrega disponible.';
  } else if (!minimumReached) {
    checkoutNotice = `Faltan ${formatCurrency(minimumRemaining, currency)} para realizar el pedido`;
  }

  return (
    <div className="public-cart-modal">
      <button
        type="button"
        className="public-cart-modal__backdrop"
        onClick={onClose}
        aria-label="Cerrar carrito"
      />
      <aside
        className="public-cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-cart-title"
      >
        <div className="public-cart-drawer__header">
          <div>
            <p className="public-store-section-kicker">Tu selección</p>
            <h2 id="public-cart-title">Carrito ({totalUnits})</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="public-icon-button"
            onClick={onClose}
            aria-label="Cerrar carrito"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </div>

        <div className="public-cart-drawer__body">
          {items.length === 0 ? (
            <div className="public-cart-empty" role="status">
              <ShoppingCart aria-hidden="true" size={36} />
              <h3>Tu carrito está vacío</h3>
              <p>Agrega productos del catálogo para ver el subtotal.</p>
            </div>
          ) : (
            <ul className="public-cart-items" aria-label="Productos en el carrito">
              {items.map(({ product, quantity, maxQuantity, lineTotal }) => (
                <li key={product.id} className="public-cart-item">
                  <div className="public-cart-item__top">
                    <div>
                      <h3>{product.name}</h3>
                      <p>{formatCurrency(product.price, product.currency)} cada uno</p>
                    </div>
                    <button
                      type="button"
                      className="public-icon-button public-icon-button--danger"
                      onClick={() => onRemove(product.id)}
                      aria-label={`Eliminar ${product.name}`}
                    >
                      <Trash2 aria-hidden="true" size={18} />
                    </button>
                  </div>

                  <div className="public-cart-item__bottom">
                    <div className="public-quantity-control" aria-label={`Cantidad de ${product.name}`}>
                      <button
                        type="button"
                        onClick={() => onDecrement(product.id)}
                        aria-label={`Disminuir cantidad de ${product.name}`}
                      >
                        <Minus aria-hidden="true" size={16} />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={maxQuantity}
                        step="1"
                        value={quantity}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue !== '') onSetQuantity(product.id, nextValue);
                        }}
                        aria-label={`Cantidad de ${product.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => onIncrement(product.id)}
                        disabled={quantity >= maxQuantity}
                        aria-label={`Aumentar cantidad de ${product.name}`}
                      >
                        <Plus aria-hidden="true" size={16} />
                      </button>
                    </div>
                    <strong>{formatCurrency(lineTotal, product.currency)}</strong>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="public-cart-drawer__footer">
          {items.length > 0 ? (
            <button type="button" className="public-cart-clear" onClick={onClear}>
              Vaciar carrito
            </button>
          ) : null}

          <div className="public-cart-summary">
            <span>Subtotal</span>
            <strong>{formatCurrency(subtotal, currency)}</strong>
          </div>

          {minimum > 0 ? (
            <div className="public-cart-minimum" aria-live="polite">
              <div className="public-cart-minimum__track" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
              <p>
                {minimumReached
                  ? 'Alcanzaste el pedido mínimo.'
                  : `Te faltan ${formatCurrency(minimumRemaining, currency)} para el pedido mínimo.`}
              </p>
            </div>
          ) : null}

          <button
            type="button"
            className="ui-button ui-button--primary public-cart-checkout"
            disabled={checkoutDisabled}
            onClick={onCheckout}
          >
            Continuar pedido
          </button>
          <p className="public-cart-coming-soon" aria-live="polite">{checkoutNotice}</p>
        </div>
      </aside>
    </div>
  );
}

export default PublicCartDrawer;
