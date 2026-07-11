import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useProductStore } from '../../store/useProductStore';
import { db as defaultDb, STORES as DEFAULT_STORES } from '../db/dexie';
import { getAvailableStock } from '../db/utils';
import {
  getAvailableBatchStock,
  getBatchDisplayCode,
  getBatchExpiryValue,
  getBatchId,
  isBatchActiveForFefo,
  sortBatchesByFefo
} from '../products/fefoUtils';
import { getInventoryQuantityForSale } from '../sales/stockValidation';
import { extractCalendarDate, getBatchExpiryStatus } from '../../utils/dateUtils';
import { getEcommercePosContextIdentity } from './ecommercePosDraftService';

export const ECOMMERCE_INVENTORY_RESOLUTION_VERSION = 2;
export const ECOMMERCE_INVENTORY_STALE_RESPONSE = 'ECOMMERCE_INVENTORY_STALE_RESPONSE';
export const ECOMMERCE_INVENTORY_READ_FAILED = 'ECOMMERCE_INVENTORY_READ_FAILED';

export const ECOMMERCE_INVENTORY_STATUS = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  CONFLICT: 'conflict'
});

const PRODUCT_REMOVED_STATUSES = new Set(['inactive', 'deleted', 'archived']);
const BATCH_EXPIRY_MODES = new Set(['STRICT', 'SHELF_LIFE', 'BATCH']);
const EPSILON = 0.0001;
const READ_FAILURE_MESSAGE = 'No se pudo comprobar el inventario local. Intenta resolverlo nuevamente.';
const inventoryResolutionAttempts = new Map();
let attemptSequence = 0;

const toFinitePositiveQuantity = (value) => {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
};

const getRealProductId = (item = {}) => item.parentId || item.id || null;
const getLineId = (item = {}, index = 0) => (
  item.lineId || item.uniqueLineId || item.ecommerceOrderItemId || `${getRealProductId(item) || 'item'}-${index}`
);

const isProductInactive = (product = {}) => (
  product.isActive === false
  || product.is_active === false
  || Boolean(product.deletedAt || product.deleted_at || product.deletedTimestamp)
  || PRODUCT_REMOVED_STATUSES.has(String(product.status || '').trim().toLowerCase())
);

const hasRecipe = (product = {}) => Array.isArray(product.recipe) && product.recipe.length > 0;

const isBatchManagedProduct = (product = {}) => Boolean(
  product.batchManagement?.enabled
  || product.batch_management?.enabled
  || String(product.expirationMode || product.expiration_mode || '').trim().toLowerCase() === 'batch'
);

const getInventoryMode = (product = {}) => {
  if (isBatchManagedProduct(product)) return 'batch';
  if (product.trackStock === false && !hasRecipe(product)) return 'unlimited';
  return 'exact';
};

const getExpirationMode = (product = {}) => String(
  product.expirationMode || product.expiration_mode || 'NONE'
).trim().toUpperCase();

const getInventorySignature = (product = {}) => ({
  mode: getInventoryMode(product),
  trackStock: product.trackStock !== false,
  expirationMode: getExpirationMode(product),
  hasRecipe: hasRecipe(product),
  conversionEnabled: product.conversionFactor?.enabled === true,
  conversionFactor: product.conversionFactor?.enabled === true
    ? Number(product.conversionFactor.factor) || null
    : null
});

const signaturesMatch = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const getProductUpdatedAt = (product = {}) => (
  product.updatedAt || product.updated_at || product.modifiedAt || product.modified_at || null
);

const getRequiredQuantityMetadata = (item, product) => {
  const requestedSaleQuantity = toFinitePositiveQuantity(item?.quantity);
  const requiredInventoryQuantity = requestedSaleQuantity
    ? toFinitePositiveQuantity(getInventoryQuantityForSale(item, product))
    : null;

  return {
    requestedSaleQuantity: requestedSaleQuantity ?? (Number(item?.quantity) || 0),
    requiredInventoryQuantity: requiredInventoryQuantity ?? 0,
    requestedQuantity: requiredInventoryQuantity ?? 0,
    valid: Boolean(requestedSaleQuantity && requiredInventoryQuantity)
  };
};

const createResolution = ({
  mode,
  status,
  code = null,
  quantityMetadata,
  availableQuantitySnapshot = null,
  batch = null,
  selectionMode = null,
  resolvedAt = null,
  sourceProductUpdatedAt = null
}) => ({
  mode,
  status,
  code,
  requestedSaleQuantity: quantityMetadata.requestedSaleQuantity,
  requiredInventoryQuantity: quantityMetadata.requiredInventoryQuantity,
  requestedQuantity: quantityMetadata.requestedQuantity,
  availableQuantitySnapshot,
  batchId: batch ? getBatchId(batch) : null,
  batchNumber: batch ? getBatchDisplayCode(batch) : null,
  expirationDate: batch ? extractCalendarDate(getBatchExpiryValue(batch)) : null,
  selectionMode,
  resolvedAt,
  sourceProductUpdatedAt
});

const createConflictLine = ({
  item,
  product,
  mode,
  code,
  quantityMetadata,
  availableQuantitySnapshot = null,
  preserveBatchId = false
}) => ({
  ...item,
  batchId: preserveBatchId ? item?.batchId : undefined,
  needsInventoryResolution: true,
  inventoryResolution: createResolution({
    mode,
    status: 'conflict',
    code,
    quantityMetadata,
    availableQuantitySnapshot,
    sourceProductUpdatedAt: getProductUpdatedAt(product)
  })
});

const buildResolvedLine = ({
  item,
  product,
  mode,
  quantityMetadata,
  availableQuantitySnapshot,
  batch = null,
  selectionMode = null,
  now
}) => ({
  ...item,
  batchId: batch ? getBatchId(batch) : undefined,
  needsInventoryResolution: false,
  inventoryResolution: createResolution({
    mode,
    status: 'resolved',
    quantityMetadata,
    availableQuantitySnapshot,
    batch,
    selectionMode,
    resolvedAt: now.toISOString(),
    sourceProductUpdatedAt: getProductUpdatedAt(product)
  })
});

const getRawStockState = (product = {}) => {
  const stockValue = product.stock;
  const committedValue = product.committedStock ?? product.committed_stock ?? 0;
  const stock = Number(stockValue);
  const committedStock = Number(committedValue);

  if (
    stockValue === null
    || stockValue === undefined
    || stockValue === ''
    || !Number.isFinite(stock)
    || committedValue === null
    || committedValue === ''
    || !Number.isFinite(committedStock)
    || committedStock < 0
  ) {
    return { known: false, available: null };
  }

  return { known: true, available: getAvailableStock(product) };
};

const batchBelongsToProduct = (batch, productId) => String(
  batch?.productId ?? batch?.product_id ?? ''
) === String(productId || '');

const batchNeedsExpiry = (product = {}) => BATCH_EXPIRY_MODES.has(getExpirationMode(product));

const classifyBatch = ({ batch, product, productId, now }) => {
  const available = getAvailableBatchStock(batch);
  const expiryStatus = getBatchExpiryStatus({ expiryDate: getBatchExpiryValue(batch) }, now);
  const belongs = batchBelongsToProduct(batch, productId);
  const active = isBatchActiveForFefo(batch);
  const hasStock = Number.isFinite(available) && available > EPSILON;
  const expired = expiryStatus === 'expired';
  const invalidExpiry = expiryStatus === 'invalid' || (batchNeedsExpiry(product) && expiryStatus === 'missing');
  const valid = belongs && active && hasStock && !expired && !invalidExpiry;

  return {
    batch,
    batchId: getBatchId(batch),
    belongs,
    active,
    available,
    hasStock,
    expiryStatus,
    expired,
    invalidExpiry,
    valid
  };
};

const summarizeBatchCandidates = ({ batches, product, productId, now }) => {
  const classified = (Array.isArray(batches) ? batches : []).map((batch) => classifyBatch({
    batch,
    product,
    productId,
    now
  }));
  const valid = classified.filter((entry) => entry.valid);
  const orderedValidBatches = sortBatchesByFefo(valid.map((entry) => entry.batch));
  const validById = new Map(valid.map((entry) => [String(entry.batchId), entry]));
  const orderedValid = orderedValidBatches
    .map((batch) => validById.get(String(getBatchId(batch))))
    .filter(Boolean);
  const expiredAvailable = classified
    .filter((entry) => entry.belongs && entry.active && entry.hasStock && entry.expired)
    .reduce((sum, entry) => sum + entry.available, 0);

  return { classified, orderedValid, expiredAvailable };
};

const getBatchLedgerKey = (productId, batchId) => `${String(productId || '')}:${String(batchId || '')}`;

const createInventoryLedger = ({ products, batchesByProduct, now }) => {
  const remainingStockByProduct = new Map();
  const remainingStockByBatch = new Map();
  const batchSummariesByProduct = new Map();

  for (const product of products) {
    const productId = product?.id;
    if (!productId) continue;

    if (getInventoryMode(product) === 'exact') {
      const stockState = getRawStockState(product);
      if (stockState.known) remainingStockByProduct.set(String(productId), stockState.available);
    }

    if (getInventoryMode(product) === 'batch') {
      const batches = batchesByProduct instanceof Map
        ? (batchesByProduct.get(productId) || batchesByProduct.get(String(productId)) || [])
        : (batchesByProduct?.[productId] || []);
      const summary = summarizeBatchCandidates({ batches, product, productId, now });
      batchSummariesByProduct.set(String(productId), summary);
      summary.orderedValid.forEach((entry) => {
        remainingStockByBatch.set(getBatchLedgerKey(productId, entry.batchId), entry.available);
      });
    }
  }

  return {
    remainingStockByProduct,
    remainingStockByBatch,
    batchSummariesByProduct
  };
};

const getRemainingBatchQuantity = (ledger, productId, batchId) => (
  ledger.remainingStockByBatch.get(getBatchLedgerKey(productId, batchId)) || 0
);

const consumeBatchQuantity = (ledger, productId, batchId, quantity) => {
  const key = getBatchLedgerKey(productId, batchId);
  const available = ledger.remainingStockByBatch.get(key) || 0;
  ledger.remainingStockByBatch.set(key, Math.max(0, available - quantity));
};

const isManualBatchSelection = (item = {}) => Boolean(
  item.batchId
  && item.inventoryResolution?.selectionMode === 'manual'
);

const resolveLineWithLedger = ({ item, product, batches = [], now, ledger }) => {
  const productId = getRealProductId(item);
  const previousResolution = item?.inventoryResolution || null;
  const fallbackMode = previousResolution?.mode || getInventoryMode(item || {});
  const quantityMetadata = getRequiredQuantityMetadata(item, product || item);

  if (!quantityMetadata.valid) {
    return createConflictLine({
      item,
      product,
      mode: fallbackMode,
      code: 'INVENTORY_UNKNOWN',
      quantityMetadata
    });
  }

  if (!product) {
    return createConflictLine({
      item,
      product: null,
      mode: fallbackMode,
      code: 'PRODUCT_MISSING',
      quantityMetadata
    });
  }

  if (isProductInactive(product)) {
    return createConflictLine({
      item,
      product,
      mode: getInventoryMode(product),
      code: 'PRODUCT_INACTIVE',
      quantityMetadata
    });
  }

  const currentSignature = getInventorySignature(product);
  const itemSignature = getInventorySignature(item || {});
  if (!signaturesMatch(itemSignature, currentSignature)) {
    return createConflictLine({
      item,
      product,
      mode: currentSignature.mode,
      code: 'INVENTORY_MODE_CHANGED',
      quantityMetadata
    });
  }

  const mode = currentSignature.mode;
  if (mode === 'unlimited') {
    return buildResolvedLine({
      item,
      product,
      mode,
      quantityMetadata,
      availableQuantitySnapshot: null,
      now
    });
  }

  if (mode === 'exact') {
    if (hasRecipe(product)) {
      return createConflictLine({
        item,
        product,
        mode,
        code: 'INVENTORY_UNKNOWN',
        quantityMetadata
      });
    }

    const stockState = getRawStockState(product);
    if (!stockState.known) {
      return createConflictLine({
        item,
        product,
        mode,
        code: 'INVENTORY_UNKNOWN',
        quantityMetadata
      });
    }

    const ledgerKey = String(productId);
    if (!ledger.remainingStockByProduct.has(ledgerKey)) {
      ledger.remainingStockByProduct.set(ledgerKey, stockState.available);
    }
    const available = ledger.remainingStockByProduct.get(ledgerKey) || 0;
    const required = quantityMetadata.requiredInventoryQuantity;

    if (available + EPSILON < required) {
      return createConflictLine({
        item,
        product,
        mode,
        code: 'INSUFFICIENT_STOCK',
        quantityMetadata,
        availableQuantitySnapshot: available
      });
    }

    ledger.remainingStockByProduct.set(ledgerKey, Math.max(0, available - required));
    return buildResolvedLine({
      item,
      product,
      mode,
      quantityMetadata,
      availableQuantitySnapshot: available,
      now
    });
  }

  const summary = ledger.batchSummariesByProduct.get(String(productId))
    || summarizeBatchCandidates({ batches, product, productId, now });
  const required = quantityMetadata.requiredInventoryQuantity;
  const selectedBatchId = isManualBatchSelection(item)
    ? (item.batchId || previousResolution?.batchId)
    : null;

  if (selectedBatchId) {
    const selected = summary.classified.find((entry) => String(entry.batchId) === String(selectedBatchId));
    const remaining = selected ? getRemainingBatchQuantity(ledger, productId, selectedBatchId) : 0;

    if (!selected || !selected.valid || remaining + EPSILON < required) {
      return createConflictLine({
        item,
        product,
        mode,
        code: 'BATCH_STALE',
        quantityMetadata,
        availableQuantitySnapshot: remaining,
        preserveBatchId: true
      });
    }

    consumeBatchQuantity(ledger, productId, selectedBatchId, required);
    return buildResolvedLine({
      item,
      product,
      mode,
      quantityMetadata,
      availableQuantitySnapshot: remaining,
      batch: selected.batch,
      selectionMode: 'manual',
      now
    });
  }

  const singleBatch = summary.orderedValid.find((entry) => (
    getRemainingBatchQuantity(ledger, productId, entry.batchId) + EPSILON >= required
  ));
  if (singleBatch) {
    const available = getRemainingBatchQuantity(ledger, productId, singleBatch.batchId);
    consumeBatchQuantity(ledger, productId, singleBatch.batchId, required);
    return buildResolvedLine({
      item,
      product,
      mode,
      quantityMetadata,
      availableQuantitySnapshot: available,
      batch: singleBatch.batch,
      selectionMode: 'fefo_auto',
      now
    });
  }

  if (summary.orderedValid.length === 0) {
    return createConflictLine({
      item,
      product,
      mode,
      code: summary.expiredAvailable > EPSILON ? 'ONLY_EXPIRED_BATCHES' : 'NO_VALID_BATCH',
      quantityMetadata,
      availableQuantitySnapshot: 0
    });
  }

  const totalRemaining = summary.orderedValid.reduce((sum, entry) => (
    sum + getRemainingBatchQuantity(ledger, productId, entry.batchId)
  ), 0);

  if (totalRemaining + EPSILON < required) {
    return createConflictLine({
      item,
      product,
      mode,
      code: 'INSUFFICIENT_BATCH_STOCK',
      quantityMetadata,
      availableQuantitySnapshot: totalRemaining
    });
  }

  return createConflictLine({
    item,
    product,
    mode,
    code: 'MULTI_BATCH_REQUIRED',
    quantityMetadata,
    availableQuantitySnapshot: totalRemaining
  });
};

export const resolveEcommerceDraftLineInventory = ({
  item,
  product,
  batches = [],
  now = new Date()
} = {}) => {
  const productId = product?.id || getRealProductId(item);
  const products = product ? [product] : [];
  const batchesByProduct = new Map([[productId, batches]]);
  const ledger = createInventoryLedger({ products, batchesByProduct, now });
  return resolveLineWithLedger({ item, product, batches, now, ledger });
};

export const calculateEcommerceInventoryStatus = (items = []) => {
  const resolutions = (Array.isArray(items) ? items : []).map((item) => item?.inventoryResolution);
  if (resolutions.some((resolution) => resolution?.status === 'conflict')) return 'conflict';
  if (resolutions.length === 0 || resolutions.some((resolution) => resolution?.status !== 'resolved')) return 'pending';
  return 'ready';
};

export const resolveEcommerceDraftInventoryFromInputs = ({
  order,
  products = [],
  batchesByProduct = new Map(),
  now = new Date()
} = {}) => {
  const productMap = new Map((Array.isArray(products) ? products : []).map((product) => [String(product?.id || ''), product]));
  const records = (Array.isArray(order?.items) ? order.items : []).map((item, index) => {
    const productId = getRealProductId(item);
    const product = productMap.get(String(productId || '')) || null;
    const batches = batchesByProduct instanceof Map
      ? (batchesByProduct.get(productId) || batchesByProduct.get(String(productId || '')) || [])
      : (batchesByProduct?.[productId] || []);
    return { index, item, product, productId, batches };
  });
  const ledger = createInventoryLedger({ products, batchesByProduct, now });
  const items = new Array(records.length);
  const manualBatchRecords = records.filter(({ item, product }) => (
    getInventoryMode(product || item) === 'batch' && isManualBatchSelection(item)
  ));
  const manualIndexes = new Set(manualBatchRecords.map(({ index }) => index));
  const processingOrder = [
    ...manualBatchRecords,
    ...records.filter(({ index }) => !manualIndexes.has(index))
  ];

  processingOrder.forEach((record) => {
    items[record.index] = resolveLineWithLedger({
      item: record.item,
      product: record.product,
      batches: record.batches,
      now,
      ledger
    });
  });

  const ecommerceInventoryStatus = calculateEcommerceInventoryStatus(items);
  const ecommerceInventoryConflictCount = items.filter((item) => item?.inventoryResolution?.status === 'conflict').length;

  return {
    items,
    ecommerceInventoryStatus,
    ecommerceInventoryConflictCount,
    ecommerceInventoryResolutionVersion: ECOMMERCE_INVENTORY_RESOLUTION_VERSION,
    ecommerceInventoryResolvedAt: ecommerceInventoryStatus === 'ready' ? now.toISOString() : null,
    ecommerceInventoryError: null
  };
};

const loadProductsForOrder = async ({ order, products, db, STORES }) => {
  const productMap = new Map((Array.isArray(products) ? products : []).map((product) => [String(product?.id || ''), product]));
  const missingIds = Array.from(new Set((order?.items || [])
    .map(getRealProductId)
    .filter((productId) => productId && !productMap.has(String(productId)))));

  if (missingIds.length > 0 && db && STORES?.MENU) {
    const loaded = await db.table(STORES.MENU).bulkGet(missingIds);
    (loaded || []).filter(Boolean).forEach((product) => productMap.set(String(product.id), product));
  }

  return Array.from(productMap.values());
};

const loadBatchesForProducts = async ({ products, queryBatchesByProduct }) => {
  const batchesByProduct = new Map();
  const batchProductIds = products.filter(isBatchManagedProduct).map((product) => product.id).filter(Boolean);
  await Promise.all(batchProductIds.map(async (productId) => {
    const batches = await queryBatchesByProduct(productId);
    batchesByProduct.set(productId, Array.isArray(batches) ? batches : []);
  }));
  return batchesByProduct;
};

export const resolveEcommerceDraftInventory = async ({ order, now = new Date(), deps = {} } = {}) => {
  const db = deps.db || defaultDb;
  const STORES = deps.STORES || DEFAULT_STORES;
  const products = typeof deps.loadProductsForOrder === 'function'
    ? await deps.loadProductsForOrder(order)
    : await loadProductsForOrder({
      order,
      products: deps.products || useProductStore.getState().menu,
      db,
      STORES
    });
  const queryBatchesByProduct = deps.queryBatchesByProduct || (async (productId) => (
    db.table(STORES.PRODUCT_BATCHES).where('productId').equals(productId).toArray()
  ));
  const batchesByProduct = await loadBatchesForProducts({ products, queryBatchesByProduct });
  return resolveEcommerceDraftInventoryFromInputs({ order, products, batchesByProduct, now });
};

const normalizeRevision = (value) => {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
};

const getRelevantLineSignature = (order = {}) => JSON.stringify((order.items || []).map((item, index) => ({
  lineId: getLineId(item, index),
  productId: getRealProductId(item),
  quantity: item.quantity,
  batchId: item.batchId || null,
  selectionMode: item.inventoryResolution?.selectionMode || null,
  conversionEnabled: item.conversionFactor?.enabled === true,
  conversionFactor: item.conversionFactor?.enabled === true
    ? Number(item.conversionFactor.factor) || null
    : null
})));

const captureOrderExpectation = (order = {}) => ({
  expectedRevision: normalizeRevision(order.revision),
  expectedUpdatedAt: order.updatedAt || null,
  expectedLineSignature: getRelevantLineSignature(order)
});

const createAttempt = (orderId) => {
  attemptSequence += 1;
  const attemptId = `${String(orderId)}:${attemptSequence}`;
  inventoryResolutionAttempts.set(orderId, attemptId);
  return attemptId;
};

const staleResult = () => ({
  success: false,
  stale: true,
  changed: false,
  code: ECOMMERCE_INVENTORY_STALE_RESPONSE
});

const getActiveOrdersState = (deps = {}) => {
  if (typeof deps.getActiveOrdersState === 'function') return deps.getActiveOrdersState();
  if (deps.activeOrders) return deps.activeOrders;
  return useActiveOrders.getState();
};

const getContextIdentity = (deps = {}) => (
  typeof deps.getContextIdentity === 'function'
    ? deps.getContextIdentity()
    : getEcommercePosContextIdentity()
);

const isExpectedOrderCurrent = ({ order, orderId, expectation = {}, attemptId, deps = {} }) => {
  if (!order) return false;
  if (order.origin !== 'ecommerce' || order.ecommerceDraftStatus !== 'prepared') return false;
  if (!order.ecommerceLicenseIdentity || order.ecommerceLicenseIdentity !== getContextIdentity(deps)) return false;
  if (attemptId && inventoryResolutionAttempts.get(orderId) !== attemptId) return false;
  if (
    expectation.expectedRevision !== undefined
    && normalizeRevision(order.revision) !== normalizeRevision(expectation.expectedRevision)
  ) return false;
  if (
    expectation.expectedUpdatedAt !== undefined
    && String(order.updatedAt || '') !== String(expectation.expectedUpdatedAt || '')
  ) return false;
  if (
    expectation.expectedLineSignature
    && getRelevantLineSignature(order) !== expectation.expectedLineSignature
  ) return false;
  return true;
};

const comparableResolution = (resolution = null) => resolution ? {
  mode: resolution.mode || null,
  status: resolution.status || null,
  code: resolution.code || null,
  requestedSaleQuantity: resolution.requestedSaleQuantity ?? null,
  requiredInventoryQuantity: resolution.requiredInventoryQuantity ?? null,
  requestedQuantity: resolution.requestedQuantity ?? null,
  availableQuantitySnapshot: resolution.availableQuantitySnapshot ?? null,
  batchId: resolution.batchId || null,
  batchNumber: resolution.batchNumber || null,
  expirationDate: resolution.expirationDate || null,
  selectionMode: resolution.selectionMode || null,
  sourceProductUpdatedAt: resolution.sourceProductUpdatedAt || null
} : null;

const comparableResult = (order = {}) => ({
  ecommerceInventoryStatus: order.ecommerceInventoryStatus || 'pending',
  ecommerceInventoryConflictCount: Number(order.ecommerceInventoryConflictCount) || 0,
  ecommerceInventoryResolutionVersion: order.ecommerceInventoryResolutionVersion || null,
  ecommerceInventoryError: order.ecommerceInventoryError || null,
  items: (order.items || []).map((item) => ({
    lineId: item.lineId || item.uniqueLineId || null,
    batchId: item.batchId || null,
    needsInventoryResolution: Boolean(item.needsInventoryResolution),
    inventoryResolution: comparableResolution(item.inventoryResolution)
  }))
});

export const applyEcommerceInventoryResolution = ({
  orderId,
  resolution,
  expectedRevision,
  expectedUpdatedAt,
  expectedLineSignature,
  attemptId,
  deps = {}
} = {}) => {
  const expectation = { expectedRevision, expectedUpdatedAt, expectedLineSignature };
  const activeOrders = getActiveOrdersState(deps);
  const order = activeOrders.activeOrders?.get(orderId);
  const guarded = attemptId
    || expectedRevision !== undefined
    || expectedUpdatedAt !== undefined
    || expectedLineSignature;

  if (guarded && !isExpectedOrderCurrent({ order, orderId, expectation, attemptId, deps })) {
    return staleResult();
  }
  if (!order || order.origin !== 'ecommerce' || order.ecommerceDraftStatus !== 'prepared') {
    return { success: false, changed: false, code: 'ECOMMERCE_INVENTORY_DRAFT_INVALID' };
  }
  if (!order.ecommerceLicenseIdentity || order.ecommerceLicenseIdentity !== getContextIdentity(deps)) {
    return { success: false, changed: false, code: 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' };
  }

  const nextOrder = { ...order, ...resolution };
  if (JSON.stringify(comparableResult(order)) === JSON.stringify(comparableResult(nextOrder))) {
    return { success: true, changed: false, order };
  }

  activeOrders.updateOrder(orderId, resolution);
  return {
    success: true,
    changed: true,
    order: getActiveOrdersState(deps).activeOrders?.get(orderId) || nextOrder
  };
};

export const markEcommerceInventoryReadFailure = ({
  orderId,
  expectedRevision,
  expectedUpdatedAt,
  expectedLineSignature,
  attemptId,
  error,
  now = new Date(),
  deps = {}
} = {}) => {
  const activeOrders = getActiveOrdersState(deps);
  const order = activeOrders.activeOrders?.get(orderId);
  const expectation = { expectedRevision, expectedUpdatedAt, expectedLineSignature };
  if (!isExpectedOrderCurrent({ order, orderId, expectation, attemptId, deps })) {
    return staleResult();
  }

  const items = (order.items || []).map((item) => {
    const previous = item.inventoryResolution || {};
    const quantityMetadata = {
      requestedSaleQuantity: previous.requestedSaleQuantity ?? (Number(item.quantity) || 0),
      requiredInventoryQuantity: previous.requiredInventoryQuantity ?? previous.requestedQuantity ?? (Number(item.quantity) || 0),
      requestedQuantity: previous.requestedQuantity ?? previous.requiredInventoryQuantity ?? (Number(item.quantity) || 0)
    };
    return {
      ...item,
      needsInventoryResolution: true,
      inventoryResolution: {
        ...previous,
        mode: previous.mode || getInventoryMode(item),
        status: 'conflict',
        code: 'INVENTORY_READ_FAILED',
        ...quantityMetadata,
        resolvedAt: null
      }
    };
  });
  const message = READ_FAILURE_MESSAGE;
  const resolution = {
    items,
    ecommerceInventoryStatus: 'conflict',
    ecommerceInventoryResolvedAt: null,
    ecommerceInventoryConflictCount: Math.max(
      1,
      Number(order.ecommerceInventoryConflictCount) || 0,
      items.length
    ),
    ecommerceInventoryResolutionVersion: ECOMMERCE_INVENTORY_RESOLUTION_VERSION,
    ecommerceInventoryError: {
      code: 'INVENTORY_READ_FAILED',
      message,
      occurredAt: now.toISOString(),
      detail: error?.message || null
    }
  };
  const applied = applyEcommerceInventoryResolution({
    orderId,
    resolution,
    expectedRevision,
    expectedUpdatedAt,
    expectedLineSignature,
    attemptId,
    deps
  });

  if (applied.stale) return applied;
  return {
    success: false,
    changed: applied.changed,
    code: ECOMMERCE_INVENTORY_READ_FAILED,
    message,
    order: applied.order
  };
};

export const revalidateEcommerceDraftInventory = async ({ orderId, now = new Date(), deps = {} } = {}) => {
  const activeOrders = getActiveOrdersState(deps);
  const order = activeOrders.activeOrders?.get(orderId);
  if (!order) return { success: false, changed: false, code: 'ECOMMERCE_INVENTORY_DRAFT_INVALID' };
  if (
    order.origin !== 'ecommerce'
    || order.ecommerceDraftStatus !== 'prepared'
    || !order.ecommerceLicenseIdentity
    || order.ecommerceLicenseIdentity !== getContextIdentity(deps)
  ) {
    return { success: false, changed: false, code: 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' };
  }

  const expectation = captureOrderExpectation(order);
  const attemptId = createAttempt(orderId);

  try {
    const resolution = await resolveEcommerceDraftInventory({ order, now, deps });
    return {
      ...applyEcommerceInventoryResolution({
        orderId,
        resolution,
        ...expectation,
        attemptId,
        deps
      }),
      resolution
    };
  } catch (error) {
    return markEcommerceInventoryReadFailure({
      orderId,
      ...expectation,
      attemptId,
      error,
      now,
      deps
    });
  }
};

const loadOrderInventoryInputs = async ({ order, deps = {} }) => {
  const db = deps.db || defaultDb;
  const STORES = deps.STORES || DEFAULT_STORES;
  const products = typeof deps.loadProductsForOrder === 'function'
    ? await deps.loadProductsForOrder(order)
    : await loadProductsForOrder({
      order,
      products: deps.products || useProductStore.getState().menu,
      db,
      STORES
    });
  const queryBatchesByProduct = deps.queryBatchesByProduct || (async (productId) => (
    db.table(STORES.PRODUCT_BATCHES).where('productId').equals(productId).toArray()
  ));
  const batchesByProduct = await loadBatchesForProducts({ products, queryBatchesByProduct });
  return { products, batchesByProduct };
};

export const getEcommerceDraftBatchOptions = async ({ orderId, lineId, now = new Date(), deps = {} } = {}) => {
  const activeOrders = getActiveOrdersState(deps);
  const order = activeOrders.activeOrders?.get(orderId);
  const itemIndex = order?.items?.findIndex((entry, index) => String(getLineId(entry, index)) === String(lineId)) ?? -1;
  if (!order || itemIndex < 0) return { success: false, code: 'ECOMMERCE_INVENTORY_LINE_NOT_FOUND', options: [] };

  const { products, batchesByProduct } = await loadOrderInventoryInputs({ order, deps });
  const productMap = new Map(products.map((product) => [String(product.id), product]));
  const item = order.items[itemIndex];
  const productId = getRealProductId(item);
  const product = productMap.get(String(productId)) || null;
  if (!product || !isBatchManagedProduct(product)) {
    return { success: false, code: 'ECOMMERCE_INVENTORY_BATCH_NOT_APPLICABLE', options: [] };
  }

  const ledger = createInventoryLedger({ products, batchesByProduct, now });
  (order.items || []).forEach((entry, index) => {
    if (index === itemIndex || !isManualBatchSelection(entry)) return;
    const entryProductId = getRealProductId(entry);
    const entryProduct = productMap.get(String(entryProductId)) || null;
    const entryBatches = batchesByProduct.get(entryProductId) || batchesByProduct.get(String(entryProductId)) || [];
    resolveLineWithLedger({ item: entry, product: entryProduct, batches: entryBatches, now, ledger });
  });

  const quantityMetadata = getRequiredQuantityMetadata(item, product);
  const summary = ledger.batchSummariesByProduct.get(String(productId))
    || summarizeBatchCandidates({
      batches: batchesByProduct.get(productId) || batchesByProduct.get(String(productId)) || [],
      product,
      productId,
      now
    });
  const recommendedId = summary.orderedValid.find((entry) => (
    getRemainingBatchQuantity(ledger, productId, entry.batchId) > EPSILON
  ))?.batchId || null;
  const options = summary.orderedValid.map((entry) => {
    const availableQuantity = getRemainingBatchQuantity(ledger, productId, entry.batchId);
    return {
      batchId: entry.batchId,
      batchNumber: getBatchDisplayCode(entry.batch),
      expirationDate: extractCalendarDate(getBatchExpiryValue(entry.batch)),
      availableQuantity,
      isRecommended: Boolean(recommendedId && String(recommendedId) === String(entry.batchId)),
      canCoverRequested: availableQuantity + EPSILON >= quantityMetadata.requiredInventoryQuantity,
      requestedSaleQuantity: quantityMetadata.requestedSaleQuantity,
      requiredInventoryQuantity: quantityMetadata.requiredInventoryQuantity
    };
  });

  return { success: true, product, item, options };
};

export const selectEcommerceDraftBatch = async ({
  orderId,
  lineId,
  batchId,
  now = new Date(),
  deps = {}
} = {}) => {
  const activeOrders = getActiveOrdersState(deps);
  const order = activeOrders.activeOrders?.get(orderId);
  const itemIndex = order?.items?.findIndex((entry, index) => String(getLineId(entry, index)) === String(lineId)) ?? -1;
  if (!order || itemIndex < 0) return { success: false, changed: false, code: 'ECOMMERCE_INVENTORY_LINE_NOT_FOUND' };
  if (
    order.origin !== 'ecommerce'
    || order.ecommerceDraftStatus !== 'prepared'
    || !order.ecommerceLicenseIdentity
    || order.ecommerceLicenseIdentity !== getContextIdentity(deps)
  ) {
    return { success: false, changed: false, code: 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' };
  }

  const expectation = captureOrderExpectation(order);
  const attemptId = createAttempt(orderId);
  const candidateOrder = {
    ...order,
    items: order.items.map((entry, index) => (
      index === itemIndex
        ? {
          ...entry,
          batchId,
          needsInventoryResolution: true,
          inventoryResolution: {
            ...entry.inventoryResolution,
            mode: 'batch',
            status: 'pending',
            code: null,
            batchId,
            selectionMode: 'manual',
            resolvedAt: null
          }
        }
        : entry
    ))
  };

  try {
    const resolution = await resolveEcommerceDraftInventory({ order: candidateOrder, now, deps });
    const selectedLine = resolution.items[itemIndex];
    if (!isExpectedOrderCurrent({
      order: getActiveOrdersState(deps).activeOrders?.get(orderId),
      orderId,
      expectation,
      attemptId,
      deps
    })) {
      return staleResult();
    }
    if (
      selectedLine?.inventoryResolution?.status !== 'resolved'
      || selectedLine.inventoryResolution.selectionMode !== 'manual'
      || String(selectedLine.batchId || '') !== String(batchId || '')
    ) {
      return {
        success: false,
        changed: false,
        code: selectedLine?.inventoryResolution?.code || 'BATCH_STALE'
      };
    }

    return {
      ...applyEcommerceInventoryResolution({
        orderId,
        resolution,
        ...expectation,
        attemptId,
        deps
      }),
      resolution
    };
  } catch (error) {
    return markEcommerceInventoryReadFailure({
      orderId,
      ...expectation,
      attemptId,
      error,
      now,
      deps
    });
  }
};

const formatQuantity = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? 0);
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(4)));
};

const getConversionCopy = (resolution = {}) => {
  const sale = Number(resolution.requestedSaleQuantity);
  const inventory = Number(resolution.requiredInventoryQuantity);
  if (!Number.isFinite(sale) || !Number.isFinite(inventory) || Math.abs(sale - inventory) <= EPSILON) return '';
  return `${formatQuantity(sale)} unidades vendidas · ${formatQuantity(inventory)} unidad${inventory === 1 ? '' : 'es'} de inventario requerida${inventory === 1 ? '' : 's'}`;
};

export const getEcommerceInventoryLineMessage = (item = {}) => {
  const resolution = item.inventoryResolution || {};
  const available = resolution.availableQuantitySnapshot;
  const requested = resolution.requiredInventoryQuantity ?? resolution.requestedQuantity ?? item.quantity;
  const conversionCopy = getConversionCopy(resolution);
  const withConversion = (message) => conversionCopy ? `${message} · ${conversionCopy}` : message;

  if (resolution.status === 'resolved' && resolution.mode === 'unlimited') {
    return withConversion('Inventario: Sin control de existencias');
  }
  if (resolution.status === 'resolved' && resolution.mode === 'exact') {
    return withConversion(`Existencia suficiente: ${formatQuantity(available)} disponibles / ${formatQuantity(requested)} requeridos`);
  }
  if (resolution.status === 'resolved' && resolution.mode === 'batch') {
    const prefix = resolution.selectionMode === 'manual' ? 'Lote seleccionado' : 'Lote FEFO asignado';
    const expiry = resolution.expirationDate ? ` · Caduca ${resolution.expirationDate}` : '';
    return withConversion(`${prefix}: ${resolution.batchNumber || resolution.batchId}${expiry} · ${formatQuantity(available)} disponibles`);
  }

  const messages = {
    INSUFFICIENT_STOCK: `Sin existencia suficiente: ${formatQuantity(available ?? 0)} disponibles / ${formatQuantity(requested)} requeridos`,
    INVENTORY_UNKNOWN: 'La existencia actual es desconocida. Revisa el producto antes de continuar.',
    INVENTORY_READ_FAILED: READ_FAILURE_MESSAGE,
    NO_VALID_BATCH: 'No hay un lote vigente con existencia para este producto.',
    ONLY_EXPIRED_BATCHES: 'El producto solo tiene lotes vencidos. No puede prepararse para venta.',
    INSUFFICIENT_BATCH_STOCK: 'Los lotes vigentes no cubren la cantidad solicitada.',
    MULTI_BATCH_REQUIRED: 'La existencia total alcanza, pero se encuentra distribuida en varios lotes.',
    BATCH_STALE: 'El lote seleccionado ya no es válido o no tiene existencia suficiente. Resuelve nuevamente el inventario.',
    PRODUCT_MISSING: 'El producto ya no existe en el catálogo local.',
    PRODUCT_INACTIVE: 'El producto está inactivo y no puede prepararse para venta.',
    INVENTORY_MODE_CHANGED: 'La configuración de inventario del producto cambió después del pedido.',
    PRODUCT_STALE: 'El producto cambió después del pedido. Revisa su inventario.'
  };
  return withConversion(messages[resolution.code] || 'Inventario pendiente de resolver.');
};

export const resetEcommerceInventoryResolutionAttemptsForTests = () => {
  inventoryResolutionAttempts.clear();
  attemptSequence = 0;
};
