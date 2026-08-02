import { db, STORES } from '../database';
import { categoriesRepository } from '../db/general';
import {
  checkHasExpiredProductsForPosMenu,
  isExpiredForPosMenu,
  isOutOfStockForPosMenu,
  resolveExpiredProductIdsForPosMenu,
} from './productMenuEligibility';

export const POS_CATALOG_PAGE_SIZE = 50;
export const INVENTORY_CATALOG_PAGE_SIZE = 50;

const getPosCatalogSortValue = (product) => String(product?.createdAt || '');
const getPosCatalogId = (product) => String(product?.id || '');

export const comparePosCatalogProducts = (left, right) => {
  const sortComparison = getPosCatalogSortValue(right)
    .localeCompare(getPosCatalogSortValue(left));
  if (sortComparison !== 0) return sortComparison;
  return getPosCatalogId(right).localeCompare(getPosCatalogId(left));
};

const createPosCatalogCursor = (product) => product ? ({
  sortValue: getPosCatalogSortValue(product),
  id: getPosCatalogId(product)
}) : null;

const getInventoryCatalogSortValue = (product) => String(product?.createdAt || '');
const getInventoryCatalogId = (product) => String(product?.id || '');

export const compareInventoryCatalogProducts = (left, right) => {
  const sortComparison = getInventoryCatalogSortValue(right)
    .localeCompare(getInventoryCatalogSortValue(left));
  if (sortComparison !== 0) return sortComparison;
  return getInventoryCatalogId(right).localeCompare(getInventoryCatalogId(left));
};

const createInventoryCatalogCursor = (product) => product ? ({
  createdAt: getInventoryCatalogSortValue(product),
  id: getInventoryCatalogId(product)
}) : null;

const isAfterInventoryCatalogCursor = (product, cursor) => {
  if (!cursor) return true;
  const createdAt = getInventoryCatalogSortValue(product);
  if (createdAt < cursor.createdAt) return true;
  if (createdAt > cursor.createdAt) return false;
  return getInventoryCatalogId(product) < cursor.id;
};

const isAfterPosCatalogCursor = (product, cursor) => {
  if (!cursor) return true;
  const sortValue = getPosCatalogSortValue(product);
  if (sortValue < cursor.sortValue) return true;
  if (sortValue > cursor.sortValue) return false;
  return getPosCatalogId(product) < cursor.id;
};

const sortCategories = (categories = []) => [...categories]
  .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0));

export const isPosCatalogEligible = (product) => (
  Boolean(product?.id)
  && product.isActive !== false
  && !product.deletedAt
  && !product.deletedTimestamp
  && product.productType !== 'ingredient'
  && product.product_type !== 'ingredient'
);

export const loadCatalogCategories = async () => {
  const categories = await categoriesRepository.getActiveCategories();
  return sortCategories(categories || []);
};

const getInventoryProductType = (product) => (
  product?.productType ?? product?.product_type ?? null
);

const matchesInventoryStatus = (product, status) => {
  const isActive = product?.isActive !== false;
  if (status === 'inactive') return !isActive;
  if (status === 'all') return true;
  return isActive;
};

export const isInventoryCatalogEligible = (product, options = {}) => {
  if (!product?.id || product.deletedAt || product.deletedTimestamp) return false;
  if (!matchesInventoryStatus(product, options.status || 'active')) return false;

  const requestedType = options.productType ?? null;
  const productType = getInventoryProductType(product);
  if (requestedType === 'sellable' && productType !== null && productType !== 'sellable') {
    return false;
  }
  if (requestedType && requestedType !== 'sellable' && productType !== requestedType) {
    return false;
  }

  const categoryId = options.categoryId ?? null;
  const productCategoryId = product.categoryId ?? product.category_id ?? null;
  if (categoryId !== null && productCategoryId !== categoryId) return false;

  if (options.outOfStockOnly && !isOutOfStockForPosMenu(product)) return false;
  return true;
};

export const queryInventoryCatalogPage = async (options = {}) => {
  const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0
    ? options.pageSize
    : INVENTORY_CATALOG_PAGE_SIZE;
  const requestedCursor = options.cursor?.createdAt !== undefined && options.cursor?.id
    ? {
      createdAt: String(options.cursor.createdAt || ''),
      id: String(options.cursor.id)
    }
    : null;

  const allProducts = await db.table(STORES.MENU).toArray();
  let eligible = allProducts.filter((product) => (
    isAfterInventoryCatalogCursor(product, requestedCursor)
    && isInventoryCatalogEligible(product, options)
  ));

  if (options.expiredOnly) {
    const expiredProductIds = await resolveExpiredProductIdsForPosMenu(
      eligible,
      { db, STORES }
    );
    eligible = eligible.filter((product) => (
      !isOutOfStockForPosMenu(product)
      && (expiredProductIds.has(product.id) || isExpiredForPosMenu(product))
    ));
  }

  const requestedLimit = pageSize + 1;
  const pageCandidates = eligible
    .sort(compareInventoryCatalogProducts)
    .slice(0, requestedLimit);
  const hasMore = pageCandidates.length > pageSize;
  const data = pageCandidates.slice(0, pageSize);

  return {
    data,
    items: data,
    hasMore,
    nextCursor: hasMore ? createInventoryCatalogCursor(data[data.length - 1]) : null,
    requestedLimit
  };
};

export const queryInventoryCatalogProductById = async (productId, options = {}) => {
  if (!productId) return null;
  const product = await db.table(STORES.MENU).get(productId);
  if (!isInventoryCatalogEligible(product, options)) return null;
  if (!options.expiredOnly) return product;

  const expiredProductIds = await resolveExpiredProductIdsForPosMenu(
    [product],
    { db, STORES }
  );
  return !isOutOfStockForPosMenu(product)
    && (expiredProductIds.has(product.id) || isExpiredForPosMenu(product))
    ? product
    : null;
};

export const queryPosCatalogPage = async (options = {}) => {
  const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0
    ? options.pageSize
    : POS_CATALOG_PAGE_SIZE;
  const categoryId = options.categoryId ?? null;
  const outOfStockOnly = Boolean(options.outOfStockOnly);
  const expiredOnly = Boolean(options.expiredOnly);
  const requestedCursor = options.cursor?.sortValue && options.cursor?.id
    ? options.cursor
    : null;
  const targetSize = pageSize + 1;
  const eligible = [];
  let scanCursor = requestedCursor;
  let exhausted = false;

  while (eligible.length < targetSize && !exhausted) {
    let collection = scanCursor
      ? db.table(STORES.MENU).where('createdAt').belowOrEqual(scanCursor.sortValue).reverse()
      : db.table(STORES.MENU).orderBy('createdAt').reverse();

    collection = collection.filter((product) => {
      if (!isAfterPosCatalogCursor(product, scanCursor)) return false;
      if (!isPosCatalogEligible(product)) return false;
      const productCategoryId = product.categoryId ?? product.category_id ?? null;
      if (categoryId !== null && productCategoryId !== categoryId) return false;
      if (outOfStockOnly) return isOutOfStockForPosMenu(product);
      if (expiredOnly && isOutOfStockForPosMenu(product)) return false;
      if (!expiredOnly && isOutOfStockForPosMenu(product)) return false;
      return true;
    });

    const candidates = await collection.limit(targetSize).toArray();
    if (candidates.length === 0) {
      exhausted = true;
      break;
    }

    if (outOfStockOnly) {
      eligible.push(...candidates.slice(0, targetSize - eligible.length));
    } else {
      const expiredProductIds = await resolveExpiredProductIdsForPosMenu(
        candidates,
        { db, STORES }
      );
      for (const product of candidates) {
        const isExpired = expiredProductIds.has(product.id) || isExpiredForPosMenu(product);
        if (expiredOnly ? isExpired : !isExpired) eligible.push(product);
        if (eligible.length === targetSize) break;
      }
    }

    const lastScanned = candidates[candidates.length - 1];
    scanCursor = createPosCatalogCursor(lastScanned);
    exhausted = candidates.length < targetSize;
  }

  const hasMore = eligible.length > pageSize;
  const data = eligible.slice(0, pageSize).sort(comparePosCatalogProducts);
  return {
    data,
    hasMore,
    nextCursor: hasMore ? createPosCatalogCursor(data[data.length - 1]) : null,
    requestedLimit: targetSize
  };
};

export const isProductVisibleInPosCatalog = async (product, options = {}) => {
  if (!isPosCatalogEligible(product)) return false;

  const categoryId = options.categoryId ?? null;
  const productCategoryId = product.categoryId ?? product.category_id ?? null;
  if (categoryId !== null && categoryId !== undefined && productCategoryId !== categoryId) {
    return false;
  }

  const isOutOfStock = isOutOfStockForPosMenu(product);
  if (options.outOfStockOnly) return isOutOfStock;
  if (isOutOfStock) return false;

  const expiredProductIds = await resolveExpiredProductIdsForPosMenu(
    [product],
    { db, STORES }
  );
  const isExpired = expiredProductIds.has(product.id) || isExpiredForPosMenu(product);
  if (options.expiredOnly) return isExpired;
  if (isExpired) return false;

  return true;
};

export const queryPosCatalogProductById = async (productId, options = {}) => {
  if (!productId) return null;
  const product = await db.table(STORES.MENU).get(productId);
  return await isProductVisibleInPosCatalog(product, options) ? product : null;
};

export const checkPosOutOfStockProducts = async () => {
  const products = await db.table(STORES.MENU).toArray();
  return products.some((product) => isPosCatalogEligible(product) && isOutOfStockForPosMenu(product));
};

export const checkPosExpiredProducts = () => (
  checkHasExpiredProductsForPosMenu({ db, STORES })
);
