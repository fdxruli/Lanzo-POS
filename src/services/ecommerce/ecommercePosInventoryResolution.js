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
import { extractCalendarDate, getBatchExpiryStatus } from '../../utils/dateUtils';
import { getEcommercePosContextIdentity } from './ecommercePosDraftService';

export const ECOMMERCE_INVENTORY_RESOLUTION_VERSION = 1;

export const ECOMMERCE_INVENTORY_STATUS = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  CONFLICT: 'conflict'
});

const PRODUCT_REMOVED_STATUSES = new Set(['inactive', 'deleted', 'archived']);
const BATCH_EXPIRY_MODES = new Set(['STRICT', 'SHELF_LIFE', 'BATCH']);
const EPSILON = 0.0001;

const toFinitePositiveQuantity = (value) => {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
};

const getRealProductId = (item = {}) => item.parentId || item.id || null;

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

const createResolution = ({
  mode,
  status,
  code = null,
  requestedQuantity,
  availableQuantitySnapshot = null,
  batch = null,
  selectionMode = null,
  resolvedAt = null,
  sourceProductUpdatedAt = null
}) => ({
  mode,
  status,
  code,
  requestedQuantity,
  availableQuantitySnapshot,
  batchId: batch ? getBatchId(batch) : null,
  batchNumber: batch ? getBatchDisplayCode(batch) : null,
  expirationDate: batch ? extractCalendarDate(getBatchExpiryValue(batch)) : null,
  selectionMode,
  resolvedAt,
  sourceProductUpdatedAt
});

const createConflictLine = ({ item, product, mode, code, requestedQuantity, availableQuantitySnapshot = null }) => ({
  ...item,
  batchId: undefined,
  needsInventoryResolution: true,
  inventoryResolution: createResolution({
    mode,
    status: 'conflict',
    code,
    requestedQuantity,
    availableQuantitySnapshot,
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

const classifyBatch = ({ batch, product, productId, requestedQuantity, now }) => {
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
    valid,
    coversRequested: valid && available + EPSILON >= requestedQuantity
  };
};

const summarizeBatchCandidates = ({ batches, product, productId, requestedQuantity, now }) => {
  const classified = (Array.isArray(batches) ? batches : []).map((batch) => classifyBatch({
    batch,
    product,
    productId,
    requestedQuantity,
    now
  }));
  const valid = classified.filter((entry) => entry.valid);
  const orderedValidBatches = sortBatchesByFefo(valid.map((entry) => entry.batch));
  const validById = new Map(valid.map((entry) => [String(entry.batchId), entry]));
  const orderedValid = orderedValidBatches.map((batch) => validById.get(String(getBatchId(batch)))).filter(Boolean);
  const available = orderedValid.reduce((sum, entry) => sum + entry.available, 0);
  const expiredAvailable = classified
    .filter((entry) => entry.belongs && entry.active && entry.hasStock && entry.expired)
    .reduce((sum, entry) => sum + entry.available, 0);

  return { classified, orderedValid, available, expiredAvailable };
};

const buildResolvedLine = ({ item, product, mode, requestedQuantity, availableQuantitySnapshot, batch = null, selectionMode = null, now }) => ({
  ...item,
  batchId: batch ? getBatchId(batch) : undefined,
  needsInventoryResolution: false,
  inventoryResolution: createResolution({
    mode,
    status: 'resolved',
    requestedQuantity,
    availableQuantitySnapshot,
    batch,
    selectionMode,
    resolvedAt: now.toISOString(),
    sourceProductUpdatedAt: getProductUpdatedAt(product)
  })
});

export const resolveEcommerceDraftLineInventory = ({
  item,
  product,
  batches = [],
  now = new Date()
} = {}) => {
  const requestedQuantity = toFinitePositiveQuantity(item?.quantity);
  const productId = getRealProductId(item);
  const previousResolution = item?.inventoryResolution || null;
  const fallbackMode = previousResolution?.mode || getInventoryMode(item || {});

  if (!requestedQuantity) {
    return createConflictLine({
      item,
      product,
      mode: fallbackMode,
      code: 'INVENTORY_UNKNOWN',
      requestedQuantity: Number(item?.quantity) || 0
    });
  }

  if (!product) {
    return createConflictLine({
      item,
      product: null,
      mode: fallbackMode,
      code: 'PRODUCT_MISSING',
      requestedQuantity
    });
  }

  if (isProductInactive(product)) {
    return createConflictLine({
      item,
      product,
      mode: getInventoryMode(product),
      code: 'PRODUCT_INACTIVE',
      requestedQuantity
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
      requestedQuantity
    });
  }

  const mode = currentSignature.mode;
  if (mode === 'unlimited') {
    return buildResolvedLine({
      item,
      product,
      mode,
      requestedQuantity,
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
        requestedQuantity
      });
    }

    const stockState = getRawStockState(product);
    if (!stockState.known) {
      return createConflictLine({
        item,
        product,
        mode,
        code: 'INVENTORY_UNKNOWN',
        requestedQuantity
      });
    }

    if (stockState.available + EPSILON < requestedQuantity) {
      return createConflictLine({
        item,
        product,
        mode,
        code: 'INSUFFICIENT_STOCK',
        requestedQuantity,
        availableQuantitySnapshot: stockState.available
      });
    }

    return buildResolvedLine({
      item,
      product,
      mode,
      requestedQuantity,
      availableQuantitySnapshot: stockState.available,
      now
    });
  }

  const summary = summarizeBatchCandidates({ batches, product, productId, requestedQuantity, now });
  const selectedBatchId = item?.batchId || previousResolution?.batchId || null;
  if (selectedBatchId) {
    const selected = summary.classified.find((entry) => String(entry.batchId) === String(selectedBatchId));
    if (!selected || !selected.valid || !selected.coversRequested) {
      return createConflictLine({
        item,
        product,
        mode,
        code: 'BATCH_STALE',
        requestedQuantity,
        availableQuantitySnapshot: selected?.available ?? 0
      });
    }

    return buildResolvedLine({
      item,
      product,
      mode,
      requestedQuantity,
      availableQuantitySnapshot: selected.available,
      batch: selected.batch,
      selectionMode: previousResolution?.selectionMode === 'manual' ? 'manual' : 'fefo_auto',
      now
    });
  }

  const singleBatch = summary.orderedValid.find((entry) => entry.coversRequested);
  if (singleBatch) {
    return buildResolvedLine({
      item,
      product,
      mode,
      requestedQuantity,
      availableQuantitySnapshot: singleBatch.available,
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
      requestedQuantity,
      availableQuantitySnapshot: 0
    });
  }

  if (summary.available + EPSILON < requestedQuantity) {
    return createConflictLine({
      item,
      product,
      mode,
      code: 'INSUFFICIENT_BATCH_STOCK',
      requestedQuantity,
      availableQuantitySnapshot: summary.available
    });
  }

  return createConflictLine({
    item,
    product,
    mode,
    code: 'MULTI_BATCH_REQUIRED',
    requestedQuantity,
    availableQuantitySnapshot: summary.available
  });
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
  const items = (Array.isArray(order?.items) ? order.items : []).map((item) => {
    const productId = getRealProductId(item);
    const product = productMap.get(String(productId || '')) || null;
    const batches = batchesByProduct instanceof Map
      ? (batchesByProduct.get(productId) || batchesByProduct.get(String(productId || '')) || [])
      : (batchesByProduct?.[productId] || []);
    return resolveEcommerceDraftLineInventory({ item, product, batches, now });
  });
  const ecommerceInventoryStatus = calculateEcommerceInventoryStatus(items);
  const ecommerceInventoryConflictCount = items.filter((item) => item?.inventoryResolution?.status === 'conflict').length;

  return {
    items,
    ecommerceInventoryStatus,
    ecommerceInventoryConflictCount,
    ecommerceInventoryResolutionVersion: ECOMMERCE_INVENTORY_RESOLUTION_VERSION,
    ecommerceInventoryResolvedAt: ecommerceInventoryStatus === 'ready' ? now.toISOString() : null
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
  const products = await loadProductsForOrder({
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

const comparableResolution = (resolution = null) => resolution ? {
  mode: resolution.mode || null,
  status: resolution.status || null,
  code: resolution.code || null,
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
  deps = {}
} = {}) => {
  const activeOrders = deps.activeOrders || useActiveOrders.getState();
  const getContextIdentity = deps.getContextIdentity || (() => getEcommercePosContextIdentity());
  const order = activeOrders.activeOrders?.get(orderId);

  if (!order || order.origin !== 'ecommerce' || order.ecommerceDraftStatus !== 'prepared') {
    return { success: false, code: 'ECOMMERCE_INVENTORY_DRAFT_INVALID' };
  }
  if (!order.ecommerceLicenseIdentity || order.ecommerceLicenseIdentity !== getContextIdentity()) {
    return { success: false, code: 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' };
  }

  const nextOrder = { ...order, ...resolution };
  if (JSON.stringify(comparableResult(order)) === JSON.stringify(comparableResult(nextOrder))) {
    return { success: true, changed: false, order };
  }

  activeOrders.updateOrder(orderId, resolution);
  return {
    success: true,
    changed: true,
    order: activeOrders.activeOrders?.get(orderId) || nextOrder
  };
};

export const revalidateEcommerceDraftInventory = async ({ orderId, now = new Date(), deps = {} } = {}) => {
  const activeOrders = deps.activeOrders || useActiveOrders.getState();
  const order = activeOrders.activeOrders?.get(orderId);
  if (!order) return { success: false, code: 'ECOMMERCE_INVENTORY_DRAFT_INVALID' };

  try {
    const resolution = await resolveEcommerceDraftInventory({ order, now, deps });
    return {
      ...applyEcommerceInventoryResolution({ orderId, resolution, deps: { ...deps, activeOrders } }),
      resolution
    };
  } catch (error) {
    return {
      success: false,
      code: 'ECOMMERCE_INVENTORY_READ_FAILED',
      message: error?.message || 'No se pudo leer el inventario local.'
    };
  }
};

export const getEcommerceDraftBatchOptions = async ({ orderId, lineId, now = new Date(), deps = {} } = {}) => {
  const activeOrders = deps.activeOrders || useActiveOrders.getState();
  const order = activeOrders.activeOrders?.get(orderId);
  const item = order?.items?.find((entry) => String(entry.lineId || entry.uniqueLineId) === String(lineId));
  if (!order || !item) return { success: false, code: 'ECOMMERCE_INVENTORY_LINE_NOT_FOUND', options: [] };

  const db = deps.db || defaultDb;
  const STORES = deps.STORES || DEFAULT_STORES;
  const productId = getRealProductId(item);
  const product = (deps.products || useProductStore.getState().menu || []).find((entry) => String(entry?.id) === String(productId))
    || await db.table(STORES.MENU).get(productId);
  if (!product || !isBatchManagedProduct(product)) {
    return { success: false, code: 'ECOMMERCE_INVENTORY_BATCH_NOT_APPLICABLE', options: [] };
  }

  const queryBatchesByProduct = deps.queryBatchesByProduct || (async (id) => (
    db.table(STORES.PRODUCT_BATCHES).where('productId').equals(id).toArray()
  ));
  const batches = await queryBatchesByProduct(productId);
  const requestedQuantity = toFinitePositiveQuantity(item.quantity) || 0;
  const summary = summarizeBatchCandidates({ batches, product, productId, requestedQuantity, now });
  const recommendedId = summary.orderedValid[0]?.batchId || null;
  const options = summary.orderedValid.map((entry) => ({
    batchId: entry.batchId,
    batchNumber: getBatchDisplayCode(entry.batch),
    expirationDate: extractCalendarDate(getBatchExpiryValue(entry.batch)),
    availableQuantity: entry.available,
    isRecommended: Boolean(recommendedId && String(recommendedId) === String(entry.batchId)),
    canCoverRequested: entry.coversRequested
  }));

  return { success: true, product, item, options };
};

export const selectEcommerceDraftBatch = async ({
  orderId,
  lineId,
  batchId,
  now = new Date(),
  deps = {}
} = {}) => {
  const activeOrders = deps.activeOrders || useActiveOrders.getState();
  const order = activeOrders.activeOrders?.get(orderId);
  const itemIndex = order?.items?.findIndex((entry) => String(entry.lineId || entry.uniqueLineId) === String(lineId)) ?? -1;
  if (!order || itemIndex < 0) return { success: false, code: 'ECOMMERCE_INVENTORY_LINE_NOT_FOUND' };

  const db = deps.db || defaultDb;
  const STORES = deps.STORES || DEFAULT_STORES;
  const item = order.items[itemIndex];
  const productId = getRealProductId(item);
  const products = deps.products || useProductStore.getState().menu || [];
  const product = products.find((entry) => String(entry?.id) === String(productId))
    || await db.table(STORES.MENU).get(productId);
  if (!product || isProductInactive(product)) {
    return { success: false, code: product ? 'PRODUCT_INACTIVE' : 'PRODUCT_MISSING' };
  }

  const queryBatchesByProduct = deps.queryBatchesByProduct || (async (id) => (
    db.table(STORES.PRODUCT_BATCHES).where('productId').equals(id).toArray()
  ));
  const batches = await queryBatchesByProduct(productId);
  const batch = (batches || []).find((entry) => String(getBatchId(entry)) === String(batchId));
  const requestedQuantity = toFinitePositiveQuantity(item.quantity) || 0;
  const selected = batch ? classifyBatch({ batch, product, productId, requestedQuantity, now }) : null;

  if (!selected || !selected.belongs) return { success: false, code: 'BATCH_STALE' };
  if (selected.expired || selected.invalidExpiry) return { success: false, code: 'ONLY_EXPIRED_BATCHES' };
  if (!selected.valid) return { success: false, code: 'NO_VALID_BATCH' };
  if (!selected.coversRequested) return { success: false, code: 'INSUFFICIENT_BATCH_STOCK' };

  const selectedLine = buildResolvedLine({
    item,
    product,
    mode: 'batch',
    requestedQuantity,
    availableQuantitySnapshot: selected.available,
    batch: selected.batch,
    selectionMode: 'manual',
    now
  });
  const items = order.items.map((entry, index) => (index === itemIndex ? selectedLine : entry));
  const ecommerceInventoryStatus = calculateEcommerceInventoryStatus(items);
  const resolution = {
    items,
    ecommerceInventoryStatus,
    ecommerceInventoryConflictCount: items.filter((entry) => entry?.inventoryResolution?.status === 'conflict').length,
    ecommerceInventoryResolutionVersion: ECOMMERCE_INVENTORY_RESOLUTION_VERSION,
    ecommerceInventoryResolvedAt: ecommerceInventoryStatus === 'ready' ? now.toISOString() : null
  };

  return {
    ...applyEcommerceInventoryResolution({ orderId, resolution, deps: { ...deps, activeOrders } }),
    resolution
  };
};

export const getEcommerceInventoryLineMessage = (item = {}) => {
  const resolution = item.inventoryResolution || {};
  const available = resolution.availableQuantitySnapshot;
  const requested = resolution.requestedQuantity ?? item.quantity;

  if (resolution.status === 'resolved' && resolution.mode === 'unlimited') {
    return 'Inventario: Sin control de existencias';
  }
  if (resolution.status === 'resolved' && resolution.mode === 'exact') {
    return `Existencia suficiente: ${available} disponibles / ${requested} requeridos`;
  }
  if (resolution.status === 'resolved' && resolution.mode === 'batch') {
    const prefix = resolution.selectionMode === 'manual' ? 'Lote seleccionado' : 'Lote FEFO asignado';
    const expiry = resolution.expirationDate ? ` · Caduca ${resolution.expirationDate}` : '';
    return `${prefix}: ${resolution.batchNumber || resolution.batchId}${expiry} · ${available} disponibles`;
  }

  const messages = {
    INSUFFICIENT_STOCK: `Sin existencia suficiente: ${available ?? 0} disponibles / ${requested} requeridos`,
    INVENTORY_UNKNOWN: 'La existencia actual es desconocida. Revisa el producto antes de continuar.',
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
  return messages[resolution.code] || 'Inventario pendiente de resolver.';
};
