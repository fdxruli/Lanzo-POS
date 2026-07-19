import Logger from '../Logger';
import { syncConflictService } from '../sync/syncConflictService';
import { syncMetaService } from '../sync/syncMetaService';
import { SYNC_ENTITY_TYPES, SYNC_LIMITS } from '../sync/syncConstants';
import {
  batchToCloudPayload,
  categoryToCloudPayload,
  normalizeBarcodeKey,
  normalizeNameKey,
  normalizeSkuKey,
  productToCloudPayload
} from './productMapper';
import { productCloudRepository } from './productCloudRepository';
import { productLocalRepository } from './productLocalRepository';
import {
  buildProductsMigratedMetaKey,
  PRODUCT_CATALOG_LAST_SEQ_KEY,
  PRODUCT_MIGRATION_BATCH_SIZE,
  PRODUCTS_LAST_SNAPSHOT_AT_META_KEY,
  PRODUCTS_MIGRATED_AT_META_KEY,
  PRODUCTS_MIGRATION_WARNING_META_KEY
} from './productConstants';
import { notifyProductsChanged } from './productEvents';
import { createProductCatalogSyncError } from './productCatalogSyncDiagnostics';

const nowIso = () => new Date().toISOString();
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pushIssue = (issues, type, record, message, extra = {}) => {
  issues.push({
    type,
    id: record?.id || null,
    message,
    ...extra
  });
};

const findDuplicateGroups = (records, keyFn) => {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, ids: group.map((record) => record.id), names: group.map((record) => record.name || record.sku || record.id) }));
};

export const validateLocalCatalogForMigration = ({ categories = [], products = [], batches = [] } = {}) => {
  const issues = [];
  const categoryIds = new Set(categories.map((category) => category.id));
  const productIds = new Set(products.map((product) => product.id));
  const productsById = new Map(products.map((product) => [product.id, product]));

  for (const category of categories) {
    if (!category?.id) pushIssue(issues, 'CATEGORY_MISSING_ID', category, 'Categoria sin ID.');
    if (!String(category?.name || '').trim()) pushIssue(issues, 'CATEGORY_MISSING_NAME', category, 'Categoria sin nombre.');
  }

  for (const group of findDuplicateGroups(categories, (category) => normalizeNameKey(category.name))) {
    pushIssue(issues, 'DUPLICATE_CATEGORY_NAME', null, 'Categorias duplicadas por nombre.', { group });
  }

  for (const product of products) {
    if (!product?.id) pushIssue(issues, 'PRODUCT_MISSING_ID', product, 'Producto sin ID.');
    if (!String(product?.name || '').trim()) pushIssue(issues, 'PRODUCT_MISSING_NAME', product, 'Producto sin nombre.');
    if (toNumber(product.price) < 0) pushIssue(issues, 'PRODUCT_NEGATIVE_PRICE', product, 'Producto con precio negativo.');
    if (toNumber(product.cost) < 0) pushIssue(issues, 'PRODUCT_NEGATIVE_COST', product, 'Producto con costo negativo.');
    if (toNumber(product.stock) < 0) pushIssue(issues, 'PRODUCT_NEGATIVE_STOCK', product, 'Producto con stock negativo.');
    if (product.categoryId && !categoryIds.has(product.categoryId)) {
      pushIssue(issues, 'PRODUCT_CATEGORY_MISSING', product, 'Producto apunta a una categoria local inexistente.', {
        categoryId: product.categoryId
      });
    }
  }

  for (const group of findDuplicateGroups(products, (product) => normalizeSkuKey(product.sku_normalized || product.sku))) {
    pushIssue(issues, 'DUPLICATE_PRODUCT_SKU', null, 'SKU duplicado entre productos.', { group });
  }

  for (const group of findDuplicateGroups(products, (product) => normalizeBarcodeKey(product.barcode_normalized || product.barcode))) {
    pushIssue(issues, 'DUPLICATE_PRODUCT_BARCODE', null, 'Codigo de barras duplicado entre productos.', { group });
  }

  for (const batch of batches) {
    if (!batch?.id) pushIssue(issues, 'BATCH_MISSING_ID', batch, 'Lote sin ID.');
    if (!batch?.productId) {
      pushIssue(issues, 'BATCH_MISSING_PRODUCT_ID', batch, 'Lote sin producto padre.');
      continue;
    }
    if (!productIds.has(batch.productId)) {
      pushIssue(issues, 'BATCH_ORPHAN', batch, 'Lote huerfano: el producto padre no existe.', { productId: batch.productId });
      continue;
    }
    if (toNumber(batch.stock) < 0) pushIssue(issues, 'BATCH_NEGATIVE_STOCK', batch, 'Lote con stock negativo.');
    if (toNumber(batch.cost) < 0) pushIssue(issues, 'BATCH_NEGATIVE_COST', batch, 'Lote con costo negativo.');
    if (toNumber(batch.price) < 0) pushIssue(issues, 'BATCH_NEGATIVE_PRICE', batch, 'Lote con precio negativo.');

    const parent = productsById.get(batch.productId);
    if (parent?.expirationMode === 'STRICT' && toNumber(batch.stock) > 0) {
      if (!batch.expiryDate) pushIssue(issues, 'STRICT_BATCH_MISSING_EXPIRY', batch, 'Producto STRICT con lote sin caducidad.');
      if (!String(batch.manufacturerBatchId || '').trim()) {
        pushIssue(issues, 'STRICT_BATCH_MISSING_MANUFACTURER_ID', batch, 'Producto STRICT con lote sin ID de fabricante.');
      }
    }
  }

  return issues;
};

const saveBlockedMigrationConflict = async ({ licenseKey, issues }) => {
  const conflict = await syncConflictService.saveConflict({
    id: `products-migration:${licenseKey}:${Date.now()}`,
    entityType: SYNC_ENTITY_TYPES.PRODUCT,
    entityId: 'local-catalog-migration',
    conflictType: 'PRODUCT_MIGRATION_BLOCKED',
    localPayload: { issues },
    serverPayload: null,
    metadata: {
      licenseKey,
      message: 'Migracion inicial de catalogo detenida por datos locales inconsistentes.'
    }
  });

  await syncMetaService.setMeta(PRODUCTS_MIGRATION_WARNING_META_KEY, {
    at: nowIso(),
    conflictId: conflict?.id || null,
    issues
  }, { licenseKey });

  return conflict;
};

export const productMigrationService = {
  async pullFullSnapshot({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };

    let applied = 0;
    let latestChangeSeq = 0;
    let rejected = [];

    for (const entityType of ['category', 'product', 'product_batch']) {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const response = await productCloudRepository.pullCatalogSnapshot({
          licenseKey,
          entityType,
          offset,
          limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
          includeDeleted: true
        });

        if (response?.success === false) {
          throw new Error(response.message || response.code || 'PRODUCT_SNAPSHOT_FAILED');
        }

        const counts = await productLocalRepository.applyCloudCatalog(response);
        rejected = rejected.concat(counts.rejected || []);
        const count = counts.categories + counts.products + counts.batches;
        applied += count;
        const responseCount = (response.categories?.length || 0)
          + (response.products?.length || 0)
          + (response.batches?.length || 0);
        offset += responseCount;
        hasMore = Boolean(response.has_more || response.hasMore) && responseCount > 0;

        if (counts.rejected?.length > 0) {
          Logger.warn('[Products/Snapshot] Registros invalidos omitidos durante aplicacion local.', {
            operation: 'pull_full_snapshot', phase: 'snapshot_normalization', entityErrors: counts.rejected, offset
          });
        }

        const responseSeq = Number(response.latest_change_seq ?? response.latestChangeSeq ?? latestChangeSeq);
        if (Number.isFinite(responseSeq) && responseSeq > latestChangeSeq) {
          latestChangeSeq = responseSeq;
          // A snapshot may span several pages. The cursor only becomes durable
          // after every page has been written successfully.
        }
      }
    }

    if (rejected.length > 0) {
      throw createProductCatalogSyncError('El snapshot se aplico parcialmente; el cursor se conserva para un reintento seguro.', {
        code: 'PRODUCT_CATALOG_SNAPSHOT_PARTIAL',
        phase: 'snapshot_normalization',
        entityType: rejected[0]?.entityType || null,
        entityId: rejected[0]?.entityId || null,
        index: rejected[0]?.index,
        retryable: true,
        licenseKey
      });
    }

    if (latestChangeSeq > 0) {
      await syncMetaService.setMeta(PRODUCT_CATALOG_LAST_SEQ_KEY, latestChangeSeq, { licenseKey });
    }
    await syncMetaService.setMeta(PRODUCTS_LAST_SNAPSHOT_AT_META_KEY, nowIso(), { licenseKey });
    notifyProductsChanged({ source: 'productMigrationService.pullFullSnapshot', applied });
    return { success: true, applied, latestChangeSeq };
  },

  async runInitialMigrationIfNeeded({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (!isOnline()) return { skipped: true, reason: 'offline' };

    const migratedKey = buildProductsMigratedMetaKey(licenseKey);
    const alreadyMigrated = await syncMetaService.getMeta(migratedKey, false, { licenseKey });

    if (alreadyMigrated) {
      return this.pullFullSnapshot({ licenseKey });
    }

    const localCatalog = await productLocalRepository.getLocalCatalogForMigration();
    const issues = validateLocalCatalogForMigration(localCatalog);

    if (issues.length > 0) {
      await saveBlockedMigrationConflict({ licenseKey, issues });
      Logger.warn('[Products/Migration] Migracion bloqueada por conflictos locales:', issues);
      return { success: false, blocked: true, issues };
    }

    const totalLocalRows = localCatalog.categories.length + localCatalog.products.length + localCatalog.batches.length;

    if (totalLocalRows > 0) {
      const batchId = `products-${licenseKey}-${Date.now()}`;

      for (let index = 0; index < localCatalog.categories.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
        const categories = localCatalog.categories.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(categoryToCloudPayload);
        const response = await productCloudRepository.migrateLocalCatalog({
          licenseKey,
          categories,
          products: [],
          batches: [],
          batchId: `${batchId}-categories-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
        });

        if (response?.success === false) {
          await saveBlockedMigrationConflict({
            licenseKey,
            issues: [{ type: response.code || 'PRODUCT_MIGRATION_RPC_FAILED', message: response.message || 'Fallo RPC de migracion de categorias.', response }]
          });
          return { success: false, blocked: true, response };
        }

        await productLocalRepository.applyCloudCatalog(response);
      }

      for (let index = 0; index < localCatalog.products.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
        const products = localCatalog.products.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(productToCloudPayload);
        const response = await productCloudRepository.migrateLocalCatalog({
          licenseKey,
          categories: [],
          products,
          batches: [],
          batchId: `${batchId}-products-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
        });

        if (response?.success === false) {
          await saveBlockedMigrationConflict({
            licenseKey,
            issues: [{ type: response.code || 'PRODUCT_MIGRATION_RPC_FAILED', message: response.message || 'Fallo RPC de migracion de productos.', response }]
          });
          return { success: false, blocked: true, response };
        }

        await productLocalRepository.applyCloudCatalog(response);
      }

      for (let index = 0; index < localCatalog.batches.length; index += PRODUCT_MIGRATION_BATCH_SIZE) {
        const batches = localCatalog.batches.slice(index, index + PRODUCT_MIGRATION_BATCH_SIZE).map(batchToCloudPayload);

        const response = await productCloudRepository.migrateLocalCatalog({
          licenseKey,
          categories: [],
          products: [],
          batches,
          batchId: `${batchId}-batches-${index / PRODUCT_MIGRATION_BATCH_SIZE}`
        });

        if (response?.success === false) {
          await saveBlockedMigrationConflict({
            licenseKey,
            issues: [{ type: response.code || 'PRODUCT_MIGRATION_RPC_FAILED', message: response.message || 'Fallo RPC de migracion de lotes.', response }]
          });
          return { success: false, blocked: true, response };
        }

        await productLocalRepository.applyCloudCatalog(response);
      }
    }

    const snapshot = await this.pullFullSnapshot({ licenseKey });

    await syncMetaService.setMeta(migratedKey, true, { licenseKey });
    await syncMetaService.setMeta(PRODUCTS_MIGRATED_AT_META_KEY, nowIso(), { licenseKey });
    await syncMetaService.setMeta(PRODUCTS_MIGRATION_WARNING_META_KEY, null, { licenseKey });

    Logger.log(`[Products/Migration] Migracion inicial completada. Local=${totalLocalRows}, snapshot=${snapshot.applied || 0}`);
    notifyProductsChanged({ source: 'productMigrationService.runInitialMigrationIfNeeded' });

    return {
      success: true,
      migrated: totalLocalRows,
      snapshotCount: snapshot.applied || 0
    };
  }
};

export default productMigrationService;
