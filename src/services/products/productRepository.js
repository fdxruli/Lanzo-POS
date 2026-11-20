import Logger from '../Logger';
import { generateID } from '../utils';
import { useAppStore } from '../../store/useAppStore';
import { generateIdempotencyKey } from '../sync/idempotency';
import { syncOutboxService } from '../sync/syncOutboxService';
import {
  getLicenseKeyFromDetails,
  isCloudProductsSyncEnabled,
  SYNC_LIMITS,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import {
  batchToCloudPayload,
  categoryToCloudPayload,
  productToCloudPayload,
  normalizeSkuKey
} from './productMapper';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import {
  ensureCloudProductCategory,
  getProductCloudConfirmationError
} from './productCategoryCloudGate';
import { createApparelSkuCandidate, resolveProductRubroContext } from './apparelSku';
import { productConflictService } from './productConflictService';
import { productMigrationService } from './productMigrationService';
import { pullCatalogChanges } from './productSyncHandler';
import { PRODUCT_CLOUD_PHASE, PRODUCT_SYNC_STATUS } from './productConstants';
import { CANONICAL_BUSINESS_TYPES } from '../../utils/businessType';
import {
  getPharmacyClassification,
  isSpecialPharmacyProduct,
  requiresConfirmedMedicineClassification,
  PHARMACY_CLASSIFICATION_REQUIRED_FOR_ACTIVATION
} from '../../utils/pharmacyClassification';
import { isBatchArchived } from './batchStatus';
import { notifyProductsChanged } from './productEvents';
import {
  actorOriginFromHandle,
  assertProductInventoryMutationCurrent,
  captureProductInventoryMutation,
  getProductInventoryMutationRequirements
} from '../auth/productInventoryAuthority';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const nowIso = () => new Date().toISOString();
const isApparelProduct = (product, businessTypes) => resolveProductRubroContext(product, businessTypes)
  === CANONICAL_BUSINESS_TYPES.APPAREL;
const hasApparelVariantAttributes = (batch) => Boolean(
  String(batch?.attributes?.talla ?? '').trim()
  && String(batch?.attributes?.color ?? '').trim()
);
const isApparelVariantBatch = (product, batch, businessTypes) => (
  isApparelProduct(product, businessTypes) && hasApparelVariantAttributes(batch)
);

const loadCloudSkuRecords = async (licenseKey) => {
  const records = [];
  const pageSize = SYNC_LIMITS.MAX_PULL_LIMIT;

  for (const entityType of ['products', 'batches']) {
    let offset = 0;
    while (true) {
      const response = await productCloudRepository.pullCatalogSnapshot({
        licenseKey,
        entityType,
        limit: pageSize,
        offset,
        includeDeleted: false,
        force: true
      });
      if (!response || response.success === false) {
        throw new Error(response?.message || 'APPAREL_SKU_CATALOG_READ_FAILED');
      }

      const page = entityType === 'products' ? response.products : response.batches;
      if (!Array.isArray(page)) throw new Error('APPAREL_SKU_CATALOG_READ_INVALID');
      records.push(...page.map((record) => ({ ...record, skuEntityType: entityType })));

      if (response.has_more !== true && response.hasMore !== true) break;
      if (page.length === 0) throw new Error('APPAREL_SKU_CATALOG_READ_INCOMPLETE');
      offset += page.length;
    }
  }
  return records;
};

const remoteSkuConflicts = (sku, records, excludedBatchId = null) => {
  const skuKey = normalizeSkuKey(sku);
  if (!skuKey) return false;
  return records.some((record) => {
    if (record.skuEntityType === 'batches' && excludedBatchId
      && String(record.id) === String(excludedBatchId)) return false;
    return normalizeSkuKey(record.sku_key || record.skuKey || record.sku_normalized || record.sku) === skuKey;
  });
};

const findApparelSkuConflict = async (sku, { cloudRecords = null, excludeBatchId = null } = {}) => {
  const localConflicts = await productLocalRepository.findSkuConflicts(sku, {
    excludeBatchIds: excludeBatchId ? [excludeBatchId] : []
  });
  if (localConflicts.length) return true;
  return Array.isArray(cloudRecords)
    ? remoteSkuConflicts(sku, cloudRecords, excludeBatchId)
    : false;
};

const apparelSkuError = (code, sku = '') => ({
  success: false,
  code,
  field: 'quickVariants',
  message: code === 'APPAREL_DUPLICATE_SKU'
    ? `El SKU "${sku}" ya está asignado a otro producto o variante de este negocio.`
    : 'No se pudo comprobar que el SKU sea único. No se guardó la variante. Inténtalo de nuevo.',
  error: new Error(code === 'APPAREL_DUPLICATE_SKU'
    ? `El SKU "${sku}" ya está asignado a otro producto o variante de este negocio.`
    : 'No se pudo comprobar que el SKU sea único. No se guardó la variante. Inténtalo de nuevo.')
});

const prepareApparelVariantSkus = async (prepared, mode) => {
  if (!isApparelProduct(prepared.product, mode.businessTypes)) return { success: true };

  const changes = [];
  const hasVariantAttributes = (variant) => Boolean(
    String(variant?.attributes?.talla ?? variant?.talla ?? '').trim()
    && String(variant?.attributes?.color ?? variant?.color ?? '').trim()
  );

  if (prepared.editing) {
    const delta = prepared.apparelVariantDelta || {};
    for (const variant of delta.created || []) {
      changes.push({ variant, auto: true, excludeBatchId: null });
    }
    for (const variant of delta.updated || []) {
      const existingBatch = variant.existingBatch || {};
      const previousSku = String(existingBatch.sku ?? existingBatch.sku_key ?? existingBatch.skuKey ?? '');
      const nextSku = String(variant.sku ?? '');
      if (previousSku === nextSku) continue;
      changes.push({
        variant,
        auto: !normalizeSkuKey(nextSku),
        excludeBatchId: existingBatch.id || variant.id
      });
    }
  } else {
    for (const variant of prepared.batches.filter(hasVariantAttributes)) {
      changes.push({ variant, auto: true, excludeBatchId: null });
    }
  }

  if (!changes.length) return { success: true };

  let cloudRecords = null;
  if (mode.cloudEnabled && isOnline()) {
    try {
      cloudRecords = await loadCloudSkuRecords(mode.licenseKey);
    } catch (error) {
      Logger.warn('[Products] No se pudo comprobar el catálogo Cloud para SKU Apparel:', error);
      return apparelSkuError('APPAREL_SKU_CHECK_FAILED');
    }
  }

  const productSkuKey = normalizeSkuKey(
    prepared.product.skuNormalized || prepared.product.sku_normalized || prepared.product.skuKey || prepared.product.sku
  );
  const reserved = new Set(productSkuKey ? [productSkuKey] : []);
  for (const change of changes) {
    const variant = change.variant;
    const requestedSku = String(variant.sku ?? '');
    const hasRequestedSku = Boolean(requestedSku.trim());
    let finalSku = hasRequestedSku ? requestedSku : '';

    if (!hasRequestedSku && change.auto) {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const candidate = createApparelSkuCandidate({
          productName: prepared.product.name,
          color: variant.attributes?.color ?? variant.color,
          size: variant.attributes?.talla ?? variant.talla,
          variantId: variant.id,
          attempt
        });
        const key = normalizeSkuKey(candidate);
        if (reserved.has(key)) continue;
        try {
          if (await findApparelSkuConflict(candidate, { cloudRecords, excludeBatchId: change.excludeBatchId })) continue;
        } catch (error) {
          Logger.warn('[Products] No se pudo comprobar SKU Apparel en Dexie:', error);
          return apparelSkuError('APPAREL_SKU_CHECK_FAILED');
        }
        finalSku = candidate;
        break;
      }
      if (!finalSku) return apparelSkuError('APPAREL_SKU_CHECK_FAILED');
    }

    if (!finalSku) continue;
    const key = normalizeSkuKey(finalSku);
    if (reserved.has(key)) return apparelSkuError('APPAREL_DUPLICATE_SKU', finalSku);
    if (hasRequestedSku) {
      try {
        if (await findApparelSkuConflict(finalSku, { cloudRecords, excludeBatchId: change.excludeBatchId })) {
          return apparelSkuError('APPAREL_DUPLICATE_SKU', finalSku);
        }
      } catch (error) {
        Logger.warn('[Products] No se pudo comprobar SKU Apparel en Dexie:', error);
        return apparelSkuError('APPAREL_SKU_CHECK_FAILED');
      }
    }
    variant.sku = finalSku;
    reserved.add(key);
  }

  return { success: true };
};

const stringifyCloudError = (error) => {
  const values = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    error?.status,
    error?.statusCode,
    error?.name,
    error?.error_description,
    error?.error
  ].filter((value) => value !== null && value !== undefined);

  return values.map((value) => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ').toLowerCase();
};

const isRetryableCloudError = (error) => {
  if (!isOnline()) return true;
  if (error?.name === 'TypeError') return true;

  const code = String(error?.code || '').toLowerCase();
  const message = stringifyCloudError(error);

  return (
    code === '57014' ||
    code.startsWith('08') ||
    code.startsWith('53') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('statement timeout') ||
    message.includes('query timeout') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
};

const getMode = () => {
  const state = useAppStore.getState();
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  return {
    appStatus: state?.appStatus,
    licenseDetails,
    licenseKey,
    businessTypes: state?.companyProfile?.business_type,
    cloudEnabled: Boolean(licenseKey && isCloudProductsSyncEnabled(licenseDetails))
  };
};

const makeIdempotencyKey = ({ entityType, operation, entityId }) => generateIdempotencyKey({
  entityType,
  operation,
  entityId,
  prefix: 'product'
});

const pendingSync = (idempotencyKey) => ({
  syncStatus: PRODUCT_SYNC_STATUS.PENDING,
  pendingOperationId: idempotencyKey,
  localMutationId: idempotencyKey,
  lastSyncedAt: null,
  conflictReason: null
});

const enqueueProductOperation = ({
  licenseKey,
  entityType,
  operation,
  entityId,
  payload,
  idempotencyKey,
  actorHandle
}) => {
  const requirements = getProductInventoryMutationRequirements({ entityType, operation, payload });
  assertProductInventoryMutationCurrent(actorHandle, {
    products: requirements.includes('products'),
    inventory: requirements.includes('inventory')
  });
  return syncOutboxService.enqueueOperation({
    licenseKey,
    entityType,
    operation,
    entityId,
    payload,
    idempotencyKey,
    actorSensitive: true,
    originActor: actorOriginFromHandle(actorHandle),
    metadata: {
      source: 'productRepository',
      phase: PRODUCT_CLOUD_PHASE,
      queuedAt: nowIso()
    }
  });
};

const saveConflictIfNeeded = async ({ operation, response, localPayload }) => {
  if (!productConflictService.isConflictResponse(response)) return;
  await productConflictService.saveConflict({
    operation,
    response,
    localPayload,
    source: 'productRepository'
  });
};

const PHARMACY_BATCH_ERROR_MESSAGES = Object.freeze({
  PHARMACY_EXISTING_BATCH_REQUIRED: 'Ya existe un lote con este código de fabricante. Consulta Lotes / historial y selecciona el lote existente.',
  PHARMACY_ARCHIVED_BATCH_EXISTS: 'Este lote ya está archivado. Revisa Lotes / historial; no se puede reactivar ni duplicar su identidad.',
  PHARMACY_BATCH_IDENTITY_IMMUTABLE: 'La identidad del lote de fabricante no se puede cambiar después de registrarla.'
});

const getPharmacyBatchErrorCode = (error) => {
  const candidates = [error?.code, error?.message, error?.details, error?.hint, error?.response?.code]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value));
  return Object.keys(PHARMACY_BATCH_ERROR_MESSAGES).find((code) => (
    candidates.some((value) => value.includes(code))
  )) || null;
};

const pharmacyBatchFailure = (code) => ({
  success: false,
  code,
  message: PHARMACY_BATCH_ERROR_MESSAGES[code],
  error: { code, message: PHARMACY_BATCH_ERROR_MESSAGES[code] }
});

const normalizeCloudFailure = (response, fallback = 'PRODUCT_CLOUD_ERROR') => {
  const normalized = productConflictService.normalizeFailure(response, fallback);
  const code = getPharmacyBatchErrorCode(response);
  if (!code) return normalized;
  const message = PHARMACY_BATCH_ERROR_MESSAGES[code];
  return { ...normalized, code, message, error: { ...normalized.error, code, message } };
};

const applyResponseAndNotify = async (response, event) => {
  await productLocalRepository.applyCloudCatalog(response);
  notifyProductsChanged(event);
};

const notifyProductMutation = ({ productId, operation, source }) => {
  notifyProductsChanged({
    productId,
    productIds: productId ? [productId] : [],
    operation,
    source,
    timestamp: Date.now()
  });
};

const saveApparelVariantDelta = async (prepared) => {
  const delta = prepared.apparelVariantDelta;
  if (!prepared.editing || !delta) return { success: true };

  const productId = prepared.productId;
  const applied = { updated: [], created: [], removed: [] };
  let latestProduct = null;
  for (const variant of delta.updated || []) {
    const existingBatch = variant.existingBatch;
    const result = await productRepository.saveBatch({
      ...existingBatch,
      productId,
      id: existingBatch.id,
      stock: existingBatch.stock,
      cost: variant.cost,
      price: variant.price,
      sku: variant.sku || null,
      attributes: { talla: variant.talla || '', color: variant.color || '' }
    }, { existingBatch, expectedVersion: existingBatch.serverVersion, apparelSkuAlreadyChecked: true });
    if (!result?.success) return { ...result, appliedVariants: applied, latestProduct };
    latestProduct = result?.response?.product || latestProduct;
    applied.updated.push({ variant, result });
  }

  for (const variant of delta.created || []) {
    const result = await productRepository.saveBatch({
      id: variant.id,
      productId,
      stock: Number(variant.stock) || 0,
      cost: Number(variant.cost) || 0,
      price: Number(variant.price) || 0,
      sku: variant.sku || null,
      attributes: { talla: variant.talla || '', color: variant.color || '' },
      isActive: true,
      status: 'active',
      trackStock: true,
      createdAt: variant.createdAt || nowIso(),
      notes: 'Ingreso rapido'
    }, { expectedVersion: null, apparelSkuAlreadyChecked: true });
    if (!result?.success) return { ...result, appliedVariants: applied, latestProduct };
    latestProduct = result?.response?.product || latestProduct;
    applied.created.push({ variant, result });
  }

  for (const existingBatch of delta.removed || []) {
    const result = await productRepository.deleteBatch(existingBatch, {
      expectedVersion: existingBatch.serverVersion
    });
    if (!result?.success) return { ...result, appliedVariants: applied, latestProduct };
    latestProduct = result?.response?.product || latestProduct;
    applied.removed.push({ variant: existingBatch, result });
  }

  return { success: true, appliedVariants: applied, latestProduct };
};

export const productRepository = {
  async listProductsPage(options = {}) {
    return productLocalRepository.listProductsPage(options);
  },

  async getProductById(productId) {
    return productLocalRepository.getProductById(productId);
  },

  async getAssortmentCatalogSnapshot(options = {}) {
    return productLocalRepository.getAssortmentCatalogSnapshot(options);
  },

  async getCategoryProductCounts(categoryIds = []) {
    const { cloudEnabled } = getMode();
    const counts = await productLocalRepository.getCategoryProductCounts(categoryIds);
    // IndexedDB is authoritative for Free, but never proves a current Cloud total.
    return { source: 'local', complete: !cloudEnabled, counts };
  },

  async listCategories(options = {}) {
    void options;
    return productLocalRepository.listCategories();
  },

  async saveCategory(categoryData, options = {}) {
    const mode = getMode();
    const category = {
      ...categoryData,
      id: categoryData.id || generateID('cat'),
      createdAt: categoryData.createdAt || nowIso(),
      updatedAt: nowIso(),
      isActive: true
    };
    const actorHandle = captureProductInventoryMutation({ products: true });

    if (!mode.cloudEnabled) {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      return productLocalRepository.saveCategoryLocal(category, { syncStatus: PRODUCT_SYNC_STATUS.LOCAL });
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: category.id
    });
    const expectedVersion = options.expectedVersion ?? category.serverVersion ?? null;
    const cloudPayload = categoryToCloudPayload(category);
    const outboxPayload = { category: cloudPayload, expectedVersion };

    const savePending = async (message) => {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      const local = await productLocalRepository.saveCategoryLocal(category, pendingSync(idempotencyKey));
      await enqueueProductOperation({
        actorHandle,
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.CATEGORY,
        operation: SYNC_OPERATIONS.UPSERT,
        entityId: category.id,
        payload: outboxPayload,
        idempotencyKey
      });
      notifyProductsChanged({ source: 'productRepository.saveCategory.pending' });
      return { ...local, success: true, pending: true, message };
    };

    if (!isOnline()) {
      return savePending('Categoria guardada localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      const response = await productCloudRepository.upsertCategory({
        actorHandle,
        licenseKey: mode.licenseKey,
        category: cloudPayload,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success !== true) {
        await saveConflictIfNeeded({
          operation: { entityType: SYNC_ENTITY_TYPES.CATEGORY, entityId: category.id, payload: outboxPayload },
          response,
          localPayload: category
        });
        const failure = normalizeCloudFailure(response, 'CATEGORY_SYNC_FAILED');
        if (response?.code === 'VERSION_CONFLICT' && response.category) {
          try {
            assertProductInventoryMutationCurrent(actorHandle, { products: true });
            await productLocalRepository.applyCloudCategory(response.category);
          } catch (refreshError) {
            Logger.warn('[Products] No se pudo actualizar la categoría después de un conflicto de versión:', refreshError);
            failure.categoryRefreshFailed = true;
          }
        }
        return failure;
      }

      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      await applyResponseAndNotify(response, {
        operation: 'updated',
        source: 'productRepository.saveCategory'
      });
      return { ...(response.category || category), success: true };
    } catch (error) {
      Logger.warn('[Products] Upsert category cloud fallo:', error);
      if (isRetryableCloudError(error)) {
        return savePending('Categoria guardada localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return { success: false, message: error?.message || 'Error al guardar categoria cloud.', error };
    }
  },

  async deleteCategory(categoryId, options = {}) {
    const mode = getMode();
    const actorHandle = captureProductInventoryMutation({ products: true });

    if (!mode.cloudEnabled) {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      return productLocalRepository.deleteCategoryLocal(categoryId);
    }

    const category = await productLocalRepository.getCategoryById(categoryId);
    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      operation: SYNC_OPERATIONS.DELETE,
      entityId: categoryId
    });
    const expectedVersion = options.expectedVersion ?? category?.serverVersion ?? null;
    const outboxPayload = { categoryId, expectedVersion };

    const deletePending = async (message) => {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      const result = await productLocalRepository.deleteCategoryLocal(categoryId, pendingSync(idempotencyKey));
      if (!result?.success) return result;
      await enqueueProductOperation({
        actorHandle,
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.CATEGORY,
        operation: SYNC_OPERATIONS.DELETE,
        entityId: categoryId,
        payload: outboxPayload,
        idempotencyKey
      });
      notifyProductsChanged({ source: 'productRepository.deleteCategory.pending' });
      return { success: true, pending: true, message };
    };

    if (!isOnline()) {
      return deletePending('Categoria eliminada localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      const response = await productCloudRepository.deleteCategory({
        actorHandle,
        licenseKey: mode.licenseKey,
        categoryId,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        await saveConflictIfNeeded({
          operation: { entityType: SYNC_ENTITY_TYPES.CATEGORY, entityId: categoryId, payload: outboxPayload },
          response,
          localPayload: category
        });
        return normalizeCloudFailure(response, 'CATEGORY_DELETE_FAILED');
      }

      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      await applyResponseAndNotify(response, {
        operation: 'deleted',
        source: 'productRepository.deleteCategory'
      });
      pullCatalogChanges(mode.licenseKey).catch(() => {});
      return { success: true, response };
    } catch (error) {
      Logger.warn('[Products] Delete category cloud fallo:', error);
      if (isRetryableCloudError(error)) {
        return deletePending('Categoria eliminada localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return { success: false, message: error?.message || 'Error al eliminar categoria cloud.', error };
    }
  },

  async saveProduct(productData, { existingProduct = null, ...options } = {}) {
    const prepared = await productLocalRepository.prepareProduct(productData, existingProduct);
    const mode = getMode();
    const skuValidation = await prepareApparelVariantSkus(prepared, mode);
    if (!skuValidation.success) return skuValidation;
    const pharmacy = getPharmacyClassification(prepared.product);
    if (!prepared.editing && pharmacy.recorded && pharmacy.kind === 'medicine' && (
      Number(prepared.product.stock || 0) > 0 ||
      prepared.batches.some((batch) => Number(batch.stock || 0) > 0)
    )) {
      return {
        success: false,
        code: 'PHARMACY_INITIAL_STOCK_REQUIRES_DOCUMENTED_RECEIPT',
        message: 'Guarda el medicamento con existencia cero y registra la recepción con comprobante.'
      };
    }
    const operation = prepared.editing ? 'updated' : 'created';
    const productMutationPayload = {
      product: productToCloudPayload(prepared.product),
      initialBatches: prepared.editing ? [] : prepared.batches.map(batchToCloudPayload),
      isNewProduct: !prepared.editing
    };
    const productRequirements = getProductInventoryMutationRequirements({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPSERT,
      payload: productMutationPayload
    });
    const mutationRequirements = {
      products: productRequirements.includes('products'),
      inventory: productRequirements.includes('inventory')
        || Boolean(prepared.apparelVariantDelta && Object.values(prepared.apparelVariantDelta).some((items) => Array.isArray(items) && items.length > 0))
    };
    const actorHandle = captureProductInventoryMutation(mutationRequirements);

    if (!mode.cloudEnabled) {
      assertProductInventoryMutationCurrent(actorHandle, mutationRequirements);
      const result = await productLocalRepository.savePreparedProductLocal(
        prepared,
        { syncStatus: PRODUCT_SYNC_STATUS.LOCAL }
      );
      let appliedVariants = null;
      if (result?.success) {
        assertProductInventoryMutationCurrent(actorHandle, mutationRequirements);
        const variants = await saveApparelVariantDelta(prepared);
        if (!variants?.success) return variants;
        appliedVariants = variants.appliedVariants;
        notifyProductMutation({
          productId: prepared.productId,
          operation,
          source: 'productRepository.saveProduct.local'
        });
      }
      return appliedVariants ? { ...result, appliedVariants } : result;
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: prepared.productId
    });
    const expectedVersion = options.expectedVersion ?? (prepared.editing ? prepared.product?.serverVersion || null : null);
    const payload = { ...productMutationPayload, expectedVersion };
    const savePending = async (message) => {
      assertProductInventoryMutationCurrent(actorHandle, mutationRequirements);
      const result = await productLocalRepository.savePreparedProductLocal(prepared, pendingSync(idempotencyKey));
      if (!result?.success) return result;
      await enqueueProductOperation({
        actorHandle,
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        operation: SYNC_OPERATIONS.UPSERT,
        entityId: prepared.productId,
        payload,
        idempotencyKey
      });
      notifyProductMutation({
        productId: prepared.productId,
        operation,
        source: 'productRepository.saveProduct.pending'
      });
      assertProductInventoryMutationCurrent(actorHandle, mutationRequirements);
      const variants = await saveApparelVariantDelta(prepared);
      if (!variants?.success) return variants;
      return { ...result, pending: true, message, appliedVariants: variants.appliedVariants };
    };

    if (!isOnline()) {
      return savePending('Producto guardado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      assertProductInventoryMutationCurrent(actorHandle, mutationRequirements);
      await ensureCloudProductCategory({
        licenseKey: mode.licenseKey,
        categoryId: payload.product.category_id ?? payload.product.categoryId,
        actorHandle
      });
      const response = await productCloudRepository.upsertProduct({
        actorHandle,
        licenseKey: mode.licenseKey,
        product: payload.product,
        initialBatches: payload.initialBatches,
        isNewProduct: payload.isNewProduct === true,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        await saveConflictIfNeeded({
          operation: { entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: prepared.productId, payload },
          response,
          localPayload: prepared.product
        });
        return normalizeCloudFailure(response, 'PRODUCT_SYNC_FAILED');
      }

      const confirmationError = getProductCloudConfirmationError(response, payload.product);
      if (confirmationError) {
        return {
          success: false,
          ...confirmationError,
          error: confirmationError
        };
      }

      assertProductInventoryMutationCurrent(actorHandle, mutationRequirements);
      await applyResponseAndNotify(response, {
        productId: prepared.productId,
        productIds: [prepared.productId],
        operation,
        source: 'productRepository.saveProduct'
      });
      assertProductInventoryMutationCurrent(actorHandle, mutationRequirements);
      const variants = await saveApparelVariantDelta(prepared);
      if (!variants?.success) {
        return {
          ...variants,
          partial: true,
          productRebase: variants.latestProduct || response.product || prepared.product,
          message: variants.message || 'El producto se guardó, pero no se pudieron sincronizar todas sus variantes. Conservamos tus cambios para que puedas recuperarlos.'
        };
      }
      return {
        success: true,
        productId: prepared.productId,
        inventoryValue: prepared.inventoryValue,
        response,
        appliedVariants: variants.appliedVariants
      };
    } catch (error) {
      Logger.warn('[Products] Upsert product cloud fallo:', error);
      if (isApparelProduct(prepared.product, mode.businessTypes) && String(error?.code || '') === '23505') {
        return apparelSkuError('APPAREL_DUPLICATE_SKU');
      }
      if (isRetryableCloudError(error)) {
        return savePending('Producto guardado localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return {
        success: false,
        code: error?.code || 'PRODUCT_CLOUD_ERROR',
        message: error?.message || 'Error al guardar producto cloud.',
        error
      };
    }
  },

  async deleteProduct(productOrId, options = {}) {
    const productId = typeof productOrId === 'string' ? productOrId : productOrId?.id;
    const product = typeof productOrId === 'string'
      ? await productLocalRepository.getProductById(productId)
      : productOrId;
    const mode = getMode();
    const actorHandle = captureProductInventoryMutation({ products: true, inventory: true });

    if (!mode.cloudEnabled) {
      assertProductInventoryMutationCurrent(actorHandle, { products: true, inventory: true });
      const result = await productLocalRepository.deleteProductLocal(product || productId);
      if (result?.success) {
        notifyProductMutation({
          productId,
          operation: 'deleted',
          source: 'productRepository.deleteProduct.local'
        });
      }
      return result;
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.DELETE,
      entityId: productId
    });
    const expectedVersion = options.expectedVersion ?? product?.serverVersion ?? null;
    const payload = { productId, expectedVersion };

    const deletePending = async (message) => {
      assertProductInventoryMutationCurrent(actorHandle, { products: true, inventory: true });
      const result = await productLocalRepository.deleteProductLocal(product || productId, pendingSync(idempotencyKey));
      if (!result?.success) return result;
      await enqueueProductOperation({
        actorHandle,
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        operation: SYNC_OPERATIONS.DELETE,
        entityId: productId,
        payload,
        idempotencyKey
      });
      notifyProductMutation({
        productId,
        operation: 'deleted',
        source: 'productRepository.deleteProduct.pending'
      });
      return { success: true, pending: true, message };
    };

    if (!isOnline()) {
      return deletePending('Producto eliminado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      assertProductInventoryMutationCurrent(actorHandle, { products: true, inventory: true });
      const response = await productCloudRepository.deleteProduct({
        actorHandle,
        licenseKey: mode.licenseKey,
        productId,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        await saveConflictIfNeeded({
          operation: { entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: productId, payload },
          response,
          localPayload: product
        });
        return normalizeCloudFailure(response, 'PRODUCT_DELETE_FAILED');
      }

      assertProductInventoryMutationCurrent(actorHandle, { products: true, inventory: true });
      await applyResponseAndNotify(response, {
        productId,
        productIds: [productId],
        operation: 'deleted',
        source: 'productRepository.deleteProduct'
      });
      return { success: true, response };
    } catch (error) {
      Logger.warn('[Products] Delete product cloud fallo:', error);
      if (isRetryableCloudError(error)) {
        return deletePending('Producto eliminado localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return { success: false, message: error?.message || 'Error al eliminar producto cloud.', error };
    }
  },

  async toggleProductStatus(productOrId, isActiveOverride = undefined, options = {}) {
    const productId = typeof productOrId === 'string' ? productOrId : productOrId?.id;
    const product = (await productLocalRepository.getProductById(productId))
      || (typeof productOrId === 'string' ? null : productOrId);
    const isActive = isActiveOverride === undefined ? !(product?.isActive !== false) : Boolean(isActiveOverride);
    if (isActive && requiresConfirmedMedicineClassification(product)) {
      return {
        success: false,
        code: 'PHARMACY_CLASSIFICATION_REQUIRED',
        message: PHARMACY_CLASSIFICATION_REQUIRED_FOR_ACTIVATION
      };
    }
    if (isActive && isSpecialPharmacyProduct(product)) {
      return { success: false, message: 'La fracción I, II o III no puede activarse para venta genérica.' };
    }
    const mode = getMode();
    const actorHandle = captureProductInventoryMutation({ products: true });

    const operation = isActive ? 'activated' : 'deactivated';

    if (!mode.cloudEnabled) {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      const result = await productLocalRepository.toggleProductStatusLocal(product || productId, isActive);
      if (result?.success) {
        notifyProductMutation({
          productId,
          operation,
          source: 'productRepository.toggleProductStatus.local'
        });
      }
      return result;
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.TOGGLE_STATUS,
      entityId: productId
    });
    const expectedVersion = options.expectedVersion ?? product?.serverVersion ?? null;
    const payload = { productId, isActive, expectedVersion };

    const enqueuePending = async (message) => {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      await productLocalRepository.markProductPending(productId, {
        ...pendingSync(idempotencyKey),
        isActive,
        updatedAt: nowIso()
      });
      await enqueueProductOperation({
        actorHandle,
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        operation: SYNC_OPERATIONS.TOGGLE_STATUS,
        entityId: productId,
        payload,
        idempotencyKey
      });
      notifyProductMutation({
        productId,
        operation,
        source: 'productRepository.toggleProductStatus.pending'
      });
      return { success: true, pending: true, message };
    };

    if (!isOnline()) {
      return enqueuePending('Estado guardado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      const response = await productCloudRepository.toggleProductStatus({
        actorHandle,
        licenseKey: mode.licenseKey,
        productId,
        isActive,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        await saveConflictIfNeeded({
          operation: { entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: productId, payload },
          response,
          localPayload: product
        });
        return normalizeCloudFailure(response, 'PRODUCT_TOGGLE_FAILED');
      }
      if (response?.success !== true) {
        return {
          success: false,
          code: 'PRODUCT_TOGGLE_CONFIRMATION_MISSING',
          message: 'Nube no confirmó el cambio de estado. Actualiza el catálogo antes de continuar.'
        };
      }

      assertProductInventoryMutationCurrent(actorHandle, { products: true });
      await applyResponseAndNotify(response, {
        productId,
        productIds: [productId],
        operation,
        source: 'productRepository.toggleProductStatus'
      });
      return { success: true, response };
    } catch (error) {
      Logger.warn('[Products] Toggle product cloud fallo:', error);
      if (isRetryableCloudError(error)) {
        return enqueuePending('Estado guardado localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return { success: false, message: error?.message || 'Error al cambiar estado cloud.', error };
    }
  },

  async saveBatch(batchData, { existingBatch = null, apparelSkuAlreadyChecked = false, ...options } = {}) {
    const parent = await productLocalRepository.getProductById(batchData.productId);
    const currentBatch = existingBatch || (batchData.id ? await productLocalRepository.getBatchById(batchData.id) : null);
    const pharmacy = getPharmacyClassification(parent || {});
    if (pharmacy.recorded && pharmacy.kind === 'medicine') {
      const original = currentBatch;
      const originalManufacturer = String(original?.manufacturerBatchId || '').trim().toLowerCase();
      const nextManufacturer = String(batchData.manufacturerBatchId || '').trim().toLowerCase();
      const wasArchived = isBatchArchived(original);
      const isReactivated = (batchData.deletedAt === undefined || batchData.deletedAt === null)
        && (batchData.deleted_at === undefined || batchData.deleted_at === null)
        && batchData.isActive !== false && batchData.status !== 'archived';
      if (wasArchived && isReactivated) return pharmacyBatchFailure('PHARMACY_ARCHIVED_BATCH_EXISTS');
      if (original && originalManufacturer && originalManufacturer !== nextManufacturer) {
        return pharmacyBatchFailure('PHARMACY_BATCH_IDENTITY_IMMUTABLE');
      }
      if (nextManufacturer) {
        const batches = await productLocalRepository.getBatchesByProductId(parent.id);
        const duplicate = batches.find((batch) => batch.id !== batchData.id
          && String(batch.manufacturerBatchId || '').trim().toLowerCase() === nextManufacturer);
        if (duplicate) return pharmacyBatchFailure(
          isBatchArchived(duplicate)
            ? 'PHARMACY_ARCHIVED_BATCH_EXISTS' : 'PHARMACY_EXISTING_BATCH_REQUIRED'
        );
      }
      if (Number(batchData.stock || 0) > Number(original?.stock || 0)) {
        return {
          success: false,
          code: 'PHARMACY_BATCH_STOCK_INCREASE_REQUIRES_DOCUMENTED_RECEIPT',
          message: 'El lote se crea con cero unidades. Para aumentar existencias usa la recepción con comprobante.'
        };
      }
    }
    const mode = getMode();
    const skuKey = normalizeSkuKey(batchData.sku);
    const skuChanged = skuKey !== normalizeSkuKey(currentBatch?.skuKey || currentBatch?.sku_key || currentBatch?.sku);
    if (isApparelVariantBatch(parent, currentBatch || batchData, mode.businessTypes) && skuKey && skuChanged && !apparelSkuAlreadyChecked) {
      let cloudRecords = null;
      if (mode.cloudEnabled && isOnline()) {
        try {
          cloudRecords = await loadCloudSkuRecords(mode.licenseKey);
        } catch (error) {
          Logger.warn('[Products] No se pudo comprobar el catálogo Cloud para SKU Apparel:', error);
          return apparelSkuError('APPAREL_SKU_CHECK_FAILED');
        }
      }
      try {
        if (await findApparelSkuConflict(batchData.sku, {
          cloudRecords,
          excludeBatchId: currentBatch?.id || batchData.id
        })) return apparelSkuError('APPAREL_DUPLICATE_SKU', batchData.sku);
      } catch (error) {
        Logger.warn('[Products] No se pudo comprobar SKU Apparel en Dexie:', error);
        return apparelSkuError('APPAREL_SKU_CHECK_FAILED');
      }
    }
    const actorHandle = captureProductInventoryMutation({ inventory: true });

    if (!mode.cloudEnabled) {
      assertProductInventoryMutationCurrent(actorHandle, { inventory: true });
      const result = await productLocalRepository.saveBatchLocal(
        batchData,
        { syncStatus: PRODUCT_SYNC_STATUS.LOCAL }
      );
      if (result?.success) {
        notifyProductMutation({
          productId: batchData.productId,
          operation: 'updated',
          source: 'productRepository.saveBatch.local'
        });
      }
      return result;
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: batchData.id
    });
    const expectedVersion = options.expectedVersion ?? existingBatch?.serverVersion ?? batchData.serverVersion ?? null;
    const payload = { batch: batchToCloudPayload(batchData), expectedVersion };

    const enqueuePending = async (message) => {
      assertProductInventoryMutationCurrent(actorHandle, { inventory: true });
      const local = await productLocalRepository.saveBatchLocal(batchData, pendingSync(idempotencyKey));
      if (!local?.success) return local;
      await enqueueProductOperation({
        actorHandle,
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
        operation: SYNC_OPERATIONS.UPSERT,
        entityId: batchData.id,
        payload,
        idempotencyKey
      });
      notifyProductMutation({
        productId: batchData.productId,
        operation: 'updated',
        source: 'productRepository.saveBatch.pending'
      });
      return { ...local, pending: true, message };
    };

    if (!isOnline()) {
      return enqueuePending('Lote guardado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      assertProductInventoryMutationCurrent(actorHandle, { inventory: true });
      const response = await productCloudRepository.upsertProductBatch({
        actorHandle,
        licenseKey: mode.licenseKey,
        batch: payload.batch,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        await saveConflictIfNeeded({
          operation: { entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH, entityId: batchData.id, payload },
          response,
          localPayload: batchData
        });
        return normalizeCloudFailure(response, 'BATCH_SYNC_FAILED');
      }
      if (response?.success !== true) {
        return {
          success: false,
          code: 'BATCH_SYNC_CONFIRMATION_MISSING',
          message: 'Nube no confirmó el lote. Actualiza el historial antes de continuar.'
        };
      }

      assertProductInventoryMutationCurrent(actorHandle, { inventory: true });
      await applyResponseAndNotify(response, {
        productId: batchData.productId,
        productIds: batchData.productId ? [batchData.productId] : [],
        operation: 'updated',
        source: 'productRepository.saveBatch'
      });
      return { success: true, response };
    } catch (error) {
      Logger.warn('[Products] Upsert batch cloud fallo:', error);
      const pharmacyBatchCode = getPharmacyBatchErrorCode(error);
      if (pharmacyBatchCode) return pharmacyBatchFailure(pharmacyBatchCode);
      if (isApparelVariantBatch(parent, batchData, mode.businessTypes) && String(error?.code || '') === '23505') {
        return apparelSkuError('APPAREL_DUPLICATE_SKU', batchData.sku);
      }
      if (isRetryableCloudError(error)) {
        return enqueuePending('Lote guardado localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return { success: false, message: error?.message || 'Error al guardar lote cloud.', error };
    }
  },

  async deleteBatch(batchOrId, options = {}) {
    const batchId = typeof batchOrId === 'string' ? batchOrId : batchOrId?.id;
    const batch = typeof batchOrId === 'string'
      ? await productLocalRepository.getBatchById(batchId)
      : batchOrId;
    const mode = getMode();
    const actorHandle = captureProductInventoryMutation({ inventory: true });

    if (!mode.cloudEnabled) {
      assertProductInventoryMutationCurrent(actorHandle, { inventory: true });
      const result = await productLocalRepository.deleteBatchLocal(
        batch || { id: batchId },
        { syncStatus: PRODUCT_SYNC_STATUS.LOCAL }
      );
      if (result?.success) {
        notifyProductMutation({
          productId: batch?.productId || batch?.product_id || null,
          operation: 'updated',
          source: 'productRepository.deleteBatch.local'
        });
      }
      return result;
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      operation: SYNC_OPERATIONS.DELETE,
      entityId: batchId
    });
    const expectedVersion = options.expectedVersion ?? batch?.serverVersion ?? null;
    const payload = { batchId, expectedVersion };

    const enqueuePending = async (message) => {
      assertProductInventoryMutationCurrent(actorHandle, { inventory: true });
      const local = await productLocalRepository.deleteBatchLocal(batch || { id: batchId }, pendingSync(idempotencyKey));
      if (!local?.success) return local;
      await enqueueProductOperation({
        actorHandle,
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
        operation: SYNC_OPERATIONS.DELETE,
        entityId: batchId,
        payload,
        idempotencyKey
      });
      notifyProductMutation({
        productId: batch?.productId || batch?.product_id || null,
        operation: 'updated',
        source: 'productRepository.deleteBatch.pending'
      });
      return { success: true, pending: true, message };
    };

    if (!isOnline()) {
      return enqueuePending('Lote archivado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      assertProductInventoryMutationCurrent(actorHandle, { inventory: true });
      const response = await productCloudRepository.deleteProductBatch({
        actorHandle,
        licenseKey: mode.licenseKey,
        batchId,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        await saveConflictIfNeeded({
          operation: { entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH, entityId: batchId, payload },
          response,
          localPayload: batch
        });
        return normalizeCloudFailure(response, 'BATCH_DELETE_FAILED');
      }

      assertProductInventoryMutationCurrent(actorHandle, { inventory: true });
      await applyResponseAndNotify(response, {
        productId: batch?.productId || batch?.product_id || null,
        productIds: [batch?.productId || batch?.product_id].filter(Boolean),
        operation: 'updated',
        source: 'productRepository.deleteBatch'
      });
      return { success: true, response };
    } catch (error) {
      Logger.warn('[Products] Delete batch cloud fallo:', error);
      if (isRetryableCloudError(error)) {
        return enqueuePending('Lote archivado localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return { success: false, message: error?.message || 'Error al eliminar lote cloud.', error };
    }
  },

  async pullFullSnapshot(options = {}) {
    const mode = getMode();
    return productMigrationService.pullFullSnapshot({
      licenseKey: options.licenseKey || mode.licenseKey
    });
  }
};

export default productRepository;
