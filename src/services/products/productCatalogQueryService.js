import { db, STORES } from '../database';
import { categoriesRepository } from '../db/general';
import { productLocalRepository } from './productLocalRepository';
import {
  checkHasExpiredProductsForPosMenu,
  isOutOfStockForPosMenu
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
  const result = await productLocalRepository.listProductsPage({
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
  const result = await productLocalRepository.listProductsPage({
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

export const checkPosOutOfStockProducts = async () => {
  const products = await db.table(STORES.MENU).toArray();
  return products.some((product) => isPosCatalogEligible(product) && isOutOfStockForPosMenu(product));
};

export const checkPosExpiredProducts = () => (
  checkHasExpiredProductsForPosMenu({ db, STORES })
);
