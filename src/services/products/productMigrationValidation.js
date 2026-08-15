import {
  normalizeBarcodeKey,
  normalizeNameKey,
  normalizeSkuKey
} from './productMapper';

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

export default validateLocalCatalogForMigration;
