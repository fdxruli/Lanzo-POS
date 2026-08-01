import { db, loadDataPaginated, STORES } from '../database';
import { categoriesRepository } from '../db/general';
import {
  checkHasExpiredProductsForPosMenu,
  isExpiredForPosMenu,
  isOutOfStockForPosMenu,
  resolveExpiredProductIdsForPosMenu,
} from './productMenuEligibility';

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

export const queryInventoryCatalogPage = async (options = {}) => {
  const { productType = null, ...queryOptions } = options;
  const result = await loadDataPaginated(STORES.MENU, {
    limit: 50,
    timeIndex: 'createdAt',
    status: 'active',
    ...queryOptions
  });
  return {
    ...result,
    data: productType
      ? (result?.data || []).filter((product) => (
        (product.productType || product.product_type || null) === productType
      ))
      : (result?.data || [])
  };
};

export const queryPosCatalogPage = async (options = {}) => {
  const result = await loadDataPaginated(STORES.MENU, {
    limit: 50,
    timeIndex: 'createdAt',
    ...options,
    status: 'active'
  });

  return {
    ...result,
    data: (result?.data || []).filter(isPosCatalogEligible)
  };
};

export const isProductVisibleInPosCatalog = async (product, options = {}) => {
  if (!isPosCatalogEligible(product)) return false;

  const categoryId = options.categoryId ?? null;
  const productCategoryId = product.categoryId ?? product.category_id ?? null;
  if (categoryId !== null && categoryId !== undefined && productCategoryId !== categoryId) {
    return false;
  }

  if (options.outOfStockOnly && !isOutOfStockForPosMenu(product)) return false;

  if (options.expiredOnly) {
    if (isOutOfStockForPosMenu(product)) return false;
    const expiredProductIds = await resolveExpiredProductIdsForPosMenu(
      [product],
      { db, STORES }
    );
    if (!expiredProductIds.has(product.id) && !isExpiredForPosMenu(product)) return false;
  }

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
