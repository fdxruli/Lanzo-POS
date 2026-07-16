import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useParams } from 'react-router-dom';
import {
  getPublicProductStockLabel,
  isPublicProductAvailable
} from '../../../services/ecommerce/ecommercePublicProductRules';
import PublicSafeImage from './PublicSafeImage';
import PublicStoreState from './PublicStoreState';

const PublicProductConfigurationModal = lazy(() => import('./PublicProductConfigurationModal'));

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency
}).format(Number(value) || 0);

const normalizeCatalogRevision = (value) => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
};

const requiresPublicConfiguration = (product) => (
  product?.configuration?.requiresConfiguration === true
  || product?.configuration?.hasVariants === true
  || product?.configuration?.hasOptionGroups === true
);

function PublicProductCard({ product, onAdd, onConfigure }) {
  const isAvailable = isPublicProductAvailable(product);
  const stockLabel = getPublicProductStockLabel(product);
  const isUnavailableStockLabel = stockLabel === 'Agotado' || stockLabel === 'No disponible';
  const configurable = requiresPublicConfiguration(product);
  const buttonLabel = configurable ? 'Seleccionar opciones' : 'Agregar';

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
            <strong>
              {configurable ? 'Desde ' : ''}
              {formatCurrency(product.price, product.currency)}
            </strong>
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
            onClick={() => (configurable ? onConfigure(product) : onAdd(product))}
            aria-label={isAvailable ? `${buttonLabel}: ${product.name}` : `${product.name} no disponible`}
          >
            <Plus aria-hidden="true" size={18} />
            {isAvailable ? buttonLabel : 'No disponible'}
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
  catalogRevision,
  offline = false,
  maxItemQuantity = 99
}) {
  const { slug = '' } = useParams();
  const resolvedCatalogRevision = normalizeCatalogRevision(catalogRevision);
  const resolvedOffline = offline === true;
  const resolvedMaxItemQuantity = Math.max(1, Math.floor(Number(maxItemQuantity) || 99));
  const [configurationProduct, setConfigurationProduct] = useState(null);
  const [initialLine, setInitialLine] = useState(null);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  useEffect(() => {
    const handleEdit = (event) => {
      const line = event.detail;
      const product = productMap.get(line?.productId);
      if (!line?.lineKey || !product || !requiresPublicConfiguration(product)) return;
      setInitialLine(line);
      setConfigurationProduct(product);
    };
    window.addEventListener('lanzo:ecommerce:edit-configured-line', handleEdit);
    return () => window.removeEventListener('lanzo:ecommerce:edit-configured-line', handleEdit);
  }, [productMap]);

  const openConfiguration = (product) => {
    setInitialLine(null);
    setConfigurationProduct(product);
  };

  const closeConfiguration = () => {
    setConfigurationProduct(null);
    setInitialLine(null);
  };

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
    <>
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
              <PublicProductCard
                key={product.id}
                product={product}
                onAdd={onAdd}
                onConfigure={openConfiguration}
              />
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

      {configurationProduct ? (
        <Suspense fallback={null}>
          <PublicProductConfigurationModal
            isOpen
            slug={slug}
            product={configurationProduct}
            catalogRevision={resolvedCatalogRevision}
            offline={resolvedOffline}
            initialLine={initialLine}
            maxItemQuantity={resolvedMaxItemQuantity}
            onClose={closeConfiguration}
            onAdd={onAdd}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export default PublicCatalog;
