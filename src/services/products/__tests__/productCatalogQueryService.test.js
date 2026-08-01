import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadDataPaginated: vi.fn(),
  getActiveCategories: vi.fn(),
  get: vi.fn(),
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
  queryPosCatalogProductById,
  queryInventoryCatalogPage,
  queryPosCatalogPage
} from '../productCatalogQueryService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.table.mockReturnValue({ get: mocks.get });
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

  it('reads one current IndexedDB product and applies the active POS view', async () => {
    mocks.get.mockResolvedValue({
      id: 'product-1',
      name: 'Updated',
      categoryId: 'drinks',
      productType: 'sellable',
      isActive: true
    });

    await expect(queryPosCatalogProductById('product-1', { categoryId: 'drinks' }))
      .resolves.toMatchObject({ name: 'Updated' });
    await expect(queryPosCatalogProductById('product-1', { categoryId: 'food' }))
      .resolves.toBeNull();
  });

  it('returns null for an inactive or ingredient product during directed reconciliation', async () => {
    mocks.get.mockResolvedValueOnce({
      id: 'product-1', productType: 'sellable', isActive: false
    });
    await expect(queryPosCatalogProductById('product-1')).resolves.toBeNull();

    mocks.get.mockResolvedValueOnce({
      id: 'product-1', productType: 'ingredient', isActive: true
    });
    await expect(queryPosCatalogProductById('product-1')).resolves.toBeNull();
  });
});
