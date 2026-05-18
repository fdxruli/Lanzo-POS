import { db, STORES } from './db/dexie';
import { getAvailableStock } from './db/utils';
import Logger from './Logger';

const BULK_BATCH_THRESHOLD = 0.02;

const safePrice = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const isActiveProduct = (product) => product?.isActive !== false;

const normalizeCode = (code) => {
  if (!code || typeof code !== 'string') {
    throw new Error('Codigo invalido');
  }

  const normalizedCode = code.trim();

  if (!normalizedCode) {
    throw new Error('Codigo vacio');
  }

  return normalizedCode;
};

const buildVariantName = (batch) =>
  `${batch?.attributes?.talla || ''} ${batch?.attributes?.color || ''}`.trim();

const normalizeComparableCode = (value) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toLowerCase()
    : '';

const findProductMatchByCode = async (code) => {
  const batchTable = db.table(STORES.PRODUCT_BATCHES);
  const menuTable = db.table(STORES.MENU);

  const batch = await batchTable.where('sku').equals(code).first();

  if (batch) {
    const product = await menuTable.get(batch.productId);

    if (product && isActiveProduct(product)) {
      return {
        product,
        batch,
        batchId: batch.id,
        isVariant: true,
        skuDetected: batch.sku,
        variantName: buildVariantName(batch),
      };
    }
  }

  const directProduct = await menuTable
    .where('barcode')
    .equals(code)
    .or('sku')
    .equals(code)
    .filter(isActiveProduct)
    .first();

  if (!directProduct) {
    return null;
  }

  return {
    product: directProduct,
    batch: null,
    batchId: null,
    isVariant: false,
    skuDetected: directProduct.sku || null,
    variantName: null,
  };
};

const selectFifoBatch = async (productId, product) => {
  try {
    const activeBatches = await db
      .table(STORES.PRODUCT_BATCHES)
      .where('productId')
      .equals(productId)
      .filter((batch) => batch.isActive && getAvailableStock(batch) > 0)
      .sortBy('createdAt');

    if (!activeBatches || activeBatches.length === 0) {
      return null;
    }

    if (product?.saleType === 'bulk') {
      const validBatch = activeBatches.find(
        (batch) => getAvailableStock(batch) > BULK_BATCH_THRESHOLD
      );

      return validBatch || activeBatches[0];
    }

    return activeBatches[0];
  } catch (error) {
    Logger.warn('Error obteniendo lote FIFO:', error);
    return null;
  }
};

const buildResolvedProduct = ({
  product,
  batch = null,
  batchId = null,
  isVariant = false,
  skuDetected = null,
  variantName = null,
}) => {
  let finalPrice = safePrice(product.price);
  let finalCost = safePrice(product.cost);
  let displayName = product.name;
  let stock = getAvailableStock(product);
  let resolvedBatchId = batchId;

  if (isVariant && batch) {
    displayName = `${product.name} (${variantName || skuDetected || 'Variante'})`;
    finalPrice = safePrice(batch.price) || finalPrice;
    finalCost = safePrice(batch.cost) || finalCost;
    stock = getAvailableStock(batch);
    resolvedBatchId = batch.id;
  } else if (product.batchManagement?.enabled && batch) {
    finalPrice = safePrice(batch.price) || finalPrice;
    finalCost = safePrice(batch.cost) || finalCost;
    stock = getAvailableStock(batch);
    resolvedBatchId = batch.id;
  }

  return {
    id: product.id,
    name: displayName,
    price: finalPrice,
    cost: finalCost,
    originalPrice: finalPrice,
    quantity: 1,
    stock,
    batchId: resolvedBatchId,
    isVariant,
    skuDetected,
    variantName,
    trackStock: product.trackStock !== false,
    saleType: product.saleType || 'unit',
    categoryId: product.categoryId || null,
    barcode: product.barcode || null,
    priceWarning: false,
    forceWholesale: false,
    forceSafePrice: false,
    exceedsStock: false,
  };
};

const resolveBarcodeInTransaction = async (code) => {
  const match = await findProductMatchByCode(code);

  if (!match) {
    return null;
  }

  if (match.isVariant) {
    return buildResolvedProduct(match);
  }

  const fifoBatch = match.product.batchManagement?.enabled
    ? await selectFifoBatch(match.product.id, match.product)
    : null;

  return buildResolvedProduct({
    ...match,
    batch: fifoBatch,
    batchId: fifoBatch?.id || null,
  });
};

export const resolveBarcode = async (code) => {
  const normalizedCode = normalizeCode(code);

  try {
    return await db.transaction('r', [STORES.PRODUCT_BATCHES, STORES.MENU], async () =>
      resolveBarcodeInTransaction(normalizedCode)
    );
  } catch (error) {
    Logger.error('Error resolviendo codigo de barras:', error);
    throw error;
  }
};

export const resolveBarcodeByStaticReference = async (reference, code = null) => {
  if (!reference?.id) {
    return null;
  }

  try {
    return await db.transaction('r', [STORES.PRODUCT_BATCHES, STORES.MENU], async () => {
      const product = await db.table(STORES.MENU).get(reference.id);

      if (!product || !isActiveProduct(product)) {
        return null;
      }

      if (reference.isVariant && reference.batchId) {
        const batch = await db.table(STORES.PRODUCT_BATCHES).get(reference.batchId);

        if (
          !batch ||
          batch.productId !== product.id ||
          (code && normalizeComparableCode(batch.sku) !== normalizeComparableCode(code))
        ) {
          return null;
        }

        return buildResolvedProduct({
          product,
          batch,
          batchId: batch.id,
          isVariant: true,
          skuDetected: reference.skuDetected || batch.sku || null,
          variantName: buildVariantName(batch),
        });
      }

      const fifoBatch = product.batchManagement?.enabled
        ? await selectFifoBatch(product.id, product)
        : null;

      if (
        code &&
        normalizeComparableCode(product.barcode) !== normalizeComparableCode(code) &&
        normalizeComparableCode(product.sku) !== normalizeComparableCode(code)
      ) {
        return null;
      }

      return buildResolvedProduct({
        product,
        batch: fifoBatch,
        batchId: fifoBatch?.id || null,
        isVariant: false,
        skuDetected: reference.skuDetected || product.sku || null,
        variantName: null,
      });
    });
  } catch (error) {
    Logger.error('Error resolviendo codigo cacheado:', error);
    throw error;
  }
};

export const codeExists = async (code) => {
  if (!code || typeof code !== 'string') {
    return false;
  }

  try {
    const normalizedCode = code.trim();

    if (!normalizedCode) {
      return false;
    }

    return Boolean(
      await db.transaction('r', [STORES.PRODUCT_BATCHES, STORES.MENU], async () =>
        findProductMatchByCode(normalizedCode)
      )
    );
  } catch {
    return false;
  }
};
