import {
  getEcommercePortal,
  listPublishedProducts
} from './ecommerceAdminService';
import {
  getAvailableBatchStock,
  getBatchExpiryValue,
  isBatchActiveForFefo
} from '../products/fefoUtils';
import { getAvailableStock, normalizeStock } from '../db/utils';
import { getBatchExpiryStatus } from '../../utils/dateUtils';
import { getInventoryQuantityForSale } from '../sales/stockValidation';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import { ecommercePublishedStockLocalSource } from './ecommercePublishedStockLocalSource';
import {
  ECOMMERCE_PUBLISHED_STOCK_ALERT_TTL_MS,
  ECOMMERCE_PUBLISHED_STOCK_STATUS
} from './ecommercePublishedStockAlertConstants';

const REMOVED_PRODUCT_STATUSES = new Set(['inactive', 'deleted', 'archived']);
const BLOCKED_BATCH_STATUSES = new Set([
  'inactive',
  'blocked',
  'quarantined',
  'deleted',
  'removed',
  'archived'
]);
const EXPIRY_REQUIRED_MODES = new Set(['STRICT', 'SHELF_LIFE', 'BATCH']);
const EPSILON = 0.0001;

const toText = (value) => String(value || '').trim();
const toStatus = (value) => toText(value).toLowerCase();
const nowIso = () => new Date().toISOString();

const getStaffIdentity = (state = {}) => {
  if (state.currentDeviceRole !== 'staff') return 'admin';
  const staff = state.currentStaffUser || {};
  return toText(
    staff.sessionToken
    || staff.session_token
    || staff.staffSessionToken
    || staff.staff_session_token
    || staff.id
    || staff.staffId
    || staff.staff_id
    || 'staff'
  );
};

export const getEcommercePublishedStockAlertContextKey = (state = {}) => {
  const licenseKey = getLicenseKeyFromDetails(state.licenseDetails || {});
  if (!licenseKey) return null;

  const role = toText(state.currentDeviceRole || 'unknown');
  const device = toText(
    state.deviceFingerprint
    || state.device_fingerprint
    || state.licenseDetails?.device_fingerprint
    || 'device'
  );

  return [licenseKey, role, getStaffIdentity(state), device].join(':');
};

const isProductInactive = (product = {}) => (
  product.isActive === false
  || product.is_active === false
  || Boolean(product.deletedAt || product.deleted_at || product.deletedTimestamp)
  || REMOVED_PRODUCT_STATUSES.has(toStatus(product.status))
);

const hasRecipe = (product = {}) => (
  Array.isArray(product.recipe) && product.recipe.length > 0
);

const isBatchManaged = (product = {}) => (
  product.batchManagement?.enabled === true
  || product.batch_management?.enabled === true
  || toStatus(product.expirationMode || product.expiration_mode) === 'batch'
);

const getExpirationMode = (product = {}) => toText(
  product.expirationMode || product.expiration_mode || 'NONE'
).toUpperCase();

const getRawAvailableStock = (product = {}) => {
  const stock = Number(product.stock);
  const committedValue = product.committedStock ?? product.committed_stock ?? 0;
  const committedStock = Number(committedValue);

  if (
    product.stock === null
    || product.stock === undefined
    || product.stock === ''
    || !Number.isFinite(stock)
    || !Number.isFinite(committedStock)
    || committedStock < 0
  ) {
    return { verified: false, available: null };
  }

  return { verified: true, available: getAvailableStock(product) };
};

const getVerifiedBatchAvailableStock = (batch = {}) => {
  const stockValue = batch.stock ?? batch.quantity;
  const committedValue = batch.committedStock ?? batch.committed_stock ?? 0;
  const stock = Number(stockValue);
  const committedStock = Number(committedValue);

  if (
    stockValue === null
    || stockValue === undefined
    || stockValue === ''
    || !Number.isFinite(stock)
    || !Number.isFinite(committedStock)
    || committedStock < 0
  ) {
    return { verified: false, available: null };
  }

  return {
    verified: true,
    available: getAvailableBatchStock(batch)
  };
};

const getSellableBatchState = (batch, product, now) => {
  if (!isBatchActiveForFefo(batch)) {
    return { verified: true, sellable: false, available: 0 };
  }
  if (
    batch?.isBlocked === true
    || batch?.is_blocked === true
    || batch?.blocked === true
    || BLOCKED_BATCH_STATUSES.has(toStatus(batch?.status))
  ) {
    return { verified: true, sellable: false, available: 0 };
  }

  const stockState = getVerifiedBatchAvailableStock(batch);
  if (!stockState.verified) {
    return { verified: false, sellable: false, available: null };
  }
  if (stockState.available <= EPSILON) {
    return { verified: true, sellable: false, available: 0 };
  }

  const expiryMode = getExpirationMode(product);
  if (!EXPIRY_REQUIRED_MODES.has(expiryMode)) {
    return {
      verified: true,
      sellable: true,
      available: stockState.available
    };
  }

  const expiryStatus = getBatchExpiryStatus({
    expiryDate: getBatchExpiryValue(batch)
  }, now);
  const sellable = expiryStatus === 'valid' || expiryStatus === 'expires_today';

  return {
    verified: true,
    sellable,
    available: sellable ? stockState.available : 0
  };
};

const isSellableBatch = (batch, product, now) => (
  getSellableBatchState(batch, product, now).sellable
);

const getSellableUnitStock = (inventoryStock, product) => {
  const inventoryPerSaleUnit = Number(getInventoryQuantityForSale(
    { quantity: 1 },
    product
  ));

  if (!Number.isFinite(inventoryPerSaleUnit) || inventoryPerSaleUnit <= 0) {
    return null;
  }

  return normalizeStock(Number(inventoryStock) / inventoryPerSaleUnit);
};

const makeResult = ({
  publishedProduct,
  status,
  availableStock = null
}) => ({
  publishedProductId: publishedProduct.id || null,
  localProductRef: publishedProduct.localProductRef || null,
  publicName: publishedProduct.publicName || 'Producto publicado',
  status,
  availableStock
});

const classifyProduct = ({
  publishedProduct,
  localProduct,
  batches,
  batchReadFailed,
  now
}) => {
  if (!localProduct) {
    return makeResult({
      publishedProduct,
      // IndexedDB is a per-device cache, not the authoritative product source.
      // A cache miss must preserve the last cloud-confirmed availability.
      status: ECOMMERCE_PUBLISHED_STOCK_STATUS.UNVERIFIED
    });
  }

  if (isProductInactive(localProduct)) {
    return makeResult({
      publishedProduct,
      status: ECOMMERCE_PUBLISHED_STOCK_STATUS.INACTIVE_SOURCE
    });
  }

  if (localProduct.trackStock === false && !hasRecipe(localProduct)) {
    return makeResult({
      publishedProduct,
      status: ECOMMERCE_PUBLISHED_STOCK_STATUS.NOT_TRACKED
    });
  }

  if (hasRecipe(localProduct)) {
    return makeResult({
      publishedProduct,
      status: ECOMMERCE_PUBLISHED_STOCK_STATUS.UNVERIFIED
    });
  }

  let inventoryStock;
  if (isBatchManaged(localProduct)) {
    if (batchReadFailed) {
      return makeResult({
        publishedProduct,
        status: ECOMMERCE_PUBLISHED_STOCK_STATUS.UNVERIFIED
      });
    }

    const batchStates = (batches || []).map((batch) => (
      getSellableBatchState(batch, localProduct, now)
    ));
    inventoryStock = batchStates
      .filter((state) => state.sellable)
      .reduce((sum, state) => sum + state.available, 0);

    if (
      inventoryStock <= EPSILON
      && batchStates.some((state) => state.verified === false)
    ) {
      return makeResult({
        publishedProduct,
        status: ECOMMERCE_PUBLISHED_STOCK_STATUS.UNVERIFIED
      });
    }
  } else {
    const stockState = getRawAvailableStock(localProduct);
    if (!stockState.verified) {
      return makeResult({
        publishedProduct,
        status: ECOMMERCE_PUBLISHED_STOCK_STATUS.UNVERIFIED
      });
    }
    inventoryStock = stockState.available;
  }

  const availableStock = getSellableUnitStock(inventoryStock, localProduct);
  if (availableStock === null) {
    return makeResult({
      publishedProduct,
      status: ECOMMERCE_PUBLISHED_STOCK_STATUS.UNVERIFIED
    });
  }

  return makeResult({
    publishedProduct,
    status: availableStock <= 0
      ? ECOMMERCE_PUBLISHED_STOCK_STATUS.OUT_OF_STOCK
      : ECOMMERCE_PUBLISHED_STOCK_STATUS.IN_STOCK,
    availableStock
  });
};

const countByStatus = (products, status) => (
  products.filter((product) => product.status === status).length
);

const buildSnapshot = ({
  portal,
  products,
  evaluatedAt,
  reason,
  cached = false
}) => ({
  success: true,
  evaluatedAt,
  reason,
  cached,
  portalStatus: portal?.status || 'draft',
  publishedCount: products.length,
  outOfStockCount: countByStatus(
    products,
    ECOMMERCE_PUBLISHED_STOCK_STATUS.OUT_OF_STOCK
  ),
  unverifiedCount: countByStatus(
    products,
    ECOMMERCE_PUBLISHED_STOCK_STATUS.UNVERIFIED
  ),
  sourceMissingCount: countByStatus(
    products,
    ECOMMERCE_PUBLISHED_STOCK_STATUS.SOURCE_MISSING
  ),
  inactiveSourceCount: countByStatus(
    products,
    ECOMMERCE_PUBLISHED_STOCK_STATUS.INACTIVE_SOURCE
  ),
  notTrackedCount: countByStatus(
    products,
    ECOMMERCE_PUBLISHED_STOCK_STATUS.NOT_TRACKED
  ),
  products
});

export const createEcommercePublishedStockAlertService = ({
  getState = () => ({}),
  getPortal = getEcommercePortal,
  getPublishedProducts = listPublishedProducts,
  localSource = ecommercePublishedStockLocalSource,
  ttlMs = ECOMMERCE_PUBLISHED_STOCK_ALERT_TTL_MS,
  getNow = () => new Date()
} = {}) => {
  const cacheByContext = new Map();
  const inFlightByContext = new Map();
  const epochByContext = new Map();
  let globalEpoch = 0;

  const currentEpoch = (contextKey) => Number(epochByContext.get(contextKey) || 0);

  const invalidateEcommercePublishedStockAlerts = ({ contextKey } = {}) => {
    if (!contextKey) {
      globalEpoch += 1;
      cacheByContext.clear();
      return;
    }

    cacheByContext.delete(contextKey);
    epochByContext.set(contextKey, currentEpoch(contextKey) + 1);
  };

  const clearEcommercePublishedStockAlerts = ({ contextKey } = {}) => {
    invalidateEcommercePublishedStockAlerts({ contextKey });
    if (!contextKey) inFlightByContext.clear();
  };

  const loadAdministrativeSnapshot = async (options) => {
    const hasPortal = Object.prototype.hasOwnProperty.call(options, 'portal');
    const hasProducts = Object.prototype.hasOwnProperty.call(options, 'publishedProducts');

    let portal = hasPortal ? options.portal : undefined;
    let publishedProducts = hasProducts ? options.publishedProducts : undefined;

    if (!hasPortal) {
      const portalResult = await getPortal();
      if (portalResult?.success !== true) {
        return {
          success: false,
          message: portalResult?.message || 'No se pudo cargar el portal online.'
        };
      }
      portal = portalResult.portal || null;
    }

    if (!hasProducts && portal) {
      const productsResult = await getPublishedProducts();
      if (productsResult?.success !== true) {
        return {
          success: false,
          message: productsResult?.message || 'No se pudieron cargar los productos publicados.'
        };
      }
      publishedProducts = productsResult.products || [];
    }

    return {
      success: true,
      portal: portal || null,
      publishedProducts: Array.isArray(publishedProducts) ? publishedProducts : []
    };
  };

  const evaluateCore = async (options) => {
    const administrative = await loadAdministrativeSnapshot(options);
    if (!administrative.success) return administrative;

    const publishedProducts = administrative.publishedProducts.filter((product) => (
      product?.isPublished === true && toText(product.localProductRef)
    ));
    const evaluatedAt = getNow().toISOString();

    if (publishedProducts.length === 0) {
      return buildSnapshot({
        portal: administrative.portal,
        products: [],
        evaluatedAt,
        reason: options.reason
      });
    }

    const localProductRefs = publishedProducts.map((product) => (
      toText(product.localProductRef)
    ));

    let localProductsById;
    try {
      localProductsById = await localSource.getProductsByIds(localProductRefs);
    } catch {
      return buildSnapshot({
        portal: administrative.portal,
        products: publishedProducts.map((publishedProduct) => makeResult({
          publishedProduct,
          status: ECOMMERCE_PUBLISHED_STOCK_STATUS.UNVERIFIED
        })),
        evaluatedAt,
        reason: options.reason
      });
    }

    const batchManagedIds = Array.from(new Set(
      localProductRefs.filter((productId) => {
        const product = localProductsById.get(productId);
        return product && !isProductInactive(product) && isBatchManaged(product);
      })
    ));

    let batchesByProductId = new Map();
    let batchReadFailed = false;
    if (batchManagedIds.length > 0) {
      try {
        batchesByProductId = await localSource.getBatchesByProductIds(batchManagedIds);
      } catch {
        batchReadFailed = true;
      }
    }

    const evaluationNow = getNow();
    const products = publishedProducts.map((publishedProduct) => {
      const localProductRef = toText(publishedProduct.localProductRef);
      return classifyProduct({
        publishedProduct,
        localProduct: localProductsById.get(localProductRef),
        batches: batchesByProductId.get(localProductRef) || [],
        batchReadFailed,
        now: evaluationNow
      });
    });

    return buildSnapshot({
      portal: administrative.portal,
      products,
      evaluatedAt,
      reason: options.reason
    });
  };

  const evaluatePublishedProductStockAlerts = async (options = {}) => {
    const state = getState() || {};
    const contextKey = options.contextKey
      || getEcommercePublishedStockAlertContextKey(state);
    if (!contextKey) {
      return {
        success: false,
        code: 'ECOMMERCE_PUBLISHED_STOCK_CONTEXT_REQUIRED',
        message: 'No se pudo confirmar la licencia para evaluar el catalogo publicado.'
      };
    }

    const force = options.force === true;
    const reason = options.reason || 'manual';
    const cached = cacheByContext.get(contextKey);
    if (
      !force
      && cached
      && Date.now() - cached.storedAt < ttlMs
    ) {
      return { ...cached.snapshot, cached: true, reason };
    }

    const contextEpoch = currentEpoch(contextKey);
    const requestGlobalEpoch = globalEpoch;
    const currentFlight = inFlightByContext.get(contextKey);
    if (
      currentFlight
      && currentFlight.contextEpoch === contextEpoch
      && currentFlight.globalEpoch === requestGlobalEpoch
    ) {
      return currentFlight.promise;
    }

    const requestPromise = (async () => {
      const result = await evaluateCore({ ...options, reason });
      const currentContextKey = getEcommercePublishedStockAlertContextKey(
        getState() || {}
      );
      const stale = (
        currentEpoch(contextKey) !== contextEpoch
        || globalEpoch !== requestGlobalEpoch
        || currentContextKey !== contextKey
      );

      if (stale) return { ...result, stale: true };

      if (result?.success === true) {
        cacheByContext.set(contextKey, {
          storedAt: Date.now(),
          snapshot: result
        });
      }

      return result;
    })();

    const flight = {
      promise: requestPromise,
      contextEpoch,
      globalEpoch: requestGlobalEpoch
    };
    inFlightByContext.set(contextKey, flight);
    try {
      return await requestPromise;
    } finally {
      if (inFlightByContext.get(contextKey)?.promise === requestPromise) {
        inFlightByContext.delete(contextKey);
      }
    }
  };

  return {
    evaluatePublishedProductStockAlerts,
    invalidateEcommercePublishedStockAlerts,
    clearEcommercePublishedStockAlerts
  };
};

export const ecommercePublishedStockAlertServiceInternals = Object.freeze({
  classifyProduct,
  getRawAvailableStock,
  getVerifiedBatchAvailableStock,
  getSellableBatchState,
  getSellableUnitStock,
  isBatchManaged,
  isProductInactive,
  isSellableBatch,
  buildSnapshot,
  nowIso
});
