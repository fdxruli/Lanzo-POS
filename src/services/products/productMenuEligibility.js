import { getAvailableStock } from '../db/utils';
import {
  getAvailableBatchStock,
  isBatchActiveForFefo,
} from './fefoUtils';
import { getStrictExpirySaleGuard } from './strictExpirySaleGuards';
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

const getSellableBatchStatus = (product, batches = [], now = new Date()) => {
  const activeAvailableBatches = (Array.isArray(batches) ? batches : []).filter((batch) => (
    isBatchActiveForFefo(batch) && getAvailableBatchStock(batch) > 0
  ));

  if (activeAvailableBatches.length === 0) {
    return {
      hasActiveAvailableBatches: false,
      hasCurrentBatch: false,
    };
  }

  const expirationMode = getExpirationMode(product);

  if (expirationMode === 'STRICT') {
    const productForGuard = product?.batchManagement
      ? product
      : { ...product, batchManagement: product?.batch_management };
    const strictGuard = getStrictExpirySaleGuard({ product: productForGuard, batches: activeAvailableBatches, now });
    return {
      hasActiveAvailableBatches: true,
      hasCurrentBatch: !strictGuard.blocked,
    };
  }

  if (expirationMode === 'SHELF_LIFE') {
    return {
      hasActiveAvailableBatches: true,
      hasCurrentBatch: activeAvailableBatches.some(
        (batch) => getBatchExpiryStatus(batch, now) !== 'expired'
      ),
    };
  }

  return {
    hasActiveAvailableBatches: true,
    hasCurrentBatch: true,
  };
};

export const isExpiredForPosMenu = (product, batches = [], now = new Date()) => {
  if (!product || isRecipeBasedProduct(product)) return false;

  if (hasDirectExpiredDate(product, now)) return true;
  if (!productUsesBatchManagement(product)) return false;

  const batchStatus = getSellableBatchStatus(product, batches, now);
  return !batchStatus.hasCurrentBatch && (
    batchStatus.hasActiveAvailableBatches || hasExpirationBlockingMode(product)
  );
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
