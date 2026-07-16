import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useProductStore } from '../../store/useProductStore';
import { db as defaultDb, STORES as DEFAULT_STORES } from '../db/dexie';
import { validateStockBeforeSale } from '../sales/stockValidation';
import {
  ECOMMERCE_INVENTORY_RESOLUTION_VERSION,
  getEcommerceInventoryLineMessage as getBaseEcommerceInventoryLineMessage,
  revalidateEcommerceDraftInventory as revalidateBaseEcommerceDraftInventory
} from './ecommercePosInventoryResolutionBase';
import { reconcileEcommerceConfiguredItems } from './ecommercePosConfiguredItem';

export * from './ecommercePosInventoryResolutionBase';

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? '').trim();
const getProductId = (item = {}) => asText(item.parentId ?? item.id);
const hasRecipe = (product = {}) => asArray(product.recipe).length > 0;

const getActiveOrdersState = (deps = {}) => {
  if (typeof deps.getActiveOrdersState === 'function') return deps.getActiveOrdersState();
  if (deps.activeOrders) return deps.activeOrders;
  return useActiveOrders.getState();
};

const getProducts = (deps = {}) => asArray(deps.products || useProductStore.getState().menu);

const updateOrder = ({ orderId, patch, deps = {} }) => {
  const state = getActiveOrdersState(deps);
  if (typeof state.updateOrder === 'function') {
    state.updateOrder(orderId, patch);
    return getActiveOrdersState(deps).activeOrders?.get?.(orderId) || null;
  }
  const current = state.activeOrders?.get?.(orderId) || null;
  if (!current) return null;
  const next = { ...current, ...patch };
  state.activeOrders.set(orderId, next);
  return next;
};

const reconcileStoredConfiguredItems = ({ orderId, products, deps }) => {
  const state = getActiveOrdersState(deps);
  const order = state.activeOrders?.get?.(orderId) || null;
  if (!order) return null;
  const reconciled = reconcileEcommerceConfiguredItems({ items: order.items, products });
  if (!reconciled.changed) return order;
  return updateOrder({ orderId, patch: { items: reconciled.items }, deps }) || { ...order, items: reconciled.items };
};

const getRecipeProductIds = ({ order, products }) => {
  const productMap = new Map(products.map((product) => [asText(product?.id), product]));
  return new Set(asArray(order?.items)
    .map(getProductId)
    .filter((productId) => hasRecipe(productMap.get(productId))));
};

const buildRecipeSafeProduct = (product = {}) => ({
  ...product,
  recipe: [],
  trackStock: false,
  track_stock: false,
  expirationMode: 'NONE',
  expiration_mode: 'NONE',
  batchManagement: {
    ...(product.batchManagement || product.batch_management || {}),
    enabled: false
  },
  batch_management: {
    ...(product.batch_management || product.batchManagement || {}),
    enabled: false
  },
  ecommerceRecipeSource: true
});

const buildRecipeSafeItem = (item = {}) => ({
  ...item,
  ecommerceOriginalRecipe: item.ecommerceOriginalRecipe || item.recipe || null,
  recipe: [],
  trackStock: false,
  track_stock: false,
  expirationMode: 'NONE',
  expiration_mode: 'NONE',
  batchManagement: {
    ...(item.batchManagement || item.batch_management || {}),
    enabled: false
  },
  batch_management: {
    ...(item.batch_management || item.batchManagement || {}),
    enabled: false
  },
  ecommerceRecipeSource: true
});

const buildStockDeps = (deps = {}) => {
  const database = deps.db || defaultDb;
  const STORES = deps.STORES || DEFAULT_STORES;
  return {
    STORES,
    loadData: deps.loadData || ((store, id) => database.table(store).get(id)),
    loadMultipleData: deps.loadMultipleData || ((store, ids) => database.table(store).bulkGet(ids)),
    queryBatchesByProductIdAndActive: deps.queryBatchesByProductIdAndActive
      || deps.queryBatchesByProduct
      || (async (productId) => database
        .table(STORES.PRODUCT_BATCHES)
        .where('productId')
        .equals(productId)
        .filter((batch) => (
          batch?.isActive !== false
          && batch?.is_active !== false
          && !['inactive', 'deleted', 'archived', 'blocked', 'quarantined']
            .includes(asText(batch?.status).toLowerCase())
        ))
        .toArray())
  };
};

const validateRecipeAndConfiguredInventory = async ({ order, products, deps }) => {
  const stockDeps = buildStockDeps(deps);
  const productMap = new Map(products.map((product) => [asText(product?.id), product]));
  return validateStockBeforeSale({
    itemsToProcess: asArray(order?.items),
    productMap,
    ignoreStock: false,
    ...stockDeps
  });
};

const patchInventoryLines = ({
  orderId,
  targetIds,
  mode,
  status,
  code,
  now,
  details = null,
  deps = {}
}) => {
  const state = getActiveOrdersState(deps);
  const order = state.activeOrders?.get?.(orderId) || null;
  if (!order) return null;

  const items = asArray(order.items).map((item) => {
    if (!targetIds.has(getProductId(item))) return item;
    const requested = Number(item.quantity) || 0;
    return {
      ...item,
      needsInventoryResolution: status !== 'resolved',
      inventoryResolution: {
        ...(item.inventoryResolution || {}),
        mode,
        status,
        code,
        requestedSaleQuantity: requested,
        requiredInventoryQuantity: requested,
        requestedQuantity: requested,
        batchId: null,
        selectionMode: mode === 'recipe' ? 'recipe_ingredients' : null,
        resolvedAt: status === 'resolved' ? now.toISOString() : null,
        ...(details ? { details } : {})
      }
    };
  });

  const conflictCount = items.filter((item) => item?.inventoryResolution?.status === 'conflict').length;
  const ready = items.length > 0 && items.every((item) => (
    item?.needsInventoryResolution === false
    && item?.inventoryResolution?.status === 'resolved'
  ));
  return updateOrder({
    orderId,
    deps,
    patch: {
      items,
      ecommerceInventoryStatus: ready ? 'ready' : (conflictCount > 0 ? 'conflict' : 'pending'),
      ecommerceInventoryConflictCount: conflictCount,
      ecommerceInventoryResolutionVersion: ECOMMERCE_INVENTORY_RESOLUTION_VERSION,
      ecommerceInventoryResolvedAt: ready ? now.toISOString() : null,
      ecommerceInventoryError: null
    }
  });
};

const buildResultFromStoredOrder = (baseResult, order) => ({
  ...baseResult,
  success: baseResult?.success !== false,
  changed: true,
  order,
  resolution: order ? {
    items: order.items,
    ecommerceInventoryStatus: order.ecommerceInventoryStatus,
    ecommerceInventoryConflictCount: order.ecommerceInventoryConflictCount,
    ecommerceInventoryResolutionVersion: order.ecommerceInventoryResolutionVersion,
    ecommerceInventoryResolvedAt: order.ecommerceInventoryResolvedAt,
    ecommerceInventoryError: order.ecommerceInventoryError
  } : baseResult?.resolution
});

export const revalidateEcommerceDraftInventory = async ({ orderId, now = new Date(), deps = {} } = {}) => {
  const products = getProducts(deps);
  let order = reconcileStoredConfiguredItems({ orderId, products, deps });
  if (!order) return { success: false, changed: false, code: 'ECOMMERCE_INVENTORY_DRAFT_INVALID' };

  const mappingConflictIds = new Set(asArray(order.items)
    .filter((item) => item.ecommerceConfiguredModifierMappingStatus === 'conflict')
    .map(getProductId));
  if (mappingConflictIds.size > 0) {
    const baseResult = await revalidateBaseEcommerceDraftInventory({ orderId, now, deps: { ...deps, products } });
    if (baseResult?.stale || baseResult?.success === false) return baseResult;
    const patched = patchInventoryLines({
      orderId,
      targetIds: mappingConflictIds,
      mode: 'configured',
      status: 'conflict',
      code: 'ECOMMERCE_CONFIGURATION_MAPPING_FAILED',
      now,
      deps
    });
    return buildResultFromStoredOrder(baseResult, patched);
  }

  const recipeProductIds = getRecipeProductIds({ order, products });
  if (recipeProductIds.size === 0) {
    return revalidateBaseEcommerceDraftInventory({ orderId, now, deps: { ...deps, products } });
  }

  const stockValidation = await validateRecipeAndConfiguredInventory({ order, products, deps });
  if (!stockValidation?.ok) {
    const baseResult = await revalidateBaseEcommerceDraftInventory({ orderId, now, deps: { ...deps, products } });
    if (baseResult?.stale || baseResult?.success === false) return baseResult;
    const patched = patchInventoryLines({
      orderId,
      targetIds: recipeProductIds,
      mode: 'recipe',
      status: 'conflict',
      code: stockValidation?.response?.errorType === 'STOCK_WARNING'
        ? 'INSUFFICIENT_RECIPE_STOCK'
        : 'RECIPE_INVENTORY_UNKNOWN',
      now,
      details: stockValidation?.response?.missingData || null,
      deps
    });
    return buildResultFromStoredOrder(baseResult, patched);
  }

  const safeProducts = products.map((product) => (
    recipeProductIds.has(asText(product?.id)) ? buildRecipeSafeProduct(product) : product
  ));
  const safeItems = asArray(order.items).map((item) => (
    recipeProductIds.has(getProductId(item)) ? buildRecipeSafeItem(item) : item
  ));
  order = updateOrder({ orderId, patch: { items: safeItems }, deps }) || { ...order, items: safeItems };

  const baseResult = await revalidateBaseEcommerceDraftInventory({
    orderId,
    now,
    deps: { ...deps, products: safeProducts }
  });
  if (baseResult?.stale || baseResult?.success === false) return baseResult;

  const patched = patchInventoryLines({
    orderId,
    targetIds: recipeProductIds,
    mode: 'recipe',
    status: 'resolved',
    code: null,
    now,
    deps
  });
  return buildResultFromStoredOrder(baseResult, patched);
};

export const getEcommerceInventoryLineMessage = (item = {}) => {
  const resolution = item.inventoryResolution || {};
  if (resolution.status === 'resolved' && resolution.mode === 'recipe') {
    return 'Ingredientes y extras verificados para la receta.';
  }
  if (resolution.code === 'ECOMMERCE_CONFIGURATION_MAPPING_FAILED') {
    return 'No se pudo vincular una opción del pedido con la configuración actual del POS.';
  }
  if (resolution.code === 'INSUFFICIENT_RECIPE_STOCK') {
    return 'No hay ingredientes suficientes para preparar esta configuración.';
  }
  if (resolution.code === 'RECIPE_INVENTORY_UNKNOWN') {
    return 'No se pudo verificar el inventario de los ingredientes.';
  }
  return getBaseEcommerceInventoryLineMessage(item);
};

export const ecommercePosInventoryRecipeBridgeInternals = Object.freeze({
  getRecipeProductIds,
  buildRecipeSafeProduct,
  buildRecipeSafeItem,
  buildStockDeps,
  validateRecipeAndConfiguredInventory,
  patchInventoryLines
});
