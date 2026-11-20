import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Search } from 'lucide-react';
import {
  getPublicProductStockLabel,
  isPublicProductAvailable
} from '../../../services/ecommerce/ecommercePublicProductRules';
import PublicProductCard from './PublicProductCard';
import PublicStoreState from './PublicStoreState';

const PublicProductConfigurationModal = lazy(() => import('./PublicProductConfigurationModal'));

const normalizeCatalogRevision = (value) => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
};

const requiresPublicConfiguration = (product) => (
  product?.configuration?.requiresConfiguration === true
  || product?.configuration?.hasVariants === true
  || product?.configuration?.hasOptionGroups === true
);

function PublicCatalog({
  slug = '',
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
  maxItemQuantity = 99,
  showSearch = true,
  showCategories = true,
  initialViewMode = 'grid'
}) {
  const resolvedCatalogRevision = normalizeCatalogRevision(catalogRevision);
  const resolvedOffline = offline === true;
  const resolvedMaxItemQuantity = Math.max(1, Math.floor(Number(maxItemQuantity) || 99));
  const [configurationProduct, setConfigurationProduct] = useState(null);
  const [initialLine, setInitialLine] = useState(null);
  const [viewMode, setViewMode] = useState(initialViewMode === 'list' ? 'list' : 'grid');

  useEffect(() => {
    setViewMode(initialViewMode === 'list' ? 'list' : 'grid');
  }, [initialViewMode]);

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

  useEffect(() => {
    const closeTransientOverlays = () => {
      setConfigurationProduct(null);
      setInitialLine(null);
    };
    window.addEventListener(
      'lanzo:public-store-close-transient-overlays',
      closeTransientOverlays
    );
    return () => window.removeEventListener(
      'lanzo:public-store-close-transient-overlays',
      closeTransientOverlays
    );
  }, []);

  const openConfiguration = (product) => {
    setInitialLine(null);
    setConfigurationProduct(product);
  };

  const handleProductAction = (product) => {
    if (requiresPublicConfiguration(product)) {
      openConfiguration(product);
      return;
    }
    onAdd(product);
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
      <section
        className={`public-catalog public-catalog--view-${viewMode}`}
        aria-labelledby="public-catalog-title"
        data-catalog-view={viewMode}
      >
        {(showSearch || showCategories) ? (
          <div className="public-catalog__tools">
          {showSearch ? (
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
          ) : null}

          {showCategories ? (
          <>
          <label className="public-catalog__category public-catalog__category-select">
            <span className="sr-only">Filtrar por categoría</span>
            <select value={selectedCategory} onChange={(event) => onCategoryChange(event.target.value)}>
              <option value="all">Todos</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <div className="public-catalog__category-chips" aria-label="Categorías">
            <button
              type="button"
              className={selectedCategory === 'all' ? 'is-selected' : ''}
              aria-pressed={selectedCategory === 'all'}
              onClick={() => onCategoryChange('all')}
            >
              Todos
            </button>
            {categories.map((category) => (
              <button
                type="button"
                key={category}
                className={selectedCategory === category ? 'is-selected' : ''}
                aria-pressed={selectedCategory === category}
                onClick={() => onCategoryChange(category)}
              >
                {category}
              </button>
            ))}
          </div>
          </>
          ) : null}
        </div>
        ) : null}

        <div className="public-catalog__heading">
          <div>
            <p className="public-store-section-kicker">Catálogo</p>
            <h2 id="public-catalog-title">Elige tus productos</h2>
            <span>{products.length} producto{products.length === 1 ? '' : 's'}</span>
          </div>
          <div className="public-catalog__view-toggle" aria-label="Vista de productos">
            <button
              type="button"
              aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid aria-hidden="true" size={17} />
              Cuadrícula
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            >
              <List aria-hidden="true" size={18} />
              Lista
            </button>
          </div>
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
                isConfigurable={requiresPublicConfiguration(product)}
                isAvailable={isPublicProductAvailable(product)}
                stockLabel={getPublicProductStockLabel(product)}
                onPrimaryAction={handleProductAction}
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
