import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPausedWhatsappUrl } from '../../utils/pausedWhatsappContact';
import {
  EcommercePublicError,
  getPublicCatalog,
  getPublicPortalBySlug
} from '../../services/ecommerce/ecommercePublicService';
import { preparePublicStoreDocument } from '../../router/preparePublicStoreDocument';
import { isValidStoreSlug } from '../../../store/api/_storeSlug';

const INITIAL_PAGINATION = { offset: 0, limit: 100, hasMore: false };

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

function usePublicStoreCatalog({
  slug,
  closeTransientOverlays,
  onPortalUnavailable
}) {
  const mountedRef = useRef(false);
  const activeSlugRef = useRef(slug);
  const activePortalIdRef = useRef(null);
  const requestGenerationRef = useRef(0);
  const requestedOffsetsRef = useRef(new Set());
  const paginationRef = useRef(INITIAL_PAGINATION);
  const activeCatalogRevisionRef = useRef(null);
  const cachePolicyRef = useRef(null);
  const availabilityRef = useRef(null);
  const catalogReadyRef = useRef(false);
  const productsRef = useRef([]);
  const revisionRevalidationPromiseRef = useRef(null);
  const recoveryPromiseRef = useRef(null);
  const revisionRestartCountRef = useRef(0);

  const [portalResult, setPortalResult] = useState(null);
  const [storeStatus, setStoreStatus] = useState('loading');
  const [pausedContactUrl, setPausedContactUrl] = useState('');
  const [storeReloadKey, setStoreReloadKey] = useState(0);
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState(INITIAL_PAGINATION);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogRefreshError, setCatalogRefreshError] = useState(null);
  const [catalogSource, setCatalogSource] = useState('network');
  const [catalogRevision, setCatalogRevision] = useState(null);
  const [catalogValidated, setCatalogValidated] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [offlineCatalog, setOfflineCatalog] = useState(false);
  const [connectionOnline, setConnectionOnline] = useState(isOnlineNow);

  const portal = portalResult?.portal || null;
  const availability = useMemo(() => resolveAvailability(portalResult), [portalResult]);

  const applyAuthoritativePortalStatus = useCallback((error) => {
    const code = error instanceof EcommercePublicError ? error.code : '';
    if (code !== 'ECOMMERCE_PORTAL_PAUSED' && code !== 'ECOMMERCE_PORTAL_NOT_FOUND') {
      return false;
    }

    const paused = code === 'ECOMMERCE_PORTAL_PAUSED';
    requestGenerationRef.current += 1;
    activePortalIdRef.current = null;
    activeCatalogRevisionRef.current = null;
    cachePolicyRef.current = null;
    requestedOffsetsRef.current = new Set();
    paginationRef.current = INITIAL_PAGINATION;
    availabilityRef.current = null;
    catalogReadyRef.current = false;
    productsRef.current = [];

    setStoreStatus(paused ? 'paused' : 'not_found');
    setPausedContactUrl(paused
      ? buildPausedWhatsappUrl(error.pausedContact?.whatsappPhone) : '');
    setPortalResult(null);
    setProducts([]);
    setPagination(INITIAL_PAGINATION);
    setCatalogLoading(false);
    setCatalogLoadingMore(false);
    setCatalogReady(false);
    setCatalogError(null);
    setCatalogRefreshError(null);
    setCatalogSource('network');
    setCatalogRevision(null);
    setCatalogValidated(false);
    setCatalogRefreshing(false);
    setOfflineCatalog(false);
    onPortalUnavailable?.();
    return true;
  }, [onPortalUnavailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      revisionRevalidationPromiseRef.current = null;
      recoveryPromiseRef.current = null;
    };
  }, []);

  useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);

  useEffect(() => {
    catalogReadyRef.current = catalogReady;
    productsRef.current = products;
  }, [catalogReady, products]);

  useEffect(() => {
    revisionRestartCountRef.current = 0;
  }, [slug]);

  const loadCatalog = useCallback(async ({
    requestSlug,
    offset = 0,
    replace = false,
    generation,
    expectedRevision = activeCatalogRevisionRef.current,
    portalId = activePortalIdRef.current,
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
      setCatalogRefreshError(null);
    }

    try {
      const catalogOptions = { limit: 100, offset: normalizedOffset };
      if (portalId) catalogOptions.portalId = portalId;
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
      setCatalogRefreshError(null);
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
    activePortalIdRef.current = null;
    requestedOffsetsRef.current = new Set();
    paginationRef.current = INITIAL_PAGINATION;
    activeCatalogRevisionRef.current = null;
    cachePolicyRef.current = null;
    revisionRevalidationPromiseRef.current = null;
    recoveryPromiseRef.current = null;

    setStoreStatus('loading');
    setPausedContactUrl('');
    setPortalResult(null);
    setProducts([]);
    setPagination(INITIAL_PAGINATION);
    setCatalogLoading(true);
    setCatalogLoadingMore(false);
    setCatalogReady(false);
    setCatalogError(null);
    setCatalogRefreshError(null);
    setCatalogSource('network');
    setCatalogRevision(null);
    setCatalogValidated(false);
    setCatalogRefreshing(false);
    setOfflineCatalog(false);
    setConnectionOnline(isOnlineNow());

    const isCurrentRequest = () => (
      mountedRef.current
      && activeSlugRef.current === slug
      && requestGenerationRef.current === generation
    );

    if (!isValidStoreSlug(slug)) {
      setStoreStatus('invalid_link');
      setCatalogLoading(false);
      return undefined;
    }

    const loadStore = async () => {
      try {
        const result = await getPublicPortalBySlug(slug, { portalId: activePortalIdRef.current });
        if (!isCurrentRequest()) return;
        const revision = normalizeRevision(result.catalogRevision);
        activePortalIdRef.current = result.portalId || null;
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
        if (applyAuthoritativePortalStatus(error)) return;
        setPausedContactUrl('');
        setStoreStatus('error');
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
  }, [applyAuthoritativePortalStatus, loadCatalog, slug, storeReloadKey]);

  const revalidateCatalogRevision = useCallback((reason = 'visible', { forceCatalog = false } = {}) => {
    if (reason === 'online') setConnectionOnline(true);
    if (recoveryPromiseRef.current) return recoveryPromiseRef.current;
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
        if (nextRevision === requestRevision && !forceCatalog) {
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
      } catch (error) {
        if (!isCurrentRequest()) return false;
        if (applyAuthoritativePortalStatus(error)) return false;
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
  }, [applyAuthoritativePortalStatus, catalogReady, loadCatalog, portal]);

  const recoverPublicStore = useCallback((reason = 'resume', { closeOverlays = false } = {}) => {
    if (recoveryPromiseRef.current) return recoveryPromiseRef.current;
    if (!portal || !isOnlineNow()) {
      if (closeOverlays) void closeTransientOverlays?.();
      preparePublicStoreDocument();
      setConnectionOnline(false);
      setOfflineCatalog(true);
      setCatalogValidated(false);
      return Promise.resolve(false);
    }

    const requestSlug = activeSlugRef.current;
    const recoveryGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = recoveryGeneration;
    requestedOffsetsRef.current = new Set();
    const isCurrentRequest = () => (
      mountedRef.current
      && activeSlugRef.current === requestSlug
      && requestGenerationRef.current === recoveryGeneration
    );

    setCatalogRefreshing(true);
    setCatalogError(null);
    setCatalogRefreshError(null);
    setCatalogValidated(false);

    const request = (async () => {
      try {
        if (closeOverlays) await closeTransientOverlays?.();
        preparePublicStoreDocument();
        const nextPortal = await getPublicPortalBySlug(requestSlug, {
          reason,
          portalId: activePortalIdRef.current
        });
        if (!isCurrentRequest()) return false;
        const nextRevision = normalizeRevision(nextPortal.catalogRevision);
        const nextCachePolicy = nextPortal.cachePolicy || null;
        const nextCatalog = await getPublicCatalog(requestSlug, {
          limit: 100,
          offset: 0,
          catalogRevision: nextRevision,
          portalId: nextPortal.portalId,
          cachePolicy: nextCachePolicy,
          cacheStrategy: 'network-first'
        });
        if (!isCurrentRequest()) return false;

        const nextPagination = nextCatalog.pagination;
        activeCatalogRevisionRef.current = nextRevision;
        cachePolicyRef.current = nextCachePolicy;
        paginationRef.current = nextPagination;
        availabilityRef.current = resolveAvailability(nextPortal);
        setPortalResult(nextPortal);
        setCatalogRevision(nextRevision);
        setProducts(nextCatalog.items);
        setPagination(nextPagination);
        setCatalogSource(nextCatalog.source === 'cache' ? 'cache' : 'network');
        setOfflineCatalog(nextCatalog.offline === true);
        setConnectionOnline(isOnlineNow());
        setCatalogReady(true);
        setCatalogValidated(nextCatalog.offline !== true && isOnlineNow());
        setCatalogRefreshError(null);
        return true;
      } catch (error) {
        if (!isCurrentRequest()) return false;
        if (applyAuthoritativePortalStatus(error)) return false;
        setConnectionOnline(isOnlineNow());
        setOfflineCatalog(!isOnlineNow());
        if (catalogReadyRef.current && productsRef.current.length > 0) {
          setCatalogRefreshError(error);
        } else {
          setCatalogError({ error, offset: 0, replace: true });
        }
        return false;
      } finally {
        if (isCurrentRequest()) setCatalogRefreshing(false);
      }
    })();

    recoveryPromiseRef.current = request;
    const release = () => {
      if (recoveryPromiseRef.current === request) recoveryPromiseRef.current = null;
    };
    request.then(release, release);
    return request;
  }, [applyAuthoritativePortalStatus, closeTransientOverlays, portal]);

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

  const markOffline = useCallback(() => {
    setConnectionOnline(false);
    setOfflineCatalog(true);
    setCatalogValidated(false);
  }, []);

  const getCurrentCatalogContext = useCallback(() => ({
    slug: activeSlugRef.current,
    catalogRevision: activeCatalogRevisionRef.current
  }), []);

  const isCurrentCatalogContext = useCallback((context) => (
    mountedRef.current
    && activeSlugRef.current === context?.slug
    && activeCatalogRevisionRef.current === context?.catalogRevision
  ), []);

  const getCurrentAvailability = useCallback(() => availabilityRef.current, []);
  const reloadStore = useCallback(() => {
    setStoreReloadKey((current) => current + 1);
  }, []);

  return {
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
  };
}

export default usePublicStoreCatalog;
