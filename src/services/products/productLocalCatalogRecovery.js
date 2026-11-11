import Logger from '../Logger';
import { syncConflictService } from '../sync/syncConflictService';
import { syncMetaService } from '../sync/syncMetaService';
import { OUTBOX_STATUS, SYNC_ENTITY_TYPES, SYNC_LIMITS } from '../sync/syncConstants';
import { syncOutboxService } from '../sync/syncOutboxService';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { getPharmacyClassification } from '../../utils/pharmacyClassification';
import { getTenantStorageState } from '../tenant/tenantScopedStorage';
import {
  batchToCloudPayload,
  categoryToCloudPayload,
  productToCloudPayload
} from './productMapper';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import { validateLocalCatalogForMigration } from './productMigrationValidation';
import { validateMigrationBatchResponse } from './productMigrationResponseValidation';
import { PRODUCTS_UNSYNCED_RESCUE_META_KEY } from './productConstants';
import { notifyProductsChanged } from './productEvents';

const nowIso = () => new Date().toISOString();
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const countCatalogRows = (catalog = {}) => {
  const { categories = [], products = [], batches = [], deletes = {} } = catalog;
  return categories.length
    + products.length
    + batches.length
    + Object.values(deletes).reduce((total, records) => total + (records?.length || 0), 0);
};

const saveRecoveryWarning = async ({ licenseKey, issues, conflictType, message }) => {
  const tenantIdentity = getSafeTenantIdentity(licenseKey);
  const conflict = await syncConflictService.saveConflict({
    id: `products-recovery:${tenantIdentity}:${Date.now()}`,
    entityType: SYNC_ENTITY_TYPES.PRODUCT,
    entityId: 'local-catalog-recovery',
    conflictType,
    localPayload: { issues },
    serverPayload: null,
    metadata: { tenantIdentity, message }
  });

  await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, {
    at: nowIso(),
    conflictId: conflict?.id || null,
    issues
  }, { licenseKey });

  return conflict;
};

const markCatalogConflictRecords = async (catalog = {}, reason = 'PRODUCT_CATALOG_RECOVERY_BLOCKED') => {
  const groups = [
    [SYNC_ENTITY_TYPES.CATEGORY, catalog.categories || []],
    [SYNC_ENTITY_TYPES.PRODUCT, catalog.products || []],
    [SYNC_ENTITY_TYPES.PRODUCT_BATCH, catalog.batches || []]
  ];

  for (const [entityType, records] of groups) {
    for (const record of records) {
      try {
        await productLocalRepository.markConflict({ entityType, entityId: record.id, reason });
      } catch (error) {
        Logger.warn('[Products/Recovery] No se pudo marcar conflicto local:', { entityType, id: record?.id, error });
      }
    }
  }

  const deletionGroups = [
    [SYNC_ENTITY_TYPES.CATEGORY, catalog.deletes?.categories || []],
    [SYNC_ENTITY_TYPES.PRODUCT, catalog.deletes?.products || []],
    [SYNC_ENTITY_TYPES.PRODUCT_BATCH, catalog.deletes?.batches || []]
  ];

  for (const [entityType, records] of deletionGroups) {
    for (const record of records) {
      try {
        await productLocalRepository.markCatalogDeletionConflict({
          entityType,
          entityId: record.id,
          reason
        });
      } catch (error) {
        Logger.warn('[Products/Recovery] No se pudo marcar tombstone en conflicto:', {
          entityType,
          id: record?.id,
          error
        });
      }
    }
  }
};

const getExpectedVersion = (record) => {
  const value = Number(record?.serverVersion ?? record?.server_version);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const sanitizeKeyPart = (value, fallback = 'unknown') => String(value || fallback)
  .replace(/[^a-zA-Z0-9._-]+/g, '-');

const fingerprint = (value) => {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const getSafeTenantIdentity = (licenseKey) => (
  getTenantStorageState()?.opaqueId || `license-fp-${fingerprint(licenseKey)}`
);

const getLocalMutationIdentity = (record) => (
  record?.localMutationId
  || [
    record?.updatedAt,
    record?.updated_at,
    record?.deletedAt,
    record?.deletedTimestamp,
    record?.createdAt,
    record?.created_at
  ].find(Boolean)
  || 'legacy'
);

const buildRecoveryIdempotencyKey = ({ licenseKey, entityType, operation, record }) => (
  [
    'products-recovery',
    sanitizeKeyPart(getSafeTenantIdentity(licenseKey), 'tenant'),
    operation,
    entityType,
    sanitizeKeyPart(record?.id, 'unknown'),
    getExpectedVersion(record) ?? 'new',
    sanitizeKeyPart(getLocalMutationIdentity(record), 'legacy')
  ].join(':')
);

const throwRecoveryResponseError = ({
  response,
  fallbackCode,
  expectedCounts = null,
  entityType = null,
  entityId = null
}) => {
  const issues = expectedCounts
    ? validateMigrationBatchResponse({ response, expectedCounts })
    : [{
      type: 'PRODUCT_RECOVERY_RPC_FAILED',
      entityType,
      entityId,
      code: response?.code || fallbackCode,
      message: response?.message || fallbackCode,
      serverVersion: response?.server_version ?? response?.serverVersion ?? null,
      serverPayload: response?.server_payload ?? response?.serverPayload ?? null
    }];

  if (issues.length === 0) return;

  throw Object.assign(new Error(issues[0].message || issues[0].code || fallbackCode), {
    response: {
      ...(response || {}),
      success: false,
      code: issues[0].code || fallbackCode,
      message: issues[0].message || fallbackCode,
      issues
    }
  });
};

const assertCanonicalMutationResponse = (response, fallbackCode, identity = {}) => {
  if (response?.success === true) return response;
  throwRecoveryResponseError({ response, fallbackCode, ...identity });
};


const isProtectedMedicine = (product) => {
  const pharma = getPharmacyClassification(product);
  return (pharma.recorded && pharma.kind === 'medicine')
    || product?.requiresPrescription === true
    || ['controlled', 'antibiotic', 'prescription'].includes(product?.prescriptionType);
};

// Return unresolved original operations; never invent one from a stock delta.
const reconcilePharmacyOutbox = async ({ licenseKey, localCatalog, rows }) => {
  const medicineIds = new Set(localCatalog.products.filter(isProtectedMedicine).map((p) => p.id));
  const belongs = (row) => medicineIds.has(row.entityId || row.payload?.entry?.productId);
  const relevant = rows.filter(belongs);
  if (relevant.every((row) => row.status === OUTBOX_STATUS.SYNCED)) return [];
  if (relevant.some((row) => row.status === OUTBOX_STATUS.PENDING)) {
    await posSyncOrchestrator.processOutbox('pharmacy_inventory_recovery');
  }
  const after = await syncOutboxService.listInventoryEntriesForRecovery({ licenseKey });
  return after.filter(belongs).filter((row) => row.status !== OUTBOX_STATUS.SYNCED);
};

// Read-only, paginated; never apply a snapshot before provenance is reconciled.
const fetchCloudStockSnapshot = async ({ licenseKey, productIds, batchIds }) => {
  const product = new Map(), batch = new Map();
  for (const [entityType, wanted, result] of [
    ['product', productIds, product],
    ['product_batch', batchIds, batch]
  ]) {
    if (wanted.size === 0) continue;
    let offset = 0;
    while (true) {
      const response = await productCloudRepository.pullCatalogSnapshot({
        licenseKey, entityType, offset, limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
        includeDeleted: false, force: true
      });
      const rows = entityType === 'product' ? response?.products : response?.batches;
      if (response?.success !== true || !Array.isArray(rows)) {
        throw Object.assign(new Error('No se pudo verificar el inventario Cloud.'), {
          code: 'PHARMACY_RECOVERY_CLOUD_READ_FAILED'
        });
      }
      for (const row of rows) if (wanted.has(row?.id)) result.set(row.id, row);
      if (!response.has_more && !response.hasMore) break;
      if (!rows.length) throw new Error('PHARMACY_RECOVERY_CLOUD_PAGINATION_STALLED');
      offset += rows.length;
    }
  }
  return { product, batch };
};

const assertPharmacyStockReconciled = async ({ licenseKey, catalog, localCatalog }) => {
  const parents = new Map(localCatalog.products.map((p) => [p.id, p]));
  const products = catalog.products.filter(isProtectedMedicine);
  const batches = catalog.batches.filter((b) => isProtectedMedicine(parents.get(b.productId)));
  if (!products.length && !batches.length) return;
  const cloud = await fetchCloudStockSnapshot({
    licenseKey,
    productIds: new Set([...products.map((p) => p.id), ...batches.map((b) => b.productId)]),
    batchIds: new Set(batches.map((b) => b.id))
  });
  const issues = [];
  for (const row of products) {
    if (Number(row.stock || 0) !== Number(cloud.product.get(row.id)?.stock || 0)) {
      issues.push({ code: 'PHARMACY_PRODUCT_STOCK_UNRECONCILED', entityType: 'product', entityId: row.id });
    }
  }
  for (const row of batches) {
    if (Number(row.stock || 0) !== Number(cloud.batch.get(row.id)?.stock || 0)) {
      issues.push({ code: 'PHARMACY_BATCH_STOCK_UNRECONCILED', entityType: 'product_batch', entityId: row.id });
    }
  }
  if (issues.length) {
    const error = new Error('Diferencia de inventario sin operación documental confirmada.');
    error.code = 'PHARMACY_RECOVERY_RECONCILIATION_REQUIRED';
    error.response = { success: false, code: error.code, issues };
    throw error;
  }
};

const migrateUnsyncedCatalog = async ({ licenseKey, catalog, localCatalog }) => {
  await assertPharmacyStockReconciled({ licenseKey, catalog, localCatalog });
  let migrated = 0;

  const mutationOperations = [
    {
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      records: catalog.categories,
      mutate: (record, idempotencyKey) => productCloudRepository.upsertCategory({
        licenseKey,
        category: categoryToCloudPayload(record),
        expectedVersion: getExpectedVersion(record),
        idempotencyKey
      }),
      fallbackCode: 'PRODUCT_RECOVERY_CATEGORY_FAILED'
    },
    {
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      records: [...catalog.products].sort((a, b) =>
        Number(b.productType === 'ingredient') - Number(a.productType === 'ingredient')),
      mutate: (record, idempotencyKey) => productCloudRepository.upsertProduct({
        licenseKey,
        product: productToCloudPayload(record),
        initialBatches: [],
        expectedVersion: getExpectedVersion(record),
        idempotencyKey
      }),
      fallbackCode: 'PRODUCT_RECOVERY_PRODUCT_FAILED'
    },
    {
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      records: catalog.batches,
      mutate: (record, idempotencyKey) => {
        const batch = batchToCloudPayload(record);
        const parent = localCatalog.products.find((p) => p.id === record.productId);
        if (isProtectedMedicine(parent)) {
          delete batch.stock;
          delete batch.committed_stock;
          delete batch.committedStock;
        }
        return productCloudRepository.upsertProductBatch({
          licenseKey, batch, expectedVersion: getExpectedVersion(record), idempotencyKey
        });
      },
      fallbackCode: 'PRODUCT_RECOVERY_BATCH_FAILED'
    }
  ];

  for (const operation of mutationOperations) {
    for (const record of operation.records) {
      const idempotencyKey = buildRecoveryIdempotencyKey({
        licenseKey,
        entityType: operation.entityType,
        operation: 'upsert',
        record
      });
      const response = await operation.mutate(record, idempotencyKey);
      assertCanonicalMutationResponse(response, operation.fallbackCode, {
        entityType: operation.entityType,
        entityId: record.id
      });
      await productLocalRepository.applyCloudCatalog(response);
      migrated += 1;
    }
  }

  const deletionOperations = [
    {
      entityType: SYNC_ENTITY_TYPES.CATEGORY,
      records: catalog.deletes?.categories || [],
      deleteRemote: (record, idempotencyKey) => productCloudRepository.deleteCategory({
        licenseKey,
        categoryId: record.id,
        expectedVersion: getExpectedVersion(record),
        idempotencyKey
      })
    },
    {
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      records: catalog.deletes?.products || [],
      deleteRemote: (record, idempotencyKey) => productCloudRepository.deleteProduct({
        licenseKey,
        productId: record.id,
        expectedVersion: getExpectedVersion(record),
        idempotencyKey
      })
    },
    {
      entityType: SYNC_ENTITY_TYPES.PRODUCT_BATCH,
      records: catalog.deletes?.batches || [],
      deleteRemote: (record, idempotencyKey) => productCloudRepository.deleteProductBatch({
        licenseKey,
        batchId: record.id,
        expectedVersion: getExpectedVersion(record),
        idempotencyKey
      })
    }
  ];

  for (const operation of deletionOperations) {
    for (const record of operation.records) {
      const idempotencyKey = buildRecoveryIdempotencyKey({
        licenseKey,
        entityType: operation.entityType,
        operation: 'delete',
        record
      });
      const response = await operation.deleteRemote(record, idempotencyKey);
      assertCanonicalMutationResponse(
        response,
        `PRODUCT_RECOVERY_${operation.entityType.toUpperCase()}_DELETE_FAILED`,
        { entityType: operation.entityType, entityId: record.id }
      );

      await productLocalRepository.markCatalogDeletionSynced({
        entityType: operation.entityType,
        entityId: record.id
      });
      migrated += 1;
    }
  }

  return migrated;
};

export const productLocalCatalogRecovery = {
  async savePermissionBlockedWarning({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };

    const catalog = await productLocalRepository.listUnsyncedLocalCatalogForCloud();
    const unsynced = countCatalogRows(catalog);
    if (unsynced === 0) return { success: true, skipped: true, reason: 'no_unsynced_catalog' };

    const issues = [{
      type: 'PRODUCT_RECOVERY_PERMISSION_DENIED',
      message: 'Este dispositivo tiene productos locales no sincronizados, pero el staff no tiene permiso para migrar catalogo.'
    }];

    await saveRecoveryWarning({
      licenseKey,
      issues,
      conflictType: 'PRODUCT_RECOVERY_PERMISSION_DENIED',
      message: 'Recuperacion de catalogo local detenida por permisos insuficientes.'
    });
    await markCatalogConflictRecords(catalog, 'STAFF_WITHOUT_PRODUCTS_PERMISSION');
    notifyProductsChanged({ source: 'productLocalCatalogRecovery.permission_denied' });

    return { success: false, blocked: true, reason: 'permission_denied', issues, unsynced };
  },

  async runUnsyncedCatalogRecovery({ licenseKey, canMigrateProducts = true } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (!isOnline()) return { skipped: true, reason: 'offline' };
    if (!canMigrateProducts) return this.savePermissionBlockedWarning({ licenseKey });

    // A confirmed catalog does not imply that a local receipt is acknowledged.
    // Preserve the local state if its original operation is still unresolved.
    const outbox = await syncOutboxService.listInventoryEntriesForRecovery({ licenseKey });
    const initialCatalog = await productLocalRepository.listUnsyncedLocalCatalogForCloud();
    const localCatalog = outbox.length || countCatalogRows(initialCatalog)
      ? await productLocalRepository.getLocalCatalogForMigration() : null;
    if (localCatalog) {
      const pending = await reconcilePharmacyOutbox({ licenseKey, localCatalog, rows: outbox });
      if (pending.length) {
        const issues = pending.map((row) => ({
          code: 'PHARMACY_ORIGINAL_RECEIPT_UNCONFIRMED',
          entityType: SYNC_ENTITY_TYPES.INVENTORY_ENTRY,
          entityId: row.entityId, operationId: row.idempotencyKey || row.id,
          status: row.status
        }));
        // Keep the original outbox rows untouched, including actor origin.
        return { success: false, blocked: true, reason: 'pharmacy_receipts_unconfirmed', issues };
      }
    }
    const catalog = await productLocalRepository.listUnsyncedLocalCatalogForCloud();
    const unsynced = countCatalogRows(catalog);
    if (unsynced === 0) {
      await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, null, { licenseKey });
      return { success: true, skipped: true, reason: 'no_unsynced_catalog' };
    }

    const validationCatalog = await productLocalRepository.getLocalCatalogForMigration();
    const issues = validateLocalCatalogForMigration(validationCatalog);
    if (issues.length > 0) {
      await saveRecoveryWarning({
        licenseKey,
        issues,
        conflictType: 'PRODUCT_RECOVERY_BLOCKED',
        message: 'Recuperacion de catalogo local detenida por datos inconsistentes.'
      });
      await markCatalogConflictRecords(catalog, 'PRODUCT_RECOVERY_VALIDATION_FAILED');
      notifyProductsChanged({ source: 'productLocalCatalogRecovery.validation_failed' });
      return { success: false, blocked: true, issues, unsynced };
    }

    try {
      const recovered = await migrateUnsyncedCatalog({ licenseKey, catalog, localCatalog: validationCatalog });
      await syncMetaService.setMeta(PRODUCTS_UNSYNCED_RESCUE_META_KEY, null, { licenseKey });
      notifyProductsChanged({ source: 'productLocalCatalogRecovery.recovered', recovered });
      return { success: true, recovered };
    } catch (error) {
      const response = error?.response;
      const issues = Array.isArray(response?.issues) && response.issues.length > 0
        ? response.issues
        : [{
          type: response?.code || 'PRODUCT_RECOVERY_RPC_FAILED',
          message: response?.message || error?.message || 'Fallo RPC de recuperacion de catalogo.',
          response
        }];

      await saveRecoveryWarning({
        licenseKey,
        issues,
        conflictType: 'PRODUCT_RECOVERY_RPC_FAILED',
        message: 'Recuperacion de catalogo local detenida por error remoto.'
      });
      await markCatalogConflictRecords(catalog, 'PRODUCT_RECOVERY_RPC_FAILED');
      notifyProductsChanged({ source: 'productLocalCatalogRecovery.rpc_failed' });
      return { success: false, blocked: true, issues, unsynced };
    }
  }
};

export default productLocalCatalogRecovery;
