import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { useParams } from 'react-router-dom';
import PublicStoreHeader from '../components/ecommerce/public/PublicStoreHeader';
import PublicCatalog from '../components/ecommerce/public/PublicCatalog';
import PublicCartDrawer, { PublicMobileCartBar } from '../components/ecommerce/public/PublicCartDrawer';
import PublicStoreState from '../components/ecommerce/public/PublicStoreState';
import usePublicCart from '../hooks/ecommerce/usePublicCart';
import {
  EcommercePublicError,
  getPublicCatalog,
  getPublicPortalBySlug,
} from '../services/ecommerce/ecommercePublicService';
import './PublicStorePage.css';

const DEFAULT_META_DESCRIPTION = 'Consulta el catálogo de esta tienda online.';

const normalizeSearch = (value) => value.trim().toLocaleLowerCase('es-MX');

function PublicStorePage() {
  const { slug = '' } = useParams();
  const activeSlugRef = useRef(slug);
  const [portalResult, setPortalResult] = useState(null);
  const [storeStatus, setStoreStatus] = useState('loading');
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ offset: 0, limit: 100, hasMore: false });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isCartOpen, setIsCartOpen] = useState(false);

  const portal = portalResult?.portal || null;

  const loadCatalog = useCallback(async ({ offset = 0, replace = false } = {}) => {
    const requestSlug = slug;
    if (replace) {
      setCatalogLoading(true);
      setCatalogReady(false);
    } else {
      setCatalogLoadingMore(true);
    }
    setCatalogError(null);

    try {
      const result = await getPublicCatalog(requestSlug, { limit: 100, offset });
      if (activeSlugRef.current !== requestSlug) return;

      setProducts((currentProducts) => {
        const source = replace ? [] : currentProducts;
        const byId = new Map(source.map((product) => [product.id, product]));
        result.items.forEach((product) => byId.set(product.id, product));
        return Array.from(byId.values());
      });
      setPagination(result.pagination);
      setCatalogReady(true);
    } catch (error) {
      if (activeSlugRef.current !== requestSlug) return;
      setCatalogError(error);
    } finally {
      if (activeSlugRef.current === requestSlug) {
        setCatalogLoading(false);
        setCatalogLoadingMore(false);
      }
    }
  }, [slug]);

  const loadStore = useCallback(async () => {
    const requestSlug = slug;
    setStoreStatus('loading');
    setPortalResult(null);
    setProducts([]);
    setCatalogReady(false);
    setCatalogError(null);
    setSearchTerm('');
    setSelectedCategory('all');

    try {
      const result = await getPublicPortalBySlug(requestSlug);
      if (activeSlugRef.current !== requestSlug) return;
      setPortalResult(result);
      setStoreStatus('ready');
      await loadCatalog({ offset: 0, replace: true });
    } catch (error) {
      if (activeSlugRef.current !== requestSlug) return;
      const unavailable = error instanceof EcommercePublicError
        && error.code === 'ECOMMERCE_PORTAL_NOT_FOUND';
      setStoreStatus(unavailable ? 'unavailable' : 'error');
      setCatalogLoading(false);
    }
  }, [loadCatalog, slug]);

  useEffect(() => {
    activeSlugRef.current = slug;
    loadStore();
  }, [loadStore, slug]);

  useEffect(() => {
    if (!portal) return undefined;

    const previousTitle = document.title;
    const descriptionMeta = document.querySelector('meta[name="description"]');
    const previousDescription = descriptionMeta?.getAttribute('content') ?? null;
    const meta = descriptionMeta || document.createElement('meta');
    if (!descriptionMeta) {
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }

    document.title = `${portal.name} | Tienda online`;
    meta.setAttribute(
      'content',
      portal.headline || portal.description || `${portal.name}. ${DEFAULT_META_DESCRIPTION}`
    );

    return () => {
      document.title = previousTitle;
      if (descriptionMeta) {
        if (previousDescription === null) descriptionMeta.removeAttribute('content');
        else descriptionMeta.setAttribute('content', previousDescription);
      } else {
        meta.remove();
      }
    };
  }, [portal]);

  const categories = useMemo(() => Array.from(new Set(
    products.map((product) => product.categoryName).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'es-MX')), [products]);

  const filteredProducts = useMemo(() => {
    const query = normalizeSearch(searchTerm);
    return products.filter((product) => {
      const matchesCategory = selectedCategory === 'all'
        || product.categoryName === selectedCategory;
      if (!matchesCategory) return false;
      if (!query) return true;

      return normalizeSearch(product.name).includes(query)
        || normalizeSearch(product.description || '').includes(query);
    });
  }, [products, searchTerm, selectedCategory]);

  const cart = usePublicCart({
    slug,
    products,
    catalogReady,
    maxItemQuantity: portal?.maxItemQuantity,
    maxOrderItems: portal?.maxOrderItems,
    minOrderTotal: portal?.minOrderTotal,
  });

  useEffect(() => {
    if (!cart.notice) return undefined;
    const timeoutId = window.setTimeout(cart.clearNotice, 2600);
    return () => window.clearTimeout(timeoutId);
  }, [cart.notice, cart.clearNotice]);

  if (storeStatus === 'loading') {
    return (
      <main className="public-store-shell public-store-shell--centered">
        <PublicStoreState
          type="loading"
          title="Cargando tienda..."
          description="Estamos preparando el catálogo."
        />
      </main>
    );
  }

  if (storeStatus === 'unavailable') {
    return (
      <main className="public-store-shell public-store-shell--centered">
        <PublicStoreState
          type="unavailable"
          title="Esta tienda no está disponible"
          description="El enlace puede ser incorrecto o el negocio puede haber pausado temporalmente su portal."
        />
      </main>
    );
  }

  if (storeStatus === 'error' || !portal) {
    return (
      <main className="public-store-shell public-store-shell--centered">
        <PublicStoreState
          type="error"
          title="No se pudo cargar la tienda"
          description="Revisa tu conexión e intenta nuevamente."
          actionLabel="Reintentar"
          onAction={loadStore}
        />
      </main>
    );
  }

  return (
    <main className="public-store-shell">
      <PublicStoreHeader portal={portal} hours={portalResult.hours} />

      <div className="public-store-content">
        <div className="public-store-content__topbar">
          <p>Compra de forma sencilla desde el catálogo del negocio.</p>
          <button
            type="button"
            className="ui-button ui-button--secondary public-store-cart-button"
            onClick={() => setIsCartOpen(true)}
            aria-label={`Ver carrito, ${cart.totalUnits} unidades`}
          >
            <ShoppingCart aria-hidden="true" size={19} />
            Carrito
            <span>{cart.totalUnits}</span>
          </button>
        </div>

        {cart.notice ? (
          <div className="public-store-notice" role="status" aria-live="polite">
            {cart.notice}
          </div>
        ) : null}

        <PublicCatalog
          products={products}
          filteredProducts={filteredProducts}
          categories={categories}
          searchTerm={searchTerm}
          selectedCategory={selectedCategory}
          onSearchChange={setSearchTerm}
          onCategoryChange={setSelectedCategory}
          onAdd={cart.addProduct}
          isLoading={catalogLoading}
          error={catalogError}
          onRetry={() => loadCatalog({ offset: 0, replace: true })}
          hasMore={pagination.hasMore}
          onLoadMore={() => loadCatalog({
            offset: pagination.offset + pagination.limit,
            replace: false,
          })}
          isLoadingMore={catalogLoadingMore}
        />
      </div>

      <PublicMobileCartBar
        totalUnits={cart.totalUnits}
        subtotal={cart.subtotal}
        currency={cart.currency}
        onOpen={() => setIsCartOpen(true)}
      />

      <PublicCartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cart.items}
        totalUnits={cart.totalUnits}
        subtotal={cart.subtotal}
        currency={cart.currency}
        minOrderTotal={portal.minOrderTotal}
        minimumRemaining={cart.minimumRemaining}
        minimumReached={cart.minimumReached}
        maxItemQuantity={portal.maxItemQuantity}
        onIncrement={cart.increment}
        onDecrement={cart.decrement}
        onSetQuantity={cart.setQuantity}
        onRemove={cart.removeProduct}
        onClear={cart.clearCart}
      />
    </main>
  );
}

export default PublicStorePage;
