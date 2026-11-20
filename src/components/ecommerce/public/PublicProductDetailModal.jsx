import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { getPublicProductMaxQuantity, getPublicProductStockLabel, isPublicProductAvailable } from '../../../services/ecommerce/ecommercePublicProductRules';
import { lockPublicDocumentScroll, unlockPublicDocumentScroll } from '../../../utils/publicDocumentScroll';
import PublicSafeImage from './PublicSafeImage';
import './PublicProductDetailModal.css';

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value) || 0);

const normalizeMaximum = (value, fallback = 99) => {
  const maximum = Math.floor(Number(value));
  return Number.isFinite(maximum) && maximum > 0 ? maximum : fallback;
};

function PublicProductDetailModal({
  product,
  maxItemQuantity = 99,
  maxOrderItems = 30,
  cartItems = [],
  onAdd,
  onClose,
  returnFocusElement = null
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const portalMaximum = normalizeMaximum(maxItemQuantity);
  const maximumForProduct = getPublicProductMaxQuantity(product, portalMaximum);
  const existingQuantity = cartItems.reduce((total, line) => (
    line?.product?.id === product?.id && !line.product.configurationLine
      ? total + Math.max(0, Math.floor(Number(line.quantity) || 0))
      : total
  ), 0);
  const availableQuantity = Math.max(0, maximumForProduct - existingQuantity);
  const hasExistingLine = existingQuantity > 0;
  const normalizedMaxOrderItems = normalizeMaximum(maxOrderItems, 30);
  const canAddLine = hasExistingLine || cartItems.length < normalizedMaxOrderItems;
  const isAvailable = isPublicProductAvailable(product);
  const stockLabel = getPublicProductStockLabel(product);
  const productHasWholesale = product.wholesaleEnabled === true
    && Array.isArray(product.wholesaleTiers)
    && product.wholesaleTiers.length > 0;

  useEffect(() => {
    setQuantity(1);
  }, [product.id]);

  useEffect(() => {
    const nextMaximum = Math.max(1, availableQuantity);
    setQuantity((current) => Math.min(current, nextMaximum));
  }, [availableQuantity]);

  useEffect(() => {
    lockPublicDocumentScroll('public-product-detail');
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unlockPublicDocumentScroll('public-product-detail');
      window.removeEventListener('keydown', handleKeyDown);
      if (returnFocusElement?.isConnected) returnFocusElement.focus();
    };
  }, [returnFocusElement]);

  const submit = () => {
    if (!isAvailable || availableQuantity < 1 || !canAddLine) return;
    const safeQuantity = Math.min(Math.max(1, quantity), availableQuantity);
    if (onAdd(product, { quantity: safeQuantity }) !== false) onCloseRef.current();
  };

  const updateQuantity = (value) => {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return;
    setQuantity(Math.min(Math.max(1, parsed), Math.max(1, availableQuantity)));
  };

  const limitMessage = !canAddLine
    ? `Tu carrito ya tiene el máximo de ${normalizedMaxOrderItems} ${normalizedMaxOrderItems === 1 ? 'producto distinto' : 'productos distintos'}.`
    : availableQuantity < 1 && isAvailable
      ? 'Ya tienes en el carrito la cantidad máxima disponible de este producto.'
      : '';

  return (
    <div className="public-product-detail-modal">
      <button
        type="button"
        className="public-product-detail-modal__backdrop"
        aria-label="Cerrar detalle"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="public-product-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-product-detail-title"
      >
        <header className="public-product-detail__header">
          <div>
            <p className="public-store-section-kicker">Detalle del producto</p>
            <h2 id="public-product-detail-title">{product.name}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="public-icon-button"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </header>

        <div className="public-product-detail__body">
          <PublicSafeImage
            src={product.imageUrl}
            alt={product.name}
            fallbackLabel={`${product.name} sin imagen`}
            className="public-product-detail__image"
            eager
          />

          <div className="public-product-detail__content">
            {product.categoryName ? <p className="public-product-detail__category">{product.categoryName}</p> : null}
            {product.description ? <p className="public-product-detail__description">{product.description}</p> : null}

            <div className="public-product-detail__price-block">
              <strong>{formatCurrency(product.price, product.currency)}</strong>
              {stockLabel ? (
                <span className={`public-product-detail__availability${isAvailable ? '' : ' is-unavailable'}`}>
                  {stockLabel}
                </span>
              ) : null}
            </div>

            {productHasWholesale ? (
              <div className="public-product-detail__wholesale" aria-label="Precios por mayoreo">
                <h3>Precios por mayoreo</h3>
                {product.wholesaleTiers.map((tier) => (
                  <p key={tier.sourceTierRef || tier.minQuantity}>
                    <span>{tier.minQuantity} o más</span>
                    <strong>{formatCurrency(tier.unitPrice, product.currency)} c/u</strong>
                  </p>
                ))}
              </div>
            ) : null}

            {!isAvailable ? (
              <p className="public-product-detail__unavailable" role="status">
                Puedes consultar el producto, pero no está disponible para compra.
              </p>
            ) : null}
          </div>
        </div>

        <footer className="public-product-detail__footer">
          <div className="public-product-detail__quantity">
            <label htmlFor="public-product-detail-quantity">Cantidad</label>
            <div className="public-quantity-control">
              <button
                type="button"
                onClick={() => updateQuantity(quantity - 1)}
                disabled={!isAvailable || quantity <= 1}
                aria-label={`Disminuir cantidad de ${product.name}`}
              >
                <Minus aria-hidden="true" size={18} />
              </button>
              <input
                id="public-product-detail-quantity"
                type="number"
                min="1"
                max={Math.max(1, availableQuantity)}
                value={quantity}
                onChange={(event) => updateQuantity(event.target.value)}
                disabled={!isAvailable || availableQuantity < 1}
                aria-label={`Cantidad de ${product.name}`}
              />
              <button
                type="button"
                onClick={() => updateQuantity(quantity + 1)}
                disabled={!isAvailable || quantity >= availableQuantity}
                aria-label={`Aumentar cantidad de ${product.name}`}
              >
                <Plus aria-hidden="true" size={18} />
              </button>
            </div>
          </div>
          <button
            type="button"
            className="ui-button ui-button--primary public-product-detail__add"
            disabled={!isAvailable || availableQuantity < 1 || !canAddLine}
            onClick={submit}
          >
            {isAvailable ? 'Agregar al carrito' : 'No disponible'}
          </button>
          {limitMessage ? <p className="public-product-detail__limit" role="status">{limitMessage}</p> : null}
        </footer>
      </section>
    </div>
  );
}

export default PublicProductDetailModal;
