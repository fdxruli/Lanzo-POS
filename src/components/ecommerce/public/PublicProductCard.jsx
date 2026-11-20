import { Plus } from 'lucide-react';
import PublicSafeImage from './PublicSafeImage';

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency
}).format(Number(value) || 0);

/**
 * Displays a product summary and reports the primary action to its catalog.
 * The catalog owns whether that action adds the product or opens configuration.
 */
export default function PublicProductCard({
  product,
  isConfigurable,
  isAvailable,
  stockLabel,
  onPrimaryAction,
  onOpenProduct
}) {
  const isUnavailableStockLabel = stockLabel === 'Agotado' || stockLabel === 'No disponible';
  const buttonLabel = isConfigurable ? 'Seleccionar opciones' : 'Agregar';

  return (
    <article className="public-product-card ui-card">
      <button
        type="button"
        className="public-product-card__detail-trigger public-product-card__image-trigger"
        onClick={(event) => onOpenProduct(product, event)}
        aria-label={`Ver detalle de ${product.name}`}
      >
        <PublicSafeImage
          src={product.imageUrl}
          alt=""
          fallbackLabel={`${product.name} sin imagen`}
          className="public-product-card__image"
        />
      </button>
      <div className="public-product-card__body">
        <div className="public-product-card__copy">
          {product.categoryName ? <p className="public-product-card__category">{product.categoryName}</p> : null}
          <h3>
            <button
              type="button"
              className="public-product-card__detail-trigger public-product-card__name-trigger"
              onClick={(event) => onOpenProduct(product, event)}
            >
              {product.name}
            </button>
          </h3>
          {product.description ? <p className="public-product-card__description">{product.description}</p> : null}
        </div>
        <div className="public-product-card__footer">
          <div>
            <strong>
              {isConfigurable ? 'Desde ' : ''}
              {formatCurrency(product.price, product.currency)}
            </strong>
            {product.wholesaleEnabled && product.wholesaleTiers?.length > 0 ? (
              <span className="public-product-card__wholesale">
                {product.wholesaleTiers.map((tier) => (
                  <small key={tier.sourceTierRef || tier.minQuantity}>
                    Compra {tier.minQuantity} o más: {formatCurrency(tier.unitPrice, product.currency)} c/u
                  </small>
                ))}
              </span>
            ) : null}
            {stockLabel ? (
              <span className={`public-product-card__stock${isUnavailableStockLabel ? ' is-unavailable' : ''}`}>
                {stockLabel}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="ui-button ui-button--primary public-product-card__add"
            disabled={!isAvailable}
            onClick={(event) => onPrimaryAction(product, event)}
            aria-label={isAvailable ? `${buttonLabel} ${product.name}` : `${product.name} no disponible`}
          >
            <Plus aria-hidden="true" size={18} />
            {isAvailable ? buttonLabel : 'No disponible'}
          </button>
        </div>
      </div>
    </article>
  );
}
