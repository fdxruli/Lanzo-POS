import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadDataPaginated: vi.fn(),
  getActiveCategories: vi.fn(),
  table: vi.fn(),
  checkExpired: vi.fn()
}));

vi.mock('../../db/general', () => ({
  categoriesRepository: { getActiveCategories: mocks.getActiveCategories }
}));
vi.mock('../../database', () => ({
  db: { table: mocks.table },
  STORES: { MENU: 'menu' },
  loadDataPaginated: mocks.loadDataPaginated
}));
vi.mock('../productMenuEligibility', () => ({
  checkHasExpiredProductsForPosMenu: mocks.checkExpired,
  isOutOfStockForPosMenu: (product) => Number(product.stock) <= 0
}));

import {
  isPosCatalogEligible,
  queryInventoryCatalogPage,
  queryPosCatalogPage
} from '../productCatalogQueryService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('product catalog IndexedDB queries', () => {
  it('keeps administrative status filters and product types in inventory', async () => {
    mocks.loadDataPaginated.mockResolvedValue({
      data: [
        { id: 'inactive-sellable', productType: 'sellable', isActive: false },
        { id: 'inactive-ingredient', productType: 'ingredient', isActive: false }
      ],
      nextCursor: null
    });

    const result = await queryInventoryCatalogPage({ status: 'inactive', productType: 'ingredient' });

    expect(mocks.loadDataPaginated).toHaveBeenCalledWith(
      'menu',
      expect.objectContaining({ status: 'inactive' })
    );
    expect(result.data.map((product) => product.id)).toEqual(['inactive-ingredient']);
  });

  it('forces active IndexedDB reads and excludes ingredients or deleted records from POS', async () => {
    mocks.loadDataPaginated.mockResolvedValue({
      data: [
        { id: 'sellable', productType: 'sellable', isActive: true },
        { id: 'ingredient', productType: 'ingredient', isActive: true },
        { id: 'inactive', productType: 'sellable', isActive: false },
        { id: 'deleted', productType: 'sellable', isActive: true, deletedAt: '2026-01-01' }
      ],
      nextCursor: null
    });

    const result = await queryPosCatalogPage({ status: 'all' });

    expect(mocks.loadDataPaginated).toHaveBeenCalledWith(
      'menu',
      expect.objectContaining({ status: 'active' })
    );
    expect(result.data.map((product) => product.id)).toEqual(['sellable']);
    expect(isPosCatalogEligible({ id: 'ingredient', productType: 'ingredient' })).toBe(false);
  });
});
