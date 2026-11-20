import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useParams } from 'react-router-dom';
import LogoMark from '../components/common/LogoMark';
import EcommerceSiteRenderer from '../components/ecommerce/site/EcommerceSiteRenderer';
import PublicCartDrawer, { PublicMobileCartBar } from '../components/ecommerce/public/PublicCartDrawer';
import PublicCheckoutDialog from '../components/ecommerce/public/PublicCheckoutDialog';
import PublicStoreStatusScreen from '../components/ecommerce/public/PublicStoreStatusScreen';
import usePublicCart from '../hooks/ecommerce/usePublicCart';
import usePublicStoreCatalog from '../hooks/ecommerce/usePublicStoreCatalog';
import {
  EcommercePublicError,
  createPublicOrder
} from '../services/ecommerce/ecommercePublicService';
import {
  clearCheckoutAttempt,
  getOrCreateCheckoutAttempt,
  getStoredCheckoutAttempt,
  isAmbiguousCheckoutError,
  markCheckoutAttemptAmbiguous
} from '../services/ecommerce/ecommerceCheckoutIdempotency';
import {
  getAvailabilityDetail,
  getAvailabilityLabel,
  getAvailabilityRefreshDelay
} from '../utils/ecommerceAvailability';
import {
  buildAcceptedEcommerceOrderItems,
  haveSameAcceptedEcommerceEconomics
} from '../utils/ecommercePriceAcceptance';
import {
  normalizeEcommercePortalTemplate
} from '../utils/ecommercePortalTheme';
import {
  normalizeEcommerceSiteDocument
} from '../utils/ecommerceSiteDocument';
import { preparePublicStoreDocument } from '../router/preparePublicStoreDocument';
import { resetPublicDocumentScroll } from '../utils/publicDocumentScroll';
import '../components/ecommerce/public/PublicCheckout.css';
import './PublicStorePage.css';

const DEFAULT_META_DESCRIPTION = 'Consulta el catálogo de esta tienda online.';
const REVISION_REVALIDATION_INTERVAL_MS = 60_000;
const FULL_RECOVERY_HIDDEN_THRESHOLD_MS = 30_000;
const RESUME_EVENT_COALESCE_MS = 75;
const AVAILABILITY_ERROR_CODES = new Set([
  'ECOMMERCE_ORDERS_PAUSED',
  'ECOMMERCE_STORE_CLOSED',
  'ECOMMERCE_SCHEDULE_NOT_CONFIGURED',
  'ECOMMERCE_CONFIGURATION_CHANGED',
  'ECOMMERCE_CATALOG_REVISION_CHANGED',
  'ECOMMERCE_PRICE_CONFIRMATION_CHANGED',
  'ECOMMERCE_PRODUCT_UNAVAILABLE',
  'ECOMMERCE_PRODUCT_NOT_AVAILABLE',
  'ECOMMERCE_STOCK_LIMIT_EXCEEDED',
  'ECOMMERCE_INSUFFICIENT_STOCK',
  'STOCK_INSUFFICIENT'
]);

const normalizeSearch = (value) => value.trim().toLocaleLowerCase('es-MX');

function PublicStorePage() {
  const { slug = '' } = useParams();
  const mountedRef = useRef(false);
  const activeCheckoutPromiseRef = useRef(null);
  const checkoutOpeningPromiseRef = useRef(null);
  const checkoutStatusRef = useRef('idle');
  const hiddenAtRef = useRef(null);
  const resumeTimerRef = useRef(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState('idle');
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [checkoutError, setCheckoutError] = useState(null);
  const [checkoutOpening, setCheckoutOpening] = useState(false);
  const [checkoutAcceptedItems, setCheckoutAcceptedItems] = useState(null);
  const [checkoutObservedItems, setCheckoutObservedItems] = useState(null);
  const [checkoutRequestUncertain, setCheckoutRequestUncertain] = useState(false);

  const closeTransientOverlays = useCallback(async () => {
    const protectedCheckout = (
      checkoutStatusRef.current === 'submitting'
      || checkoutStatusRef.current === 'confirmed'
    );
    window.dispatchEvent(new Event('lanzo:public-store-close-transient-overlays'));
    setIsCartOpen(false);
    if (!protectedCheckout) setCheckoutOpen(false);
    await Promise.resolve();
    if (!protectedCheckout) resetPublicDocumentScroll();
  }, []);
  const handlePortalUnavailable = useCallback(() => {
    setIsCartOpen(false);
    setCheckoutOpen(false);
    setCheckoutOpening(false);
  }, []);
  const catalog = usePublicStoreCatalog({
    slug,
    closeTransientOverlays,
    onPortalUnavailable: handlePortalUnavailable
  });
  const {
    portalResult,
    portal,
    availability,
    storeStatus,
    pausedContactUrl,
    storeReloadKey,
    reloadStore,
    products,
    pagination,
    catalogLoading,
    catalogLoadingMore,
    catalogReady,
    catalogError,
    catalogRefreshError,
    catalogSource,
    catalogRevision,
    catalogValidated,
    catalogRefreshing,
    offlineCatalog,
    connectionOnline,
    loadNextCatalogPage,
    retryCatalog,
    revalidateCatalogRevision,
    recoverPublicStore,
    markOffline,
    getCurrentCatalogContext,
    isCurrentCatalogContext,
    getCurrentAvailability
  } = catalog;
  const publicSiteDocument = useMemo(() => normalizeEcommerceSiteDocument(portalResult?.site?.document, {
    templateCode: portal?.templateCode, theme: portal?.theme, logoUrl: portal?.logoUrl, coverImageUrl: portal?.coverImageUrl
  }), [portal?.coverImageUrl, portal?.logoUrl, portal?.templateCode, portal?.theme, portalResult?.site?.document]);
  const portalTemplate = useMemo(() => normalizeEcommercePortalTemplate(publicSiteDocument.global.appearance.templateCode), [publicSiteDocument]);
  const features = portalResult?.features || {};
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
      activeCheckoutPromiseRef.current = null;
      checkoutOpeningPromiseRef.current = null;
      window.clearTimeout(resumeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    checkoutStatusRef.current = checkoutStatus;
  }, [checkoutStatus]);

  useEffect(() => {
    activeCheckoutPromiseRef.current = null;
    checkoutOpeningPromiseRef.current = null;
    setSearchTerm('');
    setSelectedCategory('all');
    setIsCartOpen(false);
    setCheckoutOpen(false);
    setCheckoutStatus('idle');
    setConfirmedOrder(null);
    setCheckoutError(null);
    setCheckoutOpening(false);
    setCheckoutAcceptedItems(null);
    setCheckoutObservedItems(null);
    setCheckoutRequestUncertain(false);
  }, [slug, storeReloadKey]);

  useEffect(() => {
    if (!portal) return undefined;

    const handleOnline = () => {
      void recoverPublicStore('online');
    };
    const handleFocus = () => {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => {
        void revalidateCatalogRevision('focus');
      }, RESUME_EVENT_COALESCE_MS);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenFor = hiddenAtRef.current === null ? 0 : Date.now() - hiddenAtRef.current;
      hiddenAtRef.current = null;
      window.clearTimeout(resumeTimerRef.current);
      if (hiddenFor >= FULL_RECOVERY_HIDDEN_THRESHOLD_MS) {
        void recoverPublicStore('visibility-long', { closeOverlays: true });
      } else {
        resumeTimerRef.current = window.setTimeout(() => {
          void revalidateCatalogRevision('visibility-short');
        }, RESUME_EVENT_COALESCE_MS);
      }
    };
    const handlePageShow = (event) => {
      preparePublicStoreDocument();
      if (event.persisted) {
        window.clearTimeout(resumeTimerRef.current);
        void recoverPublicStore('pageshow-bfcache', { closeOverlays: true });
      }
    };
    const handleControlledRecovery = () => {
      void recoverPublicStore('manual-controlled', { closeOverlays: true });
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void revalidateCatalogRevision('visible-interval');
      }
    }, REVISION_REVALIDATION_INTERVAL_MS);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', markOffline);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('lanzo:public-store-recover', handleControlledRecovery);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', markOffline);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('lanzo:public-store-recover', handleControlledRecovery);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearTimeout(resumeTimerRef.current);
    };
  }, [markOffline, portal, recoverPublicStore, revalidateCatalogRevision]);

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
    portalId: portalResult?.portalId,
    products,
    catalogReady,
    catalogExhausted,
    catalogRevision,
    maxItemQuantity: portal?.maxItemQuantity,
    maxOrderItems: portal?.maxOrderItems,
    minOrderTotal: portal?.minOrderTotal
  });

  useEffect(() => {
    if (!cart.hasStoredEntries || cart.isReconciled) return;
    if (cart.pendingProductIds.length === 0) return;
    if (
      !catalogReady
      || catalogExhausted
      || catalogLoading
      || catalogLoadingMore
      || catalogError
    ) return;

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

  const openCheckout = useCallback(() => {
    if (checkoutOpeningPromiseRef.current) return checkoutOpeningPromiseRef.current;
    const canStart = (
      portal?.orderingEnabled === true
      && features.orderInbox === true
      && checkoutCatalogReady
      && availability?.acceptingOrders === true
      && cart.isReconciled
      && !cart.hasStaleConfigurations
      && cart.items.length > 0
      && cart.minimumReached
      && (portal.pickupEnabled === true || portal.deliveryEnabled === true)
      && checkoutStatus !== 'submitting'
    );
    if (!canStart) return Promise.resolve(false);

    const request = (async () => {
      setCheckoutOpening(true);
      const revalidated = await revalidateCatalogRevision('checkout-open');
      if (!revalidated || getCurrentAvailability()?.acceptingOrders !== true) return false;
      const { slug: activeSlug } = getCurrentCatalogContext();
      const existingAttempt = getStoredCheckoutAttempt(activeSlug);
      const restoredItems = Array.isArray(existingAttempt?.acceptedItems)
        ? existingAttempt.acceptedItems
        : null;
      setCheckoutError(null);
      setConfirmedOrder(null);
      if (existingAttempt) {
        setCheckoutAcceptedItems(restoredItems);
        setCheckoutObservedItems(restoredItems);
      }
      setCheckoutRequestUncertain(Boolean(existingAttempt));
      setCheckoutStatus('editing');
      setCheckoutOpen(true);
      setIsCartOpen(false);
      return true;
    })();
    checkoutOpeningPromiseRef.current = request;
    const release = () => {
      if (checkoutOpeningPromiseRef.current === request) {
        checkoutOpeningPromiseRef.current = null;
      }
      if (mountedRef.current) setCheckoutOpening(false);
    };
    request.then(release, release);
    return request;
  }, [
    availability,
    cart.hasStaleConfigurations,
    cart.isReconciled,
    cart.items.length,
    cart.minimumReached,
    checkoutCatalogReady,
    checkoutStatus,
    features.orderInbox,
    getCurrentAvailability,
    getCurrentCatalogContext,
    portal,
    revalidateCatalogRevision
  ]);

  const submitCheckout = useCallback((customer) => {
    if (
      !checkoutCatalogReady
      || (!checkoutRequestUncertain && (!cart.isReconciled || cart.hasStaleConfigurations))
    ) {
      return Promise.reject(new EcommercePublicError(
        'ECOMMERCE_CATALOG_NOT_VALIDATED',
        'Actualiza las opciones del carrito antes de confirmar el pedido.'
      ));
    }
    if (activeCheckoutPromiseRef.current) return activeCheckoutPromiseRef.current;

    const acceptedItems = checkoutAcceptedItems;
    const acceptedStillCurrent = Array.isArray(acceptedItems)
      && haveSameAcceptedEcommerceEconomics(acceptedItems, cart.items);
    if (!Array.isArray(acceptedItems) || (!acceptedStillCurrent && !checkoutRequestUncertain)) {
      return Promise.reject(new EcommercePublicError(
        'ECOMMERCE_PRICE_CONFIRMATION_CHANGED',
        'Revisa y acepta el total actualizado antes de confirmar el pedido.'
      ));
    }

    const requestContext = getCurrentCatalogContext();
    const requestSlug = requestContext.slug;
    const items = acceptedItems;

    const requestPromise = (async () => {
      setCheckoutError(null);
      setCheckoutStatus('submitting');

      try {
        const attempt = await getOrCreateCheckoutAttempt(requestSlug, { customer, items });
        setCheckoutRequestUncertain(true);
        if (
          !isCurrentCatalogContext(requestContext)
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

        if (!mountedRef.current || !isCurrentCatalogContext(requestContext)) return response;

        clearCheckoutAttempt(requestSlug, attempt.idempotencyKey);
        setCheckoutRequestUncertain(false);
        cart.clearCart();
        setConfirmedOrder(response);
        setCheckoutStatus('confirmed');
        setCheckoutError(null);
        return response;
      } catch (error) {
        if (mountedRef.current && isCurrentCatalogContext(requestContext)) {
          const safeError = error instanceof Error
            ? error
            : new EcommercePublicError(
                'ECOMMERCE_ORDER_CREATE_FAILED',
                'No pudimos confirmar el pedido. Inténtalo nuevamente más tarde.'
              );
          if (safeError.code === 'ECOMMERCE_CONFIGURATION_CHANGED') {
            clearCheckoutAttempt(requestSlug);
            cart.markConfiguredLinesStale();
          }
          if (isAmbiguousCheckoutError(safeError)) {
            const storedAttempt = getStoredCheckoutAttempt(requestSlug);
            if (safeError.code !== 'ECOMMERCE_CHECKOUT_RESULT_UNCERTAIN') {
              markCheckoutAttemptAmbiguous(requestSlug, storedAttempt?.idempotencyKey);
            }
            setCheckoutRequestUncertain(true);
          } else {
            clearCheckoutAttempt(requestSlug);
            setCheckoutRequestUncertain(false);
          }
          setCheckoutError(safeError);
          setCheckoutStatus('recoverable_error');
          if (AVAILABILITY_ERROR_CODES.has(safeError.code)) {
            void revalidateCatalogRevision(
              safeError.code === 'ECOMMERCE_PRICE_CONFIRMATION_CHANGED'
                ? 'checkout-price-rejected'
                : 'checkout-configuration-rejected',
              { forceCatalog: safeError.code === 'ECOMMERCE_PRICE_CONFIRMATION_CHANGED' }
            );
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
  }, [
    cart,
    catalogValidated,
    checkoutAcceptedItems,
    checkoutCatalogReady,
    checkoutRequestUncertain,
    getCurrentCatalogContext,
    isCurrentCatalogContext,
    revalidateCatalogRevision
  ]);

  useEffect(() => {
    if (
      !checkoutOpen
      || !checkoutCatalogReady
      || !cart.isReconciled
      || cart.hasStaleConfigurations
    ) return;
    const currentItems = buildAcceptedEcommerceOrderItems(cart.items);
    setCheckoutObservedItems((existing) => existing || currentItems);
  }, [cart.hasStaleConfigurations, cart.isReconciled, cart.items, checkoutCatalogReady, checkoutOpen]);

  const acceptCurrentCheckoutTotal = useCallback(() => {
    if (checkoutRequestUncertain || !cart.isReconciled || cart.hasStaleConfigurations) return;
    const acceptedItems = buildAcceptedEcommerceOrderItems(cart.items);
    if (!Array.isArray(acceptedItems)) return;
    setCheckoutAcceptedItems(acceptedItems);
    setCheckoutObservedItems(acceptedItems);
    setCheckoutError(null);
    setCheckoutStatus('editing');
  }, [cart.hasStaleConfigurations, cart.isReconciled, cart.items, checkoutRequestUncertain]);

  const clearCheckoutPriceAcceptance = useCallback(() => {
    if (checkoutRequestUncertain) return;
    setCheckoutAcceptedItems(null);
  }, [checkoutRequestUncertain]);

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
    setCheckoutAcceptedItems(null);
    setCheckoutObservedItems(null);
    setCheckoutRequestUncertain(false);
  }, []);

  const reviewCheckoutCart = useCallback(() => {
    if (checkoutStatus === 'submitting') return;
    setCheckoutOpen(false);
    setCheckoutStatus('idle');
    setCheckoutError(null);
    setIsCartOpen(true);
  }, [checkoutStatus]);

  const refreshStaleCart = useCallback(() => {
    if (checkoutStatus === 'submitting') return;
    void revalidateCatalogRevision('checkout-refresh', {
      forceCatalog: checkoutError?.code === 'ECOMMERCE_PRICE_CONFIRMATION_CHANGED'
        || checkoutError?.code === 'ECOMMERCE_CATALOG_REVISION_CHANGED'
    });
  }, [checkoutError?.code, checkoutStatus, revalidateCatalogRevision]);

  if (storeStatus === 'loading') {
    return (
      <PublicStoreStatusScreen
        type="loading"
        title="Cargando tienda..."
        description="Estamos preparando el catálogo."
      />
    );
  }

  if (storeStatus === 'invalid_link') {
    return (
      <PublicStoreStatusScreen
        type="invalid"
        title="Enlace de tienda no válido"
        description="No pudimos identificar la tienda. Revisa que el enlace esté completo y vuelve a intentarlo."
      />
    );
  }

  if (storeStatus === 'not_found') {
    return (
      <PublicStoreStatusScreen
        type="notFound"
        title="No encontramos esta tienda"
        description="Verifica que la dirección sea correcta o solicita nuevamente el enlace al negocio."
      />
    );
  }

  if (storeStatus === 'paused') {
    return (
      <PublicStoreStatusScreen
        type="paused"
        title="Esta tienda está pausada temporalmente"
        description="El negocio ha pausado temporalmente su portal en línea."
        actionLabel={pausedContactUrl ? 'Contactar por WhatsApp' : undefined}
        actionHref={pausedContactUrl || undefined}
        actionVariant="link"
      />
    );
  }

  if (storeStatus === 'error' || !portal) {
    return (
      <PublicStoreStatusScreen
        type="error"
        title="No se pudo cargar la tienda"
        description="Revisa tu conexión e intenta nuevamente."
        actionLabel="Reintentar"
        onAction={reloadStore}
      />
    );
  }

  return (
    <main
      className={`public-store-shell ecommerce-site-surface${cart.totalUnits > 0 ? ' public-store-shell--has-cart' : ''}`}
      data-catalog-source={catalogSource}
      data-catalog-revision={catalogRevision || undefined}
      data-site-version={portalResult?.site?.versionNumber || undefined}
      data-template-code={portalTemplate}
    >
      <EcommerceSiteRenderer
        siteDocument={publicSiteDocument}
        siteDocumentMode={portalResult?.site?.documentMode}
        portal={portal}
        products={products}
        categories={categories}
        hours={portalResult.hours}
        availability={availability}
        features={features}
        slug={slug}
        catalogProps={{
          products, filteredProducts, categories, searchTerm, selectedCategory,
          onSearchChange: setSearchTerm, onCategoryChange: setSelectedCategory,
          onAdd: cart.addProduct, isLoading: catalogLoading, error: catalogError?.error || null,
          onRetry: retryCatalog, hasMore: pagination.hasMore, onLoadMore: loadNextCatalogPage,
          isLoadingMore: catalogLoadingMore, catalogRevision, offline: offlineCatalog,
          maxItemQuantity: portal.maxItemQuantity
        }}
        catalogChrome={<>
        {catalogRefreshing ? (
          <div className="public-store-notice" role="status" aria-live="polite">
            Actualizando catálogo… El checkout se habilitará al confirmar precios y disponibilidad.
          </div>
        ) : null}

        {catalogRefreshError ? (
          <div className="public-store-notice" role="alert">
            No pudimos actualizar la tienda. Mostramos la última información disponible.
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

        </>}
      >

      {portalResult?.legacyFooter === true ? (
        <div className="public-store-footer__inner">
          <div className="public-store-footer__mark" aria-hidden="true">
            <LogoMark />
          </div>
          <div className="public-store-footer__copy">
            <p className="public-store-footer__brand">Tienda creada con Lanzo</p>
          </div>
          <a
            className="public-store-footer__cta"
            href={`/conoce-lanzo?tienda=${encodeURIComponent(slug)}`}
          >
            Conoce Lanzo
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
        </div>
      ) : null}

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
        hasStaleConfigurations={cart.hasStaleConfigurations}
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
        acceptedItems={checkoutAcceptedItems}
        observedItems={checkoutObservedItems}
        requestUncertain={checkoutRequestUncertain}
        confirmedOrder={confirmedOrder}
        onClose={closeCheckout}
        onSubmit={submitCheckout}
        onAcceptCurrentTotal={acceptCurrentCheckoutTotal}
        onClearPriceAcceptance={clearCheckoutPriceAcceptance}
        onReviewCart={reviewCheckoutCart}
        onRefreshCart={refreshStaleCart}
        onContinue={continueShopping}
        acceptingOrders={availability?.acceptingOrders === true}
      />
      </EcommerceSiteRenderer>
    </main>
  );
}

export default PublicStorePage;
