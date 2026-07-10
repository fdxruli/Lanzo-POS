import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { useParams } from 'react-router-dom';
import PublicStoreHeader from '../components/ecommerce/public/PublicStoreHeader';
import PublicCatalog from '../components/ecommerce/public/PublicCatalog';
import PublicCartDrawer, { PublicMobileCartBar } from '../components/ecommerce/public/PublicCartDrawer';
import PublicCheckoutDialog from '../components/ecommerce/public/PublicCheckoutDialog';
import PublicStoreState from '../components/ecommerce/public/PublicStoreState';
import usePublicCart from '../hooks/ecommerce/usePublicCart';
import {
  EcommercePublicError,
  createPublicOrder,
  getPublicCatalog,
  getPublicPortalBySlug,
} from '../services/ecommerce/ecommercePublicService';
import {
  clearCheckoutAttempt,
  getOrCreateCheckoutAttempt,
} from '../services/ecommerce/ecommerceCheckoutIdempotency';
import '../components/ecommerce/public/PublicCheckout.css';
import './PublicStorePage.css';

const DEFAULT_META_DESCRIPTION = 'Consulta el catálogo de esta tienda online.';
const INITIAL_PAGINATION = { offset: 0, limit: 100, hasMore: false };

const normalizeSearch = (value) => value.trim().toLocaleLowerCase('es-MX');

function PublicStorePage() {
  const { slug = '' } = useParams();
  const mountedRef = useRef(false);
  const activeSlugRef = useRef(slug);
  const requestGenerationRef = useRef(0);
  const requestedOffsetsRef = useRef(new Set());
  const paginationRef = useRef(INITIAL_PAGINATION);
  const activeCheckoutPromiseRef = useRef(null);
  const [portalResult, setPortalResult] = useState(null);
  const [storeStatus, setStoreStatus] = useState('loading');
  const [storeReloadKey, setStoreReloadKey] = useState(0);
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState(INITIAL_PAGINATION);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState('idle');
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [checkoutError, setCheckoutError] = useState(null);

  const portal = portalResult?.portal || null;
  const features = portalResult?.features || {};
  const catalogExhausted = catalogReady && pagination.hasMore === false;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      activeCheckoutPromiseRef.current = null;
    };
  }, []);

  const loadCatalog = useCallback(async ({
    requestSlug,
    offset = 0,
    replace = false,
    generation,
  }) => {
    const normalizedOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const requestedOffsets = requestedOffsetsRef.current;
    if (requestedOffsets.has(normalizedOffset)) return false;
    requestedOffsets.add(normalizedOffset);

    const isCurrentRequest = () => (
      mountedRef.current
      && activeSlugRef.current === requestSlug
      && requestGenerationRef.current === generation
    );

    if (isCurrentRequest()) {
      if (replace) {
        setCatalogLoading(true);
        setCatalogReady(false);
      } else {
        setCatalogLoadingMore(true);
      }
      setCatalogError(null);
    }

    try {
      const result = await getPublicCatalog(requestSlug, {
        limit: 100,
        offset: normalizedOffset,
      });
      if (!isCurrentRequest()) return false;

      setProducts((currentProducts) => {
        const source = replace ? [] : currentProducts;
        const byId = new Map(source.map((product) => [product.id, product]));
        result.items.forEach((product) => byId.set(product.id, product));
        return Array.from(byId.values());
      });

      const previousPagination = paginationRef.current;
      const returnedPagination = result.pagination;
      const offsetDidNotAdvance = !replace
        && returnedPagination.hasMore
        && returnedPagination.offset <= previousPagination.offset;
      const nextPagination = {
        ...returnedPagination,
        hasMore: offsetDidNotAdvance ? false : returnedPagination.hasMore,
      };

      paginationRef.current = nextPagination;
      setPagination(nextPagination);
      setCatalogReady(true);
      return true;
    } catch (error) {
      requestedOffsets.delete(normalizedOffset);
      if (!isCurrentRequest()) return false;
      setCatalogError({ error, offset: normalizedOffset, replace });
      return false;
    } finally {
      if (isCurrentRequest()) {
        setCatalogLoading(false);
        setCatalogLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    activeSlugRef.current = slug;
    requestedOffsetsRef.current = new Set();
    paginationRef.current = INITIAL_PAGINATION;
    activeCheckoutPromiseRef.current = null;

    setStoreStatus('loading');
    setPortalResult(null);
    setProducts([]);
    setPagination(INITIAL_PAGINATION);
    setCatalogLoading(true);
    setCatalogLoadingMore(false);
    setCatalogReady(false);
    setCatalogError(null);
    setSearchTerm('');
    setSelectedCategory('all');
    setIsCartOpen(false);
    setCheckoutOpen(false);
    setCheckoutStatus('idle');
    setConfirmedOrder(null);
    setCheckoutError(null);

    const isCurrentRequest = () => (
      mountedRef.current
      && activeSlugRef.current === slug
      && requestGenerationRef.current === generation
    );

    const loadStore = async () => {
      try {
        const result = await getPublicPortalBySlug(slug);
        if (!isCurrentRequest()) return;
        setPortalResult(result);
        setStoreStatus('ready');
        await loadCatalog({
          requestSlug: slug,
          offset: 0,
          replace: true,
          generation,
        });
      } catch (error) {
        if (!isCurrentRequest()) return;
        const unavailable = error instanceof EcommercePublicError
          && error.code === 'ECOMMERCE_PORTAL_NOT_FOUND';
        setStoreStatus(unavailable ? 'unavailable' : 'error');
        setCatalogLoading(false);
      }
    };

    loadStore();

    return () => {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
      }
    };
  }, [loadCatalog, slug, storeReloadKey]);

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
    catalogExhausted,
    maxItemQuantity: portal?.maxItemQuantity,
    maxOrderItems: portal?.maxOrderItems,
    minOrderTotal: portal?.minOrderTotal,
  });

  const loadNextCatalogPage = useCallback(() => {
    const currentPagination = paginationRef.current;
    if (!currentPagination.hasMore) return false;

    const nextOffset = currentPagination.offset + currentPagination.limit;
    if (!Number.isFinite(nextOffset) || nextOffset <= currentPagination.offset) {
      const exhaustedPagination = { ...currentPagination, hasMore: false };
      paginationRef.current = exhaustedPagination;
      setPagination(exhaustedPagination);
      return false;
    }

    return loadCatalog({
      requestSlug: activeSlugRef.current,
      offset: nextOffset,
      replace: false,
      generation: requestGenerationRef.current,
    });
  }, [loadCatalog]);

  useEffect(() => {
    if (!cart.hasStoredEntries || cart.isReconciled) return;
    if (cart.pendingProductIds.length === 0) return;
    if (!catalogReady || catalogExhausted || catalogLoading || catalogLoadingMore || catalogError) return;

    loadNextCatalogPage();
  }, [
    cart.hasStoredEntries,
    cart.isReconciled,
    cart.pendingProductIds,
    catalogError,
    catalogExhausted,
    catalogLoading,
    catalogLoadingMore,
    catalogReady,
    loadNextCatalogPage,
  ]);

  useEffect(() => {
    if (!cart.notice) return undefined;
    const timeoutId = window.setTimeout(cart.clearNotice, 2600);
    return () => window.clearTimeout(timeoutId);
  }, [cart.notice, cart.clearNotice]);

  const retryCatalog = useCallback(() => {
    const retry = catalogError || { offset: 0, replace: true };
    return loadCatalog({
      requestSlug: activeSlugRef.current,
      offset: retry.offset,
      replace: retry.replace,
      generation: requestGenerationRef.current,
    });
  }, [catalogError, loadCatalog]);

  const openCheckout = useCallback(() => {
    const canCheckout = (
      portal?.orderingEnabled === true
      && features.orderInbox === true
      && cart.isReconciled
      && cart.items.length > 0
      && cart.minimumReached
      && (portal.pickupEnabled === true || portal.deliveryEnabled === true)
      && checkoutStatus !== 'submitting'
    );
    if (!canCheckout) return false;

    setCheckoutError(null);
    setConfirmedOrder(null);
    setCheckoutStatus('editing');
    setCheckoutOpen(true);
    setIsCartOpen(false);
    return true;
  }, [cart.isReconciled, cart.items.length, cart.minimumReached, checkoutStatus, features.orderInbox, portal]);

  const submitCheckout = useCallback((customer) => {
    if (activeCheckoutPromiseRef.current) return activeCheckoutPromiseRef.current;

    const requestSlug = activeSlugRef.current;
    const items = cart.items.map(({ product, quantity }) => ({
      productId: product.id,
      quantity,
    }));

    const requestPromise = (async () => {
      setCheckoutError(null);
      setCheckoutStatus('submitting');

      try {
        const attempt = await getOrCreateCheckoutAttempt(requestSlug, { customer, items });
        const response = await createPublicOrder(requestSlug, {
          customer,
          items,
          idempotencyKey: attempt.idempotencyKey,
        });

        if (!mountedRef.current || activeSlugRef.current !== requestSlug) return response;

        clearCheckoutAttempt(requestSlug, attempt.idempotencyKey);
        cart.clearCart();
        setConfirmedOrder(response);
        setCheckoutStatus('confirmed');
        setCheckoutError(null);
        return response;
      } catch (error) {
        if (mountedRef.current && activeSlugRef.current === requestSlug) {
          const safeError = error instanceof Error
            ? error
            : new EcommercePublicError(
                'ECOMMERCE_ORDER_CREATE_FAILED',
                'No se pudo confirmar el pedido. Revisa tu conexión e intenta nuevamente.'
              );
          setCheckoutError(safeError);
          setCheckoutStatus('recoverable_error');
        }
        throw error;
      }
    })();

    activeCheckoutPromiseRef.current = requestPromise;
    const releaseActiveRequest = () => {
      if (activeCheckoutPromiseRef.current === requestPromise) {
        activeCheckoutPromiseRef.current = null;
      }
    };
    requestPromise.then(releaseActiveRequest, releaseActiveRequest);
    return requestPromise;
  }, [cart]);

  const closeCheckout = useCallback(() => {
    if (checkoutStatus === 'submitting') return;
    setCheckoutOpen(false);
    if (checkoutStatus !== 'confirmed') {
      setCheckoutStatus('idle');
      setCheckoutError(null);
    }
  }, [checkoutStatus]);

  const continueShopping = useCallback(() => {
    setCheckoutOpen(false);
    setCheckoutStatus('idle');
    setConfirmedOrder(null);
    setCheckoutError(null);
  }, []);

  const refreshStaleCart = useCallback(() => {
    if (checkoutStatus === 'submitting') return;
    window.location.reload();
  }, [checkoutStatus]);

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
          onAction={() => setStoreReloadKey((current) => current + 1)}
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
          error={catalogError?.error || null}
          onRetry={retryCatalog}
          hasMore={pagination.hasMore}
          onLoadMore={loadNextCatalogPage}
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
        isReconciled={cart.isReconciled}
        orderingEnabled={portal.orderingEnabled}
        orderInboxEnabled={features.orderInbox}
        pickupEnabled={portal.pickupEnabled}
        deliveryEnabled={portal.deliveryEnabled}
        isCheckoutLoading={checkoutStatus === 'submitting'}
        onIncrement={cart.increment}
        onDecrement={cart.decrement}
        onSetQuantity={cart.setQuantity}
        onRemove={cart.removeProduct}
        onClear={cart.clearCart}
        onCheckout={openCheckout}
      />

      <PublicCheckoutDialog
        isOpen={checkoutOpen}
        status={checkoutStatus}
        error={checkoutError}
        portal={portal}
        features={features}
        cart={cart}
        confirmedOrder={confirmedOrder}
        onClose={closeCheckout}
        onSubmit={submitCheckout}
        onRefreshCart={refreshStaleCart}
        onContinue={continueShopping}
      />
    </main>
  );
}

export default PublicStorePage;
