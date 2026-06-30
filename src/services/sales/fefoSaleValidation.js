import { db as defaultDb, STORES as DEFAULT_STORES } from '../db/dexie';
import {
  getAvailableBatchStock,
  getFefoWarningForSelection,
  getRecommendedFefoBatch,
  isBatchActiveForFefo,
  isBatchExpiredForSale
} from '../products/fefoUtils';
import {
  isStrictExpiryBatchManagedProduct,
  STRICT_EXPIRY_NO_CURRENT_BATCH_MESSAGE
} from '../products/strictExpirySaleGuards';

const getRealProductId = (item) => item?.parentId || item?.id;
const STRICT_EXPIRED_BATCH_BLOCKED = 'STRICT_EXPIRED_BATCH_BLOCKED';

const loadMissingProducts = async ({ productIds, productMap, db, STORES }) => {
  const missingIds = productIds.filter((productId) => productId && !productMap.has(productId));
  if (missingIds.length === 0) return;

  const loadedProducts = await db.table(STORES.MENU).bulkGet(missingIds);
  loadedProducts.filter(Boolean).forEach((product) => productMap.set(product.id, product));
};

const loadBatchesByProduct = async ({ productIds, db, STORES }) => {
  const batchesByProduct = new Map();

  await Promise.all(
    productIds.map(async (productId) => {
      const batches = await db.table(STORES.PRODUCT_BATCHES)
        .where('productId')
        .equals(productId)
        .toArray();
      batchesByProduct.set(productId, batches || []);
    })
  );

  return batchesByProduct;
};

const buildBlockedMessage = (productName) => (
  `El lote seleccionado de ${productName || 'este producto'} está vencido y no puede venderse. Selecciona otro lote o manda el producto a merma.`
);

const buildNoCurrentBatchMessage = (productName) => (
  productName
    ? `${productName}: ${STRICT_EXPIRY_NO_CURRENT_BATCH_MESSAGE}`
    : STRICT_EXPIRY_NO_CURRENT_BATCH_MESSAGE
);

export const validateFefoSelectionBeforeCheckout = async (
  items = [],
  allProducts = [],
  deps = {}
) => {
  const db = deps.db || defaultDb;
  const STORES = deps.STORES || DEFAULT_STORES;
  const now = deps.now || new Date();

  if (!db || !STORES?.MENU || !STORES?.PRODUCT_BATCHES) {
    return { blocked: false, warnings: [] };
  }

  const sellableItems = (Array.isArray(items) ? items : []).filter((item) => Number(item?.quantity) > 0);
  if (sellableItems.length === 0) return { blocked: false, warnings: [] };

  const productMap = new Map((allProducts || []).map((product) => [product.id, product]));
  const productIds = Array.from(new Set(sellableItems.map(getRealProductId).filter(Boolean)));

  await loadMissingProducts({ productIds, productMap, db, STORES });

  const batchManagedProductIds = productIds.filter((productId) => (
    productMap.get(productId)?.batchManagement?.enabled === true
  ));

  if (batchManagedProductIds.length === 0) {
    return { blocked: false, warnings: [] };
  }

  const batchesByProduct = await loadBatchesByProduct({
    productIds: batchManagedProductIds,
    db,
    STORES
  });

  const warnings = [];

  for (const item of sellableItems) {
    const productId = getRealProductId(item);
    const product = productMap.get(productId);
    if (!product?.batchManagement?.enabled) continue;

    const productName = product?.name || item?.name;
    const productBatches = batchesByProduct.get(productId) || [];
    const selectedBatch = item?.batchId
      ? productBatches.find((batch) => String(batch?.id) === String(item.batchId))
      : null;

    if (selectedBatch && isBatchExpiredForSale(selectedBatch, product, now)) {
      return {
        blocked: true,
        code: STRICT_EXPIRED_BATCH_BLOCKED,
        message: buildBlockedMessage(productName),
        warnings
      };
    }

    const recommendedBatch = getRecommendedFefoBatch(productBatches, product, { now });

    if (!selectedBatch && !recommendedBatch && isStrictExpiryBatchManagedProduct(product)) {
      const hasAvailableBatchStock = productBatches.some((batch) => (
        isBatchActiveForFefo(batch)
        && getAvailableBatchStock(batch) > 0
      ));

      return {
        blocked: true,
        code: STRICT_EXPIRED_BATCH_BLOCKED,
        message: buildNoCurrentBatchMessage(productName),
        warnings,
        metadata: {
          productId,
          productName,
          hasAvailableBatchStock
        }
      };
    }

    const warning = getFefoWarningForSelection({
      selectedBatch,
      recommendedBatch,
      product,
      now
    });

    if (warning && !warning.blocking) {
      warnings.push({
        ...warning,
        productId,
        productName,
        selectedBatchId: selectedBatch?.id || null,
        recommendedBatchId: recommendedBatch?.id || null
      });
    }
  }

  return { blocked: false, warnings };
};
