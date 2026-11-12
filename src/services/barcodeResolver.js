import { db, STORES } from './db/dexie';
import { getAvailableStock } from './db/utils';
import Logger from './Logger';
import { isCommercialVariantProduct } from './products/commercialVariants';
import { isBatchActiveForFefo, isBatchExpiredForSale, isBatchRemoved } from './products/fefoUtils';
import { getStrictExpirySaleGuard, isStrictExpiryBatchManagedProduct } from './products/strictExpirySaleGuards';
import { normalizeBarcodeKey, normalizeSkuKey } from './products/productMapper';

const BULK_BATCH_THRESHOLD = 0.02;

const parseStrictPrice = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const isActiveProduct = (product) => product?.isActive !== false;
const isSellableBatch = (batch, product) => Boolean(
  batch
    && isBatchActiveForFefo(batch)
    && batch.status !== 'inactive'
    && getAvailableStock(batch) > 0
    && !isBatchExpiredForSale(batch, product)
    && !getStrictExpirySaleGuard({ product, batches: [batch] }).blocked
);

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

// Resolve identity before applying stock, lot, or active-state guards.
// Tenant isolation is supplied by the existing runtime Dexie tables.
const isLiveProduct = (product) => Boolean(
  product?.id != null &&
  !product.deletedAt && !product.deletedTimestamp &&
  !product.deleted_at && !product.deleted_timestamp &&
  !product.isDeleted && !product.is_deleted
);

const findCodeCandidates = async (code) => {
  const menuTable = db.table(STORES.MENU);
  const batchTable = db.table(STORES.PRODUCT_BATCHES);
  const barcodeKey = normalizeBarcodeKey(code);
  const skuKey = normalizeSkuKey(code);

  // Existing indexes do not use the same whitespace rules as Cloud's
  // barcode_key. Scan tenant-local records to include historical duplicates.
  const [directProducts, matchingBatches] = await Promise.all([
    menuTable.filter((product) => isLiveProduct(product) && (
      normalizeBarcodeKey(product.barcode) === barcodeKey ||
      normalizeSkuKey(product.sku) === skuKey
    )).toArray(),
    batchTable.filter((batch) => (
      !isBatchRemoved(batch) && normalizeSkuKey(batch.sku) === skuKey
    )).toArray(),
  ]);

  const distinctProducts = new Map(directProducts.map((product) => [String(product.id), product]));
  for (const batch of matchingBatches) {
    if (batch.productId == null || distinctProducts.has(String(batch.productId))) continue;
    const product = await menuTable.get(batch.productId);
    if (isLiveProduct(product)) distinctProducts.set(String(product.id), product);
  }

  return {
    products: [...distinctProducts.values()],
    matchingBatches,
  };
};

const selectFifoBatch = async (productId, product) => {
  // Dexie exceptions must reach the UI; a read failure is not empty inventory.
  const activeBatches = await db
    .table(STORES.PRODUCT_BATCHES)
    .where('productId')
    .equals(productId)
    .filter((batch) => isSellableBatch(batch, product))
    .sortBy('createdAt');

  if (!activeBatches?.length) return null;

  if (product?.saleType === 'bulk') {
    return activeBatches.find((batch) => getAvailableStock(batch) > BULK_BATCH_THRESHOLD)
      || activeBatches[0];
  }
  return activeBatches[0];
};

const buildResolvedProduct = ({
  product,
  batch = null,
  batchId = null,
  isVariant = false,
  skuDetected = null,
  variantName = null,
}) => {
  let finalPrice = parseStrictPrice(product.price);
  if (finalPrice === null) {
    throw new Error(`CRÍTICO: El producto "${product.name}" tiene un precio de venta inválido o corrupto. Venta bloqueada por seguridad.`);
  }

  let finalCost = parseStrictPrice(product.cost) || 0; // El costo sí puede omitirse o ser 0

  let displayName = product.name;
  let stock = getAvailableStock(product);
  let resolvedBatchId = batchId;

  if (isVariant && batch) {
    displayName = `${product.name} (${variantName || skuDetected || 'Variante'})`;
    const variantPrice = parseStrictPrice(batch.price);
    finalPrice = variantPrice !== null ? variantPrice : finalPrice;
    
    const variantCost = parseStrictPrice(batch.cost);
    finalCost = variantCost !== null ? variantCost : finalCost;

    stock = getAvailableStock(batch);
    resolvedBatchId = batch.id;
  } else if (product.batchManagement?.enabled && batch) {
    const batchCost = parseStrictPrice(batch.cost);
    finalCost = batchCost !== null ? batchCost : finalCost;

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

export const BARCODE_RESOLUTION_STATUS = Object.freeze({
  RESOLVED: 'RESOLVED',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  INACTIVE: 'INACTIVE',
  NO_SELLABLE_BATCH: 'NO_SELLABLE_BATCH',
});

const resolved = (code, product) => ({
  status: BARCODE_RESOLUTION_STATUS.RESOLVED, code, product,
});

const unavailable = (status, code, product = null, reason = null) => ({
  status,
  code,
  product: product ? { id: product.id, name: product.name } : null,
  reason,
});

const resolveBarcodeInTransaction = async (code) => {
  const { products, matchingBatches } = await findCodeCandidates(code);
  if (!products.length) return unavailable(BARCODE_RESOLUTION_STATUS.NOT_FOUND, code);

  if (products.length > 1) {
    return {
      status: BARCODE_RESOLUTION_STATUS.DUPLICATE,
      code,
      matches: products.map((product) => ({
        id: product.id,
        name: product.name,
        isActive: isActiveProduct(product),
      })),
    };
  }

  const product = products[0];
  if (!isActiveProduct(product)) {
    return unavailable(BARCODE_RESOLUTION_STATUS.INACTIVE, code, product);
  }

  const matchingProductBatches = matchingBatches.filter(
    (batch) => String(batch.productId) === String(product.id)
  );
  const isVariant = isCommercialVariantProduct({
    ...product, activeBatches: matchingProductBatches,
  });
  const requiresBatch = Boolean(
    product.batchManagement?.enabled &&
    (product.trackStock !== false || isVariant || isStrictExpiryBatchManagedProduct(product))
  );

  // Explicit batch SKUs keep their matching batch, rather than being
  // silently replaced by a different lot with another SKU.
  const matchedBatch = matchingProductBatches
    .filter((batch) => isSellableBatch(batch, product))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0] || null;

  if (matchingProductBatches.length && !matchedBatch) {
    return unavailable(BARCODE_RESOLUTION_STATUS.NO_SELLABLE_BATCH, code, product, 'matching_batch_unavailable');
  }

  // Untracked products with a legacy batchManagement flag must not be
  // rejected solely for missing stock. Strict expiry and variants still
  // require a valid batch.
  const batch = matchedBatch || (
    requiresBatch && !matchingProductBatches.length
      ? await selectFifoBatch(product.id, product)
      : null
  );

  if (requiresBatch && !batch) {
    return unavailable(BARCODE_RESOLUTION_STATUS.NO_SELLABLE_BATCH, code, product, 'no_sellable_batch');
  }

  return resolved(code, buildResolvedProduct({
    product,
    batch,
    batchId: batch?.id || null,
    isVariant: Boolean(isVariant && batch),
    skuDetected: matchingProductBatches.length ? batch?.sku || null : product.sku || null,
    variantName: batch && isVariant ? buildVariantName(batch) : null,
  }));
};

export const resolveBarcodeResult = async (code) => {
  const normalizedCode = normalizeCode(code);
  try {
    return await db.transaction('r', [STORES.PRODUCT_BATCHES, STORES.MENU], () =>
      resolveBarcodeInTransaction(normalizedCode)
    );
  } catch (error) {
    Logger.error('Error resolviendo codigo de barras:', error);
    throw error;
  }
};

// Compatibility for legacy consumers that expect a POS product or null.
export const resolveBarcode = async (code) => {
  const result = await resolveBarcodeResult(code);
  return result.status === BARCODE_RESOLUTION_STATUS.RESOLVED ? result.product : null;
};

export const resolveBarcodeByStaticReference = async (reference, code = null) => {
  if (!reference?.id || !code) return null;
  const result = await resolveBarcodeResult(code);
  return result.status === BARCODE_RESOLUTION_STATUS.RESOLVED &&
    String(result.product.id) === String(reference.id)
    ? result.product
    : null;
};

export const codeExists = async (code) => {
  if (!code || typeof code !== 'string' || !code.trim()) return false;
  try {
    return (await resolveBarcodeResult(code)).status !== BARCODE_RESOLUTION_STATUS.NOT_FOUND;
  } catch {
    return false;
  }
};
