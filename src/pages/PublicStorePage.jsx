import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ShoppingCart } from 'lucide-react';
import { useParams } from 'react-router-dom';
import LogoMark from '../components/common/LogoMark';
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
  getPublicPortalBySlug
} from '../services/ecommerce/ecommercePublicService';
import {
  clearCheckoutAttempt,
  getOrCreateCheckoutAttempt
} from '../services/ecommerce/ecommerceCheckoutIdempotency';
import {
  getAvailabilityDetail,
  getAvailabilityLabel,
  getAvailabilityRefreshDelay
} from '../utils/ecommerceAvailability';
import '../components/ecommerce/public/PublicCheckout.css';
import './PublicStorePage.css';

const DEFAULT_META_DESCRIPTION = 'Consulta el catálogo de esta tienda online.';
const INITIAL_PAGINATION = { offset: 0, limit: 100, hasMore: false };
const REVISION_REVALIDATION_INTERVAL_MS = 60_000;
const AVAILABILITY_ERROR_CODES = new Set([
  'ECOMMERCE_ORDERS_PAUSED',
  'ECOMMERCE_STORE_CLOSED',
  'ECOMMERCE_SCHEDULE_NOT_CONFIGURED'
]);

const normalizeSearch = (value) => value.trim().toLocaleLowerCase('es-MX');
const isOnlineNow = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const normalizeRevision = (value) => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
};
const resolveAvailability = (result) => {
  if (result?.availability) return result.availability;
  const resultPortal = result?.portal;
  if (!resultPortal) return null;
  return {
    acceptingOrders: resultPortal.orderingEnabled === true,
    code: resultPortal.orderingEnabled === true ? 'OPEN' : 'ORDERING_DISABLED',
    timezone: 'America/Mexico_City',
    scheduleSource: 'disabled',
    legacy: true
  };
};

function PublicStorePage() {
  const { slug = '' } = useParams();
  const mountedRef = useRef(false);
  const activeSlugRef = useRef(slug);
  const requestGenerationRef = useRef(0);
  const requestedOffsetsRef = useRef(new Set());
  const paginationRef = useRef(INITIAL_PAGINATION);
  const activeCatalogRevisionRef = useRef(null);
  const cachePolicyRef = useRef(null);
  const activeCheckoutPromiseRef = useRef(null);
  const checkoutOpeningPromiseRef = useRef(null);
  const availabilityRef = useRef(null);
  const revisionRevalidationPromiseRef = useRef(null);
  const revisionRestartCountRef = useRef(0);
  const [portalResult, setPortalResult] = useState(null);
  const [storeStatus, setStoreStatus] = useState('loading');
  const [storeReloadKey, setStoreReloadKey] = useState(0);
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState(INITIAL_PAGINATION);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogSource, setCatalogSource] = useState('network');
  const [catalogRevision, setCatalogRevision] = useState(null);
  const [catalogValidated, setCatalogValidated] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [offlineCatalog, setOfflineCatalog] = useState(false);
  const [connectionOnline, setConnectionOnline] = useState(isOnlineNow);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState('idle');
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [checkoutError, setCheckoutError] = useState(null);
  const [checkoutOpening, setCheckoutOpening] = useState(false);

  const portal = portalResult?.portal || null;
  const features = portalResult?.features || {};
  const availability = resolveAvailability(portalResult);
  availabilityRef.current = availability;
  const catalogExhausted = catalogReady && pagination.hasMore === false;
  const checkoutCatalogReady = (
    catalogValidated
    && catalogReady
    && !catalogRefreshing
    && !offlineCatalog
    && connectionOnline
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      activeCheckoutPromiseRef.current = null;
      checkoutOpeningPromiseRef.current = null;
      revisionRevalidationPromiseRef.current = null;
    };
  }, []);

  useEffect(() => {
    revisionRestartCountRef.current = 0;
  }, [slug]);

  const loadCatalog = useCallback(async ({
    requestSlug,
    offset = 0,
    replace = false,
    generation,
    expectedRevision = activeCatalogRevisionRef.current,
    offline = false
  }) => {
    const normalizedOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const requestedOffsets = requestedOffsetsRef.current;
    if (requestedOffsets.has(normalizedOffset)) return false;
    requestedOffsets.add(normalizedOffset);

    const isCurrentRequest = () => (
      mountedRef.current
      && activeSlugRef.current === requestSlug
      && requestGenerationRef.current === generation
      && activeCatalogRevisionRef.current === expectedRevision
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
      const catalogOptions = { limit: 100, offset: normalizedOffset };
      if (expectedRevision !== null) {
        catalogOptions.catalogRevision = expectedRevision;
        catalogOptions.cachePolicy = cachePolicyRef.current;
        catalogOptions.offline = offline;
      }
      const result = await getPublicCatalog(requestSlug, catalogOptions);
      if (!isCurrentRequest()) return false;
      const resultRevision = normalizeRevision(result.catalogRevision) || expectedRevision;
      if (expectedRevision !== null && resultRevision !== expectedRevision) {
        throw new EcommercePublicError(
          'ECOMMERCE_CATALOG_REVISION_CHANGED',
          'El catálogo cambió mientras se cargaba. Se actualizará automáticamente.'
        );
      }

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
        hasMore: offsetDidNotAdvance ? false : returnedPagination.hasMore
      };

      paginationRef.current = nextPagination;
      setPagination(nextPagination);
      setCatalogSource(result.source === 'cache' ? 'cache' : 'network');
      setOfflineCatalog(result.offline === true);
      setCatalogValidated(result.offline !== true && isOnlineNow());
      setCatalogReady(true);
      setCatalogRefreshing(false);
      revisionRestartCountRef.current = 0;
      return true;
    } catch (error) {
      requestedOffsets.delete(normalizedOffset);
      if (!isCurrentRequest()) return false;

      if (
        error instanceof EcommercePublicError
        && error.code === 'ECOMMERCE_CATALOG_REVISION_CHANGED'
        && revisionRestartCountRef.current < 1
      ) {
        revisionRestartCountRef.current += 1;
        setCatalogRefreshing(true);
        setCatalogValidated(false);
        window.setTimeout(() => {
          if (mountedRef.current && activeSlugRef.current === requestSlug) {
            setStoreReloadKey((current) => current + 1);
          }
        }, 0);
        return false;
      }

      setCatalogValidated(false);
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
    activeCatalogRevisionRef.current = null;
    cachePolicyRef.current = null;
    activeCheckoutPromiseRef.current = null;
    checkoutOpeningPromiseRef.current = null;
    revisionRevalidationPromiseRef.current = null;

    setStoreStatus('loading');
    setPortalResult(null);
    setProducts([]);
    setPagination(INITIAL_PAGINATION);
    setCatalogLoading(true);
    setCatalogLoadingMore(false);
    setCatalogReady(false);
    setCatalogError(null);
    setCatalogSource('network');
    setCatalogRevision(null);
    setCatalogValidated(false);
    setCatalogRefreshing(false);
    setOfflineCatalog(false);
    setConnectionOnline(isOnlineNow());
    setSearchTerm('');
    setSelectedCategory('all');
    setIsCartOpen(false);
    setCheckoutOpen(false);
    setCheckoutStatus('idle');
    setConfirmedOrder(null);
    setCheckoutError(null);
    setCheckoutOpening(false);

    const isCurrentRequest = () => (
      mountedRef.current
      && activeSlugRef.current === slug
      && requestGenerationRef.current === generation
    );

    const loadStore = async () => {
      try {
        const result = await getPublicPortalBySlug(slug);
        if (!isCurrentRequest()) return;
        const revision = normalizeRevision(result.catalogRevision);
        activeCatalogRevisionRef.current = revision;
        cachePolicyRef.current = result.cachePolicy || null;
        setCatalogRevision(revision);
        setPortalResult(result);
        availabilityRef.current = resolveAvailability(result);
        setCatalogSource(result.source === 'cache' ? 'cache' : 'network');
        setOfflineCatalog(result.offline === true);
        setStoreStatus('ready');

        const loaded = await loadCatalog({
          requestSlug: slug,
          offset: 0,
          replace: true,
          generation,
          expectedRevision: revision,
          offline: result.offline === true
        });
        if (!loaded && result.offline === true && isCurrentRequest()) {
          setStoreStatus('error');
        }
      } catch (error) {
        if (!isCurrentRequest()) return;
        const unavailable = error instanceof EcommercePublicError
          && error.code === 'ECOMMERCE_PORTAL_NOT_FOUND';
        setStoreStatus(unavailable ? 'unavailable' : 'error');
        setCatalogLoading(false);
        setCatalogValidated(false);
      }
    };

    void loadStore();

    return () => {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
      }
    };
  }, [loadCatalog, slug, storeReloadKey]);

  const revalidateCatalogRevision = useCallback((reason = 'visible') => {
    if (!portal || !isOnlineNow()) {
      setConnectionOnline(false);
      setOfflineCatalog(true);
      setCatalogValidated(false);
      return Promise.resolve(false);
    }
    if (revisionRevalidationPromiseRef.current) {
      return revisionRevalidationPromiseRef.current;
    }

    const requestSlug = activeSlugRef.current;
    const requestGeneration = requestGenerationRef.current;
    const requestRevision = activeCatalogRevisionRef.current;
    const isCurrentRequest = () => (
      mountedRef.current
      && activeSlugRef.current === requestSlug
      && requestGenerationRef.current === requestGeneration
    );

    const request = (async () => {
      try {
        const result = await getPublicPortalBySlug(requestSlug, { cache: false, reason });
        if (!isCurrentRequest()) return false;
        setConnectionOnline(true);
        setPortalResult(result);
        availabilityRef.current = resolveAvailability(result);
        cachePolicyRef.current = result.cachePolicy || null;

        const nextRevision = normalizeRevision(result.catalogRevision);
        if (nextRevision === requestRevision) {
          setOfflineCatalog(false);
          setCatalogValidated(catalogReady);
          return true;
        }

        const nextGeneration = requestGenerationRef.current + 1;
        requestGenerationRef.current = nextGeneration;
        activeCatalogRevisionRef.current = nextRevision;
        requestedOffsetsRef.current = new Set();
        paginationRef.current = INITIAL_PAGINATION;
        setCatalogRevision(nextRevision);
        setPagination(INITIAL_PAGINATION);
        setCatalogRefreshing(true);
        setCatalogValidated(false);
        setOfflineCatalog(false);
        setCatalogError(null);
        setCatalogReady(false);

        return loadCatalog({
          requestSlug,
          offset: 0,
          replace: true,
          generation: nextGeneration,
          expectedRevision: nextRevision,
          offline: false
        });
      } catch {
        if (!isCurrentRequest()) return false;
        setConnectionOnline(isOnlineNow());
        setOfflineCatalog(true);
        setCatalogValidated(false);
        return false;
      }
    })();

    revisionRevalidationPromiseRef.current = request;
    const release = () => {
      if (revisionRevalidationPromiseRef.current === request) {
        revisionRevalidationPromiseRef.current = null;
      }
    };
    request.then(release, release);
    return request;
  }, [catalogReady, loadCatalog, portal]);

  useEffect(() => {
    if (!portal) return undefined;

    const handleOnline = () => {
      setConnectionOnline(true);
      void revalidateCatalogRevision('online');
    };
    const handleOffline = () => {
      setConnectionOnline(false);
      setOfflineCatalog(true);
      setCatalogValidated(false);
    };
    const handleFocus = () => {
      void revalidateCatalogRevision('focus');
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void revalidateCatalogRevision('visibility');
      }
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void revalidateCatalogRevision('visible-interval');
      }
    }, REVISION_REVALIDATION_INTERVAL_MS);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [portal, revalidateCatalogRevision]);

  useEffect(() => {
    if (!portal || !availability?.nextChangeAt) return undefined;
    const timeoutId = window.setTimeout(() => {
      void revalidateCatalogRevision('availability-next-change');
    }, getAvailabilityRefreshDelay(availability));
    return () => window.clearTimeout(timeoutId);
  }, [availability, portal, revalidateCatalogRevision]);

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
    catalogRevision,
    maxItemQuantity: portal?.maxItemQuantity,
    maxOrderItems: portal?.maxOrderItems,
    minOrderTotal: portal?.minOrderTotal
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
      expectedRevision: activeCatalogRevisionRef.current,
      offline: offlineCatalog
    });
  }, [loadCatalog, offlineCatalog]);

  useEffect(() => {
    if (!cart.hasStoredEntries || cart.isReconciled) return;
    if (cart.pendingProductIds.length === 0) return;
    if (!catalogReady || catalogExhausted || catalogLoading || catalogLoadingMore || catalogError) return;

    void loadNextCatalogPage();
  }, [
    cart.hasStoredEntries,
    cart.isReconciled,
    cart.pendingProductIds,
    catalogError,
    catalogExhausted,
    catalogLoading,
    catalogLoadingMore,
    catalogReady,
    loadNextCatalogPage
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
      expectedRevision: activeCatalogRevisionRef.current,
      offline: offlineCatalog
    });
  }, [catalogError, loadCatalog, offlineCatalog]);

  const openCheckout = useCallback(() => {
    if (checkoutOpeningPromiseRef.current) return checkoutOpeningPromiseRef.current;
    const canStart = (
      portal?.orderingEnabled === true
      && features.orderInbox === true
      && checkoutCatalogReady
      && availability?.acceptingOrders === true
      && cart.isReconciled
      && cart.items.length > 0
      && cart.minimumReached
      && (portal.pickupEnabled === true || portal.deliveryEnabled === true)
      && checkoutStatus !== 'submitting'
    );
    if (!canStart) return Promise.resolve(false);

    const request = (async () => {
      setCheckoutOpening(true);
      const revalidated = await revalidateCatalogRevision('checkout-open');
      if (!revalidated || availabilityRef.current?.acceptingOrders !== true) return false;
      setCheckoutError(null);
      setConfirmedOrder(null);
      setCheckoutStatus('editing');
      setCheckoutOpen(true);
      setIsCartOpen(false);
      return true;
    })();
    checkoutOpeningPromiseRef.current = request;
    const release = () => {
      if (checkoutOpeningPromiseRef.current === request) checkoutOpeningPromiseRef.current = null;
      if (mountedRef.current) setCheckoutOpening(false);
    };
    request.then(release, release);
    return request;
  }, [
    availability,
    cart.isReconciled,
    cart.items.length,
    cart.minimumReached,
    checkoutCatalogReady,
    checkoutStatus,
    features.orderInbox,
    portal,
    revalidateCatalogRevision
  ]);

  const submitCheckout = useCallback((customer) => {
    if (!checkoutCatalogReady || !cart.isReconciled) {
      return Promise.reject(new EcommercePublicError(
        'ECOMMERCE_CATALOG_NOT_VALIDATED',
        'Actualiza el catálogo antes de confirmar el pedido.'
      ));
    }
    if (activeCheckoutPromiseRef.current) return activeCheckoutPromiseRef.current;

    const requestSlug = activeSlugRef.current;
    const requestRevision = activeCatalogRevisionRef.current;
    const items = cart.items.map(({ product, quantity }) => ({
      productId: product.id,
      quantity
    }));

    const requestPromise = (async () => {
      setCheckoutError(null);
      setCheckoutStatus('submitting');

      try {
        const attempt = await getOrCreateCheckoutAttempt(requestSlug, { customer, items });
        if (
          activeSlugRef.current !== requestSlug
          || activeCatalogRevisionRef.current !== requestRevision
          || !catalogValidated
        ) {
          throw new EcommercePublicError(
            'ECOMMERCE_CATALOG_REVISION_CHANGED',
            'El catálogo cambió. Revisa tu carrito antes de confirmar.'
          );
        }
        const response = await createPublicOrder(requestSlug, {
          customer,
          items,
          idempotencyKey: attempt.idempotencyKey
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
          if (AVAILABILITY_ERROR_CODES.has(safeError.code)) {
            void revalidateCatalogRevision('checkout-availability-rejected');
          }
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
  }, [cart, catalogValidated, checkoutCatalogReady, revalidateCatalogRevision]);

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
    void revalidateCatalogRevision('checkout-refresh');
  }, [checkoutStatus, revalidateCatalogRevision]);

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
    <main
      className="public-store-shell"
      data-catalog-source={catalogSource}
      data-catalog-revision={catalogRevision || undefined}
    >
      <PublicStoreHeader
        portal={portal}
        hours={portalResult.hours}
        availability={availability}
      />

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

        {catalogRefreshing ? (
          <div className="public-store-notice" role="status" aria-live="polite">
            Actualizando catálogo… El checkout se habilitará al confirmar precios y disponibilidad.
          </div>
        ) : null}

        {offlineCatalog ? (
          <div className="public-store-notice" role="status" aria-live="polite">
            Sin conexión. Puedes consultar el catálogo guardado, pero no confirmar pedidos hasta volver a conectarte.
          </div>
        ) : null}

        {availability?.acceptingOrders !== true ? (
          <div className="public-store-availability-notice" role="status" aria-live="polite">
            <strong>{getAvailabilityLabel(availability)}</strong>
            <span>{getAvailabilityDetail(availability)}</span>
            <small>El catálogo y tu carrito siguen disponibles.</small>
          </div>
        ) : null}

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

      <footer className="public-store-footer">
        <div className="public-store-footer__inner">
          <div className="public-store-footer__mark" aria-hidden="true">
            <LogoMark />
          </div>
          <div className="public-store-footer__copy">
            <p className="public-store-section-kicker">Haz crecer tu negocio</p>
            <h2>¿Quieres tu propia tienda en línea?</h2>
            <p>
              Con Lanzo publica tu catálogo, recibe pedidos y organiza tus ventas desde un solo lugar.
              Convierte cada visita en una oportunidad para vender más.
            </p>
          </div>
          <a
            className="ui-button ui-button--secondary public-store-footer__cta"
            href={`/conoce-lanzo?tienda=${encodeURIComponent(slug)}`}
          >
            Conoce Lanzo
            <ArrowUpRight aria-hidden="true" size={18} />
          </a>
        </div>
      </footer>

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
        isReconciled={cart.isReconciled && checkoutCatalogReady}
        orderingEnabled={portal.orderingEnabled && checkoutCatalogReady && availability?.acceptingOrders === true}
        availability={{
          label: getAvailabilityLabel(availability),
          detail: getAvailabilityDetail(availability)
        }}
        orderInboxEnabled={features.orderInbox}
        pickupEnabled={portal.pickupEnabled}
        deliveryEnabled={portal.deliveryEnabled}
        isCheckoutLoading={checkoutStatus === 'submitting' || checkoutOpening}
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
        acceptingOrders={availability?.acceptingOrders === true}
      />
    </main>
  );
}

export default PublicStorePage;
