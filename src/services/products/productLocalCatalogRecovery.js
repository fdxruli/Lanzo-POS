import Logger from '../Logger';
import { STORES } from '../db/dexie';
import { listLocalOnlyInventoryEntriesForRecovery } from '../inventory/inventoryEntryService';
import { syncConflictService } from '../sync/syncConflictService';
import { syncMetaService } from '../sync/syncMetaService';
import { syncOutboxService } from '../sync/syncOutboxService';
import { OUTBOX_STATUS, SYNC_ENTITY_TYPES } from '../sync/syncConstants';
import { isLocalTenantAccessError, runWithLocalTenantSyncLease } from '../tenant/localTenantGuard';
import { batchToCloudPayload, categoryToCloudPayload, productToCloudPayload } from './productMapper';
import { productCloudRepository } from './productCloudRepository';
import { readProductCatalog } from './productCatalogReader';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { productLocalRepository } from './productLocalRepository';
import { validateLocalCatalogForMigration } from './productMigrationValidation';
import {
  buildIndividualRecoveryIdempotencyKey,
  checkCompleteBatchPayload,
  checkCompleteCategoryPayload,
  checkCompleteProductPayload,
  hasExplicitTenantMismatch,
  isLocalWithoutCloudHistory
} from './productRecoveryIdentity';
import { PRODUCTS_UNSYNCED_RESCUE_META_KEY } from './productConstants';
import { notifyProductsChanged } from './productEvents';
import { runWithProductCatalogRecoveryLock } from './productCatalogRecoveryLock';

const rescueCode = (error) => error?.code === 'P0001'
  ? error.message : error?.code || error?.message || 'PRODUCT_RECOVERY_FAILED';
const issueFor = (entityType, entityId, code) => ({ entityType, entityId, code, message: code });
const versionOf = (record) => Number(record?.serverVersion ?? record?.server_version ?? 0);
const isDeleted = (record) => Boolean(record?.deletedAt || record?.deleted_at || record?.deletedTimestamp || record?.deleted_timestamp
  || record?.deletionPending === true);

const errorWithCode = (code, entityId = null) => Object.assign(new Error(code), { code, entityId });
const relatedTo = (issue, id) => issue.id === id || issue.group?.ids?.includes(id);
const definitiveConflict = (code) => /^(?:DUPLICATE_|VERSION_CONFLICT$|PRODUCT_DELETED$|RECOVERY_(?:PRODUCT_VERSION|BATCH_|PARENT_|RESERVATION_|LOCAL_RESERVATION_|PUBLISHED_SOURCE_|PHYSICAL_)|PHARMACY_DOCUMENTED_RECEIPT_REQUIRED$|PRODUCT_RECOVERY_(?:CATEGORY_CONFLICT|EXISTING_DATA_DIFFERS)$)/.test(code);
const numericFieldsValid = (row) => [row.stock, row.committedStock ?? row.committed_stock, row.price, row.cost]
  .every((value) => (value ?? null) === null || (typeof value === 'number' || typeof value === 'string' && value.trim())
    && Number.isFinite(Number(value)) && Number(value) >= 0);
const pendingCount = (catalog) => catalog.categories.length + catalog.products.length + catalog.batches.length
  + Object.values(catalog.deletes || {}).reduce((sum, records) => sum + records.length, 0);

const saveWarning = async (licenseKey, issues) => {
  const conflict = await syncConflictService.saveConflict({
    id: 'products-recovery:local-catalog',
    entityType: SYNC_ENTITY_TYPES.PRODUCT,
    entityId: 'local-catalog-recovery',
    conflictType: 'PRODUCT_RECOVERY_BLOCKED',
    localPayload: { issues },
    metadata: { message: 'Hay registros de catálogo sin confirmar. Revisa el motivo por registro.' }
  });
  await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, {
    at: new Date().toISOString(), conflictId: conflict?.id || null, issues
  }, { licenseKey });
};

const recoveryPayload = (record, mapper) => {
  const payload = mapper(record);
  // Mapper defaults that depend on the clock must not change a replay key.
  delete payload.updated_at;
  payload.created_at = record.createdAt ?? record.created_at ?? null;
  return { ...payload, server_version: versionOf(record) };
};

const idempotencyKeyFor = (licenseKey, product, batches) => buildIndividualRecoveryIdempotencyKey({
  licenseKey, product, batches
}).replace('product-local-recovery:v1:', 'catalog-recovery:');

const checkGroupConfirmation = ({ response, product, batches, productPayload, idempotencyKey }) => {
  if (response?.success !== true) throw errorWithCode(response?.code || 'PRODUCT_RECOVERY_RPC_FAILED');
  const confirmed = response.product;
  const byId = new Map((Array.isArray(response.batches) ? response.batches : []).map((batch) => [batch.id, batch]));
  if (response.idempotency_key !== idempotencyKey
    || confirmed?.id !== product.id || versionOf(confirmed) < 1 || isDeleted(confirmed)
    || !['existing', 'created'].includes(response.outcome)
    || (confirmed.category_id ?? null) !== productPayload.category_id
    || Number(confirmed.stock) !== productPayload.stock
    || Number(confirmed.committed_stock) !== productPayload.committed_stock
    || !Array.isArray(response.batches) || response.batches.length !== batches.length
    || byId.size !== batches.length
    || batches.some((local) => {
      const batch = byId.get(local.id);
      const expected = batchToCloudPayload(local);
      return !batch || batch.product_id !== product.id || versionOf(batch) < 1 || isDeleted(batch)
        || Number(batch.stock) !== expected.stock || Number(batch.committed_stock) !== expected.committed_stock;
    })) {
    throw errorWithCode('PRODUCT_RECOVERY_CONFIRMATION_INVALID');
  }
  if (response.outcome === 'existing' && (
    !checkCompleteProductPayload(product, confirmed)
    || batches.some((local) => !checkCompleteBatchPayload(local, byId.get(local.id)))
  )) throw errorWithCode('PRODUCT_RECOVERY_EXISTING_DATA_DIFFERS');
};

const readCloudCategories = async (licenseKey, actorHandle) => {
  const { categories } = await readProductCatalog({
    cloudRepository: productCloudRepository, licenseKey, actorHandle, categoriesOnly: true
  });
  return new Map(categories.map((row) => [row.id, row]));
};

const reconcileCategory = async ({ licenseKey, category, cloud, outbox, actorHandle }) => {
  actorHandle.assertCurrent('products');
  if (outbox || category.pendingOperationId) throw errorWithCode('PRODUCT_RECOVERY_OUTBOX_PENDING');
  if (hasExplicitTenantMismatch(category, licenseKey) || await productLocalRepository.getDeletedCategoryById(category.id)) {
    throw errorWithCode('PRODUCT_RECOVERY_CATEGORY_IDENTITY_UNVERIFIED');
  }
  const payload = recoveryPayload(category, categoryToCloudPayload);
  let confirmed = cloud;
  const changesRequired = !checkCompleteCategoryPayload(category, cloud);
  if (changesRequired) {
    if (isDeleted(cloud) || versionOf(cloud) !== versionOf(category)) {
      throw errorWithCode('PRODUCT_RECOVERY_CATEGORY_CONFLICT');
    }
    const response = await productCloudRepository.upsertCategory({
      licenseKey, category: payload, expectedVersion: versionOf(category),
      idempotencyKey: idempotencyKeyFor(licenseKey, payload, []), actorHandle
    });
    if (response?.success !== true) throw errorWithCode(response?.code || 'PRODUCT_RECOVERY_CATEGORY_FAILED');
    confirmed = response.category;
  }
  if (confirmed?.id !== category.id || versionOf(confirmed) < 1 || isDeleted(confirmed)
    || !checkCompleteCategoryPayload(category, confirmed)) {
    throw errorWithCode('PRODUCT_RECOVERY_CATEGORY_CONFIRMATION_INVALID');
  }
  actorHandle.assertCurrent('products');
  await productLocalRepository.applyCloudCatalog({ category: confirmed }, {
    recovery: { store: STORES.CATEGORIES, record: category }
  });
};

const findInventoryIssue = (productId, batches, rows, localOnlyEvents) => {
  const ids = new Set([productId, ...batches.map(({ id }) => id)]);
  const unresolved = rows.find((row) => row.status !== OUTBOX_STATUS.SYNCED && [
    row.entityId, row.payload?.entry?.productId, row.payload?.entry?.batchId
  ].some((id) => ids.has(id)));
  if (unresolved) return 'PRODUCT_RECOVERY_ORIGINAL_INVENTORY_OPERATION_PENDING';
  if (localOnlyEvents.some((event) => ids.has(event.productId) || ids.has(event.batchId))) {
    return 'PRODUCT_RECOVERY_LOCAL_INVENTORY_ORIGIN_UNVERIFIED';
  }
  return null;
};

const recoverProduct = async ({ licenseKey, product, categoryBlocked, validationIssues, rows, localOnlyEvents, reservedIds }) => {
  const localBatches = await productLocalRepository.getBatchesByProductId(product.id);
  const batches = localBatches.filter((batch) => !isDeleted(batch)).sort((a, b) => a.id.localeCompare(b.id));
  const invalid = validationIssues.find((issue) =>
    (issue.type.startsWith('PRODUCT_') || issue.type.startsWith('DUPLICATE_PRODUCT_')) && relatedTo(issue, product.id)
    || batches.some((batch) => (issue.type.startsWith('BATCH_') || issue.type.startsWith('STRICT_BATCH_')) && relatedTo(issue, batch.id))
  );
  if (invalid) throw errorWithCode(invalid.type, batches.some((batch) => batch.id === invalid.id) ? invalid.id : null);
  if (categoryBlocked) throw errorWithCode('PRODUCT_RECOVERY_CATEGORY_UNCONFIRMED');
  if (await productLocalRepository.getProductDeletionTombstoneById(product.id)
    || [product, ...localBatches].some((record) => hasExplicitTenantMismatch(record, licenseKey))) {
    throw errorWithCode('PRODUCT_RECOVERY_LOCAL_IDENTITY_UNVERIFIED');
  }
  if ([product, ...batches].some((record) => !numericFieldsValid(record))) {
    throw errorWithCode('PRODUCT_RECOVERY_LOCAL_NUMERIC_INVALID');
  }
  if ([product, ...localBatches].some((record) => record.deletionPending || record.pendingOperationId)) {
    throw errorWithCode('PRODUCT_RECOVERY_LOCAL_OPERATION_PENDING');
  }
  const operations = await Promise.all([
    [SYNC_ENTITY_TYPES.PRODUCT, product.id],
    ...batches.map((batch) => [SYNC_ENTITY_TYPES.PRODUCT_BATCH, batch.id])
  ].map(([entityType, entityId]) => syncOutboxService.listOperationsForEntity({ licenseKey, entityType, entityId })));
  if (operations.some((group) => group.some((row) => row.status !== OUTBOX_STATUS.SYNCED))) {
    throw errorWithCode('PRODUCT_RECOVERY_OUTBOX_PENDING');
  }
  const inventoryIssue = findInventoryIssue(product.id, localBatches, rows, localOnlyEvents);
  if (inventoryIssue) throw errorWithCode(inventoryIssue);
  if (!versionOf(product) && [product, ...batches].some(({ id }) => reservedIds.has(id))) {
    throw errorWithCode('RECOVERY_LOCAL_RESERVATION_UNVERIFIED');
  }
  if (!versionOf(product) && [product, ...batches].some((record) => !isLocalWithoutCloudHistory(record))) {
    throw errorWithCode('PRODUCT_RECOVERY_OPENING_BALANCE_ORIGIN_REQUIRED');
  }

  const productPayload = recoveryPayload(product, productToCloudPayload);
  const batchPayloads = batches.map((batch) => recoveryPayload(batch, batchToCloudPayload));
  const idempotencyKey = idempotencyKeyFor(licenseKey, productPayload, batchPayloads);
  const response = await productCloudRepository.recoverLocalProductGroup({
    licenseKey, product: productPayload, batches: batchPayloads, idempotencyKey
  });
  checkGroupConfirmation({ response, product, batches, productPayload, idempotencyKey });
  await productLocalRepository.applyCloudCatalog(response, {
    recovery: { store: STORES.MENU, record: product, batches: localBatches }
  });
};

export const productLocalCatalogRecovery = {
  async savePermissionBlockedWarning({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };

    return runWithLocalTenantSyncLease({ license_key: licenseKey }, { reason: 'catalog_recovery_permission' }, async () => {
      const unsynced = pendingCount(await productLocalRepository.listUnsyncedLocalCatalogForCloud());
      if (!unsynced) return { success: true, skipped: true, reason: 'no_unsynced_catalog' };
      const issues = [issueFor(SYNC_ENTITY_TYPES.PRODUCT, null, 'PRODUCT_RECOVERY_PERMISSION_DENIED')];
      await saveWarning(licenseKey, issues);
      return { success: false, blocked: true, reason: 'permission_denied', issues, unsynced };
    });
  },

  async runUnsyncedCatalogRecovery({ licenseKey, canMigrateProducts = true } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: true, reason: 'offline' };
    if (!canMigrateProducts) return this.savePermissionBlockedWarning({ licenseKey });
    return runWithLocalTenantSyncLease({ license_key: licenseKey }, { reason: 'local_catalog_recovery' }, () => (
      runWithProductCatalogRecoveryLock({
        licenseKey,
        operation: () => this.runUnsyncedCatalogRecoveryWithoutLock({ licenseKey })
      })
    ));
  },

  async runUnsyncedCatalogRecoveryWithoutLock({ licenseKey } = {}) {
    const catalog = await productLocalRepository.listUnsyncedLocalCatalogForCloud();
    const unsynced = pendingCount(catalog);
    if (!unsynced) {
      await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, null, { licenseKey });
      return { success: true, skipped: true, reason: 'no_unsynced_catalog' };
    }

    try {
      const contract = await productCloudRepository.getLocalCatalogRecoveryContract({ licenseKey });
      if (contract?.success !== true || contract.contract_version !== 1) {
        throw errorWithCode(contract?.code || 'PRODUCT_RECOVERY_CONTRACT_UNAVAILABLE');
      }
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      const issues = [issueFor(SYNC_ENTITY_TYPES.PRODUCT, null, rescueCode(error))];
      await saveWarning(licenseKey, issues);
      return { success: false, blocked: true, issues, unsynced };
    }

    const [localCatalog, rows, localOnlyEvents] = await Promise.all([
      productLocalRepository.getLocalCatalogForMigration({ includeInactive: true }),
      syncOutboxService.listInventoryEntriesForRecovery({ licenseKey }),
      listLocalOnlyInventoryEntriesForRecovery({ licenseKey })
    ]);
    const records = new Map([
      [SYNC_ENTITY_TYPES.CATEGORY, catalog.categories],
      [SYNC_ENTITY_TYPES.PRODUCT, catalog.products],
      [SYNC_ENTITY_TYPES.PRODUCT_BATCH, catalog.batches]
    ].map(([entityType, items]) => [entityType, new Map(items.map((item) => [item.id, item]))]));
    const issues = [];
    let recovered = 0;
    const run = async (entityType, id, operation) => {
      try {
        await operation();
        recovered += 1;
      } catch (error) {
        if (isLocalTenantAccessError(error)) throw error;
        const code = String(rescueCode(error));
        const batchPrefix = 'RECOVERY_BATCH_CONFLICT:';
        const batchId = code.startsWith(batchPrefix) ? code.slice(batchPrefix.length) : error?.entityId;
        const issue = batchId
          ? issueFor(SYNC_ENTITY_TYPES.PRODUCT_BATCH, batchId, code.startsWith(batchPrefix) ? 'RECOVERY_BATCH_CONFLICT' : code)
          : issueFor(entityType, id, code);
        issues.push(issue);
        const expected = records.get(issue.entityType)?.get(issue.entityId);
        if (expected && definitiveConflict(issue.code)) {
          await productLocalRepository.markConflict({
            entityType: issue.entityType, entityId: issue.entityId, reason: issue.code, expected
          });
        }
        return false;
      }
      return true;
    };

    const reservedIds = await productLocalRepository.listLocalReservationIdsForRecovery(localCatalog.products);
    const validationIssues = validateLocalCatalogForMigration(localCatalog);
    const blockedCategories = new Set();
    let cloudCategories;
    let categoryActor;
    for (const category of catalog.categories) {
      const confirmed = await run(SYNC_ENTITY_TYPES.CATEGORY, category.id, async () => {
        const invalid = validationIssues.find((issue) =>
          (issue.type.startsWith('CATEGORY_') || issue.type === 'DUPLICATE_CATEGORY_NAME') && relatedTo(issue, category.id)
        );
        if (invalid) throw errorWithCode(invalid.type);
        categoryActor ??= actorRuntimeController.capture('products');
        cloudCategories ??= readCloudCategories(licenseKey, categoryActor);
        const operations = await syncOutboxService.listOperationsForEntity({
          licenseKey, entityType: SYNC_ENTITY_TYPES.CATEGORY, entityId: category.id
        });
        await reconcileCategory({
          licenseKey, category, cloud: (await cloudCategories).get(category.id), actorHandle: categoryActor,
          outbox: operations.some((row) => row.status !== OUTBOX_STATUS.SYNCED)
        });
      });
      if (!confirmed) blockedCategories.add(category.id);
    }

    const productIds = new Set(catalog.products.map(({ id }) => id));
    for (const batch of catalog.batches) productIds.add(batch.productId);
    const parents = new Map(localCatalog.products.map((product) => [product.id, product]));
    const orderedIds = [...productIds].sort((a, b) =>
      Number(parents.get(b)?.productType === 'ingredient') - Number(parents.get(a)?.productType === 'ingredient'));
    for (const id of orderedIds) {
      await run(SYNC_ENTITY_TYPES.PRODUCT, id, () => {
        const product = parents.get(id);
        if (!product) throw errorWithCode('PRODUCT_RECOVERY_LOCAL_PARENT_MISSING');
        return recoverProduct({
          licenseKey, product, categoryBlocked: blockedCategories.has(product.categoryId),
          validationIssues, rows, localOnlyEvents, reservedIds
        });
      });
    }

    for (const [key, entityType] of [
      ['categories', SYNC_ENTITY_TYPES.CATEGORY], ['products', SYNC_ENTITY_TYPES.PRODUCT],
      ['batches', SYNC_ENTITY_TYPES.PRODUCT_BATCH]
    ]) {
      for (const record of catalog.deletes?.[key] || []) {
        issues.push(issueFor(entityType, record.id, 'PRODUCT_RECOVERY_DELETE_PENDING'));
      }
    }

    if (issues.length === 0) {
      const remaining = await productLocalRepository.listUnsyncedLocalCatalogForCloud();
      for (const [entityType, records] of [
        [SYNC_ENTITY_TYPES.CATEGORY, remaining.categories],
        [SYNC_ENTITY_TYPES.PRODUCT, remaining.products],
        [SYNC_ENTITY_TYPES.PRODUCT_BATCH, remaining.batches]
      ]) {
        for (const record of records) issues.push(issueFor(entityType, record.id, 'PRODUCT_RECOVERY_LOCAL_CHANGED'));
      }
      if (issues.length === 0 && pendingCount(remaining) > 0) {
        issues.push(issueFor(SYNC_ENTITY_TYPES.PRODUCT, null, 'PRODUCT_RECOVERY_DELETE_PENDING'));
      }
    }

    if (issues.length) {
      await saveWarning(licenseKey, issues);
      Logger.warn('[Products/Recovery] Catálogo local parcialmente confirmado.', { recovered, issues });
    } else {
      await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, null, { licenseKey });
    }
    notifyProductsChanged({ source: 'productLocalCatalogRecovery', recovered });
    return { success: issues.length === 0, blocked: issues.length > 0, issues, recovered, unsynced };
  }
};

export default productLocalCatalogRecovery;
