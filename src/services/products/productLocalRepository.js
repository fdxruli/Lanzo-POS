import { db, STORES } from '../db/dexie';
import {
  createProductWithInitialInventorySafe,
  loadData,
  loadDataPaginated,
  saveBatchAndSyncProductSafe,
  saveImageToDB,
  softDeleteWithCascadeSafe,
  updateProductSafe
} from '../database';
import { categoriesRepository } from '../db/general';
import { generateID } from '../utils';
import {
  cloudBatchToLocal,
  cloudCategoryToLocal,
  cloudProductToLocal,
  markProductSyncConflict,
  normalizeNameKey
} from './productMapper';
import { PRODUCT_SYNC_STATUS } from './productConstants';

const nowIso = () => new Date().toISOString();

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const isActiveCatalogRecord = (record) => (
  record?.id &&
  record.isActive !== false &&
  !record.deletedAt &&
  !record.deletedTimestamp
);

const isUnsyncedCatalogRecord = (record) => {
  if (!isActiveCatalogRecord(record)) return false;
  return (
    record.syncStatus !== PRODUCT_SYNC_STATUS.SYNCED ||
    !record.serverVersion ||
    !record.lastSyncedAt
  );
};

const validateCategoryNameUnique = async (category) => {
  const displayName = String(category?.name || '').trim();
  const comparisonName = displayName.replace(/\s+/g, '').toLowerCase();
  const existing = await db.table(STORES.CATEGORIES)
    .filter((row) => String(row.name || '').replace(/\s+/g, '').toLowerCase() === comparisonName && row.isActive !== false)
    .first();

  if (existing && existing.id !== category.id) {
    throw new Error('Ya existe una categoria activa con este nombre.');
  }
};

const applySyncFields = async (storeName, id, sync = {}) => {
  if (!id || Object.keys(sync).length === 0) return;
  await ensureOpen();
  await db.table(storeName).update(id, sync);
};

export const productLocalRepository = {
  async listProductsPage(options = {}) {
    return loadDataPaginated(STORES.MENU, options);
  },

  async listCategories() {
    return categoriesRepository.getActiveCategories();
  },

  async getCategoryById(categoryId) {
    if (!categoryId) return null;
    return loadData(STORES.CATEGORIES, categoryId);
  },

  async getProductById(productId) {
    if (!productId) return null;
    return loadData(STORES.MENU, productId);
  },

  async getBatchById(batchId) {
    if (!batchId) return null;
    return loadData(STORES.PRODUCT_BATCHES, batchId);
  },

  async saveCategoryLocal(categoryData, sync = {}) {
    await ensureOpen();
    const isNew = !categoryData.id;
    const payload = {
      ...categoryData,
      ...sync,
      id: categoryData.id || generateID('cat'),
      name: String(categoryData.name || '').trim(),
      color: categoryData.color || '#cccccc',
      sortOrder: toNumber(categoryData.sortOrder, 0),
      isActive: categoryData.isActive !== false,
      createdAt: categoryData.createdAt || (isNew ? nowIso() : undefined),
      updatedAt: nowIso()
    };

    await validateCategoryNameUnique(payload);
    await db.table(STORES.CATEGORIES).put(payload);
    return payload;
  },

  async deleteCategoryLocal(categoryId, sync = null) {
    if (sync) {
      await ensureOpen();
      await db.table(STORES.CATEGORIES).update(categoryId, {
        ...sync,
        isActive: false,
        deletedAt: nowIso(),
        updatedAt: nowIso()
      });
      await db.table(STORES.MENU)
        .where('categoryId')
        .equals(categoryId)
        .modify({ categoryId: '', syncStatus: sync.syncStatus || PRODUCT_SYNC_STATUS.PENDING });
      return { success: true };
    }

    return softDeleteWithCascadeSafe(STORES.CATEGORIES, STORES.DELETED_CATEGORIES, categoryId, {
      reason: 'Eliminada desde Catalogo de Productos',
      cascade: {
        updates: [{ store: STORES.MENU, index: 'categoryId', value: categoryId, field: 'categoryId', setTo: '' }]
      }
    });
  },

  async prepareProduct(productData, existingProduct = null) {
    const editing = Boolean(existingProduct?.id && !existingProduct?.isNew);
    const hydratedExisting = editing
      ? ((existingProduct?.name || existingProduct?.createdAt || existingProduct?.serverVersion)
        ? existingProduct
        : ((await loadData(STORES.MENU, existingProduct.id)) || existingProduct))
      : null;

    const productId = editing ? hydratedExisting.id : (productData.id || generateID('prod'));
    let image = productData.image;

    if (productData.image instanceof File) {
      image = `img-${Date.now()}`;
      await saveImageToDB(image, productData.image);
    } else if (!productData.image && hydratedExisting?.image) {
      image = hydratedExisting.image;
    }

    const product = {
      ...productData,
      id: productId,
      image,
      updatedAt: nowIso(),
      trackStock: productData.trackStock !== false,
      batchManagement: productData.trackStock === false
        ? { ...(hydratedExisting?.batchManagement || {}), ...(productData.batchManagement || {}), enabled: false }
        : (productData.batchManagement || hydratedExisting?.batchManagement || { enabled: true, selectionStrategy: 'fifo' })
    };

    delete product.quickVariants;

    if (!editing) {
      Object.assign(product, {
        stock: 0,
        isActive: true,
        createdAt: nowIso()
      });
    }

    const cost = toNumber(productData.cost);
    const price = toNumber(productData.price);
    const stock = toNumber(productData.stock);
    const variants = Array.isArray(productData.quickVariants) ? productData.quickVariants : [];
    const recipe = productData.productType === 'sellable' && Array.isArray(productData.recipe) && productData.recipe.length > 0;
    const batches = [];

    if (!editing && !recipe && variants.length === 0 && stock > 0) {
      batches.push({
        id: `batch-${productId}-initial`,
        productId,
        cost,
        price,
        stock,
        createdAt: nowIso(),
        trackStock: true,
        isActive: true,
        status: 'active',
        notes: 'Stock Inicial',
        expiryDate: productData.expiryDate || null,
        alertTargetDate: productData.alertTargetDate || null,
        alertType: productData.alertType || null,
        manufacturerBatchId: productData.manufacturerBatchId || null,
        sku: null,
        attributes: null
      });
    }

    for (const variant of variants) {
      if ((variant.talla || variant.color) && (toNumber(variant.stock) > 0 || variant.sku)) {
        batches.push({
          id: generateID('batch'),
          productId,
          stock: toNumber(variant.stock),
          cost: toNumber(variant.cost, cost),
          price: toNumber(variant.price, price),
          sku: variant.sku || null,
          attributes: { talla: variant.talla || '', color: variant.color || '' },
          isActive: true,
          status: 'active',
          createdAt: nowIso(),
          notes: 'Ingreso rapido (Modo Asistido)',
          trackStock: true,
          expiryDate: variant.expiryDate || productData.expiryDate || null,
          alertTargetDate: variant.alertTargetDate || productData.alertTargetDate || null,
          alertType: variant.alertType || productData.alertType || null,
          manufacturerBatchId: variant.manufacturerBatchId || productData.manufacturerBatchId || null
        });
      }
    }

    return {
      productId,
      product: editing ? { ...hydratedExisting, ...product } : product,
      batches,
      editing,
      inventoryValue: batches.reduce((sum, batch) => sum + toNumber(batch.stock) * toNumber(batch.cost), 0)
    };
  },

  async savePreparedProductLocal(prepared, sync = {}) {
    const product = { ...prepared.product, ...sync };
    const batches = prepared.batches.map((batch) => ({ ...batch, ...sync }));
    let result;

    if (prepared.editing) {
      result = await updateProductSafe(prepared.productId, product);
      if (result?.success) {
        await applySyncFields(STORES.MENU, prepared.productId, sync);
        for (const batch of batches) {
          const batchResult = await saveBatchAndSyncProductSafe(batch);
          if (batchResult?.success) await applySyncFields(STORES.PRODUCT_BATCHES, batch.id, sync);
        }
      }
    } else {
      result = await createProductWithInitialInventorySafe(product, batches);
      if (result?.success || result?.productId) {
        await applySyncFields(STORES.MENU, prepared.productId, sync);
        for (const batch of batches) await applySyncFields(STORES.PRODUCT_BATCHES, batch.id, sync);
      }
    }

    return {
      ...result,
      success: result?.success !== false,
      productId: prepared.productId,
      inventoryValue: prepared.inventoryValue
    };
  },

  async deleteProductLocal(product, sync = null) {
    const productId = typeof product === 'string' ? product : product?.id;
    if (!sync) {
      return softDeleteWithCascadeSafe(STORES.MENU, STORES.DELETED_MENU, productId, {
        reason: 'Eliminado desde Catalogo de Productos'
      });
    }

    await ensureOpen();
    await db.table(STORES.MENU).update(productId, {
      ...sync,
      isActive: false,
      deletedAt: nowIso(),
      updatedAt: nowIso()
    });
    return { success: true };
  },

  async toggleProductStatusLocal(product, isActive) {
    const productId = typeof product === 'string' ? product : product?.id;
    const current = typeof product === 'string' ? await this.getProductById(productId) : product;
    return updateProductSafe(productId, { ...current, isActive, updatedAt: nowIso() });
  },

  async markProductPending(productId, sync = {}) {
    return applySyncFields(STORES.MENU, productId, sync);
  },

  async saveBatchLocal(batchData, sync = {}) {
    const payload = { ...batchData, ...sync };
    const result = await saveBatchAndSyncProductSafe(payload);
    if (result?.success) {
      await applySyncFields(STORES.PRODUCT_BATCHES, payload.id, sync);
      if (payload.productId) await applySyncFields(STORES.MENU, payload.productId, sync);
    }
    return result;
  },

  async deleteBatchLocal(batch, sync = {}) {
    return this.saveBatchLocal({
      ...batch,
      stock: 0,
      isActive: false,
      status: 'archived',
      deletedAt: batch.deletedAt || nowIso()
    }, sync);
  },

  async applyCloudCategory(category) {
    if (!category?.id) return null;
    await ensureOpen();
    const existing = await db.table(STORES.CATEGORIES).get(category.id);
    const local = cloudCategoryToLocal(category, existing);
    await db.table(STORES.CATEGORIES).put(local);
    return local;
  },

  async applyCloudProduct(product) {
    if (!product?.id) return null;
    await ensureOpen();
    const existing = await db.table(STORES.MENU).get(product.id);
    const local = cloudProductToLocal(product, existing);
    await db.table(STORES.MENU).put(local);
    return local;
  },

  async applyCloudBatch(batch) {
    if (!batch?.id) return null;
    await ensureOpen();
    const existing = await db.table(STORES.PRODUCT_BATCHES).get(batch.id);
    const local = cloudBatchToLocal(batch, existing);
    await db.table(STORES.PRODUCT_BATCHES).put(local);
    return local;
  },

  async applyCloudCatalog(response = {}) {
    const applied = { categories: 0, products: 0, batches: 0 };

    for (const category of response.categories || []) {
      if (await this.applyCloudCategory(category)) applied.categories += 1;
    }
    for (const product of response.products || []) {
      if (await this.applyCloudProduct(product)) applied.products += 1;
    }
    for (const batch of response.batches || []) {
      if (await this.applyCloudBatch(batch)) applied.batches += 1;
    }
    if (response.category && await this.applyCloudCategory(response.category)) applied.categories += 1;
    if (response.product && await this.applyCloudProduct(response.product)) applied.products += 1;
    if (response.batch && await this.applyCloudBatch(response.batch)) applied.batches += 1;

    return applied;
  },

  async markConflict({ entityType, entityId, reason }) {
    await ensureOpen();
    const storeName = entityType === 'category'
      ? STORES.CATEGORIES
      : (entityType === 'product_batch' ? STORES.PRODUCT_BATCHES : STORES.MENU);
    const current = await db.table(storeName).get(entityId);
    if (!current) return null;
    const conflict = markProductSyncConflict(current, reason);
    await db.table(storeName).put(conflict);
    return conflict;
  },

  async getLocalCatalogForMigration() {
    await ensureOpen();
    const [categories, products, batches] = await Promise.all([
      db.table(STORES.CATEGORIES).toArray(),
      db.table(STORES.MENU).toArray(),
      db.table(STORES.PRODUCT_BATCHES).toArray()
    ]);

    return {
      categories: categories.filter(isActiveCatalogRecord),
      products: products.filter(isActiveCatalogRecord),
      batches: batches.filter(isActiveCatalogRecord)
    };
  },

  async listUnsyncedLocalCatalogForCloud() {
    await ensureOpen();
    const [categories, products, batches] = await Promise.all([
      db.table(STORES.CATEGORIES).toArray(),
      db.table(STORES.MENU).toArray(),
      db.table(STORES.PRODUCT_BATCHES).toArray()
    ]);

    return {
      categories: categories.filter(isUnsyncedCatalogRecord),
      products: products.filter(isUnsyncedCatalogRecord),
      batches: batches.filter(isUnsyncedCatalogRecord)
    };
  },

  buildCategoryNameKey(category) {
    return normalizeNameKey(category?.name);
  }
};

export default productLocalRepository;
