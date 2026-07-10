import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import {
  getPublicProductStockLabel,
  isPublicProductAvailable,
} from '../../../services/ecommerce/ecommercePublicProductRules';
import PublicSafeImage from './PublicSafeImage';
import PublicStoreState from './PublicStoreState';

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
}).format(Number(value) || 0);

function PublicProductCard({ product, onAdd }) {
  const isAvailable = isPublicProductAvailable(product);
  const stockLabel = getPublicProductStockLabel(product);
  const isOutOfStock = stockLabel === 'Agotado';

  return (
    <article className="public-product-card ui-card">
      <PublicSafeImage
        src={product.imageUrl}
        alt={product.name}
        fallbackLabel={`${product.name} sin imagen`}
        className="public-product-card__image"
      />
      <div className="public-product-card__body">
        <div className="public-product-card__copy">
          {product.categoryName ? <p className="public-product-card__category">{product.categoryName}</p> : null}
          <h3>{product.name}</h3>
          {product.description ? <p className="public-product-card__description">{product.description}</p> : null}
        </div>
        <div className="public-product-card__footer">
          <div>
            <strong>{formatCurrency(product.price, product.currency)}</strong>
            {stockLabel ? (
              <span className={`public-product-card__stock${isOutOfStock ? ' is-unavailable' : ''}`}>
                {stockLabel}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="ui-button ui-button--primary public-product-card__add"
            disabled={!isAvailable}
            onClick={() => onAdd(product)}
            aria-label={isAvailable ? `Agregar ${product.name}` : `${product.name} no disponible`}
          >
            <Plus aria-hidden="true" size={18} />
            {isAvailable ? 'Agregar' : 'No disponible'}
          </button>
        </div>
      </div>
    </article>
  );
}

function PublicCatalog({
  products,
  filteredProducts,
  categories,
  searchTerm,
  selectedCategory,
  onSearchChange,
  onCategoryChange,
  onAdd,
  isLoading,
  error,
  onRetry,
  hasMore,
  onLoadMore,
  isLoadingMore,
}) {
  if (isLoading) {
    return (
      <PublicStoreState
        type="loading"
        title="Cargando productos..."
        description="Estamos preparando el catálogo."
        compact
      />
    );
  }

  if (error) {
    return (
      <PublicStoreState
        type="error"
        title="No se pudo cargar el catálogo"
        description="Revisa tu conexión e intenta nuevamente."
        actionLabel="Reintentar"
        onAction={onRetry}
        compact
      />
    );
  }

  if (products.length === 0) {
    return (
      <PublicStoreState
        type="empty"
        title="Este negocio todavía no ha publicado productos"
        description="Vuelve a revisar más tarde."
        compact
      />
    );
  }

  return (
    <section className="public-catalog" aria-labelledby="public-catalog-title">
      <div className="public-catalog__heading">
        <div>
          <p className="public-store-section-kicker">Catálogo</p>
          <h2 id="public-catalog-title">Elige tus productos</h2>
        </div>
        <span>{products.length} producto{products.length === 1 ? '' : 's'}</span>
      </div>

      <div className="public-catalog__tools">
        <label className="public-catalog__search">
          <Search aria-hidden="true" size={19} />
          <span className="sr-only">Buscar productos</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar productos"
          />
        </label>

        <label className="public-catalog__category">
          <SlidersHorizontal aria-hidden="true" size={18} />
          <span className="sr-only">Filtrar por categoría</span>
          <select value={selectedCategory} onChange={(event) => onCategoryChange(event.target.value)}>
            <option value="all">Todos</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
      </div>

      {filteredProducts.length === 0 ? (
        <PublicStoreState
          type="noResults"
          title="No encontramos productos con esa búsqueda"
          description="Prueba con otro nombre o categoría."
          compact
        />
      ) : (
        <div className="public-catalog__grid">
          {filteredProducts.map((product) => (
            <PublicProductCard key={product.id} product={product} onAdd={onAdd} />
          ))}
        </div>
      )}

      {hasMore ? (
        <div className="public-catalog__load-more">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? 'Cargando...' : 'Cargar más'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export default PublicCatalog;
