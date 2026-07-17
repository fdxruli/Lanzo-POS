import { getAvailableBatchStock, getBatchId } from '../products/fefoUtils';
import { getInventoryQuantityForSale } from '../sales/stockValidation';
import {
  classifyEcommerceVariantBatchStock,
  getEcommerceVariantSelection,
  resolveEcommerceVariantBatchCandidates
} from './ecommerceApparelVariants';

const VARIANT_CONFLICT_BATCH_SENTINEL = '__ecommerce_variant_conflict__';
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? '').trim();
const getProductId = (item = {}) => asText(item.parentId ?? item.id);
const getLineId = (item = {}, index = 0) => asText(
  item.lineId
  ?? item.uniqueLineId
  ?? item.ecommerceOrderItemId
  ?? `${getProductId(item) || 'item'}:${index}`
);
const isBatchManaged = (product = {}) => Boolean(
  product.batchManagement?.enabled
  || product.batch_management?.enabled
  || String(product.expirationMode || product.expiration_mode || '').trim().toLowerCase() === 'batch'
);

const getRequiredQuantity = (item, product) => {
  const required = Number(getInventoryQuantityForSale(item, product));
  return Number.isFinite(required) && required > 0 ? required : null;
};

const getLedgerKey = (productId, batchId) => `${asText(productId)}:${asText(batchId)}`;

const buildDisplayName = (product = {}, selection = {}) => {
  const suffix = Object.values(selection.optionValues || {}).filter(Boolean).join(' ');
  return suffix ? `${product.name || 'Producto'} (${suffix})` : (product.name || 'Producto');
};

const createPendingVariantLine = ({ item, product, selection, selectedBatch, available }) => ({
  ...item,
  parentId: product.id,
  name: buildDisplayName(product, selection),
  sku: selection.sku || selectedBatch?.sku || null,
  variantAttributes: selection.optionValues,
  ecommerceVariantSelection: selection,
  batchId: getBatchId(selectedBatch),
  needsInventoryResolution: true,
  inventoryResolution: {
    ...(item.inventoryResolution || {}),
    mode: 'batch',
    status: 'pending',
    code: null,
    batchId: getBatchId(selectedBatch),
    availableQuantitySnapshot: available,
    selectionMode: 'manual_pending',
    details: {
      ecommerceVariant: true,
      sourceVariantRef: selection.sourceVariantRef,
      sku: selection.sku,
      optionValues: selection.optionValues
    }
  }
});

const createBlockedVariantLine = ({ item, product, selection, code, available = 0 }) => ({
  ...item,
  parentId: product.id,
  name: buildDisplayName(product, selection),
  sku: selection.sku || null,
  variantAttributes: selection.optionValues,
  ecommerceVariantSelection: selection,
  batchId: VARIANT_CONFLICT_BATCH_SENTINEL,
  needsInventoryResolution: true,
  ecommerceVariantResolutionConflict: {
    code,
    availableQuantitySnapshot: available,
    selection
  },
  inventoryResolution: {
    ...(item.inventoryResolution || {}),
    mode: 'batch',
    status: 'pending',
    code,
    batchId: null,
    availableQuantitySnapshot: available,
    selectionMode: 'manual_pending',
    details: {
      ecommerceVariant: true,
      sourceVariantRef: selection.sourceVariantRef,
      sku: selection.sku,
      optionValues: selection.optionValues
    }
  }
});

export const prepareEcommerceApparelVariantInventory = async ({
  order = {},
  products = [],
  queryBatchesByProduct,
  now = new Date()
} = {}) => {
  const productMap = new Map(asArray(products).map((product) => [asText(product?.id), product]));
  const items = asArray(order.items);
  const batchCache = new Map();
  const remainingByBatch = new Map();
  let changed = false;

  const getBatches = async (productId) => {
    if (!batchCache.has(productId)) {
      const loaded = await queryBatchesByProduct(productId);
      const batches = asArray(loaded);
      batchCache.set(productId, batches);
      batches.forEach((batch) => {
        remainingByBatch.set(
          getLedgerKey(productId, getBatchId(batch)),
          Math.max(0, Number(getAvailableBatchStock(batch)) || 0)
        );
      });
    }
    return batchCache.get(productId);
  };

  const preparedItems = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const productId = getProductId(item);
    const product = productMap.get(productId);
    const selection = getEcommerceVariantSelection(item);
    if (!selection.selected || !product || !isBatchManaged(product)) {
      preparedItems.push(item);
      continue;
    }

    changed = true;
    const required = getRequiredQuantity(item, product);
    if (!required) {
      preparedItems.push(createBlockedVariantLine({
        item,
        product,
        selection,
        code: 'ECOMMERCE_VARIANT_SELECTION_STALE'
      }));
      continue;
    }

    const batches = await getBatches(productId);
    const candidateResult = resolveEcommerceVariantBatchCandidates({
      item,
      product,
      batches,
      now
    });
    if (candidateResult.code) {
      preparedItems.push(createBlockedVariantLine({
        item,
        product,
        selection,
        code: candidateResult.code
      }));
      continue;
    }

    const stockResolution = classifyEcommerceVariantBatchStock({
      candidates: candidateResult.candidates,
      requiredQuantity: required,
      getAvailableStock: (batch) => (
        remainingByBatch.get(getLedgerKey(productId, getBatchId(batch))) || 0
      )
    });
    if (stockResolution.code) {
      preparedItems.push(createBlockedVariantLine({
        item,
        product,
        selection,
        code: stockResolution.code,
        available: stockResolution.availableStock
      }));
      continue;
    }

    const selectedBatch = stockResolution.selectedBatch;
    const ledgerKey = getLedgerKey(productId, getBatchId(selectedBatch));
    const available = stockResolution.availableStock;
    remainingByBatch.set(ledgerKey, Math.max(0, available - required));
    preparedItems.push(createPendingVariantLine({
      item,
      product,
      selection,
      selectedBatch,
      available
    }));
  }

  return {
    changed,
    order: changed ? { ...order, items: preparedItems } : order
  };
};

export const applyEcommerceApparelVariantConflicts = ({ order = {}, now = new Date() } = {}) => {
  let changed = false;
  const items = asArray(order.items).map((item) => {
    const conflict = item.ecommerceVariantResolutionConflict;
    if (!conflict) return item;
    changed = true;
    const requested = Number(item.quantity) || 0;
    const { ecommerceVariantResolutionConflict, ...safeItem } = item;
    void ecommerceVariantResolutionConflict;
    return {
      ...safeItem,
      batchId: undefined,
      needsInventoryResolution: true,
      inventoryResolution: {
        ...(item.inventoryResolution || {}),
        mode: 'batch',
        status: 'conflict',
        code: conflict.code,
        requestedSaleQuantity: requested,
        requiredInventoryQuantity: requested,
        requestedQuantity: requested,
        availableQuantitySnapshot: conflict.availableQuantitySnapshot ?? 0,
        batchId: null,
        selectionMode: 'variant_exact',
        resolvedAt: null,
        details: {
          ecommerceVariant: true,
          sourceVariantRef: conflict.selection?.sourceVariantRef || null,
          sku: conflict.selection?.sku || null,
          optionValues: conflict.selection?.optionValues || {}
        }
      }
    };
  });
  if (!changed) return order;
  const conflictCount = items.filter((item) => item.inventoryResolution?.status === 'conflict').length;
  return {
    ...order,
    items,
    ecommerceInventoryStatus: conflictCount > 0 ? 'conflict' : order.ecommerceInventoryStatus,
    ecommerceInventoryConflictCount: conflictCount,
    ecommerceInventoryResolvedAt: conflictCount > 0 ? null : order.ecommerceInventoryResolvedAt,
    ecommerceInventoryError: null,
    ecommerceInventoryVariantCheckedAt: now.toISOString()
  };
};

export const getEcommerceApparelVariantInventoryMessage = (item = {}) => {
  const code = item.inventoryResolution?.code;
  if (code === 'ECOMMERCE_VARIANT_LOCAL_MAPPING_MISSING') {
    return 'La variante comprada ya no existe en el inventario local.';
  }
  if (code === 'ECOMMERCE_VARIANT_LOCAL_MAPPING_AMBIGUOUS') {
    return 'El SKU de la variante esta asociado a combinaciones incompatibles.';
  }
  if (code === 'MULTI_BATCH_REQUIRED') {
    return 'La variante tiene stock suficiente, pero esta repartido entre varios lotes y requiere resolucion manual.';
  }
  if (code === 'ECOMMERCE_VARIANT_STOCK_INSUFFICIENT') {
    return 'No hay stock suficiente de la talla y color comprados.';
  }
  if (code === 'ECOMMERCE_VARIANT_SELECTION_STALE') {
    return 'La talla, color o SKU del pedido ya no coincide con el inventario local.';
  }
  return null;
};

export const ecommercePosApparelVariantResolutionInternals = Object.freeze({
  VARIANT_CONFLICT_BATCH_SENTINEL,
  getProductId,
  getLineId,
  isBatchManaged,
  getRequiredQuantity,
  getLedgerKey,
  buildDisplayName,
  createPendingVariantLine,
  createBlockedVariantLine
});
