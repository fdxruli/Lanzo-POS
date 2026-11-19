import { db, STORES } from '../db/dexie';
import { generateIdempotencyKey } from '../sync/idempotency';
import { buildSyncOutboxRecord } from '../sync/syncOutboxService';
import { POS_SYNC_STORES, SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../sync/syncConstants';
import { getLicenseKeyFromDetails, isCloudProductsSyncEnabled, isPharmacyCloudAuthorityRequired, OUTBOX_STATUS } from '../sync/syncConstants';
import { useAppStore } from '../../store/useAppStore';
import { assertLocalTenantSyncAccess } from '../tenant/localTenantGuard';
import { getPharmacyClassification, isSpecialPharmacyProduct } from '../../utils/pharmacyClassification';
import { isBatchArchived } from '../products/batchStatus';
import { canAddInventoryEntry, hasInventoryRecipe } from './inventoryEntryEligibility';
import {
  actorOriginFromHandle,
  assertProductInventoryMutationCurrent,
  captureProductInventoryMutation,
  isLegacyLocalOwnerProductInventoryAuthority
} from '../auth/productInventoryAuthority';

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

const usesBatches = (product) => product?.batchManagement?.enabled === true;
const hasVariantAttributes = (batch) => batch?.attributes && Object.keys(batch.attributes).length > 0;
const isStrict = (product) => String(product?.expirationMode || '').toUpperCase() === 'STRICT';
const isPharmacyMedicine = (product) => {
  const pharmacy = getPharmacyClassification(product);
  return pharmacy.recorded && pharmacy.kind === 'medicine';
};
export const isCloudGeneralPharmacyBatchEntry = (product, licenseDetails) => (
  usesBatches(product) && product.trackStock !== false
  && getPharmacyClassification(product).kind === 'other'
  && isPharmacyCloudAuthorityRequired(licenseDetails)
);

const expiryDay = (value) => {
  const day = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
};
const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const payloadHash = (payload) => JSON.stringify(payload);
const assertInventoryMutationCurrent = (actorHandle) => (
  assertProductInventoryMutationCurrent(actorHandle, { inventory: true })
);

export { canAddInventoryEntry };

const buildProjection = ({ product, batches, timestamp }) => {
  const activeBatches = batches.filter((batch) => (
    batch?.isActive !== false && batch?.status !== 'archived' && !batch?.deletedAt && !batch?.deleted_at
  ));
  const stock = activeBatches.reduce((sum, batch) => sum + Math.max(0, asNumber(batch.stock, 0)), 0);
  const committedStock = batches.reduce((sum, batch) => sum + Math.max(0, asNumber(batch.committedStock ?? batch.committed_stock, 0)), 0);
  const variants = activeBatches.some(hasVariantAttributes);
  const incompleteCost = activeBatches.some((batch) => batch.stock > 0 && (batch.cost ?? null) === null);
  const inventoryValue = activeBatches.reduce((sum, batch) => sum + (Math.max(0, asNumber(batch.stock, 0)) * Math.max(0, asNumber(batch.cost, 0))), 0);
  return {
    ...product,
    stock,
    committedStock,
    cost: variants || stock <= 0 || incompleteCost ? product.cost : Number((inventoryValue / stock).toFixed(4)),
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
    cost: entry.unitCost ?? product.cost ?? null,
    costSource: entry.unitCost !== null ? 'receipt' : product.cost > 0 ? 'catalog_at_receipt' : null,
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
  const licenseDetails = useAppStore.getState()?.licenseDetails;
  const cloudProducts = isPharmacyCloudAuthorityRequired(licenseDetails);
  const localOnly = isLegacyLocalOwnerProductInventoryAuthority(actorHandle);
  assertInventoryMutationCurrent(actorHandle);
  if (!db.isOpen()) await db.open();

  return db.transaction('rw', [
    db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES), db.table(STORES.INVENTORY_EVENTS), db.table(POS_SYNC_STORES.OUTBOX)
  ], async () => {
    assertInventoryMutationCurrent(actorHandle);
    const eventId = `inventory-entry:${resolvedOperationId}`;
    const eventTable = db.table(STORES.INVENTORY_EVENTS);
    const existingEvent = await eventTable.get(eventId);
    if (existingEvent) {
      if (existingEvent.requestHash !== requestHash) throw domainError('IDEMPOTENCY_PAYLOAD_MISMATCH');
      if (existingEvent.rejectionCode) throw domainError(existingEvent.rejectionCode);
      if (cloudProducts && existingEvent.metadata?.pharmacyReceipt
        && (existingEvent.syncDisposition === 'local_only'
          || (existingEvent.syncDisposition !== 'cloud_authoritative' && !existingEvent.synced))) {
        throw domainError('PHARMACY_INVENTORY_REVIEW_REQUIRED');
      }
      return {
        ...existingEvent.result,
        pending: existingEvent.syncDisposition === 'cloud_authoritative'
          ? !existingEvent.synced : existingEvent.result?.pending,
        duplicate: true,
        operationId: resolvedOperationId
      };
    }

    const productTable = db.table(STORES.MENU);
    const batchTable = db.table(STORES.PRODUCT_BATCHES);
    const product = await productTable.get(productId);
    if (!product) throw domainError('PRODUCT_NOT_FOUND');
    if (product.trackStock === false) throw domainError('STOCK_TRACKING_DISABLED');
    if (hasInventoryRecipe(product)) throw domainError('RECIPE_INVENTORY_ENTRY_NOT_ALLOWED');

    const pharmacyMedicine = isPharmacyMedicine(product);
    if (pharmacyMedicine) {
      const classification = getPharmacyClassification(product);
      if (classification.status !== 'confirmed') throw domainError('PHARMACY_CLASSIFICATION_REQUIRED');
      if (isSpecialPharmacyProduct(product)) throw domainError('PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE');
      if (!usesBatches(product)) throw domainError('PHARMACY_BATCHES_REQUIRED');
      if (product.conversionFactor?.enabled === true) throw domainError('INVALID_UNIT_PRECISION');
      const receipt = entry.metadata?.pharmacyReceipt;
      if (!receipt || receipt.version !== 1 || !entry.supplier ||
          !['factura', 'remision', 'otro'].includes(receipt.documentType) ||
          !String(receipt.documentReference || '').trim() ||
          !Number.isFinite(Date.parse(entry.occurredAt))) {
        throw domainError('PHARMACY_PROVENANCE_REQUIRED');
      }
    }

    const cloudReceipt = pharmacyMedicine && cloudProducts;
    const cloudGeneralEntry = isCloudGeneralPharmacyBatchEntry(product, licenseDetails);
    const cloudConfirmation = cloudReceipt || cloudGeneralEntry;
    if (cloudConfirmation) {
      if (!resolvedLicenseKey || resolvedLicenseKey !== getLicenseKeyFromDetails(licenseDetails)
        || localOnly || !isCloudProductsSyncEnabled(licenseDetails)) {
        throw domainError('PHARMACY_CLOUD_SESSION_REQUIRED');
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw domainError('PHARMACY_CLOUD_OFFLINE');
      }
      if (cloudReceipt) {
        const pending = await db.table(POS_SYNC_STORES.OUTBOX)
          .where('entityType').equals(SYNC_ENTITY_TYPES.INVENTORY_ENTRY)
          .filter((row) => row.licenseKey === resolvedLicenseKey && row.entityId === productId
            && row.status !== OUTBOX_STATUS.SYNCED).first();
        const localHistory = await eventTable.where('productId').equals(productId)
          .filter((event) => event.type === 'INVENTORY_ENTRY'
            && (!event.licenseKey || event.licenseKey === resolvedLicenseKey)
            && (event.syncDisposition === 'local_only'
              || (event.syncDisposition !== 'cloud_authoritative' && !event.synced))).first();
        if (localHistory || (pending && !pending.payload?.cloudPharmacyReceipt)) {
          throw domainError('PHARMACY_INVENTORY_REVIEW_REQUIRED');
        }
        if (pending) throw domainError('PHARMACY_RECEIPT_PENDING');
      } else {
        const pending = await eventTable.where('productId').equals(productId)
          .filter((event) => event.type === 'INVENTORY_ENTRY' && !event.synced && !event.rejectionCode
            && (!event.licenseKey || event.licenseKey === resolvedLicenseKey)
            && ['cloud_authoritative', 'actor_bound'].includes(event.syncDisposition)).first();
        if (pending) throw domainError('PHARMACY_RECEIPT_PENDING');
      }
    }

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
        if (pharmacyMedicine) {
          const manufacturer = String(entry.manufacturerBatchId || '').trim().toLowerCase();
          if (!manufacturer || !expiryDay(entry.expiryDate)) throw domainError('PHARMACY_BATCH_IDENTITY_REQUIRED');
          const matchingManufacturer = batches.find((batch) =>
            !(cloudReceipt && batch.rejectedLegacyInventory)
            && String(batch.manufacturerBatchId || '').trim().toLowerCase() === manufacturer
          );
          if (matchingManufacturer) throw domainError(
            isBatchArchived(matchingManufacturer)
              ? 'PHARMACY_ARCHIVED_BATCH_EXISTS' : 'PHARMACY_EXISTING_BATCH_REQUIRED'
          );
        }
        target = makeNewBatch({ product, operationId: resolvedOperationId, entry, timestamp });
      }
      if (pharmacyMedicine) {
        if (isBatchArchived(target)) {
          throw domainError('BATCH_NOT_FOUND');
        }
        const expiry = expiryDay(target.expiryDate);
        if (!String(target.manufacturerBatchId || '').trim() || !expiry) {
          throw domainError('PHARMACY_BATCH_IDENTITY_REQUIRED');
        }
        if (expiry < localToday()) throw domainError('PHARMACY_EXPIRED_BATCH');
        const receipt = entry.metadata?.pharmacyReceipt;
        const receiptManufacturer = String(receipt?.manufacturerBatchId || '').trim().toLowerCase();
        const receiptExpiry = expiryDay(receipt?.expiryDate);
        if (receiptManufacturer !== String(target.manufacturerBatchId).trim().toLowerCase()
          || receiptExpiry !== expiry
          || Date.parse(receipt?.receivedAt) !== Date.parse(entry.occurredAt)) {
          throw domainError('PHARMACY_RECEIPT_BATCH_MISMATCH');
        }
      }
      if (isStrict(product) && (!target.manufacturerBatchId || !target.expiryDate)) {
        throw domainError(!target.manufacturerBatchId ? 'STRICT_MANUFACTURER_BATCH_REQUIRED' : 'STRICT_EXPIRY_REQUIRED');
      }

      const previousBatchStock = asNumber(target.stock, 0);
      const updatedBatch = {
        ...target,
        stock: previousBatchStock + normalizedBaseQuantity,
        cost: entry.unitCost ?? target.cost ?? product.cost ?? null,
        costSource: entry.unitCost !== null ? 'receipt' : target.costSource
          ?? ((target.cost ?? null) === null && product.cost > 0 ? 'catalog_at_receipt' : null),
        supplier: entry.supplier || target.supplier || null,
        isActive: true,
        status: 'active',
        updatedAt: timestamp
      };
      if (!cloudConfirmation) {
        assertInventoryMutationCurrent(actorHandle);
        await batchTable.put(updatedBatch);
      }
      const projected = buildProjection({ product, batches: [...batches.filter((batch) => batch.id !== updatedBatch.id), updatedBatch], timestamp });
      assertInventoryMutationCurrent(actorHandle);
      if (!cloudConfirmation) await productTable.put(projected);
      parent = projected;
      previousStock = asNumber(product.stock, 0);
      newStock = projected.stock;
      batchResult = { id: updatedBatch.id, previousStock: previousBatchStock, newStock: updatedBatch.stock };
      if (!cloudConfirmation) entry.batchId = updatedBatch.id;
    } else {
      const updatedProduct = { ...product, stock: newStock, updatedAt: timestamp };
      assertInventoryMutationCurrent(actorHandle);
      await productTable.put(updatedProduct);
      parent = updatedProduct;
    }

    const result = {
      success: true,
      operationId: resolvedOperationId,
      product: cloudConfirmation ? product : parent,
      batch: cloudConfirmation ? null : batchResult,
      previousStock,
      newStock: cloudConfirmation ? previousStock : newStock,
      pending: !localOnly
    };
    assertInventoryMutationCurrent(actorHandle);
    await eventTable.put({
      id: eventId, type: 'INVENTORY_ENTRY', operationId: resolvedOperationId, productId: product.id,
      batchId: entry.batchId, delta: normalizedBaseQuantity, previousStock, newStock: result.newStock,
      timestamp, occurredAt: entry.occurredAt, entryKind, metadata: entry.metadata,
      supplier: entry.supplier, manufacturerBatchId: target?.manufacturerBatchId || null,
      expiryDate: target?.expiryDate || null, licenseKey: resolvedLicenseKey,
      originActor: localOnly ? null : actorOriginFromHandle(actorHandle),
      requestHash,
      synced: localOnly,
      syncedAt: localOnly ? timestamp : null,
      syncDisposition: cloudConfirmation ? 'cloud_authoritative' : localOnly ? 'local_only' : 'actor_bound',
      result
    });

    if (!localOnly) {
      assertInventoryMutationCurrent(actorHandle);
      await db.table(POS_SYNC_STORES.OUTBOX).put(buildSyncOutboxRecord({
        licenseKey: resolvedLicenseKey, entityType: SYNC_ENTITY_TYPES.INVENTORY_ENTRY,
        operation: SYNC_OPERATIONS.INVENTORY_ENTRY, entityId: product.id,
        payload: {
          entry,
          ...(cloudReceipt ? { cloudPharmacyReceipt: true } : {}),
          ...(cloudGeneralEntry ? { cloudInventoryEntry: true } : {})
        }, idempotencyKey: resolvedOperationId,
        actorSensitive: true,
        originActor: actorOriginFromHandle(actorHandle),
        metadata: { source: 'inventoryEntryService', operationId: resolvedOperationId }
      }));
    }
    return result;
  });
};

// Read-only inspection. Local-only receipts lack a Cloud actor-bound outbox row
// and must never be reconstructed as a new acquisition during recovery.
export const listLocalOnlyInventoryEntriesForRecovery = async ({ licenseKey } = {}) => {
  if (!licenseKey) throw domainError('INVENTORY_ENTRY_LICENSE_REQUIRED');
  await assertLocalTenantSyncAccess({ license_key: licenseKey }, { reason: 'pharmacy_local_only_recovery_read' });
  if (!db.isOpen()) await db.open();
  const events = await db.table(STORES.INVENTORY_EVENTS).toArray();
  return events.filter((event) => event?.type === 'INVENTORY_ENTRY'
    && event?.syncDisposition === 'local_only'
    && (!event.licenseKey || event.licenseKey === licenseKey));
};

export const assertCloudPharmacyInventoryReconciled = async (productIds) => {
  const details = useAppStore.getState()?.licenseDetails;
  if (!isPharmacyCloudAuthorityRequired(details) || !productIds.length) return;
  const licenseKey = getLicenseKeyFromDetails(details);
  if (!db.isOpen()) await db.open();
  const products = await db.table(STORES.MENU).bulkGet(productIds);
  const medicineIds = products.filter(isPharmacyMedicine).map((product) => product.id);
  if (!medicineIds.length) return;
  const unresolved = await db.table(STORES.INVENTORY_EVENTS).where('productId').anyOf(medicineIds)
    .filter((event) => event.type === 'INVENTORY_ENTRY'
      && (!event.licenseKey || event.licenseKey === licenseKey)
      && (event.syncDisposition === 'local_only'
        || (event.syncDisposition !== 'cloud_authoritative' && !event.synced))).first();
  if (unresolved) throw domainError('PHARMACY_INVENTORY_REVIEW_REQUIRED',
    inventoryEntryErrors.PHARMACY_INVENTORY_REVIEW_REQUIRED);
};

export const assertNoPendingGeneralPharmacyStock = async (products) => {
  const details = useAppStore.getState()?.licenseDetails;
  const ids = [...new Set(products.filter((product) => isCloudGeneralPharmacyBatchEntry(product, details))
    .map((product) => product.id))];
  if (!ids.length) return;
  const licenseKey = getLicenseKeyFromDetails(details);
  const pending = await db.table(STORES.INVENTORY_EVENTS).where('productId').anyOf(ids)
    .filter((event) => event.type === 'INVENTORY_ENTRY' && !event.synced
      && event.syncDisposition === 'actor_bound' && (!event.licenseKey || event.licenseKey === licenseKey))
    .first();
  if (pending) throw domainError('PHARMACY_GENERAL_STOCK_SYNC_PENDING',
    inventoryEntryErrors.PHARMACY_GENERAL_STOCK_SYNC_PENDING);
};

export const retryCloudInventoryEntry = async (operationId) => {
  const licenseKey = getRuntimeLicenseKey();
  const handle = captureProductInventoryMutation({ inventory: true });
  await assertLocalTenantSyncAccess({ license_key: licenseKey }, { reason: 'pharmacy_receipt_retry' });
  const outbox = db.table(POS_SYNC_STORES.OUTBOX);
  await db.transaction('rw', outbox, async () => {
    assertInventoryMutationCurrent(handle);
    const row = await outbox.where('entityType').equals(SYNC_ENTITY_TYPES.INVENTORY_ENTRY)
      .filter((record) => record.licenseKey === licenseKey && record.idempotencyKey === operationId
        && (record.payload?.cloudPharmacyReceipt === true || record.payload?.cloudInventoryEntry === true
          || record.payload?.entry?.metadata?.pharmacyReceipt)).first();
    if (!row) throw domainError('PHARMACY_INVENTORY_REVIEW_REQUIRED');
    const staleActorConflict = row.status === OUTBOX_STATUS.CONFLICT
      && row.conflictPayload?.code === 'ACTOR_CONTEXT_STALE';
    if ([OUTBOX_STATUS.FAILED, OUTBOX_STATUS.PENDING].includes(row.status) || staleActorConflict) {
      if (row.originActorKey !== handle.actorKey) throw domainError('PHARMACY_CLOUD_SESSION_REQUIRED');
      await outbox.update(row.id, { status: OUTBOX_STATUS.PENDING, nextRetryAt: null, attempts: 0, updatedAt: nowIso() });
    }
  });
};

export const markCloudPharmacyReceiptRejected = async (operationId, code) => {
  await db.table(STORES.INVENTORY_EVENTS).update(`inventory-entry:${operationId}`, {
    rejectionCode: code
  });
};

export const markInventoryEntrySynced = async (operationId, response = null) => {
  if (!operationId || !db.isOpen()) return;
  const eventId = `inventory-entry:${operationId}`;
  await db.table(STORES.INVENTORY_EVENTS).update(eventId, {
    synced: true, syncedAt: nowIso(), cloudResult: response,
    ...(response?.receipt_outcome === 'rejected' ? { rejectionCode: 'PHARMACY_LEGACY_RECEIPT_REJECTED' } : {})
  });
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
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'Esta operación ya existe con datos distintos.',
  PHARMACY_CLASSIFICATION_REQUIRED: 'Confirma la clasificación sanitaria antes de recibir este medicamento.',
  PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE: 'Los medicamentos de fracciones I–III requieren un procedimiento de control especial no disponible en esta recepción.',
  PHARMACY_BATCHES_REQUIRED: 'Activa el control por lotes del medicamento antes de recibir existencias.',
  PHARMACY_PROVENANCE_REQUIRED: 'Registra el proveedor, tipo y referencia del comprobante.',
  PHARMACY_RECEIPT_BATCH_MISMATCH: 'El lote de fabricante, la caducidad y la fecha de recepción deben coincidir con el comprobante.',
  PHARMACY_BATCH_IDENTITY_REQUIRED: 'Registra un lote de fabricante y una caducidad válidos.',
  PHARMACY_EXISTING_BATCH_REQUIRED: 'Ya existe este lote de fabricante: selecciónalo para registrar otra recepción.',
  PHARMACY_ARCHIVED_BATCH_EXISTS: 'Este lote de fabricante ya existe archivado. Revisa su estado en Lotes / historial antes de registrar una recepción; no crees otro lote con la misma identidad.',
  PHARMACY_EXPIRED_BATCH: 'No se pueden recibir lotes vencidos como existencia vendible.',
  PHARMACY_CLOUD_SESSION_REQUIRED: 'Inicia una sesión autorizada para registrar existencias en Nube.',
  PHARMACY_CLOUD_OFFLINE: 'Conéctate a internet para confirmar la recepción.',
  PHARMACY_INVENTORY_REVIEW_REQUIRED: 'El inventario de este medicamento requiere revisión. Hay recepciones anteriores sin conciliar.',
  PHARMACY_GENERAL_STOCK_SYNC_PENDING: 'Hay una entrada de inventario pendiente de confirmar en Nube. Espera a que se sincronice antes de cobrar este producto.',
  PHARMACY_RECEIPT_PENDING: 'Hay una recepción pendiente de verificar. Consulta su estado antes de confirmar otra.',
  BATCH_NOT_FOUND: 'El lote seleccionado no está disponible.'
});
