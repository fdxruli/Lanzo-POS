import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import { syncOutboxService } from '../sync/syncOutboxService';
import {
  OUTBOX_STATUS,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { assertProductInventoryOperationActorCurrent } from '../auth/productInventoryAuthority';

const categoryIsActive = (category = {}) => (
  category.is_active !== false
  && category.isActive !== false
  && !category.deleted_at
  && !category.deletedAt
);

const categoryIdOf = (category = {}) => category.id || null;

const findCloudCategory = async (licenseKey, categoryId) => {
  let offset = 0;

  while (true) {
    const response = await productCloudRepository.pullCatalogSnapshot({
      licenseKey,
      entityType: 'categories',
      limit: SYNC_LIMITS.MAX_PULL_LIMIT,
      offset,
      includeDeleted: true,
      force: true
    });

    if (response?.success !== true || !Array.isArray(response.categories)) {
      const error = new Error(response?.message || 'No se pudo confirmar la categoría en el negocio actual.');
      error.code = response?.code || 'PRODUCT_CATEGORY_CONFIRMATION_FAILED';
      throw error;
    }

    const match = response.categories.find((category) => categoryIdOf(category) === categoryId);
    if (match) return match;

    if (response.has_more !== true && response.hasMore !== true) return null;
    if (response.categories.length === 0) {
      const error = new Error('La lista de categorías de Cloud quedó incompleta.');
      error.code = 'PRODUCT_CATEGORY_CATALOG_INCOMPLETE';
      throw error;
    }
    offset += response.categories.length;
  }
};

const categoryConfirmationFailure = (message, code = 'PRODUCT_CATEGORY_NOT_AVAILABLE') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const syncPendingCategory = async ({ licenseKey, categoryId, actorHandle }) => {
  const localCategory = await productLocalRepository.getCategoryById(categoryId);
  if (!localCategory || !categoryIsActive(localCategory)) {
    throw categoryConfirmationFailure('La categoría seleccionada no está activa en este negocio. Actualiza las categorías e inténtalo de nuevo.');
  }

  const operationId = localCategory.pendingOperationId || localCategory.localMutationId;
  if (!operationId) {
    throw categoryConfirmationFailure('La categoría seleccionada no está confirmada en Cloud para este negocio.');
  }

  let operation;
  try {
    operation = await syncOutboxService.getOperation(operationId, { licenseKey });
  } catch {
    throw categoryConfirmationFailure('La categoría seleccionada no pertenece a la sincronización pendiente de este negocio.');
  }

  const categoryPayload = operation?.payload?.category;
  const replayableStatus = new Set([OUTBOX_STATUS.PENDING, OUTBOX_STATUS.PROCESSING, OUTBOX_STATUS.FAILED]);
  if (operation?.entityType !== SYNC_ENTITY_TYPES.CATEGORY
    || operation.operation !== SYNC_OPERATIONS.UPSERT
    || operation.entityId !== categoryId
    || !replayableStatus.has(operation.status)
    || categoryIdOf(categoryPayload) !== categoryId
    || !categoryIsActive(categoryPayload)) {
    throw categoryConfirmationFailure('La categoría seleccionada no está pendiente de confirmación para este negocio.');
  }
  if (operation.actorSensitivity === 'actor_bound') {
    assertProductInventoryOperationActorCurrent(operation);
  }

  const response = await productCloudRepository.upsertCategory({
    licenseKey,
    category: categoryPayload,
    expectedVersion: operation.payload?.expectedVersion ?? null,
    idempotencyKey: operation.idempotencyKey || operation.id,
    actorHandle
  });
  const savedCategory = response?.category;
  if (response?.success !== true
    || categoryIdOf(savedCategory) !== categoryId
    || !categoryIsActive(savedCategory)) {
    throw categoryConfirmationFailure(
      response?.message || 'Cloud no confirmó la categoría seleccionada para este negocio.',
      response?.code || 'PRODUCT_CATEGORY_NOT_CONFIRMED'
    );
  }

  await syncOutboxService.markSynced(operation.id || operation.idempotencyKey, response, { licenseKey });
  await productLocalRepository.applyCloudCategory(savedCategory);
  return savedCategory;
};

export const ensureCloudProductCategory = async ({ licenseKey, categoryId, actorHandle = null } = {}) => {
  if (!categoryId) return { success: true, category: null };

  const cloudCategory = await findCloudCategory(licenseKey, categoryId);
  if (cloudCategory) {
    if (!categoryIsActive(cloudCategory)) {
      throw categoryConfirmationFailure('La categoría seleccionada está inactiva en este negocio. Actualiza el producto e inténtalo de nuevo.');
    }
    return { success: true, category: cloudCategory };
  }

  const category = await syncPendingCategory({ licenseKey, categoryId, actorHandle });
  return { success: true, category };
};

export const getProductCloudConfirmationError = (response, submittedProduct = {}) => {
  if (response?.success !== true) {
    return {
      code: 'PRODUCT_SYNC_CONFIRMATION_MISSING',
      message: response?.message || 'Cloud no confirmó el guardado del producto.'
    };
  }

  const cloudProduct = response.product
    || response.products?.find((product) => product?.id === submittedProduct.id);
  if (!cloudProduct || cloudProduct.id !== submittedProduct.id) {
    return {
      code: 'PRODUCT_SYNC_CONFIRMATION_MISSING',
      message: 'Cloud no devolvió confirmación del producto guardado.'
    };
  }

  const submittedCategoryField = Object.prototype.hasOwnProperty.call(submittedProduct, 'category_id')
    || Object.prototype.hasOwnProperty.call(submittedProduct, 'categoryId');
  if (!submittedCategoryField) return null;

  const hasCategoryId = Object.prototype.hasOwnProperty.call(cloudProduct, 'category_id')
    || Object.prototype.hasOwnProperty.call(cloudProduct, 'categoryId');
  if (!hasCategoryId) {
    return {
      code: 'PRODUCT_CATEGORY_CONFIRMATION_MISSING',
      message: 'Cloud no confirmó la categoría del producto. Actualiza y vuelve a guardar.'
    };
  }

  const expectedCategoryId = submittedProduct.category_id ?? submittedProduct.categoryId ?? null;
  const cloudCategoryId = cloudProduct.category_id ?? cloudProduct.categoryId ?? null;
  const normalize = (value) => (value === '' || value === null || value === undefined ? null : String(value));
  if (normalize(cloudCategoryId) !== normalize(expectedCategoryId)) {
    return {
      code: 'PRODUCT_CATEGORY_NOT_CONFIRMED',
      message: 'Cloud no guardó la categoría seleccionada. El producto no se confirmó; actualiza las categorías e inténtalo de nuevo.'
    };
  }

  return null;
};
