import { actorRuntimeController } from '../auth/actorRuntimeController';
import {
  assertProductInventoryMutationCurrent,
  captureProductInventoryMutation,
  hasInitialProductStock
} from '../auth/productInventoryAuthority';
import { listLocalOnlyInventoryEntriesForRecovery } from '../inventory/inventoryEntryService';
import { syncOutboxService } from '../sync/syncOutboxService';
import { getLicenseKeyFromDetails, isCloudProductsSyncEnabled, OUTBOX_STATUS, CONFLICT_STATUS, SYNC_ENTITY_TYPES, SYNC_LIMITS } from '../sync/syncConstants';
import { runWithLocalTenantSyncLease, assertLocalTenantAccess } from '../tenant/localTenantGuard';
import { getRecipeIngredientId } from '../../utils/ingredientConfiguration';
import { getPharmacyClassification } from '../../utils/pharmacyClassification';
import { useAppStore } from '../../store/useAppStore';
import { getEcommercePortal, listPublishedProducts } from '../ecommerce/ecommerceAdminService';
import { syncConflictService } from '../sync/syncConflictService';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import {
  productToCloudPayload,
  batchToCloudPayload,
  categoryToCloudPayload,
  cloudProductToLocal,
  cloudBatchToLocal,
  cloudCategoryToLocal,
  normalizeBarcodeKey,
  normalizeNameKey,
  normalizeSkuKey
} from './productMapper';
import { isBatchArchived } from './batchStatus';
import { PRODUCT_SYNC_STATUS } from './productConstants';
import { notifyProductsChanged } from './productEvents';
import { runWithProductCatalogRecoveryLock } from './productCatalogRecoveryLock';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const isDeleted = (record) => Boolean(record?.deletedAt || record?.deleted_at || record?.deletedTimestamp || record?.deleted_timestamp);
const isCloudActive = (record) => !isDeleted(record) && record?.is_active !== false && record?.isActive !== false;
const hasProductPermission = (actor) => actor?.permissions?.includes('*') || actor?.permissions?.includes('products');
const hasInventoryPermission = (actor) => actor?.permissions?.includes('*') || actor?.permissions?.includes('inventory');
const INSPECTION_ACCESS_MESSAGES = Object.freeze({
  SESSION_REQUIRED: 'La sesión vigente terminó o cambió. No se leyó el catálogo; vuelve a iniciar sesión y verifica otra vez.',
  PRODUCT_PERMISSION_REQUIRED: 'Se requiere permiso de Productos para verificar este producto.',
  INVENTORY_PERMISSION_REQUIRED: 'Se requiere permiso de Inventario para verificar existencias y lotes.'
});
const createInspectionAccessError = (code) => Object.assign(
  new Error(INSPECTION_ACCESS_MESSAGES[code] || 'No se autorizó la lectura del producto.'),
  { code }
);
const assertInspectionActor = (deps, expectedSessionId = null) => {
  const actor = deps.actorController.getState();
  if (actor?.status !== 'granted' || !actor?.sessionId || (expectedSessionId && actor.sessionId !== expectedSessionId)) {
    throw createInspectionAccessError('SESSION_REQUIRED');
  }
  if (!hasProductPermission(actor)) throw createInspectionAccessError('PRODUCT_PERMISSION_REQUIRED');
  if (!hasInventoryPermission(actor)) throw createInspectionAccessError('INVENTORY_PERMISSION_REQUIRED');
  return actor;
};
const isProtectedMedicine = (product) => {
  const pharmacy = getPharmacyClassification(product);
  return (pharmacy.recorded && pharmacy.kind === 'medicine')
    || product?.requiresPrescription === true
    || product?.requires_prescription === true
    || ['controlled', 'antibiotic', 'prescription'].includes(product?.prescriptionType || product?.prescription_type);
};
const isTombstoned = (batch) => Boolean(batch?.deletedAt || batch?.deleted_at || batch?.deletedTimestamp || batch?.deleted_timestamp || batch?.deletionPending === true);
const isArchived = (batch) => isTombstoned(batch) || isBatchArchived(batch);
const localProductId = (product) => String(product?.id ?? '');
const localBatchProductId = (batch) => String(batch?.productId ?? batch?.product_id ?? '');
const localCategoryId = (product) => product?.categoryId ?? product?.category_id ?? null;
const batchStatus = (batch) => String(batch?.status || (batch?.isActive === false ? 'inactive' : 'active')).toLowerCase();
const categoryOfCloudProduct = (product) => product?.category_id ?? product?.categoryId ?? null;
const cloudBatchParentId = (batch) => String(batch?.product_id ?? batch?.productId ?? '');
const cloudBatchId = (batch) => String(batch?.id ?? '');
const cloudProductId = (product) => String(product?.id ?? '');
const numericEqual = (left, right) => Math.abs(asNumber(left) - asNumber(right)) < 0.0001;
const textEqual = (left, right) => String(left ?? '') === String(right ?? '');
const dateEqual = (left, right) => String(left ?? '').slice(0, 10) === String(right ?? '').slice(0, 10);
const hasInvalidNumericValue = (value) => value !== undefined && value !== null && value !== '' && !Number.isFinite(Number(value));

const normalizeStableValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizeStableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeStableValue(value[key])]));
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(normalizeStableValue(value));

const fingerprint = (value) => {
  const input = String(value ?? '');
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    const char = BigInt(input.charCodeAt(index));
    first = ((first ^ char) * 0x100000001b3n) & mask;
    second = ((second ^ (char + BigInt(index))) * 0x100000001b3n) & mask;
  }
  return `${first.toString(16).padStart(16, '0')}${second.toString(16).padStart(16, '0')}`;
};

export const buildIndividualRecoveryIdempotencyKey = ({ licenseKey, product, batches = [] } = {}) => (
  `product-local-recovery:v1:${fingerprint(stableStringify({ licenseKey, product, batches }))}`
);

const addIssue = (issues, code, message, entityId = null) => {
  if (!issues.some((issue) => issue.code === code && issue.entityId === entityId)) {
    issues.push({ code, message, entityId });
  }
};

const localInitialBatches = (batches = [], productId) => batches.filter((batch) => (
  localBatchProductId(batch) === String(productId)
  && !isArchived(batch)
));

const batchManagementEnabled = (product = {}) => {
  const mode = product.batchManagement ?? product.batch_management;
  if (mode === true) return true;
  if (!mode || typeof mode !== 'object') return false;
  return mode.enabled === true || mode.manageBatches === true || mode.batchManagement === true
    || mode.useBatches === true || ['batch', 'batches', 'lote', 'lotes', 'fefo'].includes(String(mode.mode || '').toLowerCase());
};

const recipeReferenceIds = (product = {}) => [...new Set((Array.isArray(product.recipe) ? product.recipe : [])
  .map(getRecipeIngredientId).filter(Boolean).map(String))];

const localProjectionIssue = (product, submittedBatches) => {
  if (submittedBatches.length === 0) {
    const requiresLots = String(product?.expirationMode || product?.expiration_mode || '').toUpperCase() !== 'NONE'
      && String(product?.expirationMode || product?.expiration_mode || '').toUpperCase() !== '';
    if ((requiresLots || batchManagementEnabled(product)) && asNumber(product.stock) > 0) {
      return { code: 'INITIAL_LOTS_REQUIRED', message: 'El producto requiere lotes iniciales y no hay lotes activos locales que puedan enviarse.' };
    }
    return null;
  }

  const projectedStock = submittedBatches.reduce((sum, batch) => (
    sum + (batch.isActive !== false && batchStatus(batch) === 'active' ? asNumber(batch.stock) : 0)
  ), 0);
  const projectedCommitted = submittedBatches.reduce((sum, batch) => sum + asNumber(batch.committedStock ?? batch.committed_stock), 0);
  if (!numericEqual(product.stock, projectedStock)) {
    return { code: 'PRODUCT_BATCH_STOCK_MISMATCH', message: 'La existencia del producto no coincide con la suma proyectada por sus lotes activos.' };
  }
  if (!numericEqual(product.committedStock ?? product.committed_stock, projectedCommitted)) {
    return { code: 'PRODUCT_BATCH_COMMITTED_MISMATCH', message: 'El stock comprometido del producto no coincide con sus lotes.' };
  }

  const hasVariants = submittedBatches.some((batch) => (
    batch.attributes && typeof batch.attributes === 'object' && Object.keys(batch.attributes).length > 0
  ));
  if (!hasVariants && projectedStock > 0) {
    const projectedCost = Number((submittedBatches.reduce((sum, batch) => sum + asNumber(batch.stock) * asNumber(batch.cost), 0) / projectedStock).toFixed(4));
    if (!numericEqual(product.cost, projectedCost)) {
      return { code: 'PRODUCT_BATCH_COST_MISMATCH', message: 'El costo del producto cambiaría al recalcularse desde los lotes.' };
    }
  }
  return null;
};

const checkProductPayload = (local, cloud) => {
  if (!local || !cloud) return false;
  const expected = productToCloudPayload(local);
  const sameJsonValue = (left, right) => stableStringify(left ?? null) === stableStringify(right ?? null);
  return cloudProductId(cloud) === String(expected.id)
    && textEqual(categoryOfCloudProduct(cloud), expected.category_id)
    && textEqual(cloud.name, expected.name)
    && textEqual(cloud.description, expected.description)
    && textEqual(cloud.barcode ?? cloud.barCode, expected.barcode)
    && textEqual(cloud.barcode_key ?? cloud.barcodeKey, expected.barcode_key)
    && textEqual(cloud.sku ?? cloud.SKU, expected.sku)
    && textEqual(cloud.sku_key ?? cloud.skuKey, expected.sku_key)
    && numericEqual(cloud.price, expected.price)
    && numericEqual(cloud.cost, expected.cost)
    && numericEqual(cloud.stock, expected.stock)
    && numericEqual(cloud.committed_stock ?? cloud.committedStock, expected.committed_stock)
    && (cloud.track_stock ?? cloud.trackStock) === expected.track_stock
    && (cloud.is_active ?? cloud.isActive) === expected.is_active
    && textEqual(cloud.product_type ?? cloud.productType, expected.product_type)
    && textEqual(cloud.sale_type ?? cloud.saleType, expected.sale_type)
    && sameJsonValue(cloud.batch_management ?? cloud.batchManagement, expected.batch_management)
    && sameJsonValue(cloud.recipe, expected.recipe)
    && sameJsonValue(cloud.modifiers, expected.modifiers)
    && textEqual(cloud.prescription_type ?? cloud.prescriptionType, expected.prescription_type)
    && textEqual(cloud.active_substance ?? cloud.activeSubstance, expected.active_substance)
    && textEqual(cloud.laboratory, expected.laboratory)
    && (cloud.requires_prescription ?? cloud.requiresPrescription) === expected.requires_prescription
    && textEqual(cloud.presentation, expected.presentation)
    && textEqual(String(cloud.expiration_mode ?? cloud.expirationMode ?? 'NONE').toUpperCase(), expected.expiration_mode)
    && numericEqual(cloud.shelf_life_value ?? cloud.shelfLifeValue, expected.shelf_life_value)
    && textEqual(cloud.shelf_life_unit ?? cloud.shelfLifeUnit, expected.shelf_life_unit)
    && (!expected.metadata?.rubro_context
      || textEqual(cloud.metadata?.rubro_context ?? cloud.metadata?.rubroContext, expected.metadata.rubro_context));
};

const checkCategoryPayload = (local, cloud) => {
  if (!local || !cloud || isDeleted(cloud) || !isCloudActive(cloud)) return false;
  const expected = categoryToCloudPayload(local);
  return String(cloud.id) === String(expected.id)
    && textEqual(cloud.name, expected.name)
    && textEqual(cloud.name_key ?? cloud.nameKey, expected.name_key)
    && textEqual(cloud.color, expected.color)
    && Number(cloud.sort_order ?? cloud.sortOrder ?? 0) === expected.sort_order
    && (cloud.is_active ?? cloud.isActive) !== false;
};

const checkBatchPayload = (local, cloud) => {
  if (!local || !cloud) return false;
  const expected = batchToCloudPayload(local);
  const sameJsonValue = (left, right) => stableStringify(left ?? null) === stableStringify(right ?? null);
  return cloudBatchId(cloud) === String(expected.id)
    && cloudBatchParentId(cloud) === String(expected.product_id)
    && numericEqual(cloud.stock, expected.stock)
    && numericEqual(cloud.committed_stock ?? cloud.committedStock, expected.committed_stock)
    && numericEqual(cloud.price, expected.price)
    && numericEqual(cloud.cost, expected.cost)
    && (cloud.track_stock ?? cloud.trackStock) === expected.track_stock
    && (cloud.is_active ?? cloud.isActive) === expected.is_active
    && textEqual(cloud.status, expected.status)
    && textEqual(cloud.sku, expected.sku)
    && textEqual(cloud.sku_key ?? cloud.skuKey, expected.sku_key)
    && dateEqual(cloud.expiry_date ?? cloud.expiryDate, expected.expiry_date)
    && textEqual(cloud.manufacturer_batch_id ?? cloud.manufacturerBatchId, expected.manufacturer_batch_id)
    && textEqual(cloud.supplier, expected.supplier)
    && sameJsonValue(cloud.attributes, expected.attributes)
    && dateEqual(cloud.alert_target_date ?? cloud.alertTargetDate, expected.alert_target_date)
    && textEqual(cloud.alert_type ?? cloud.alertType, expected.alert_type);
};

const withoutCloudTimestamps = (payload) => {
  const businessPayload = { ...(payload || {}) };
  delete businessPayload.created_at;
  delete businessPayload.updated_at;
  for (const field of ['recipe', 'wholesale_tiers']) {
    if (businessPayload[field] === null || businessPayload[field] === undefined) businessPayload[field] = [];
  }
  return businessPayload;
};

const completeCloudPayloadMatches = (local, cloud, toPayload, fromCloud) => Boolean(local && cloud)
  && stableStringify(withoutCloudTimestamps(toPayload(local)))
    === stableStringify(withoutCloudTimestamps(toPayload(fromCloud(cloud, null))));

// Compare the full writable catalog payload after the canonical Cloud-to-local mapping.
// This tolerates mapper normalization (for example null optional arrays) while checking
// quantities, attributes, metadata, and every other field that recovery writes.
const checkCompleteProductPayload = (local, cloud) => (
  completeCloudPayloadMatches(local, cloud, productToCloudPayload, cloudProductToLocal)
);

const checkCompleteCategoryPayload = (local, cloud) => (
  completeCloudPayloadMatches(local, cloud, categoryToCloudPayload, cloudCategoryToLocal)
);

const checkCompleteBatchPayload = (local, cloud) => (
  completeCloudPayloadMatches(local, cloud, batchToCloudPayload, cloudBatchToLocal)
);

const hasCloudProductKeyConflict = (product, cloudProducts) => {
  const sku = normalizeSkuKey(product?.sku_normalized || product?.sku);
  const barcode = normalizeBarcodeKey(product?.barcode_normalized || product?.barcode);
  return cloudProducts.find((row) => cloudProductId(row) !== localProductId(product) && (
    (sku && normalizeSkuKey(row.sku_key || row.skuKey || row.sku) === sku)
    || (barcode && normalizeBarcodeKey(row.barcode_key || row.barcodeKey || row.barcode) === barcode)
  )) || null;
};

export const assessIndividualProductRecovery = ({
  licenseKey,
  requestedLicenseMatches = true,
  cloudSyncEnabled = true,
  online = true,
  lockSupported = true,
  actor = { status: 'granted', sessionId: 'session', permissions: ['*'] },
  product,
  productTombstone = null,
  localBatches = [],
  localCategory = null,
  localCategoryTombstone = null,
  localIngredients = [],
  portalExists = true,
  portalIssue = null,
  publicationIssue = null,
  publicationsVerified = true,
  publications = [],
  cloudProducts = [],
  cloudBatches = [],
  cloudCategories = [],
  outboxRows = [],
  localOnlyInventoryEvents = [],
  conflictRows = []
} = {}) => {
  const issues = [];
  const productId = localProductId(product);
  const batches = localBatches.filter((batch) => localBatchProductId(batch) === productId);
  const archivedBatches = batches.filter(isArchived);
  const initialBatches = localInitialBatches(batches, productId);
  const inventoryRequired = initialBatches.length > 0 || hasInitialProductStock(product || {});
  const actorValid = actor?.status === 'granted' && Boolean(actor?.sessionId);
  const hasProducts = actorValid && hasProductPermission(actor);
  const hasInventory = actorValid && hasInventoryPermission(actor);
  const cloudProductsForId = cloudProducts.filter((row) => cloudProductId(row) === productId);
  const cloudBatchesForProduct = cloudBatches.filter((row) => cloudBatchParentId(row) === productId);
  const cloudBatchById = new Map(cloudBatches.map((row) => [cloudBatchId(row), row]));
  const publicationMatches = publications.filter((row) => String(row?.localProductRef ?? '') === productId);
  const publication = publicationMatches.length === 1 ? publicationMatches[0] : null;
  const localStock = product?.stock;
  // The admin snapshot identifies stock depletion separately from manual and configuration blocks.
  const publicationDepleted = publication?.isAvailable === false
    && (localStock === 0 || (typeof localStock === 'string' && localStock.trim() !== '' && Number(localStock) === 0))
    && (product.trackStock ?? product.track_stock) !== false
    && publication.manualAvailable === true
    && publication.sourceAvailable === false
    && publication.sourceState === 'out_of_stock'
    && publication.stockSnapshot === 0
    && publication.requiresConfiguration === false
    && publication.availabilitySource === 'direct'
    && (publication.availabilityReasonCode == null || publication.availabilityReasonCode === 'SOURCE_STOCK_ZERO')
    && ['compatible', 'simple_override'].includes(publication.businessCapabilityStatus)
    && ['compatible', 'simple_override'].includes(publication.publicConfigurationMode)
    && publication.syncErrorCode == null;
  const activeCloudProduct = cloudProductsForId.find(isCloudActive) || null;
  const categoryId = localCategoryId(product);
  const cloudRecovery = product ? cloudRecoveryMatches({
    product, batches: initialBatches, localBatches: batches, cloudProducts, cloudBatches
  }) : { success: false };
  const existingCloudRows = cloudProductsForId.length > 0 || cloudBatchesForProduct.length > 0;
  const existingCloudComplete = existingCloudRows && cloudRecovery.success;
  const batchSummary = batches.map((batch) => {
    const cloud = cloudBatchById.get(String(batch.id)) || null;
    const archived = isArchived(batch);
    return {
      id: String(batch.id),
      label: batch.manufacturerBatchId || batch.manufacturer_batch_id || batch.sku || 'Lote sin identificador adicional',
      stock: asNumber(batch.stock),
      committedStock: asNumber(batch.committedStock ?? batch.committed_stock),
      cost: batch.cost,
      price: batch.price,
      productId: localBatchProductId(batch),
      sku: batch.sku,
      attributes: batch.attributes,
      manufacturerBatchId: batch.manufacturerBatchId ?? batch.manufacturer_batch_id,
      status: archived ? 'archived' : batchStatus(batch),
      expiryDate: batch.expiryDate ?? batch.expiry_date ?? null,
      cloudStatus: !cloud ? 'absent' : (isDeleted(cloud) ? 'deleted' : (isCloudActive(cloud) ? 'active' : 'inactive')),
      action: archived ? 'keep_local' : 'recover'
    };
  });

  if (!licenseKey || !requestedLicenseMatches) addIssue(issues, 'TENANT_CONTEXT_MISMATCH', 'El negocio activo no coincide con el contexto de esta recuperación.');
  if (!online) addIssue(issues, 'OFFLINE', 'Se necesita conexión para verificar la fuente Cloud.');
  if (!cloudSyncEnabled) addIssue(issues, 'CLOUD_SYNC_DISABLED', 'La sincronización Cloud de productos no está habilitada para este negocio.');
  if (!lockSupported) addIssue(issues, 'RECOVERY_LOCK_UNAVAILABLE', 'Este navegador no ofrece bloqueo exclusivo; no se habilitará la recuperación.');
  if (!actorValid) addIssue(issues, 'SESSION_REQUIRED', 'La sesión vigente del administrador o del staff no está disponible.');
  if (!hasProducts) addIssue(issues, 'PRODUCT_PERMISSION_REQUIRED', 'Se requiere permiso de Productos para recuperar la fuente.');
  if (inventoryRequired && !hasInventory) addIssue(issues, 'INVENTORY_PERMISSION_REQUIRED', 'Se requiere permiso de Inventario para escribir stock o lotes.');
  if (!productId) addIssue(issues, 'PRODUCT_ID_REQUIRED', 'El producto local no tiene un identificador original válido.');
  if (!product) addIssue(issues, 'LOCAL_PRODUCT_NOT_FOUND', 'No se encontró el producto en el catálogo local de este negocio.', productId || null);
  if (product && (product.isActive === false || isDeleted(product))) {
    addIssue(issues, 'LOCAL_PRODUCT_NOT_ACTIVE', 'El producto local está inactivo o eliminado; no se recuperará como producto comprable.', productId);
  }
  if (product && [product.stock, product.committedStock ?? product.committed_stock, product.cost, product.price]
    .some((value) => hasInvalidNumericValue(value) || asNumber(value) < 0)) {
    addIssue(issues, 'LOCAL_PRODUCT_NUMERIC_INVALID', 'El producto tiene cantidades o valores negativos o inválidos; no se normalizarán automáticamente.', productId);
  }
  if (productTombstone) addIssue(issues, 'LOCAL_PRODUCT_TOMBSTONE', 'Existe una eliminación local pendiente para el mismo ID.', productId);
  if (product?.syncStatus === PRODUCT_SYNC_STATUS.CONFLICT || product?.conflictReason) {
    addIssue(issues, 'LOCAL_PRODUCT_CONFLICT', 'El producto tiene un conflicto local que requiere conciliación antes de recuperar.', productId);
  }
  if ([PRODUCT_SYNC_STATUS.PENDING, PRODUCT_SYNC_STATUS.ERROR].includes(product?.syncStatus)) {
    addIssue(issues, 'LOCAL_PRODUCT_OPERATION_UNRESOLVED', 'El producto tiene un cambio pendiente o fallido que requiere revisión antes de recuperar.', productId);
  }
  if (product?.pendingOperationId) addIssue(issues, 'LOCAL_PRODUCT_OPERATION_PENDING', 'El producto tiene una operación local pendiente.', productId);

  if (portalIssue || (portalExists !== true && portalExists !== false)) {
    addIssue(issues, portalIssue?.code || 'PORTAL_STATE_UNVERIFIED', portalIssue?.message || 'No se pudo confirmar si existe un portal o si su lectura terminó completa; la acción queda bloqueada mientras se muestran las verificaciones Cloud independientes.', productId || null);
  } else if (portalExists === true && !publicationsVerified) {
    addIssue(issues, publicationIssue?.code || 'PUBLICATION_STATE_UNVERIFIED', publicationIssue?.message || 'El portal existe, pero la lista completa de publicaciones no se pudo confirmar.', productId || null);
  } else if (portalExists === true) {
    if (publicationMatches.length !== 1) {
      addIssue(issues, publicationMatches.length === 0 ? 'PUBLICATION_NOT_FOUND' : 'PUBLICATION_AMBIGUOUS',
        publicationMatches.length === 0
          ? 'No existe una publicación vinculada por localProductRef al ID original.'
          : 'Más de una publicación apunta al mismo ID local; la relación requiere conciliación.', productId || null);
    } else if (publication.sourceType !== 'local_snapshot'
      || (publication.productId && String(publication.productId) !== productId)
      || publication.isPublished !== true
      || (publication.isAvailable !== true && !publicationDepleted)) {
      addIssue(issues, 'PUBLICATION_SOURCE_MISMATCH', 'Se requiere una publicación local_snapshot vinculada al producto original, publicada y con disponibilidad o agotamiento confirmado.', publication.id || null);
    }
  }

  if (cloudProductsForId.length > 1) {
    addIssue(issues, 'CLOUD_PRODUCT_ID_AMBIGUOUS', 'Cloud devolvió más de una fila para el ID del producto.', productId);
  } else if (existingCloudRows && !existingCloudComplete && cloudProductsForId.length > 0) {
    const cloudRow = cloudProductsForId[0];
    addIssue(issues, isDeleted(cloudRow) ? 'CLOUD_PRODUCT_TOMBSTONE' : 'CLOUD_PRODUCT_RECONCILIATION_REQUIRED',
      isDeleted(cloudRow)
        ? 'Cloud ya conserva una eliminación con el ID original; no se resucitará.'
        : 'Cloud ya contiene el producto, pero su conjunto no coincide exactamente con el producto y los lotes locales; se requiere conciliación antes de escribir.', productId);
  }

  if (categoryId) {
    if (!localCategory || String(localCategory.id) !== String(categoryId) || localCategory.isActive === false || isDeleted(localCategory)) {
      addIssue(issues, 'LOCAL_CATEGORY_REFERENCE_INVALID', 'La categoría referenciada no existe o no está activa en el catálogo local.', String(categoryId));
    }
    if (localCategory?.deletionPending === true) {
      addIssue(issues, 'LOCAL_CATEGORY_TOMBSTONE', 'La categoría referenciada tiene una eliminación local pendiente.', String(categoryId));
    }
    if (!String(localCategory?.name || '').trim()) {
      addIssue(issues, 'LOCAL_CATEGORY_IDENTITY_INVALID', 'La categoría local no tiene un nombre para confirmar su ID en Cloud.', String(categoryId));
    }
    const categoryLicenseKey = localCategory?.licenseKey || localCategory?.license_key
      || localCategory?.metadata?.licenseKey || localCategory?.metadata?.license_key;
    if (categoryLicenseKey && categoryLicenseKey !== licenseKey) {
      addIssue(issues, 'LOCAL_CATEGORY_TENANT_MISMATCH', 'La categoría local registra un negocio distinto; no se escribirá en Cloud.', String(categoryId));
    }
    if (localCategoryTombstone) addIssue(issues, 'LOCAL_CATEGORY_TOMBSTONE', 'La categoría referenciada tiene una eliminación local pendiente.', String(categoryId));
    if ([PRODUCT_SYNC_STATUS.PENDING, PRODUCT_SYNC_STATUS.ERROR].includes(localCategory?.syncStatus)
      || localCategory?.pendingOperationId) {
      addIssue(issues, 'LOCAL_CATEGORY_OPERATION_UNRESOLVED', 'La categoría tiene un cambio local pendiente o fallido que requiere conciliación.', String(categoryId));
    }
    if (localCategory?.syncStatus === PRODUCT_SYNC_STATUS.CONFLICT || localCategory?.conflictReason) {
      addIssue(issues, 'LOCAL_CATEGORY_CONFLICT', 'La categoría tiene un conflicto local que requiere conciliación.', String(categoryId));
    }
    const matchingCloudCategories = cloudCategories.filter((row) => String(row.id) === String(categoryId));
    const categoryNameKey = normalizeNameKey(localCategory?.name || '');
    const cloudNameConflict = cloudCategories.find((row) => String(row.id) !== String(categoryId)
      && normalizeNameKey(row.name || row.name_key || row.nameKey || '') === categoryNameKey);
    if (cloudNameConflict) {
      addIssue(issues, 'CLOUD_CATEGORY_NAME_CONFLICT', 'Cloud ya contiene otra categoría con el mismo nombre y un ID distinto.', String(cloudNameConflict.id));
    }
    if (matchingCloudCategories.length > 1) {
      addIssue(issues, 'CLOUD_CATEGORY_ID_AMBIGUOUS', 'Cloud devolvió más de una fila para el ID original de la categoría.', String(categoryId));
    } else if (matchingCloudCategories.length === 1 && !checkCategoryPayload(localCategory, matchingCloudCategories[0])) {
      const row = matchingCloudCategories[0];
      addIssue(issues, isDeleted(row) ? 'CLOUD_CATEGORY_TOMBSTONE' : 'CLOUD_CATEGORY_ID_CONFLICT',
        isDeleted(row)
          ? 'Cloud conserva una eliminación para esta categoría; no se restaurará.'
          : 'Cloud ya usa el ID original para una categoría diferente; no se sobrescribirá.', String(categoryId));
    }
  }

  const cloudProductIds = new Set(cloudProducts.filter(isCloudActive).map(cloudProductId));
  const ingredientMap = new Map(localIngredients.filter(Boolean).map((ingredient) => [String(ingredient.id), ingredient]));
  for (const ingredientId of recipeReferenceIds(product || {})) {
    const ingredient = ingredientMap.get(ingredientId);
    if (!ingredient || ingredient.isActive === false || isDeleted(ingredient)) {
      addIssue(issues, 'LOCAL_RECIPE_REFERENCE_INVALID', 'Una referencia de receta no está activa en el catálogo local.', ingredientId);
    } else if (!cloudProductIds.has(ingredientId)) {
      addIssue(issues, 'CLOUD_RECIPE_REFERENCE_MISSING', 'Una referencia de receta no tiene fuente Cloud activa; no se migrarán productos relacionados.', ingredientId);
    }
  }

  for (const batch of batches) {
    if (!batch?.id || localBatchProductId(batch) !== productId) {
      addIssue(issues, 'LOCAL_BATCH_IDENTITY_INVALID', 'Un lote no conserva un ID o producto padre válido.', batch?.id || null);
    }
    if (asNumber(batch.stock) < 0 || asNumber(batch.committedStock ?? batch.committed_stock) < 0) {
      addIssue(issues, 'LOCAL_BATCH_STOCK_INVALID', 'Un lote tiene existencias o compromiso negativo.', batch?.id || null);
    }
    if ([batch.stock, batch.committedStock ?? batch.committed_stock, batch.cost, batch.price]
      .some((value) => hasInvalidNumericValue(value) || asNumber(value) < 0)) {
      addIssue(issues, 'LOCAL_BATCH_NUMERIC_INVALID', 'Un lote tiene cantidades o valores negativos o inválidos; no se normalizará automáticamente.', batch?.id || null);
    }
    if (batch?.syncStatus === PRODUCT_SYNC_STATUS.CONFLICT || batch?.conflictReason) {
      addIssue(issues, 'LOCAL_BATCH_CONFLICT', 'Un lote tiene un conflicto local que requiere conciliación.', batch.id);
    }
    if ([PRODUCT_SYNC_STATUS.PENDING, PRODUCT_SYNC_STATUS.ERROR].includes(batch?.syncStatus) || batch?.pendingOperationId) {
      addIssue(issues, 'LOCAL_BATCH_OPERATION_UNRESOLVED', 'Un lote tiene un cambio pendiente o fallido que requiere revisión antes de recuperar.', batch.id);
    }
    const cloud = cloudBatchById.get(String(batch.id));
    if (isArchived(batch)) {
      if (asNumber(batch.stock) > 0 || asNumber(batch.committedStock ?? batch.committed_stock) > 0) {
        addIssue(issues, 'ARCHIVED_BATCH_HAS_STOCK', 'Un lote archivado o eliminado todavía tiene stock o compromiso positivo; no se recuperará.', batch.id);
      }
      if (cloud && !isDeleted(cloud) && isCloudActive(cloud)) {
        addIssue(issues, 'ARCHIVED_BATCH_CLOUD_ACTIVE', 'El lote archivado sigue activo en Cloud; no se borrará ni se reactivará automáticamente.', batch.id);
      }
    } else if (cloud && !existingCloudComplete) {
      addIssue(issues, isDeleted(cloud) ? 'ACTIVE_BATCH_CLOUD_TOMBSTONE' : 'ACTIVE_BATCH_CLOUD_RECONCILIATION_REQUIRED',
        isDeleted(cloud)
          ? 'Cloud conserva una eliminación para un lote local activo; requiere conciliación.'
          : 'Cloud ya contiene este lote, pero el conjunto completo no coincide exactamente; no se sobrescribirá.', batch.id);
    }
    if (!isArchived(batch)
      && String(product?.expirationMode || product?.expiration_mode || '').toUpperCase() === 'STRICT'
      && asNumber(batch.stock) > 0
      && (!batch.expiryDate && !batch.expiry_date || !String(batch.manufacturerBatchId || batch.manufacturer_batch_id || '').trim())) {
      addIssue(issues, 'STRICT_BATCH_IDENTITY_REQUIRED', 'El lote STRICT con stock positivo requiere caducidad e identificador de fabricante.', batch.id);
    }
  }

  const unexpectedCloudBatches = cloudBatchesForProduct.filter((cloud) => (
    !batches.some((local) => String(local.id) === cloudBatchId(cloud))
  ));
  if (unexpectedCloudBatches.length) {
    addIssue(issues, 'CLOUD_BATCH_SET_MISMATCH', 'Cloud contiene lotes del producto que no existen localmente; se requiere conciliación.', productId);
  }

  const projectionIssue = product ? localProjectionIssue(product, initialBatches) : null;
  if (projectionIssue) addIssue(issues, projectionIssue.code, projectionIssue.message, productId);

  if (product && isProtectedMedicine(product)
    && (hasInitialProductStock(product) || initialBatches.some((batch) => asNumber(batch.stock) > 0))) {
    addIssue(issues, 'PHARMACY_DOCUMENTED_RECEIPT_REQUIRED',
      'La guarda instalada bloquea stock inicial positivo de un medicamento protegido en pos_upsert_product. Se requiere una recepción documentada o una autorización oficial de importación; esta acción no reconstruye existencias.', productId);
  }

  const cloudKeyConflict = product ? hasCloudProductKeyConflict(product, cloudProducts) : null;
  if (cloudKeyConflict) addIssue(issues, 'CLOUD_PRODUCT_KEY_CONFLICT', 'El SKU o código de barras original ya pertenece a otro producto Cloud.', cloudProductId(cloudKeyConflict));

  const unsyncedOutbox = outboxRows.filter((row) => row?.status !== OUTBOX_STATUS.SYNCED);
  if (unsyncedOutbox.length) addIssue(issues, 'CATALOG_OPERATION_UNRESOLVED', 'Hay operaciones de categoría, producto, lote o inventario pendientes o conflictivas para este producto.', productId);
  const relevantConflictRows = conflictRows.filter((row) => row?.status === CONFLICT_STATUS.PENDING);
  if (relevantConflictRows.length) addIssue(issues, 'LOCAL_SYNC_CONFLICT_PENDING', 'Hay un conflicto local pendiente para la categoría, el producto o uno de sus lotes.', productId);
  const localOnlyEvents = localOnlyInventoryEvents.filter((event) => String(event?.productId ?? event?.product_id ?? '') === productId);
  if (localOnlyEvents.length) addIssue(issues, 'LOCAL_ONLY_INVENTORY_HISTORY', 'Hay movimientos de inventario local sin confirmación Cloud; se conservan sin reconstruirlos.', productId);

  const stock = asNumber(product?.stock);
  const committedStock = asNumber(product?.committedStock ?? product?.committed_stock);
  const existingSourceState = existingCloudComplete ? 'verified' : (existingCloudRows ? 'requires_reconciliation' : 'missing');
  const recoveryPayload = product ? productToCloudPayload(product) : null;
  const ingredientReferences = recipeReferenceIds(product || {}).map((id) => {
    const localIngredient = ingredientMap.get(id);
    return {
      id,
      name: localIngredient?.name || null,
      local: localIngredient && localIngredient.isActive !== false && !isDeleted(localIngredient) ? 'active' : 'missing',
      cloud: cloudProductIds.has(id) ? 'active' : 'missing'
    };
  });
  const idempotencyKey = product
    ? buildIndividualRecoveryIdempotencyKey({ licenseKey, product, batches: initialBatches })
    : null;
  const canRecover = issues.length === 0 && Boolean(product)
    && (portalExists === false || (portalExists === true && publicationsVerified && Boolean(publication)))
    && initialBatches.every((batch) => (
    localBatchProductId(batch) === productId
  ));

  return {
    success: true,
    canRecover,
    status: canRecover ? (existingCloudComplete ? 'cloud_matches' : 'ready')
      : (existingCloudRows && !existingCloudComplete ? 'cloud_conflict' : 'blocked'),
    product: product ? {
      id: productId,
      name: product.name || '',
      cost: product.cost,
      price: product.price,
      productType: product.productType ?? product.product_type,
      sku: product.sku,
      barcode: product.barcode,
      rubroContext: product.rubroContext ?? product.rubro_context ?? product.metadata?.rubro_context ?? product.metadata?.rubroContext,
      expirationMode: product.expirationMode ?? product.expiration_mode,
      localStatus: product.syncStatus || PRODUCT_SYNC_STATUS.LOCAL,
      active: product.isActive !== false && !isDeleted(product),
      stock,
      committedStock,
      trackStock: (product.trackStock ?? product.track_stock) !== false,
      categoryId: categoryId ? String(categoryId) : null,
      references: {
        category: categoryId ? {
          id: String(categoryId),
          name: localCategory?.name || null,
          local: localCategory && localCategory.isActive !== false && !isDeleted(localCategory) ? 'active' : 'missing',
          cloud: cloudCategories.some((row) => String(row.id) === String(categoryId) && checkCategoryPayload(localCategory, row)) ? 'active' : 'missing',
          action: cloudCategories.some((row) => String(row.id) === String(categoryId) && checkCategoryPayload(localCategory, row))
            ? 'confirmed'
            : 'create_with_original_id'
        } : null,
        recipe: ingredientReferences
      },
      pharmacy: {
        ...getPharmacyClassification(product),
        protectedMedicine: isProtectedMedicine(product)
      }
    } : null,
    cloud: {
      product: existingSourceState,
      productId: activeCloudProduct?.id || null,
      batchIds: cloudBatchesForProduct.filter(isCloudActive).map(cloudBatchId)
    },
    portal: { exists: portalExists, verified: portalExists === true || portalExists === false },
    publication: publication ? {
      id: publication.id,
      sourceType: publication.sourceType,
      productId: publication.productId || null,
      localProductRef: publication.localProductRef,
      isPublished: publication.isPublished === true,
      isAvailable: publication.isAvailable === true,
      syncStatus: publication.syncStatus || null
    } : null,
    batches: batchSummary,
    operations: {
      unresolved: unsyncedOutbox.length,
      localOnlyInventory: localOnlyEvents.length
    },
    permissions: {
      session: actorValid,
      products: hasProducts,
      inventoryRequired,
      inventory: hasInventory
    },
    recovery: {
      entityCount: 1,
      existingCloudComplete,
      categoryId: categoryId ? String(categoryId) : null,
      batchIds: initialBatches.map((batch) => String(batch.id)),
      omittedArchivedBatchIds: archivedBatches.map((batch) => String(batch.id)),
      expectedProduct: recoveryPayload,
      idempotencyKey
    },
    issues
  };
};

const readCloudRows = async (cloudRepository, licenseKey, entityType) => {
  const records = [];
  let offset = 0;
  let snapshotTotal = null;
  let snapshotChangeSeq = null;
  while (true) {
    const requestedLimit = SYNC_LIMITS.MAX_PULL_LIMIT;
    const response = await cloudRepository.pullCatalogSnapshot({
      licenseKey,
      entityType,
      offset,
      limit: requestedLimit,
      includeDeleted: true,
      force: true
    });
    if (response?.success !== true) {
      throw Object.assign(new Error(response?.message || 'No se pudo verificar el catálogo Cloud.'), {
        code: response?.code || 'PRODUCT_RECOVERY_CLOUD_READ_FAILED'
      });
    }
    const collection = entityType === 'product'
      ? response.products
      : entityType === 'product_batch' ? response.batches : response.categories;
    if (!Array.isArray(collection)) {
      throw Object.assign(new Error('La respuesta del catálogo Cloud no contiene una colección válida.'), {
        code: 'PRODUCT_RECOVERY_CLOUD_RESPONSE_INVALID'
      });
    }
    const responseOffset = Number(response.offset);
    const responseLimit = Number(response.limit);
    const total = Number(response.total);
    const changeSeq = Number(response.latest_change_seq);
    if (!Number.isInteger(responseOffset)
      || responseOffset !== offset
      || response.entity_type !== entityType
      || !Number.isInteger(responseLimit)
      || responseLimit !== requestedLimit
      || !Number.isInteger(total)
      || total < 0
      || !Number.isSafeInteger(changeSeq)
      || changeSeq < 0
      || typeof response.has_more !== 'boolean') {
      throw Object.assign(new Error('La respuesta Cloud no confirma el total ni la página completa del catálogo.'), {
        code: 'PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE'
      });
    }
    if (snapshotTotal === null) {
      snapshotTotal = total;
      snapshotChangeSeq = changeSeq;
    } else if (snapshotTotal !== total || snapshotChangeSeq !== changeSeq) {
      throw Object.assign(new Error('El catálogo Cloud cambió durante la paginación.'), {
        code: 'PRODUCT_RECOVERY_CLOUD_SNAPSHOT_CHANGED'
      });
    }
    const expectedPageSize = Math.min(responseLimit, Math.max(0, total - offset));
    const expectedHasMore = offset + responseLimit < total;
    if (collection.length !== expectedPageSize || response.has_more !== expectedHasMore) {
      throw Object.assign(new Error('La página recibida no coincide con el total informado por Cloud.'), {
        code: 'PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE'
      });
    }
    records.push(...collection);
    if (!response.has_more) {
      records.snapshotMeta = { total: snapshotTotal, latestChangeSeq: snapshotChangeSeq };
      return records;
    }
    if (collection.length === 0) throw Object.assign(new Error('La paginación del catálogo Cloud no avanzó.'), {
      code: 'PRODUCT_RECOVERY_CLOUD_PAGINATION_STALLED'
    });
    offset += collection.length;
  }
};

const readCloudCatalogSnapshot = async (deps, licenseKey) => {
  const [cloudProducts, cloudBatches, cloudCategories] = await Promise.all([
    readCloudRows(deps.cloudRepository, licenseKey, 'product'),
    readCloudRows(deps.cloudRepository, licenseKey, 'product_batch'),
    readCloudRows(deps.cloudRepository, licenseKey, 'category')
  ]);
  const changeSeqs = new Set([
    cloudProducts.snapshotMeta?.latestChangeSeq,
    cloudBatches.snapshotMeta?.latestChangeSeq,
    cloudCategories.snapshotMeta?.latestChangeSeq
  ]);
  if (changeSeqs.size !== 1) {
    throw Object.assign(new Error('Las tres lecturas Cloud no corresponden a la misma revisión del catálogo.'), {
      code: 'PRODUCT_RECOVERY_CLOUD_SNAPSHOT_CHANGED'
    });
  }
  return { cloudProducts, cloudBatches, cloudCategories };
};

const getCurrentState = (deps) => deps.getAppState();

const getRecoveryContext = (deps, requestedLicenseKey = null) => {
  const appState = getCurrentState(deps);
  const currentLicenseKey = getLicenseKeyFromDetails(appState?.licenseDetails);
  return {
    appState,
    currentLicenseKey,
    licenseKey: requestedLicenseKey || currentLicenseKey,
    requestedLicenseMatches: Boolean(currentLicenseKey && (!requestedLicenseKey || requestedLicenseKey === currentLicenseKey))
  };
};

const assertRecoveryTenant = (deps, expectedLicenseKey) => {
  const context = getRecoveryContext(deps, expectedLicenseKey);
  if (!context.requestedLicenseMatches) {
    throw Object.assign(new Error('El negocio activo cambió durante la verificación.'), {
      code: 'TENANT_CONTEXT_MISMATCH'
    });
  }
};

const readLocalProductSnapshot = async (deps, productId) => {
  const product = await deps.localRepository.getProductById(productId);
  const [localBatches, productTombstone] = await Promise.all([
    deps.localRepository.getBatchesByProductId(productId),
    deps.localRepository.getProductDeletionTombstoneById(productId)
  ]);
  const categoryId = localCategoryId(product);
  const [localCategory, localCategoryTombstone] = categoryId
    ? await Promise.all([
      deps.localRepository.getCategoryById(categoryId),
      deps.localRepository.getDeletedCategoryById(categoryId)
    ])
    : [null, null];
  const ingredientIds = recipeReferenceIds(product || {});
  const localIngredients = await Promise.all(ingredientIds.map((id) => deps.localRepository.getProductById(id)));
  return { product, localBatches, productTombstone, localCategory, localCategoryTombstone, localIngredients };
};

const readCloudSnapshot = async (deps, licenseKey) => {
  const [catalog, portalResult] = await Promise.all([
    readCloudCatalogSnapshot(deps, licenseKey),
    Promise.resolve().then(() => deps.getEcommercePortal())
      .then((response) => ({ response }))
      .catch((error) => ({ error }))
  ]);
  const portalResponse = portalResult.response;
  const portalEnvelopeComplete = portalResponse?.success === true
    && Object.prototype.hasOwnProperty.call(portalResponse || {}, 'portal')
    && portalResponse.plan && typeof portalResponse.plan === 'object'
    && !Array.isArray(portalResponse.plan)
    && portalResponse.features && typeof portalResponse.features === 'object'
    && !Array.isArray(portalResponse.features)
    && typeof portalResponse.timezone === 'string'
    && typeof portalResponse.ordersPaused === 'boolean'
    && Number.isInteger(portalResponse.publishedProductCount)
    && portalResponse.publishedProductCount >= 0;
  if (portalResult.error || !portalEnvelopeComplete) {
    const error = portalResult.error;
    return {
      ...catalog,
      portalExists: null,
      portalIssue: {
        code: error?.code || portalResponse?.code || (portalResponse?.success === true
          ? 'PRODUCT_RECOVERY_PORTAL_RESPONSE_INCOMPLETE'
          : 'PRODUCT_RECOVERY_PORTAL_READ_FAILED'),
        message: error
          ? 'No se pudo confirmar el estado del portal online. Las verificaciones Cloud continúan, pero la acción queda bloqueada.'
          : portalResponse?.message || 'No se pudo confirmar el estado del portal online. Las verificaciones Cloud continúan, pero la acción queda bloqueada.'
      },
      publications: [],
      publicationsVerified: false
    };
  }
  const portalExists = portalResponse.portal !== null;
  if (!portalExists && portalResponse.publishedProductCount !== 0) {
    return {
      ...catalog,
      portalExists: null,
      portalIssue: {
        code: 'PRODUCT_RECOVERY_PORTAL_RESPONSE_INCOMPLETE',
        message: 'La respuesta indica publicaciones sin identificar un portal. Las verificaciones Cloud continúan, pero la acción queda bloqueada.'
      },
      publications: [],
      publicationsVerified: false
    };
  }
  if (portalExists && (typeof portalResponse.portal !== 'object'
    || Array.isArray(portalResponse.portal)
    || !portalResponse.portal.id
    || !portalResponse.portal.slug)) {
    return {
      ...catalog,
      portalExists: null,
      portalIssue: {
        code: 'PRODUCT_RECOVERY_PORTAL_RESPONSE_INCOMPLETE',
        message: 'La respuesta del portal no contiene una identidad completa. Las verificaciones Cloud continúan, pero la acción queda bloqueada.'
      },
      publications: [],
      publicationsVerified: false
    };
  }
  if (!portalExists) return { ...catalog, portalExists: false, publications: [], publicationsVerified: true };

  let publicationResponse = null;
  let publicationError = null;
  try {
    publicationResponse = await deps.listPublishedProducts();
  } catch (error) {
    publicationError = error;
  }
  const publishedCount = publicationResponse?.publishedCount;
  const publicationsComplete = Array.isArray(publicationResponse?.products)
    && Number.isInteger(publishedCount)
    && publishedCount >= 0
    && publishedCount <= publicationResponse.products.length
    && publishedCount === portalResponse.publishedProductCount
    && publicationResponse.products.every((row) => row
      && typeof row === 'object'
      && Boolean(row.id)
      && Object.prototype.hasOwnProperty.call(row, 'productId')
      && Object.prototype.hasOwnProperty.call(row, 'localProductRef')
      && Object.prototype.hasOwnProperty.call(row, 'sourceType')
      && Object.prototype.hasOwnProperty.call(row, 'isPublished')
      && Object.prototype.hasOwnProperty.call(row, 'isAvailable'));
  if (publicationError || publicationResponse?.success !== true || !publicationsComplete) {
    return {
      ...catalog,
      portalExists: true,
      publications: [],
      publicationsVerified: false,
      publicationIssue: {
        code: publicationError?.code || publicationResponse?.code || (publicationResponse?.success === true
          ? (Number.isInteger(publishedCount) && publishedCount !== portalResponse.publishedProductCount
            ? 'PRODUCT_RECOVERY_PUBLICATION_SNAPSHOT_CHANGED'
            : 'PRODUCT_RECOVERY_PUBLICATION_RESPONSE_INCOMPLETE')
          : 'PRODUCT_RECOVERY_PUBLICATION_READ_FAILED'),
        message: publicationError
          ? 'No se pudo verificar la lista completa de publicaciones. Las verificaciones Cloud continúan, pero la acción queda bloqueada.'
          : publicationResponse?.message || 'No se pudo verificar la lista completa de publicaciones. Las verificaciones Cloud continúan, pero la acción queda bloqueada.'
      }
    };
  }
  return { ...catalog, portalExists: true, publications: publicationResponse.products, publicationsVerified: true };
};

const readOutbox = async (deps, licenseKey, productId, batches = [], categoryId = null) => {
  const records = await Promise.all([
    deps.outboxService.listOperationsForEntity({ licenseKey, entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: productId }),
    ...batches.map((batch) => deps.outboxService.listOperationsForEntity({
      licenseKey, entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH, entityId: String(batch.id)
    })),
    ...(categoryId ? [deps.outboxService.listOperationsForEntity({
      licenseKey, entityType: SYNC_ENTITY_TYPES.CATEGORY, entityId: String(categoryId)
    })] : []),
    deps.outboxService.listInventoryEntriesForRecovery({ licenseKey })
  ]);
  const catalogRecordCount = batches.length + 1 + (categoryId ? 1 : 0);
  const productBatchCategoryRows = records.slice(0, catalogRecordCount).flat();
  const batchIds = new Set(batches.map((batch) => String(batch.id)));
  const inventoryRows = records.at(-1).filter((row) => {
    const entry = row?.payload?.entry || row?.payload?.inventoryEntry || row?.payload || {};
    const productReferences = [row?.entityId, row?.productId, row?.product_id, entry.productId, entry.product_id]
      .filter((value) => value !== undefined && value !== null)
      .map(String);
    const batchReferences = [row?.batchId, row?.batch_id, entry.batchId, entry.batch_id, entry.variantBatchId]
      .filter((value) => value !== undefined && value !== null)
      .map(String);
    return productReferences.includes(String(productId)) || batchReferences.some((id) => batchIds.has(id));
  });
  return [...productBatchCategoryRows, ...inventoryRows];
};

const loadAssessment = async (deps, { licenseKey, productId, requestedLicenseMatches, appState, actorSessionId }) => {
  if (!productId) throw Object.assign(new Error('PRODUCT_ID_REQUIRED'), { code: 'PRODUCT_ID_REQUIRED' });
  assertRecoveryTenant(deps, licenseKey);
  assertInspectionActor(deps, actorSessionId);
  const local = await readLocalProductSnapshot(deps, productId);
  assertRecoveryTenant(deps, licenseKey);
  assertInspectionActor(deps, actorSessionId);
  const cloud = await readCloudSnapshot(deps, licenseKey);
  assertRecoveryTenant(deps, licenseKey);
  const actor = assertInspectionActor(deps, actorSessionId);
  const outboxRows = local.product
    ? await readOutbox(deps, licenseKey, productId, local.localBatches, localCategoryId(local.product))
    : [];
  assertRecoveryTenant(deps, licenseKey);
  assertInspectionActor(deps, actorSessionId);
  const localOnlyInventoryEvents = await deps.listLocalOnlyInventoryEntries({ licenseKey });
  assertRecoveryTenant(deps, licenseKey);
  assertInspectionActor(deps, actorSessionId);
  const entities = [
    { entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: productId },
    ...local.localBatches.map((batch) => ({ entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH, entityId: String(batch.id) })),
    ...(local.product && localCategoryId(local.product)
      ? [{ entityType: SYNC_ENTITY_TYPES.CATEGORY, entityId: String(localCategoryId(local.product)) }]
      : [])
  ];
  const conflictRows = local.product
    ? (await Promise.all(entities.map(({ entityType, entityId }) => deps.conflictService.listConflictsForEntity({
      licenseKey, entityType, entityId
    })))).flat()
    : [];
  assertRecoveryTenant(deps, licenseKey);
  assertInspectionActor(deps, actorSessionId);
  const report = assessIndividualProductRecovery({
    licenseKey,
    requestedLicenseMatches,
    cloudSyncEnabled: deps.isCloudSyncEnabled(appState?.licenseDetails || {}),
    online: deps.isOnline(),
    lockSupported: deps.hasRecoveryLock(),
    actor,
    ...local,
    ...cloud,
    outboxRows,
    localOnlyInventoryEvents,
    conflictRows
  });
  return { report, local, cloud, outboxRows, localOnlyInventoryEvents, conflictRows };
};

const sameLocalSnapshot = (left, right) => stableStringify({
  product: left?.product || null,
  batches: [...(left?.localBatches || [])].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  productTombstone: left?.productTombstone || null,
  category: left?.localCategory || null,
  categoryTombstone: left?.localCategoryTombstone || null,
  ingredients: [...(left?.localIngredients || [])].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))
}) === stableStringify({
  product: right?.product || null,
  batches: [...(right?.localBatches || [])].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  productTombstone: right?.productTombstone || null,
  category: right?.localCategory || null,
  categoryTombstone: right?.localCategoryTombstone || null,
  ingredients: [...(right?.localIngredients || [])].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))
});

const cloudRecoveryMatches = ({ product, batches, localBatches, cloudProducts, cloudBatches }) => {
  const productRows = cloudProducts.filter((row) => cloudProductId(row) === String(product.id));
  if (productRows.length !== 1 || !isCloudActive(productRows[0]) || !checkProductPayload(product, productRows[0])) {
    return { success: false, code: 'PRODUCT_RECOVERY_CLOUD_PRODUCT_UNVERIFIED' };
  }
  const productCloudBatchRows = cloudBatches.filter((row) => cloudBatchParentId(row) === String(product.id));
  const localById = new Map(localBatches.map((batch) => [String(batch.id), batch]));
  const cloudRowsById = new Map();
  for (const row of productCloudBatchRows) {
    const id = cloudBatchId(row);
    const matches = cloudRowsById.get(id) || [];
    matches.push(row);
    cloudRowsById.set(id, matches);
  }
  if ([...cloudRowsById.values()].some((rows) => rows.length !== 1)
    || productCloudBatchRows.some((row) => !localById.has(cloudBatchId(row)))) {
    return { success: false, code: 'PRODUCT_RECOVERY_CLOUD_BATCH_SET_MISMATCH' };
  }
  if (batches.some((batch) => (cloudRowsById.get(String(batch.id)) || []).length !== 1)) {
    return { success: false, code: 'PRODUCT_RECOVERY_CLOUD_BATCH_SET_MISMATCH' };
  }
  if (batches.some((batch) => {
    const cloud = (cloudRowsById.get(String(batch.id)) || [])[0];
    return isDeleted(cloud) || !checkBatchPayload(batch, cloud);
  })) {
    return { success: false, code: 'PRODUCT_RECOVERY_CLOUD_BATCH_UNVERIFIED' };
  }
  const archivedBatches = localBatches.filter(isArchived);
  if (archivedBatches.some((batch) => {
    const cloud = (cloudRowsById.get(String(batch.id)) || [])[0];
    if (!cloud) return false;
    if (isDeleted(cloud)) return asNumber(cloud.stock) > 0 || asNumber(cloud.committed_stock ?? cloud.committedStock) > 0;
    return isCloudActive(cloud)
      || asNumber(cloud.stock) > 0
      || asNumber(cloud.committed_stock ?? cloud.committedStock) > 0
      || !checkBatchPayload(batch, cloud);
  })) {
    return { success: false, code: 'PRODUCT_RECOVERY_CLOUD_ARCHIVED_BATCH_CHANGED' };
  }
  return {
    success: true,
    product: productRows[0],
    batches: productCloudBatchRows.filter((batch) => batches.some((expected) => String(expected.id) === cloudBatchId(batch)))
  };
};

const classifyCloudRecoveryOutcome = ({ product, batches, localBatches, cloudProducts, cloudBatches }) => {
  const verification = cloudRecoveryMatches({ product, batches, localBatches, cloudProducts, cloudBatches });
  if (verification.success) return { state: 'complete', verification };

  const productId = String(product.id);
  const expectedBatchIds = new Set(batches.map((batch) => String(batch.id)));
  const productRows = cloudProducts.filter((row) => cloudProductId(row) === productId);
  const batchRows = cloudBatches.filter((row) => (
    cloudBatchParentId(row) === productId || expectedBatchIds.has(cloudBatchId(row))
  ));
  if (productRows.length === 0 && batchRows.length === 0) {
    return { state: 'absent', verification };
  }

  const presentBatchIds = new Set(batchRows.map(cloudBatchId));
  return {
    state: 'partial',
    verification,
    productPresent: productRows.length > 0,
    missingBatchIds: batches.map((batch) => String(batch.id)).filter((id) => !presentBatchIds.has(id)),
    unexpectedBatchIds: batchRows.map(cloudBatchId).filter((id) => !expectedBatchIds.has(id))
  };
};

const inspectCloudCategoryIdentity = (localCategory, cloudCategories = []) => {
  if (!localCategory?.id) return { success: true, category: null, absent: true };
  const id = String(localCategory.id);
  const matching = cloudCategories.filter((row) => String(row.id) === id);
  if (matching.length > 1) return { success: false, code: 'CLOUD_CATEGORY_ID_AMBIGUOUS' };
  const nameKey = normalizeNameKey(localCategory.name || '');
  const duplicateName = cloudCategories.find((row) => String(row.id) !== id
    && normalizeNameKey(row.name || row.name_key || row.nameKey || '') === nameKey);
  if (duplicateName) return { success: false, code: 'CLOUD_CATEGORY_NAME_CONFLICT', entityId: String(duplicateName.id) };
  if (!matching.length) return { success: true, category: null, absent: true };
  if (isDeleted(matching[0])) return { success: false, code: 'CLOUD_CATEGORY_TOMBSTONE', entityId: id };
  if (!checkCategoryPayload(localCategory, matching[0])) {
    return { success: false, code: 'CLOUD_CATEGORY_ID_CONFLICT', entityId: id };
  }
  return { success: true, category: matching[0], absent: false };
};

const categoryRecoveryIdempotencyKey = (licenseKey, payload) => (
  `product-local-recovery:category:v1:${fingerprint(stableStringify({ licenseKey, payload }))}`
);

const ensureRecoveryCategory = async ({ deps, licenseKey, local, cloud, actorHandle, requirements, actorSessionId }) => {
  const category = local?.localCategory;
  if (!category) return { category: null, wrote: false };
  const initial = inspectCloudCategoryIdentity(category, cloud.cloudCategories);
  if (!initial.success) {
    throw Object.assign(new Error('La categoría Cloud no conserva una identidad inequívoca con el catálogo local.'), {
      code: initial.code,
      entityId: initial.entityId
    });
  }
  if (!initial.absent) return { category: initial.category, wrote: false };

  const payload = categoryToCloudPayload(category);
  const idempotencyKey = categoryRecoveryIdempotencyKey(licenseKey, payload);
  assertRecoveryTenant(deps, licenseKey);
  assertInspectionActor(deps, actorSessionId);
  deps.assertMutationCurrent(actorHandle, requirements);
  let response = null;
  let mutationError = null;
  try {
    response = await deps.cloudRepository.upsertCategory({
      licenseKey,
      category: payload,
      expectedVersion: 0,
      idempotencyKey,
      actorHandle
    });
  } catch (error) {
    mutationError = error;
  }

  assertRecoveryTenant(deps, licenseKey);
  assertInspectionActor(deps, actorSessionId);
  let categories;
  try {
    categories = await readCloudRows(deps.cloudRepository, licenseKey, 'category');
  } catch (error) {
    throw Object.assign(new Error('No se pudo confirmar si la escritura de categoría llegó a Cloud. Conserva el estado local y no repitas la escritura todavía.'), {
      code: 'PRODUCT_RECOVERY_CATEGORY_OUTCOME_UNKNOWN',
      uncertain: true,
      cause: error,
      mutationError,
      rpcResponse: response
    });
  }
  assertRecoveryTenant(deps, licenseKey);
  assertInspectionActor(deps, actorSessionId);
  const confirmed = inspectCloudCategoryIdentity(category, categories);
  if (confirmed.success && !confirmed.absent) {
    return { category: confirmed.category, wrote: true, rpcResponse: response, rpcError: mutationError };
  }
  if (!confirmed.success) {
    throw Object.assign(new Error('Cloud contiene una categoría con ID o nombre conflictivo. No se continuará con el producto.'), {
      code: confirmed.code,
      uncertain: Boolean(mutationError || response?.success === true),
      entityId: confirmed.entityId,
      rpcResponse: response,
      rpcError: mutationError
    });
  }
  throw Object.assign(new Error(response?.message || mutationError?.message || 'Cloud no confirmó la categoría con su ID local. No se creó ni marcó el producto.'), {
    code: response?.code || 'PRODUCT_RECOVERY_CATEGORY_NOT_CONFIRMED',
    uncertain: Boolean(mutationError || response?.success === true),
    rpcResponse: response,
    rpcError: mutationError
  });
};

const RECOVERY_MESSAGES = Object.freeze({
  PRODUCT_RECOVERY_LOCK_UNAVAILABLE: 'El navegador no permite asegurar exclusividad. No se ejecutó la recuperación.',
  PRODUCT_RECOVERY_CATEGORY_OUTCOME_UNKNOWN: 'HOLD: no se pudo confirmar si la categoría llegó a Cloud. La verificación debe aclarar el estado antes de repetir cualquier escritura.',
  PRODUCT_RECOVERY_CATEGORY_NOT_CONFIRMED: 'Cloud no confirmó la categoría local. El producto y sus lotes no se escribieron.',
  CLOUD_CATEGORY_ID_CONFLICT: 'Cloud ya usa el ID local de la categoría para otra categoría. Se detuvo antes de escribir el producto.',
  CLOUD_CATEGORY_NAME_CONFLICT: 'Cloud ya contiene otra categoría con el mismo nombre y distinto ID. Se detuvo antes de escribir el producto.',
  CLOUD_CATEGORY_TOMBSTONE: 'Cloud conserva la categoría como eliminada. No se restauró ni se escribió el producto.',
  PHARMACY_INITIAL_STOCK_REQUIRES_DOCUMENTED_RECEIPT: 'La guarda farmacéutica requiere una recepción documentada para importar stock positivo. No se modificó el catálogo local.',
  PHARMACY_HISTORICAL_IMPORT_NOT_AUTHORIZED: 'Production no tiene una autorización vigente para importar este saldo histórico. No se modificó el catálogo local.',
  VERSION_CONFLICT: 'El producto apareció en Cloud durante la operación. Se detuvo sin sobrescribirlo.',
  DUPLICATE_PRODUCT_KEY: 'El servidor detectó un SKU o código de barras duplicado. No se modificó el catálogo local.',
  PRODUCT_RECOVERY_CLOUD_OUTCOME_UNKNOWN: 'HOLD: no se pudo confirmar en Cloud el resultado de la escritura. Conserva los datos locales y no reintentes hasta completar una lectura de conciliación.',
  PRODUCT_RECOVERY_RPC_FAILED_NO_CLOUD_WRITE: 'Cloud confirmó que no existe el producto ni sus lotes. Los datos locales siguen intactos; vuelve a verificar antes de solicitar otro intento.',
  PRODUCT_RECOVERY_CLOUD_SUCCESS_NOT_VISIBLE: 'HOLD: el RPC informó éxito, pero la lectura Cloud no encuentra el producto ni sus lotes. No reintentes hasta conciliar.',
  ACTOR_CONTEXT_STALE: 'HOLD: Cloud quedó completo, pero la sesión cambió durante la operación. Los datos locales no se marcaron como sincronizados; verifica la sesión y concilia antes de reintentar.'
});
const PARTIAL_CLOUD_WRITE_MESSAGE = 'HOLD: Cloud contiene el producto o alguno de sus lotes, pero el conjunto no coincide con los datos locales. No reintentes ni cambies inventario; requiere conciliación.';

const assertReconciliationContextCurrent = (deps, { licenseKey, actorSessionId, actorHandle, requirements }) => {
  try {
    assertRecoveryTenant(deps, licenseKey);
    assertInspectionActor(deps, actorSessionId);
    deps.assertMutationCurrent(actorHandle, requirements);
  } catch (cause) {
    throw Object.assign(new Error(RECOVERY_MESSAGES.ACTOR_CONTEXT_STALE), {
      code: 'ACTOR_CONTEXT_STALE',
      uncertain: true,
      cause
    });
  }
};

const sortedRecordIds = (records = []) => records.map((record) => String(record?.id ?? '')).sort();

const sameRecordIds = (left = [], right = []) => {
  const leftIds = sortedRecordIds(left);
  const rightIds = sortedRecordIds(right);
  return leftIds.length === rightIds.length
    && leftIds.every((id, index) => Boolean(id) && id === rightIds[index]);
};

const hasExplicitTenantMismatch = (record, licenseKey) => {
  const recordLicenseKey = record?.licenseKey || record?.license_key
    || record?.metadata?.licenseKey || record?.metadata?.license_key;
  return Boolean(recordLicenseKey && recordLicenseKey !== licenseKey);
};

const isSyncedToCloudVersion = (local, cloud, { allowTombstone = false } = {}) => {
  const localVersion = Number(local?.serverVersion ?? local?.server_version);
  const cloudVersion = Number(cloud?.server_version ?? cloud?.serverVersion);
  return local?.syncStatus === PRODUCT_SYNC_STATUS.SYNCED
    && Number.isSafeInteger(localVersion) && localVersion > 0
    && Number.isSafeInteger(cloudVersion) && cloudVersion === localVersion
    && Boolean(local?.lastSyncedAt)
    && !local?.pendingOperationId
    && !local?.localMutationId
    && !local?.conflictReason
    && local?.deletionPending !== true
    && (allowTombstone || (!isDeleted(local) && !isDeleted(cloud)));
};

const localSnapshotMatchesVerifiedCloud = async ({
  deps,
  context,
  productId,
  before,
  initialBatches,
  actorHandle,
  requirements
}) => {
  const assertCurrent = () => assertReconciliationContextCurrent(deps, {
    licenseKey: context.licenseKey,
    actorSessionId: context.actorSessionId,
    actorHandle,
    requirements
  });
  const assertTenantAccess = async () => {
    try {
      await deps.assertTenantAccess(
        { license_key: context.licenseKey },
        { reason: 'individual_product_recovery_local_reconciliation' }
      );
    } catch (cause) {
      throw Object.assign(new Error(RECOVERY_MESSAGES.ACTOR_CONTEXT_STALE), {
        code: 'ACTOR_CONTEXT_STALE',
        uncertain: true,
        cause
      });
    }
  };

  assertCurrent();
  await assertTenantAccess();
  assertCurrent();
  const freshContext = getRecoveryContext(deps, context.licenseKey);
  if (!freshContext.requestedLicenseMatches) return null;

  const verified = await loadAssessment(deps, {
    ...freshContext,
    licenseKey: context.licenseKey,
    productId,
    actorSessionId: context.actorSessionId
  });
  assertCurrent();

  const { local, cloud, report } = verified;
  const cloudPayloadIssues = new Set([
    'CLOUD_PRODUCT_RECONCILIATION_REQUIRED',
    'ACTIVE_BATCH_CLOUD_RECONCILIATION_REQUIRED',
    'CLOUD_CATEGORY_ID_CONFLICT'
  ]);
  if (report.issues.some((issue) => !cloudPayloadIssues.has(issue.code))) return null;
  if (String(local.product?.id ?? '') !== String(productId)
    || String(before.local.product?.id ?? '') !== String(productId)
    || local.productTombstone
    || local.localCategoryTombstone
    || hasExplicitTenantMismatch(local.product, context.licenseKey)) return null;

  const expectedCategoryId = localCategoryId(before.local.product);
  if (String(localCategoryId(local.product) ?? '') !== String(expectedCategoryId ?? '')) return null;

  const cloudVerification = cloudRecoveryMatches({
    product: before.local.product,
    batches: initialBatches,
    localBatches: before.local.localBatches.filter((batch) => localBatchProductId(batch) === String(productId)),
    cloudProducts: cloud.cloudProducts,
    cloudBatches: cloud.cloudBatches
  });
  if (!cloudVerification.success
    || !isCloudActive(cloudVerification.product)
    || !checkCompleteProductPayload(before.local.product, cloudVerification.product)
    || !checkCompleteProductPayload(local.product, cloudVerification.product)
    || !isSyncedToCloudVersion(local.product, cloudVerification.product)
    || hasExplicitTenantMismatch(local.product, context.licenseKey)) return null;

  const expectedBatchIds = before.local.localBatches.filter((batch) => localBatchProductId(batch) === String(productId));
  const currentBatchIds = local.localBatches.filter((batch) => localBatchProductId(batch) === String(productId));
  if (local.localBatches.some((batch) => localBatchProductId(batch) !== String(productId))
    || !sameRecordIds(expectedBatchIds, currentBatchIds)
    || !sameRecordIds(initialBatches, currentBatchIds.filter((batch) => !isArchived(batch)))) return null;

  const cloudBatchesById = new Map();
  for (const row of cloud.cloudBatches.filter((batch) => cloudBatchParentId(batch) === String(productId))) {
    const matches = cloudBatchesById.get(cloudBatchId(row)) || [];
    matches.push(row);
    cloudBatchesById.set(cloudBatchId(row), matches);
  }
  for (const batch of currentBatchIds) {
    const rows = cloudBatchesById.get(String(batch.id)) || [];
    if (rows.length > 1 || hasExplicitTenantMismatch(batch, context.licenseKey)) return null;
    if (isArchived(batch)) {
      if (rows.length === 0) {
        const beforeBatch = expectedBatchIds.find((candidate) => String(candidate.id) === String(batch.id));
        if (stableStringify(beforeBatch) !== stableStringify(batch) || batch.deletionPending === true) return null;
        continue;
      }
      const cloudBatch = rows[0];
      if (!isArchived(cloudBatch)
        || isDeleted(expectedBatchIds.find((candidate) => String(candidate.id) === String(batch.id))) !== isDeleted(cloudBatch)
        || !checkCompleteBatchPayload(expectedBatchIds.find((candidate) => String(candidate.id) === String(batch.id)), cloudBatch)
        || isDeleted(batch) !== isDeleted(cloudBatch)
        || !checkCompleteBatchPayload(batch, cloudBatch)
        || !isSyncedToCloudVersion(batch, cloudBatch, { allowTombstone: true })) return null;
      continue;
    }
    const cloudBatch = rows[0];
    if (!cloudBatch || !isCloudActive(cloudBatch)
      || !checkCompleteBatchPayload(batch, cloudBatch)
      || !isSyncedToCloudVersion(batch, cloudBatch)) return null;
  }

  if (expectedCategoryId) {
    const categoryCheck = inspectCloudCategoryIdentity(before.local.localCategory, cloud.cloudCategories);
    if (!categoryCheck.success || categoryCheck.absent
      || !checkCompleteCategoryPayload(before.local.localCategory, categoryCheck.category)
      || String(local.localCategory?.id ?? '') !== String(expectedCategoryId)
      || !checkCompleteCategoryPayload(local.localCategory, categoryCheck.category)
      || !isSyncedToCloudVersion(local.localCategory, categoryCheck.category)
      || hasExplicitTenantMismatch(local.localCategory, context.licenseKey)) return null;
  } else if (local.localCategory) {
    return null;
  }

  const beforeIngredientIds = before.local.localIngredients.filter(Boolean).map((row) => String(row.id)).sort();
  if (local.localIngredients.some((row) => !row)
    || !sameRecordIds(before.local.localIngredients.filter(Boolean), local.localIngredients)) return null;
  for (const ingredient of local.localIngredients.filter(Boolean)) {
    const beforeIngredient = before.local.localIngredients.find((row) => String(row?.id) === String(ingredient.id));
    const rows = cloud.cloudProducts.filter((row) => cloudProductId(row) === String(ingredient.id));
    const tombstone = await deps.localRepository.getProductDeletionTombstoneById(ingredient.id);
    if (rows.length !== 1 || tombstone || !isCloudActive(rows[0])
      || !checkCompleteProductPayload(beforeIngredient, rows[0])
      || !checkCompleteProductPayload(ingredient, rows[0])
      || !isSyncedToCloudVersion(ingredient, rows[0])
      || hasExplicitTenantMismatch(ingredient, context.licenseKey)) return null;
  }
  if (beforeIngredientIds.length !== local.localIngredients.length) return null;

  const latestLocal = await readLocalProductSnapshot(deps, productId);
  assertCurrent();
  if (!sameLocalSnapshot(local, latestLocal)) return null;

  const outboxRows = await readOutbox(
    deps,
    context.licenseKey,
    productId,
    latestLocal.localBatches,
    localCategoryId(latestLocal.product)
  );
  if (outboxRows.some((row) => row?.status !== OUTBOX_STATUS.SYNCED)) return null;
  const conflictEntities = [
    { entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: productId },
    ...latestLocal.localBatches.map((batch) => ({
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      entityId: String(batch.id)
    })),
    ...(localCategoryId(latestLocal.product) ? [{
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      entityId: String(localCategoryId(latestLocal.product))
    }] : [])
  ];
  const conflictRows = (await Promise.all(conflictEntities.map(({ entityType, entityId }) => (
    deps.conflictService.listConflictsForEntity({ licenseKey: context.licenseKey, entityType, entityId })
  )))).flat();
  if (conflictRows.some((row) => row?.status === CONFLICT_STATUS.PENDING)) return null;

  const localOnlyEvents = await deps.listLocalOnlyInventoryEntries({ licenseKey: context.licenseKey });
  const batchIds = new Set(latestLocal.localBatches.map((batch) => String(batch.id)));
  if (localOnlyEvents.some((event) => String(event?.productId ?? event?.product_id ?? '') === String(productId)
    || batchIds.has(String(event?.batchId ?? event?.batch_id ?? '')))) return null;

  assertCurrent();
  await assertTenantAccess();
  assertCurrent();
  return { local: latestLocal, cloudVerification };
};

const errorResult = (error, { uncertain = false } = {}) => ({
  success: false,
  blocked: true,
  uncertain,
  code: error?.code || error?.message || 'PRODUCT_RECOVERY_FAILED',
  message: RECOVERY_MESSAGES[error?.code || error?.message]
    || error?.message
    || 'No se pudo recuperar el producto. Conserva los datos locales y revisa el resultado antes de reintentar.'
});

const isTenantRuntimeFailure = (code) => (
  String(code || '').startsWith('TENANT_RUNTIME_')
  || String(code || '').startsWith('TENANT_DATABASE_')
  || String(code || '').startsWith('DB_')
  || code === 'TENANT_DIRECTORY_CORRUPT'
);

const inspectionErrorMessage = (error) => {
  const code = error?.code;
  if (INSPECTION_ACCESS_MESSAGES[code]) return INSPECTION_ACCESS_MESSAGES[code];
  if (code === 'TENANT_RUNTIME_NOT_READY') {
    return 'El runtime local de este negocio no está listo. La verificación se detuvo antes de leer el catálogo; reintentar solo vuelve a consultar y no modifica productos, lotes ni inventario.';
  }
  if (code === 'TENANT_RUNTIME_STALE_HANDLE') {
    return 'El runtime local cambió durante la verificación. No se mezclaron datos ni se escribieron cambios; vuelve a verificar con el negocio correcto.';
  }
  if (isTenantRuntimeFailure(code)) {
    return `No se pudo preparar de forma segura el runtime local (${code}). La lectura se detuvo sin consultar otra base ni modificar productos, lotes o inventario. Puedes reintentar la verificación de forma segura.`;
  }
  if (code === 'TENANT_CONTEXT_MISMATCH') {
    return 'El negocio activo no coincide con el contexto de esta verificación. No se leyeron datos de otro negocio; vuelve a verificar con el negocio correcto.';
  }
  return error?.message || 'No se pudo verificar el producto.';
};

const defaultDependencies = {
  getAppState: () => useAppStore.getState(),
  actorController: actorRuntimeController,
  localRepository: productLocalRepository,
  cloudRepository: productCloudRepository,
  outboxService: syncOutboxService,
  conflictService: syncConflictService,
  listLocalOnlyInventoryEntries: listLocalOnlyInventoryEntriesForRecovery,
  getEcommercePortal,
  listPublishedProducts,
  runWithTenantLease: runWithLocalTenantSyncLease,
  assertTenantAccess: assertLocalTenantAccess,
  runWithRecoveryLock: runWithProductCatalogRecoveryLock,
  captureMutation: captureProductInventoryMutation,
  assertMutationCurrent: assertProductInventoryMutationCurrent,
  isCloudSyncEnabled: isCloudProductsSyncEnabled,
  isOnline,
  hasRecoveryLock: () => typeof globalThis.navigator?.locks?.request === 'function'
};

export const createProductIndividualRecoveryService = (overrides = {}) => {
  const deps = { ...defaultDependencies, ...overrides };

  const runInCurrentTenant = async (requestedLicenseKey, reason, operation) => {
    const context = getRecoveryContext(deps, requestedLicenseKey);
    if (!context.licenseKey || !context.requestedLicenseMatches) {
      throw Object.assign(new Error('TENANT_CONTEXT_MISMATCH'), { code: 'TENANT_CONTEXT_MISMATCH' });
    }
    const actor = assertInspectionActor(deps);
    return deps.runWithTenantLease(
      { license_key: context.licenseKey },
      { reason },
      async () => {
        assertInspectionActor(deps, actor.sessionId);
        await deps.assertTenantAccess({ license_key: context.licenseKey }, { reason });
        const freshContext = getRecoveryContext(deps, context.licenseKey);
        if (!freshContext.requestedLicenseMatches) {
          throw Object.assign(new Error('TENANT_CONTEXT_MISMATCH'), { code: 'TENANT_CONTEXT_MISMATCH' });
        }
        assertInspectionActor(deps, actor.sessionId);
        return operation({ ...freshContext, licenseKey: context.licenseKey, actorSessionId: actor.sessionId });
      }
    );
  };

  return {
    async inspectProduct({ productId, licenseKey = null } = {}) {
      try {
        return await runInCurrentTenant(licenseKey, 'individual_product_recovery_inspect', async (context) => {
          const result = await loadAssessment(deps, { ...context, productId });
          return result.report;
        });
      } catch (error) {
        const code = error?.code || 'PRODUCT_RECOVERY_INSPECTION_FAILED';
        const retryable = isTenantRuntimeFailure(code)
          || error?.diagnostic?.isRetryable === true;
        return {
          ...errorResult(error),
          retryable,
          message: inspectionErrorMessage(error),
          product: null,
          batches: [],
          issues: [{ code, message: inspectionErrorMessage(error) }]
        };
      }
    },

    async recoverProduct({ productId, licenseKey = null } = {}) {
      try {
        return await runInCurrentTenant(licenseKey, 'individual_product_recovery', async (context) => (
          deps.runWithRecoveryLock({
            licenseKey: context.licenseKey,
            requireWebLock: true,
            operation: async () => {
            const before = await loadAssessment(deps, { ...context, productId });
            if (!before.report.canRecover) {
              return { success: false, blocked: true, report: before.report, issues: before.report.issues };
            }

            const product = before.local.product;
            const initialBatches = before.report.recovery.batchIds
              .map((id) => before.local.localBatches.find((batch) => String(batch.id) === id))
              .filter(Boolean);
            const inventoryRequired = initialBatches.length > 0 || hasInitialProductStock(product);
            const requirements = { products: true, inventory: inventoryRequired };
            const actorHandle = deps.captureMutation(requirements);
            deps.assertMutationCurrent(actorHandle, requirements);
            const localBeforeCategory = await readLocalProductSnapshot(deps, productId);
            assertRecoveryTenant(deps, context.licenseKey);
            assertInspectionActor(deps, context.actorSessionId);
            if (!sameLocalSnapshot(before.local, localBeforeCategory)) {
              return { ...errorResult(Object.assign(new Error('Los datos locales cambiaron antes de confirmar la categoría. No se escribió el producto.'), { code: 'PRODUCT_RECOVERY_LOCAL_CHANGED' })) };
            }
            const categoryResult = await ensureRecoveryCategory({
              deps,
              licenseKey: context.licenseKey,
              local: localBeforeCategory,
              cloud: before.cloud,
              actorHandle,
              requirements,
              actorSessionId: context.actorSessionId
            });
            const preflight = await loadAssessment(deps, { ...context, productId });
            if (!sameLocalSnapshot(before.local, preflight.local)) {
              return { ...errorResult(Object.assign(new Error('Los datos locales cambiaron durante la verificación de categoría. No se escribió el producto.'), { code: 'PRODUCT_RECOVERY_LOCAL_CHANGED' })) };
            }
            if (!preflight.report.canRecover) {
              return {
                success: false,
                blocked: true,
                report: preflight.report,
                issues: preflight.report.issues,
                categoryConfirmed: Boolean(categoryResult.category),
                productWriteSkipped: true
              };
            }
            const idempotencyKey = before.report.recovery.idempotencyKey;
            let response = null;
            let rpcError = null;
            if (!preflight.report.recovery.existingCloudComplete) {
              assertRecoveryTenant(deps, context.licenseKey);
              assertInspectionActor(deps, context.actorSessionId);
              deps.assertMutationCurrent(actorHandle, requirements);
              try {
                response = await deps.cloudRepository.upsertProduct({
                  licenseKey: context.licenseKey,
                  product: productToCloudPayload(product),
                  initialBatches: initialBatches.map(batchToCloudPayload),
                  expectedVersion: 0,
                  idempotencyKey,
                  actorHandle,
                  isNewProduct: true
                });
              } catch (error) {
                rpcError = error;
              }
            }

            let afterCloud;
            try {
              afterCloud = await readCloudCatalogSnapshot(deps, context.licenseKey);
            } catch (error) {
              const readError = Object.assign(new Error(error?.message || 'No se pudo releer el producto y sus lotes después de llamar al RPC.'), {
                code: 'PRODUCT_RECOVERY_CLOUD_OUTCOME_UNKNOWN',
                cause: error
              });
              return { ...errorResult(readError, { uncertain: true }), rpcResponse: response, rpcError };
            }
            try {
              assertReconciliationContextCurrent(deps, {
                licenseKey: context.licenseKey,
                actorSessionId: context.actorSessionId,
                actorHandle,
                requirements
              });
            } catch (error) {
              return { ...errorResult(error, { uncertain: true }), rpcResponse: response, rpcError };
            }

            const categoryCheck = preflight.local.localCategory
              ? inspectCloudCategoryIdentity(preflight.local.localCategory, afterCloud.cloudCategories)
              : { success: true, category: null, absent: false };
            if (!categoryCheck.success || categoryCheck.absent) {
              const error = Object.assign(new Error('El producto y sus lotes no se marcarán como recuperados hasta volver a confirmar la categoría original en Cloud.'), {
                code: categoryCheck.code || 'PRODUCT_RECOVERY_CATEGORY_NOT_CONFIRMED'
              });
              return { ...errorResult(error, { uncertain: true }), rpcResponse: response, rpcError, cloudOutcome: 'category_unconfirmed' };
            }

            const cloudOutcome = classifyCloudRecoveryOutcome({
              product,
              batches: initialBatches,
              localBatches: before.local.localBatches.filter((batch) => localBatchProductId(batch) === String(product.id)),
              cloudProducts: afterCloud.cloudProducts,
              cloudBatches: afterCloud.cloudBatches
            });
            if (cloudOutcome.state === 'absent') {
              const rpcReportedSuccess = response?.success === true;
              const error = Object.assign(new Error(rpcReportedSuccess
                ? RECOVERY_MESSAGES.PRODUCT_RECOVERY_CLOUD_SUCCESS_NOT_VISIBLE
                : RECOVERY_MESSAGES.PRODUCT_RECOVERY_RPC_FAILED_NO_CLOUD_WRITE), {
                code: rpcReportedSuccess
                  ? 'PRODUCT_RECOVERY_CLOUD_SUCCESS_NOT_VISIBLE'
                  : 'PRODUCT_RECOVERY_RPC_FAILED_NO_CLOUD_WRITE'
              });
              return { ...errorResult(error, { uncertain: rpcReportedSuccess }), rpcResponse: response, rpcError, cloudOutcome: 'absent' };
            }
            if (cloudOutcome.state === 'partial') {
              const details = [
                cloudOutcome.productPresent ? 'el producto sí existe' : 'el producto no aparece',
                cloudOutcome.missingBatchIds.length ? `faltan lotes ${cloudOutcome.missingBatchIds.join(', ')}` : null,
                cloudOutcome.unexpectedBatchIds.length ? `hay lotes inesperados ${cloudOutcome.unexpectedBatchIds.join(', ')}` : null,
                `verificación ${cloudOutcome.verification.code || 'incompleta'}`
              ].filter(Boolean).join('; ');
              const error = Object.assign(new Error(`${PARTIAL_CLOUD_WRITE_MESSAGE} Detalle: ${details}.`), {
                code: 'PRODUCT_RECOVERY_PARTIAL_CLOUD_WRITE'
              });
              return { ...errorResult(error, { uncertain: true }), rpcResponse: response, rpcError, cloudOutcome: 'partial' };
            }

            if (response?.clientLocalReconciliationPending) {
              return {
                ...errorResult(Object.assign(new Error(RECOVERY_MESSAGES.ACTOR_CONTEXT_STALE), { code: 'ACTOR_CONTEXT_STALE' }), { uncertain: true }),
                rpcResponse: response,
                rpcError,
                cloudOutcome: 'complete'
              };
            }

            const cloudCheck = cloudOutcome.verification;

            const currentLocal = await readLocalProductSnapshot(deps, productId);
            try {
              assertReconciliationContextCurrent(deps, {
                licenseKey: context.licenseKey,
                actorSessionId: context.actorSessionId,
                actorHandle,
                requirements
              });
            } catch (error) {
              return { ...errorResult(error, { uncertain: true }), rpcResponse: response, rpcError };
            }

            let localAfter = null;
            let locallyReconciled = false;
            let applied = null;
            if (!sameLocalSnapshot(before.local, currentLocal)) {
              let concurrentReconciliation = null;
              try {
                concurrentReconciliation = await localSnapshotMatchesVerifiedCloud({
                  deps,
                  context,
                  productId,
                  before,
                  initialBatches,
                  actorHandle,
                  requirements
                });
              } catch {
                // Any failed read or context check keeps the original local-change HOLD.
              }
              if (!concurrentReconciliation) {
                return { ...errorResult(Object.assign(new Error('Los datos locales cambiaron durante la operación. Cloud requiere conciliación antes de aplicar una respuesta local.'), { code: 'PRODUCT_RECOVERY_LOCAL_CHANGED' }), { uncertain: true }), rpcResponse: response, rpcError };
              }
              localAfter = concurrentReconciliation.local;
              locallyReconciled = true;
            } else {
              applied = await deps.localRepository.applyCloudCatalog({
                categories: categoryCheck.category ? [categoryCheck.category] : [],
                product: cloudCheck.product,
                batches: cloudCheck.batches
              });
              if (applied?.rejected?.length || applied?.deferredInventory
                || applied?.products !== 1 || applied?.batches !== initialBatches.length
                || applied?.categories !== (categoryCheck.category ? 1 : 0)) {
                return { ...errorResult(Object.assign(new Error('La verificación Cloud fue correcta, pero la actualización de estado local no se completó.'), { code: 'PRODUCT_RECOVERY_LOCAL_APPLY_PARTIAL' }), { uncertain: true }), applied };
              }
              localAfter = await readLocalProductSnapshot(deps, productId);
            }

            const localProductVerified = localAfter.product?.syncStatus === PRODUCT_SYNC_STATUS.SYNCED
              && Number(localAfter.product?.serverVersion || 0) > 0
              && (locallyReconciled
                ? checkCompleteProductPayload(localAfter.product, cloudCheck.product)
                : checkProductPayload(localAfter.product, cloudCheck.product));
            const localBatchesVerified = initialBatches.every((batch) => {
              const saved = localAfter.localBatches.find((candidate) => String(candidate.id) === String(batch.id));
              const cloud = cloudCheck.batches.find((candidate) => String(candidate.id) === String(batch.id));
              return saved?.syncStatus === PRODUCT_SYNC_STATUS.SYNCED
                && Number(saved?.serverVersion || 0) > 0
                && (locallyReconciled
                  ? checkCompleteBatchPayload(saved, cloud)
                  : checkBatchPayload(saved, cloud));
            });
            const localCategoryVerified = !categoryCheck.category || (
              localAfter.localCategory?.syncStatus === PRODUCT_SYNC_STATUS.SYNCED
              && Number(localAfter.localCategory?.serverVersion || 0) > 0
              && (locallyReconciled
                ? checkCompleteCategoryPayload(localAfter.localCategory, categoryCheck.category)
                : checkCategoryPayload(localAfter.localCategory, categoryCheck.category))
            );
            const archivedBefore = before.local.localBatches.filter(isArchived)
              .sort((left, right) => String(left.id).localeCompare(String(right.id)));
            const archivedAfter = localAfter.localBatches.filter(isArchived)
              .sort((left, right) => String(left.id).localeCompare(String(right.id)));
            const archivedBatchesPreserved = stableStringify(archivedBefore) === stableStringify(archivedAfter);
            if (!localProductVerified || !localBatchesVerified || !localCategoryVerified || !archivedBatchesPreserved) {
              return { ...errorResult(Object.assign(new Error('Cloud quedó completo, pero el navegador no confirmó el estado local sincronizado.'), { code: 'PRODUCT_RECOVERY_LOCAL_CONFIRMATION_MISSING' }), { uncertain: true }) };
            }

            notifyProductsChanged({ source: 'productIndividualRecoveryService.recovered', productIds: [product.id] });
            return {
              success: true,
              recovered: true,
              verified: true,
              productId: product.id,
              batchIds: initialBatches.map((batch) => String(batch.id)),
              locallyReconciled,
              rpcReportedSuccess: response?.success === true,
              cloudOutcome: 'complete',
              archivedBatchIdsKeptLocal: before.report.recovery.omittedArchivedBatchIds,
              message: locallyReconciled
                ? `Producto y ${initialBatches.length} lote(s) ya conciliados en este dispositivo y verificados en Cloud. No se repitieron escrituras locales.`
                : `Producto y ${initialBatches.length} lote(s) verificados en Cloud. Los lotes archivados permanecen intactos en este dispositivo.`
            };
            }
          })
        ));
      } catch (error) {
        return errorResult(error, { uncertain: Boolean(error?.uncertain) });
      }
    }
  };
};

export const productIndividualRecoveryService = createProductIndividualRecoveryService();

export default productIndividualRecoveryService;
