import { db, STORES } from '../db/dexie';
import { generateIdempotencyKey } from '../sync/idempotency';
import { buildSyncOutboxRecord } from '../sync/syncOutboxService';
import { POS_SYNC_STORES, SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../sync/syncConstants';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import { useAppStore } from '../../store/useAppStore';
import { actorOriginFromHandle, captureProductInventoryMutation } from '../auth/productInventoryAuthority';

const EPSILON = 0.000001;
const nowIso = () => new Date().toISOString();
const asNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const domainError = (code, message = code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeQuantity = (value, code = 'INVALID_QUANTITY') => {
  const quantity = asNumber(value);
  if (quantity === null || quantity <= 0) throw domainError(code);
  return quantity;
};

const hasRecipe = (product) => Array.isArray(product?.recipe) && product.recipe.length > 0;
const usesBatches = (product) => product?.batchManagement?.enabled === true;
const hasVariantAttributes = (batch) => batch?.attributes && Object.keys(batch.attributes).length > 0;
const isStrict = (product) => String(product?.expirationMode || '').toUpperCase() === 'STRICT';
const payloadHash = (payload) => JSON.stringify(payload);

export const canAddInventoryEntry = (product) => Boolean(
  product?.id && product.trackStock !== false && !hasRecipe(product)
);

const buildProjection = ({ product, batches, timestamp }) => {
  const activeBatches = batches.filter((batch) => (
    batch?.isActive !== false && batch?.status !== 'archived' && !batch?.deletedAt && !batch?.deleted_at
  ));
  const stock = activeBatches.reduce((sum, batch) => sum + Math.max(0, asNumber(batch.stock, 0)), 0);
  const committedStock = batches.reduce((sum, batch) => sum + Math.max(0, asNumber(batch.committedStock ?? batch.committed_stock, 0)), 0);
  const variants = activeBatches.some(hasVariantAttributes);
  const inventoryValue = activeBatches.reduce((sum, batch) => sum + (Math.max(0, asNumber(batch.stock, 0)) * Math.max(0, asNumber(batch.cost, 0))), 0);
  return {
    ...product,
    stock,
    committedStock,
    cost: variants || stock <= 0 ? product.cost : Number((inventoryValue / stock).toFixed(4)),
    hasBatches: true,
    updatedAt: timestamp
  };
};

const makeNewBatch = ({ product, operationId, entry, timestamp }) => {
  if (isStrict(product) && !String(entry.manufacturerBatchId || '').trim()) {
    throw domainError('STRICT_MANUFACTURER_BATCH_REQUIRED');
  }
  if (isStrict(product) && !entry.expiryDate) throw domainError('STRICT_EXPIRY_REQUIRED');
  return {
    id: entry.batchId || `batch-entry-${operationId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    productId: product.id,
    stock: 0,
    committedStock: 0,
    cost: Math.max(0, asNumber(entry.unitCost, asNumber(product.cost, 0))),
    price: Math.max(0, asNumber(product.price, 0)),
    supplier: entry.supplier || null,
    manufacturerBatchId: entry.manufacturerBatchId || null,
    expiryDate: entry.expiryDate || null,
    alertTargetDate: entry.expiryDate || null,
    alertType: entry.expiryDate ? 'CADUCIDAD_LEGAL' : null,
    trackStock: true,
    isActive: true,
    status: 'active',
    attributes: null,
    notes: 'Entrada de inventario',
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);

export const addInventoryEntry = async ({
  operationId = null,
  productId,
  batchId = null,
  variantBatchId = null,
  quantity,
  inputUnit = null,
  baseQuantity = null,
  baseUnit = null,
  unitCost = null,
  supplier = null,
  manufacturerBatchId = null,
  expiryDate = null,
  occurredAt = null,
  entryKind = 'restock',
  metadata = {},
  licenseKey = null
} = {}) => {
  const resolvedOperationId = operationId || generateIdempotencyKey({
    prefix: 'inventory-entry', entityType: SYNC_ENTITY_TYPES.INVENTORY_ENTRY,
    operation: SYNC_OPERATIONS.INVENTORY_ENTRY, entityId: productId
  });
  const normalizedQuantity = normalizeQuantity(quantity);
  const normalizedBaseQuantity = normalizeQuantity(baseQuantity ?? normalizedQuantity);
  if (Math.abs(normalizedQuantity - normalizedBaseQuantity) > EPSILON) {
    throw domainError('INVALID_UNIT_PRECISION', 'ENTRY.2 solo admite unidades simples.');
  }
  if (unitCost !== null && unitCost !== undefined && asNumber(unitCost) === null) {
    throw domainError('INVALID_UNIT_PRECISION');
  }

  const entry = {
    operationId: resolvedOperationId,
    productId,
    batchId: variantBatchId || batchId || null,
    variantBatchId: variantBatchId || null,
    quantity: normalizedQuantity,
    inputUnit: inputUnit || baseUnit || null,
    baseQuantity: normalizedBaseQuantity,
    baseUnit: baseUnit || inputUnit || null,
    unitCost: unitCost === null || unitCost === undefined ? null : Math.max(0, asNumber(unitCost)),
    supplier: supplier ? String(supplier).trim() : null,
    manufacturerBatchId: manufacturerBatchId ? String(manufacturerBatchId).trim() : null,
    expiryDate: expiryDate || null,
    occurredAt: occurredAt || nowIso(),
    entryKind,
    metadata: metadata && typeof metadata === 'object' ? metadata : {}
  };
  // An omitted timestamp is resolved only on the first local application. It must
  // not make an otherwise identical retry look like a different operation.
  const requestHash = payloadHash({ ...entry, occurredAt: occurredAt || null });
  const resolvedLicenseKey = licenseKey || getRuntimeLicenseKey();

  if (!productId) throw domainError('PRODUCT_NOT_FOUND');
  const actorHandle = captureProductInventoryMutation({ inventory: true });
  actorHandle.assertCurrent('inventory');
  if (!db.isOpen()) await db.open();

  return db.transaction('rw', [
    db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES), db.table(STORES.INVENTORY_EVENTS), db.table(POS_SYNC_STORES.OUTBOX)
  ], async () => {
    actorHandle.assertCurrent('inventory');
    const eventId = `inventory-entry:${resolvedOperationId}`;
    const eventTable = db.table(STORES.INVENTORY_EVENTS);
    const existingEvent = await eventTable.get(eventId);
    if (existingEvent) {
      if (existingEvent.requestHash !== requestHash) throw domainError('IDEMPOTENCY_PAYLOAD_MISMATCH');
      return { ...existingEvent.result, duplicate: true, operationId: resolvedOperationId };
    }

    const productTable = db.table(STORES.MENU);
    const batchTable = db.table(STORES.PRODUCT_BATCHES);
    const product = await productTable.get(productId);
    if (!product) throw domainError('PRODUCT_NOT_FOUND');
    if (product.trackStock === false) throw domainError('STOCK_TRACKING_DISABLED');
    if (hasRecipe(product)) throw domainError('RECIPE_INVENTORY_ENTRY_NOT_ALLOWED');

    const timestamp = nowIso();
    let target = null;
    let parent = product;
    let previousStock = asNumber(product.stock, 0);
    let newStock = previousStock + normalizedBaseQuantity;
    let batchResult = null;

    if (usesBatches(product)) {
      const batches = await batchTable.where('productId').equals(product.id).toArray();
      const requestedBatchId = entry.batchId;
      const productHasVariants = batches.some(hasVariantAttributes);
      if (productHasVariants && !requestedBatchId) throw domainError('VARIANT_REQUIRED');

      target = requestedBatchId ? await batchTable.get(requestedBatchId) : null;
      if (requestedBatchId && (!target || target.productId !== product.id)) {
        throw domainError(productHasVariants ? 'VARIANT_NOT_FOUND' : 'BATCH_NOT_FOUND');
      }
      if (target && productHasVariants && !hasVariantAttributes(target)) throw domainError('VARIANT_NOT_FOUND');
      if (!target) {
        if (productHasVariants) throw domainError('VARIANT_REQUIRED');
        target = makeNewBatch({ product, operationId: resolvedOperationId, entry, timestamp });
      }
      if (isStrict(product) && (!target.manufacturerBatchId || !target.expiryDate)) {
        throw domainError(!target.manufacturerBatchId ? 'STRICT_MANUFACTURER_BATCH_REQUIRED' : 'STRICT_EXPIRY_REQUIRED');
      }

      const previousBatchStock = asNumber(target.stock, 0);
      const updatedBatch = {
        ...target,
        stock: previousBatchStock + normalizedBaseQuantity,
        cost: entry.unitCost ?? target.cost ?? product.cost ?? 0,
        supplier: entry.supplier || target.supplier || null,
        isActive: true,
        status: 'active',
        updatedAt: timestamp
      };
      actorHandle.assertCurrent('inventory');
      await batchTable.put(updatedBatch);
      const projected = buildProjection({ product, batches: [...batches.filter((batch) => batch.id !== updatedBatch.id), updatedBatch], timestamp });
      actorHandle.assertCurrent('inventory');
      await productTable.put(projected);
      parent = projected;
      previousStock = asNumber(product.stock, 0);
      newStock = projected.stock;
      batchResult = { id: updatedBatch.id, previousStock: previousBatchStock, newStock: updatedBatch.stock };
      entry.batchId = updatedBatch.id;
    } else {
      const updatedProduct = { ...product, stock: newStock, updatedAt: timestamp };
      actorHandle.assertCurrent('inventory');
      await productTable.put(updatedProduct);
      parent = updatedProduct;
    }

    const result = { success: true, operationId: resolvedOperationId, product: parent, batch: batchResult, previousStock, newStock, pending: true };
    actorHandle.assertCurrent('inventory');
    await eventTable.put({
      id: eventId, type: 'INVENTORY_ENTRY', operationId: resolvedOperationId, productId: product.id,
      batchId: entry.batchId, delta: normalizedBaseQuantity, previousStock, newStock,
      timestamp, occurredAt: entry.occurredAt, entryKind, metadata: entry.metadata,
      requestHash, synced: false, result
    });
    actorHandle.assertCurrent('inventory');
    await db.table(POS_SYNC_STORES.OUTBOX).put(buildSyncOutboxRecord({
      licenseKey: resolvedLicenseKey, entityType: SYNC_ENTITY_TYPES.INVENTORY_ENTRY,
      operation: SYNC_OPERATIONS.INVENTORY_ENTRY, entityId: product.id,
      payload: { entry }, idempotencyKey: resolvedOperationId,
      actorSensitive: true,
      originActor: actorOriginFromHandle(actorHandle),
      metadata: { source: 'inventoryEntryService', operationId: resolvedOperationId }
    }));
    return result;
  });
};

export const markInventoryEntrySynced = async (operationId, response = null) => {
  if (!operationId || !db.isOpen()) return;
  const eventId = `inventory-entry:${operationId}`;
  await db.table(STORES.INVENTORY_EVENTS).update(eventId, { synced: true, syncedAt: nowIso(), cloudResult: response });
};

export const inventoryEntryErrors = Object.freeze({
  PRODUCT_NOT_FOUND: 'El producto ya no está disponible.',
  STOCK_TRACKING_DISABLED: 'Este producto no administra existencias.',
  INVALID_QUANTITY: 'Ingresa una cantidad mayor a cero.',
  INVALID_UNIT_PRECISION: 'La unidad seleccionada requiere una conversión que aún no está disponible.',
  VARIANT_REQUIRED: 'Este producto requiere seleccionar una variante.',
  VARIANT_NOT_FOUND: 'La variante seleccionada ya no existe.',
  STRICT_MANUFACTURER_BATCH_REQUIRED: 'Se requiere el lote del fabricante.',
  STRICT_EXPIRY_REQUIRED: 'Se requiere la fecha de caducidad.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'Esta operación ya existe con datos distintos.'
});
