import { getAvailableStock } from '../db/utils';
import {
  getAvailableBatchStock,
  getBatchExpiryValue,
  isBatchActiveForFefo,
} from './fefoUtils';
import { getBatchExpiryStatus } from '../../utils/dateUtils';

export const CAT_DYNAMIC_OUT_OF_STOCK = 'CAT_DYNAMIC_AGOTADOS';
export const CAT_DYNAMIC_EXPIRED = 'CAT_DYNAMIC_CADUCADOS';

export const isDynamicPosCategory = (categoryId) => (
  categoryId === CAT_DYNAMIC_OUT_OF_STOCK || categoryId === CAT_DYNAMIC_EXPIRED
);

const getExpirationMode = (product) => (
  product?.expirationMode || product?.expiration_mode || 'NONE'
);

const productUsesBatchManagement = (product) => (
  product?.batchManagement?.enabled === true
  || product?.batch_management?.enabled === true
  || String(product?.batch_management?.enabled || '').toLowerCase() === 'true'
);

const hasExpirationBlockingMode = (product) => (
  ['STRICT', 'SHELF_LIFE'].includes(getExpirationMode(product))
);

const getDirectExpiryValue = (product) => (
  product?.expiryDate
  || product?.expiry_date
  || product?.alertTargetDate
  || product?.alert_target_date
  || product?.metadata?.expiryDate
  || product?.metadata?.expiry_date
  || product?.metadata?.alertTargetDate
  || product?.metadata?.alert_target_date
  || null
);

const isRecipeBasedProduct = (product) => (
  Array.isArray(product?.recipe) && product.recipe.length > 0
);

export const isOutOfStockForPosMenu = (product) => {
  const managesStock = product?.trackStock !== false && (
    product?.trackStock === true || productUsesBatchManagement(product)
  );

  return managesStock && !isRecipeBasedProduct(product) && getAvailableStock(product) <= 0;
};

const hasDirectExpiredDate = (product, now) => (
  getBatchExpiryStatus({ expiryDate: getDirectExpiryValue(product) }, now) === 'expired'
);

const getBatchExpiryState = (batch, now) => (
  getBatchExpiryStatus({ expiryDate: getBatchExpiryValue(batch) }, now)
);

export const getPosMenuExpirationState = (product, batches = [], now = new Date()) => {
  const defaultState = {
    expired: false,
    regularizationRequired: false,
    noCurrentBatch: false,
    reason: 'not_expired'
  };

  if (!product || isRecipeBasedProduct(product)) return defaultState;

  if (hasDirectExpiredDate(product, now)) {
    return {
      ...defaultState,
      expired: true,
      reason: 'direct_expiry_expired'
    };
  }

  if (!productUsesBatchManagement(product)) return defaultState;

  const expirationMode = getExpirationMode(product);
  const parentHasStock = getAvailableStock(product) > 0;
  const activeAvailableBatches = (Array.isArray(batches) ? batches : []).filter((batch) => (
    isBatchActiveForFefo(batch) && getAvailableBatchStock(batch) > 0
  ));

  if (activeAvailableBatches.length === 0) {
    if (!parentHasStock || !hasExpirationBlockingMode(product)) return defaultState;

    return {
      expired: false,
      regularizationRequired: true,
      noCurrentBatch: true,
      reason: 'stock_without_active_available_batches'
    };
  }

  if (!['STRICT', 'SHELF_LIFE'].includes(expirationMode)) return defaultState;

  const batchStates = activeAvailableBatches.map((batch) => getBatchExpiryState(batch, now));
  const hasCurrentBatch = batchStates.some((status) => status === 'valid' || status === 'expires_today');
  const hasExpiredBatch = batchStates.some((status) => status === 'expired');
  const hasIncompleteBatch = batchStates.some((status) => status === 'missing' || status === 'invalid');
  const noCurrentBatch = !hasCurrentBatch;

  if (hasIncompleteBatch) {
    return {
      expired: hasExpiredBatch && noCurrentBatch,
      regularizationRequired: true,
      noCurrentBatch,
      reason: expirationMode === 'SHELF_LIFE'
        ? 'shelf_life_batch_missing_target_date'
        : 'strict_batch_missing_expiry_date'
    };
  }

  if (hasExpiredBatch && noCurrentBatch) {
    return {
      expired: true,
      regularizationRequired: false,
      noCurrentBatch: true,
      reason: 'all_available_batches_expired'
    };
  }

  if (noCurrentBatch) {
    return {
      expired: false,
      regularizationRequired: parentHasStock,
      noCurrentBatch: true,
      reason: 'no_current_batch'
    };
  }

  return defaultState;
};

export const isExpiredForPosMenu = (product, batches = [], now = new Date()) => {
  return getPosMenuExpirationState(product, batches, now).expired;
};

const loadBatchesByProductId = async ({ db, STORES, productIds = [] }) => {
  const batchesByProductId = new Map();

  await Promise.all(productIds.map(async (productId) => {
    const batches = await db.table(STORES.PRODUCT_BATCHES)
      .where('productId')
      .equals(productId)
      .toArray();
    batchesByProductId.set(productId, batches || []);
  }));

  return batchesByProductId;
};

export const resolveExpiredProductIdsForPosMenu = async (
  products = [],
  { db, STORES, now = new Date() } = {}
) => {
  if (!db || !STORES?.PRODUCT_BATCHES || !Array.isArray(products) || products.length === 0) {
    return new Set();
  }

  const candidates = products.filter((product) => (
    product?.isActive !== false
    && product?.productType !== 'ingredient'
    && product?.product_type !== 'ingredient'
    && !isOutOfStockForPosMenu(product)
  ));

  const batchManagedProductIds = [];
  for (const product of candidates) {
    if (productUsesBatchManagement(product) && product.id) {
      batchManagedProductIds.push(product.id);
    }
  }

  const batchesByProductId = await loadBatchesByProductId({
    db,
    STORES,
    productIds: Array.from(new Set(batchManagedProductIds)),
  });

  const expiredProductIds = new Set();
  for (const product of candidates) {
    if (isExpiredForPosMenu(product, batchesByProductId.get(product.id) || [], now)) {
      expiredProductIds.add(product.id);
    }
  }

  return expiredProductIds;
};

export const checkHasExpiredProductsForPosMenu = async ({ db, STORES, now = new Date() } = {}) => {
  if (!db || !STORES?.MENU || !STORES?.PRODUCT_BATCHES) return false;

  const products = await db.table(STORES.MENU)
    .filter((product) => (
      product?.isActive !== false
      && product?.productType !== 'ingredient'
      && product?.product_type !== 'ingredient'
    ))
    .toArray();

  const expiredProductIds = await resolveExpiredProductIdsForPosMenu(products, { db, STORES, now });
  return expiredProductIds.size > 0;
};
