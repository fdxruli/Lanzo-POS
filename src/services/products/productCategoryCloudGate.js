import { productCloudRepository } from './productCloudRepository';
import { readProductCatalog } from './productCatalogReader';
import { productLocalRepository } from './productLocalRepository';
import { syncOutboxService } from '../sync/syncOutboxService';
import {
  OUTBOX_STATUS,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { assertProductInventoryOperationActorCurrent } from '../auth/productInventoryAuthority';
import { categoryToCloudPayload, normalizeNameKey } from './productMapper';

const categoryIsActive = (category = {}) => (
  category.is_active !== false
  && category.isActive !== false
  && category.deletionPending !== true
  && !category.deleted_at
  && !category.deletedAt
);

const categoryIdOf = (category = {}) => category.id || null;

const listCloudCategories = async (licenseKey, actorHandle, assertContextCurrent) => {
  const { categories } = await readProductCatalog({
    cloudRepository: productCloudRepository, licenseKey, actorHandle,
    assertContextCurrent, categoriesOnly: true
  });
  return categories;
};

const findCloudCategory = async (licenseKey, categoryId, actorHandle, assertContextCurrent) => (
  (await listCloudCategories(licenseKey, actorHandle, assertContextCurrent))
    .find((category) => categoryIdOf(category) === categoryId) || null
);

const categoryConfirmationFailure = (message, code = 'PRODUCT_CATEGORY_NOT_AVAILABLE') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const categoryRecoveryRequired = (category) => {
  const error = categoryConfirmationFailure(
    `«${category.name}» existe en este dispositivo, pero aún no está confirmada en Cloud. Confirma la categoría en la nube para continuar.`,
    'PRODUCT_CATEGORY_RECOVERY_REQUIRED'
  );
  error.category = { id: category.id, name: category.name };
  return error;
};

const categoryNameKey = (category = {}) => normalizeNameKey(category.name || category.name_key || category.nameKey || '');

const isRetryableCategoryMutationError = (error) => {
  const code = String(error?.code || '').toLowerCase();
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return error?.name === 'TypeError'
    || code === '57014'
    || code.startsWith('08')
    || code.startsWith('53')
    || ['timeout', 'failed to fetch', 'networkerror', 'network request failed', 'temporarily unavailable', '502', '503', '504']
      .some((fragment) => message.includes(fragment));
};

const assertLocalCategoryHasNoContradictoryTenant = (category, licenseKey) => {
  const recordedLicenseKey = category.licenseKey || category.license_key
    || category.metadata?.licenseKey || category.metadata?.license_key;
  if (recordedLicenseKey && recordedLicenseKey !== licenseKey) {
    throw categoryConfirmationFailure(
      'La categoría local muestra un negocio de origen distinto. No se confirmó en Cloud.',
      'PRODUCT_CATEGORY_TENANT_MISMATCH'
    );
  }
};

const inspectRecoveryCloudCatalog = async ({ licenseKey, categoryId, categoryName, actorHandle, assertContextCurrent }) => {
  const categories = await listCloudCategories(licenseKey, actorHandle, assertContextCurrent);
  const localNameKey = normalizeNameKey(categoryName);
  const duplicate = categories.find((category) => (
    categoryIdOf(category) !== categoryId && categoryNameKey(category) === localNameKey
  ));
  if (duplicate) {
    throw categoryConfirmationFailure(
      `Cloud ya tiene otra categoría llamada «${categoryName}» con un ID distinto. Actualiza las categorías antes de continuar.`,
      'PRODUCT_CATEGORY_CLOUD_DUPLICATE'
    );
  }

  const existing = categories.find((category) => categoryIdOf(category) === categoryId) || null;
  if (!existing) return null;
  if (!categoryIsActive(existing)) {
    throw categoryConfirmationFailure(
      'Cloud conserva una eliminación para esta categoría. No se restauró; actualiza el catálogo o elige otra categoría.',
      'PRODUCT_CATEGORY_CLOUD_DELETED'
    );
  }
  if (categoryNameKey(existing) !== localNameKey) {
    throw categoryConfirmationFailure(
      'Cloud ya usa este ID para otra categoría. Actualiza el catálogo antes de continuar.',
      'PRODUCT_CATEGORY_CLOUD_ID_CONFLICT'
    );
  }
  return existing;
};

const requireCurrentCategoryContext = async (assertContextCurrent) => {
  if (typeof assertContextCurrent !== 'function') {
    throw categoryConfirmationFailure(
      'No se pudo validar la sesión y el negocio actuales. Verifica la categoría antes de continuar.',
      'PRODUCT_CATEGORY_RECOVERY_CONTEXT_CHANGED'
    );
  }
  await assertContextCurrent();
};

const applyConfirmedRecoveryCategory = async (category, assertContextCurrent) => {
  await requireCurrentCategoryContext(assertContextCurrent);
  await productLocalRepository.applyCloudCategory(category, {
    beforeWrite: () => requireCurrentCategoryContext(assertContextCurrent)
  });
  return category;
};

const syncPendingCategory = async ({ licenseKey, categoryId, actorHandle, assertContextCurrent }) => {
  const localCategory = await productLocalRepository.getCategoryById(categoryId);
  if (!localCategory || !categoryIsActive(localCategory)) {
    throw categoryConfirmationFailure('La categoría seleccionada no está activa en este negocio. Actualiza las categorías e inténtalo de nuevo.');
  }
  if (!String(localCategory.name || '').trim()) {
    throw categoryConfirmationFailure('La categoría local no tiene un nombre válido para confirmar en Cloud. Actualiza las categorías.');
  }
  assertLocalCategoryHasNoContradictoryTenant(localCategory, licenseKey);

  const deletedLocalCategory = await productLocalRepository.getDeletedCategoryById(categoryId);
  if (deletedLocalCategory) {
    throw categoryConfirmationFailure(
      'Esta categoría también aparece en la papelera local. No se confirmó; revisa su estado antes de continuar.',
      'PRODUCT_CATEGORY_LOCAL_DELETED'
    );
  }

  let categoryOperations;
  try {
    categoryOperations = await syncOutboxService.listOperationsForEntity({
      licenseKey,
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      entityId: categoryId
    });
  } catch {
    throw categoryConfirmationFailure(
      'No se pudo verificar que la categoría local y su sincronización pertenezcan a este negocio.',
      'PRODUCT_CATEGORY_TENANT_UNVERIFIED'
    );
  }
  if (categoryOperations.some((row) => row.operation === SYNC_OPERATIONS.DELETE)) {
    throw categoryConfirmationFailure(
      'La categoría tiene una eliminación registrada en la sincronización de este negocio. Actualiza las categorías antes de continuar.',
      'PRODUCT_CATEGORY_DELETE_PENDING'
    );
  }

  const operationId = localCategory.pendingOperationId || localCategory.localMutationId;
  let operation;
  if (operationId) {
    try {
      operation = await syncOutboxService.getOperation(operationId, { licenseKey });
    } catch {
      if (categoryOperations.length === 0) throw categoryRecoveryRequired(localCategory);
      throw categoryConfirmationFailure('La categoría seleccionada no pertenece a la sincronización pendiente de este negocio.');
    }
  } else if (categoryOperations.length === 0) {
    throw categoryRecoveryRequired(localCategory);
  } else {
    throw categoryConfirmationFailure('La categoría tiene operaciones locales que no se pueden confirmar de forma segura.');
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

  await requireCurrentCategoryContext(assertContextCurrent);
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

  // Keep the outbox receipt and local category projection bound to the actor
  // and tenant that authorized the pending operation.
  await requireCurrentCategoryContext(assertContextCurrent);
  await syncOutboxService.markSynced(operation.id || operation.idempotencyKey, response, { licenseKey });
  return applyConfirmedRecoveryCategory(savedCategory, assertContextCurrent);
};

const recoveryIdempotencyKey = (categoryId) => (
  `product:category:recovery:${encodeURIComponent(categoryId)}`
);

export const recoverLocalCategoryInCloud = async ({
  licenseKey,
  categoryId,
  actorHandle = null,
  assertContextCurrent
} = {}) => {
  if (!licenseKey || !categoryId) {
    throw categoryConfirmationFailure('No se pudo comprobar el negocio o la categoría local.', 'PRODUCT_CATEGORY_RECOVERY_CONTEXT_MISSING');
  }
  await requireCurrentCategoryContext(assertContextCurrent);

  const localCategory = await productLocalRepository.getCategoryById(categoryId);
  if (!localCategory || !categoryIsActive(localCategory) || !String(localCategory.name || '').trim()) {
    throw categoryConfirmationFailure('La categoría local ya no está activa o no tiene un nombre válido. Actualiza las categorías.');
  }
  assertLocalCategoryHasNoContradictoryTenant(localCategory, licenseKey);

  const deletedLocalCategory = await productLocalRepository.getDeletedCategoryById(categoryId);
  if (deletedLocalCategory) {
    throw categoryConfirmationFailure(
      'Esta categoría también aparece en la papelera local. No se confirmó; revisa su estado antes de continuar.',
      'PRODUCT_CATEGORY_LOCAL_DELETED'
    );
  }

  let categoryOperations;
  try {
    categoryOperations = await syncOutboxService.listOperationsForEntity({
      licenseKey,
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      entityId: categoryId
    });
  } catch {
    throw categoryConfirmationFailure(
      'No se pudo verificar que la categoría local pertenezca a este negocio.',
      'PRODUCT_CATEGORY_TENANT_UNVERIFIED'
    );
  }
  if (categoryOperations.some((row) => (
    row.operation === SYNC_OPERATIONS.DELETE && row.status !== OUTBOX_STATUS.SYNCED
  ))) {
    throw categoryConfirmationFailure(
      'La categoría tiene una eliminación pendiente en este negocio. Actualiza las categorías antes de continuar.',
      'PRODUCT_CATEGORY_DELETE_PENDING'
    );
  }
  if (categoryOperations.length > 0) {
    // A newer tab may have queued or synced the original operation since the
    // product form offered recovery. Reuse the existing PR #568 gate.
    const confirmed = await ensureCloudProductCategory({
      licenseKey, categoryId, actorHandle, assertContextCurrent
    });
    return confirmed.category;
  }

  await requireCurrentCategoryContext(assertContextCurrent);
  const existingCloudCategory = await inspectRecoveryCloudCatalog({
    licenseKey,
    categoryId,
    categoryName: localCategory.name, actorHandle, assertContextCurrent
  });
  if (existingCloudCategory) {
    return applyConfirmedRecoveryCategory(existingCloudCategory, assertContextCurrent);
  }

  const payload = categoryToCloudPayload(localCategory);
  const idempotencyKey = recoveryIdempotencyKey(categoryId);
  let response;

  try {
    await requireCurrentCategoryContext(assertContextCurrent);
    response = await productCloudRepository.upsertCategory({
      licenseKey,
      category: payload,
      // The existing RPC treats version 0 as create-only: a category inserted
      // or tombstoned by another device after our read gets a version conflict
      // instead of being overwritten or restored.
      expectedVersion: 0,
      idempotencyKey,
      actorHandle
    });
  } catch (error) {
    if (!isRetryableCategoryMutationError(error)) throw error;
    // Do not continue a timeout reconciliation in a new actor or tenant.
    await requireCurrentCategoryContext(assertContextCurrent);
    const confirmedAfterTimeout = await inspectRecoveryCloudCatalog({
      licenseKey,
      categoryId,
      categoryName: localCategory.name, actorHandle, assertContextCurrent
    });
    if (confirmedAfterTimeout) {
      return applyConfirmedRecoveryCategory(confirmedAfterTimeout, assertContextCurrent);
    }

    // A read confirmed the ID is still absent. Retry once with the same key;
    // the server receipt makes a delayed first request idempotent.
    try {
      await requireCurrentCategoryContext(assertContextCurrent);
      response = await productCloudRepository.upsertCategory({
        licenseKey,
        category: payload,
        expectedVersion: 0,
        idempotencyKey,
        actorHandle
      });
    } catch (retryError) {
      if (!isRetryableCategoryMutationError(retryError)) throw retryError;
      await requireCurrentCategoryContext(assertContextCurrent);
      const confirmedAfterRetryTimeout = await inspectRecoveryCloudCatalog({
        licenseKey,
        categoryId,
        categoryName: localCategory.name, actorHandle, assertContextCurrent
      });
      if (confirmedAfterRetryTimeout) {
        return applyConfirmedRecoveryCategory(confirmedAfterRetryTimeout, assertContextCurrent);
      }
      throw retryError;
    }
  }

  const savedCategory = response?.category;
  const receiptIdempotencyKey = response?.idempotency_key ?? response?.idempotencyKey;
  if (response?.success !== true
    || categoryIdOf(savedCategory) !== categoryId
    || !categoryIsActive(savedCategory)
    || categoryNameKey(savedCategory) !== normalizeNameKey(localCategory.name)
    || receiptIdempotencyKey !== idempotencyKey) {
    throw categoryConfirmationFailure(
      response?.message || 'Cloud no confirmó el recibo y el ID original de la categoría. No se actualizó el registro local.',
      response?.code || 'PRODUCT_CATEGORY_RECOVERY_NOT_CONFIRMED'
    );
  }

  return applyConfirmedRecoveryCategory(savedCategory, assertContextCurrent);
};

export const ensureCloudProductCategory = async ({
  licenseKey,
  categoryId,
  actorHandle = null,
  assertContextCurrent
} = {}) => {
  if (!categoryId) return { success: true, category: null };

  if (assertContextCurrent) await requireCurrentCategoryContext(assertContextCurrent);
  const cloudCategory = await findCloudCategory(licenseKey, categoryId, actorHandle, assertContextCurrent);
  if (cloudCategory) {
    if (!categoryIsActive(cloudCategory)) {
      throw categoryConfirmationFailure('La categoría seleccionada está inactiva en este negocio. Actualiza el producto e inténtalo de nuevo.');
    }
    return { success: true, category: cloudCategory };
  }

  const category = await syncPendingCategory({ licenseKey, categoryId, actorHandle, assertContextCurrent });
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
