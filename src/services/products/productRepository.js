import Logger from '../Logger';
import { generateID } from '../utils';
import { useAppStore } from '../../store/useAppStore';
import { generateIdempotencyKey } from '../sync/idempotency';
import { syncOutboxService } from '../sync/syncOutboxService';
import {
  getLicenseKeyFromDetails,
  isCloudProductsSyncEnabled,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import {
  batchToCloudPayload,
  categoryToCloudPayload,
  productToCloudPayload
} from './productMapper';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import { productConflictService } from './productConflictService';
import { productMigrationService } from './productMigrationService';
import { pullCatalogChanges } from './productSyncHandler';
import { PRODUCT_CLOUD_PHASE, PRODUCT_SYNC_STATUS } from './productConstants';
import { notifyProductsChanged } from './productEvents';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const nowIso = () => new Date().toISOString();

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
  conflictReason: null
});

const enqueueProductOperation = ({
  licenseKey,
  entityType,
  operation,
  entityId,
  payload,
  idempotencyKey
}) => syncOutboxService.enqueueOperation({
  licenseKey,
  entityType,
  operation,
  entityId,
  payload,
  idempotencyKey,
  metadata: {
    source: 'productRepository',
    phase: PRODUCT_CLOUD_PHASE,
    queuedAt: nowIso()
  }
});

const saveConflictIfNeeded = async ({ operation, response, localPayload }) => {
  if (!productConflictService.isConflictResponse(response)) return;
  await productConflictService.saveConflict({
    operation,
    response,
    localPayload,
    source: 'productRepository'
  });
};

const normalizeCloudFailure = (response, fallback = 'PRODUCT_CLOUD_ERROR') => (
  productConflictService.normalizeFailure(response, fallback)
);

const applyResponseAndNotify = async (response, source) => {
  await productLocalRepository.applyCloudCatalog(response);
  notifyProductsChanged({ source });
};

export const productRepository = {
  async listProductsPage(options = {}) {
    return productLocalRepository.listProductsPage(options);
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

    if (!mode.cloudEnabled) {
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
      const local = await productLocalRepository.saveCategoryLocal(category, pendingSync(idempotencyKey));
      await enqueueProductOperation({
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
      const response = await productCloudRepository.upsertCategory({
        licenseKey: mode.licenseKey,
        category: cloudPayload,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        await saveConflictIfNeeded({
          operation: { entityType: SYNC_ENTITY_TYPES.CATEGORY, entityId: category.id, payload: outboxPayload },
          response,
          localPayload: category
        });
        return normalizeCloudFailure(response, 'CATEGORY_SYNC_FAILED');
      }

      await applyResponseAndNotify(response, 'productRepository.saveCategory');
      return response.category || category;
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

    if (!mode.cloudEnabled) {
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
      const result = await productLocalRepository.deleteCategoryLocal(categoryId, pendingSync(idempotencyKey));
      if (!result?.success) return result;
      await enqueueProductOperation({
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
      const response = await productCloudRepository.deleteCategory({
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

      await applyResponseAndNotify(response, 'productRepository.deleteCategory');
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

    if (!mode.cloudEnabled) {
      return productLocalRepository.savePreparedProductLocal(prepared, { syncStatus: PRODUCT_SYNC_STATUS.LOCAL });
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: prepared.productId
    });
    const expectedVersion = options.expectedVersion ?? (prepared.editing ? prepared.product?.serverVersion || null : null);
    const payload = {
      product: productToCloudPayload(prepared.product),
      initialBatches: prepared.batches.map(batchToCloudPayload),
      expectedVersion
    };

    const savePending = async (message) => {
      const result = await productLocalRepository.savePreparedProductLocal(prepared, pendingSync(idempotencyKey));
      if (!result?.success) return result;
      await enqueueProductOperation({
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        operation: SYNC_OPERATIONS.UPSERT,
        entityId: prepared.productId,
        payload,
        idempotencyKey
      });
      notifyProductsChanged({ source: 'productRepository.saveProduct.pending' });
      return { ...result, pending: true, message };
    };

    if (!isOnline()) {
      return savePending('Producto guardado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      const response = await productCloudRepository.upsertProduct({
        licenseKey: mode.licenseKey,
        product: payload.product,
        initialBatches: payload.initialBatches,
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

      await applyResponseAndNotify(response, 'productRepository.saveProduct');
      return { success: true, productId: prepared.productId, inventoryValue: prepared.inventoryValue, response };
    } catch (error) {
      Logger.warn('[Products] Upsert product cloud fallo:', error);
      if (isRetryableCloudError(error)) {
        return savePending('Producto guardado localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return { success: false, message: error?.message || 'Error al guardar producto cloud.', error };
    }
  },

  async deleteProduct(productOrId, options = {}) {
    const productId = typeof productOrId === 'string' ? productOrId : productOrId?.id;
    const product = typeof productOrId === 'string'
      ? await productLocalRepository.getProductById(productId)
      : productOrId;
    const mode = getMode();

    if (!mode.cloudEnabled) {
      return productLocalRepository.deleteProductLocal(product || productId);
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.DELETE,
      entityId: productId
    });
    const expectedVersion = options.expectedVersion ?? product?.serverVersion ?? null;
    const payload = { productId, expectedVersion };

    const deletePending = async (message) => {
      const result = await productLocalRepository.deleteProductLocal(product || productId, pendingSync(idempotencyKey));
      if (!result?.success) return result;
      await enqueueProductOperation({
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        operation: SYNC_OPERATIONS.DELETE,
        entityId: productId,
        payload,
        idempotencyKey
      });
      notifyProductsChanged({ source: 'productRepository.deleteProduct.pending' });
      return { success: true, pending: true, message };
    };

    if (!isOnline()) {
      return deletePending('Producto eliminado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      const response = await productCloudRepository.deleteProduct({
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

      await applyResponseAndNotify(response, 'productRepository.deleteProduct');
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
    const product = typeof productOrId === 'string'
      ? await productLocalRepository.getProductById(productId)
      : productOrId;
    const isActive = isActiveOverride === undefined ? !(product?.isActive !== false) : Boolean(isActiveOverride);
    const mode = getMode();

    if (!mode.cloudEnabled) {
      return productLocalRepository.toggleProductStatusLocal(product || productId, isActive);
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.TOGGLE_STATUS,
      entityId: productId
    });
    const expectedVersion = options.expectedVersion ?? product?.serverVersion ?? null;
    const payload = { productId, isActive, expectedVersion };

    await productLocalRepository.markProductPending(productId, {
      ...pendingSync(idempotencyKey),
      isActive,
      updatedAt: nowIso()
    });

    const enqueuePending = async (message) => {
      await enqueueProductOperation({
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        operation: SYNC_OPERATIONS.TOGGLE_STATUS,
        entityId: productId,
        payload,
        idempotencyKey
      });
      notifyProductsChanged({ source: 'productRepository.toggleProductStatus.pending' });
      return { success: true, pending: true, message };
    };

    if (!isOnline()) {
      return enqueuePending('Estado guardado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      const response = await productCloudRepository.toggleProductStatus({
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

      await applyResponseAndNotify(response, 'productRepository.toggleProductStatus');
      return { success: true, response };
    } catch (error) {
      Logger.warn('[Products] Toggle product cloud fallo:', error);
      if (isRetryableCloudError(error)) {
        return enqueuePending('Estado guardado localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.');
      }
      return { success: false, message: error?.message || 'Error al cambiar estado cloud.', error };
    }
  },

  async saveBatch(batchData, { existingBatch = null, ...options } = {}) {
    const mode = getMode();

    if (!mode.cloudEnabled) {
      return productLocalRepository.saveBatchLocal(batchData, { syncStatus: PRODUCT_SYNC_STATUS.LOCAL });
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: batchData.id
    });
    const expectedVersion = options.expectedVersion ?? existingBatch?.serverVersion ?? batchData.serverVersion ?? null;
    const payload = { batch: batchToCloudPayload(batchData), expectedVersion };

    const local = await productLocalRepository.saveBatchLocal(batchData, pendingSync(idempotencyKey));
    if (!local?.success) return local;

    const enqueuePending = async (message) => {
      await enqueueProductOperation({
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
        operation: SYNC_OPERATIONS.UPSERT,
        entityId: batchData.id,
        payload,
        idempotencyKey
      });
      notifyProductsChanged({ source: 'productRepository.saveBatch.pending' });
      return { ...local, pending: true, message };
    };

    if (!isOnline()) {
      return enqueuePending('Lote guardado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      const response = await productCloudRepository.upsertProductBatch({
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

      await applyResponseAndNotify(response, 'productRepository.saveBatch');
      return local;
    } catch (error) {
      Logger.warn('[Products] Upsert batch cloud fallo:', error);
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

    if (!mode.cloudEnabled) {
      return productLocalRepository.deleteBatchLocal(batch || { id: batchId }, { syncStatus: PRODUCT_SYNC_STATUS.LOCAL });
    }

    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      operation: SYNC_OPERATIONS.DELETE,
      entityId: batchId
    });
    const expectedVersion = options.expectedVersion ?? batch?.serverVersion ?? null;
    const payload = { batchId, expectedVersion };
    const local = await productLocalRepository.deleteBatchLocal(batch || { id: batchId }, pendingSync(idempotencyKey));
    if (!local?.success) return local;

    const enqueuePending = async (message) => {
      await enqueueProductOperation({
        licenseKey: mode.licenseKey,
        entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
        operation: SYNC_OPERATIONS.DELETE,
        entityId: batchId,
        payload,
        idempotencyKey
      });
      notifyProductsChanged({ source: 'productRepository.deleteBatch.pending' });
      return { success: true, pending: true, message };
    };

    if (!isOnline()) {
      return enqueuePending('Lote archivado localmente. Se sincronizara cuando vuelva internet.');
    }

    try {
      const response = await productCloudRepository.deleteProductBatch({
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

      await applyResponseAndNotify(response, 'productRepository.deleteBatch');
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
