import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  records: [],
  limits: [],
  getActiveCategories: vi.fn(),
  get: vi.fn(),
  checkExpired: vi.fn(),
  expiredIds: new Set(),
  loadDataPaginated: vi.fn()
}));

const makeCollection = (source) => ({
  reverse() {
    return makeCollection([...source].reverse());
  },
  filter(predicate) {
    return makeCollection(source.filter(predicate));
  },
  limit(value) {
    mocks.limits.push(value);
    return makeCollection(source.slice(0, value));
  },
  toArray: async () => [...source]
});

const table = {
  orderBy: () => makeCollection([...mocks.records].sort((left, right) => (
    String(left.createdAt).localeCompare(String(right.createdAt))
    || String(left.id).localeCompare(String(right.id))
  ))),
  where: () => ({
    belowOrEqual: (value) => makeCollection(mocks.records
      .filter((product) => String(product.createdAt) <= value)
      .sort((left, right) => (
        String(left.createdAt).localeCompare(String(right.createdAt))
        || String(left.id).localeCompare(String(right.id))
      )))
  }),
  get: (...args) => mocks.get(...args),
  toArray: async () => [...mocks.records]
};

vi.mock('../../db/general', () => ({
  categoriesRepository: { getActiveCategories: mocks.getActiveCategories }
}));
vi.mock('../../database', () => ({
  db: { table: () => table },
  STORES: { MENU: 'menu' },
  loadDataPaginated: mocks.loadDataPaginated
}));
vi.mock('../productMenuEligibility', () => ({
  checkHasExpiredProductsForPosMenu: mocks.checkExpired,
  isOutOfStockForPosMenu: (product) => Number(product.stock) <= 0,
  isExpiredForPosMenu: (product) => product.expired === true,
  resolveExpiredProductIdsForPosMenu: vi.fn(async (products) => new Set(
    products.filter((product) => mocks.expiredIds.has(product.id)).map((product) => product.id)
  ))
}));

import {
  INVENTORY_CATALOG_PAGE_SIZE,
  isInventoryCatalogEligible,
  isPosCatalogEligible,
  POS_CATALOG_PAGE_SIZE,
  queryInventoryCatalogPage,
  queryActiveIngredientsForConfiguration,
  queryPosCatalogPage,
  queryPosCatalogProductById
} from '../productCatalogQueryService';

const product = (number, overrides = {}) => ({
  id: `product-${String(number).padStart(3, '0')}`,
  name: `Product ${number}`,
  createdAt: `2026-01-01T00:${String(number).padStart(2, '0')}:00.000Z`,
  categoryId: 'general',
  productType: 'sellable',
  isActive: true,
  stock: 10,
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.records = [];
  mocks.limits = [];
  mocks.expiredIds = new Set();
});

describe('product catalog IndexedDB queries', () => {
  it('keeps administrative status filters and product types in inventory', async () => {
    mocks.records = [
      product(1, { id: 'inactive-sellable', isActive: false }),
      product(2, { id: 'inactive-ingredient', productType: 'ingredient', isActive: false })
    ];

    const result = await queryInventoryCatalogPage({ status: 'inactive', productType: 'ingredient' });
    expect(result.data.map(({ id }) => id)).toEqual(['inactive-ingredient']);
  });

  it('fills inventory pages with eligible sellable products before limiting raw records', async () => {
    const sellable = Array.from({ length: 52 }, (_, index) => product(index, {
      id: `sellable-${String(index).padStart(3, '0')}`
    }));
    const ingredients = Array.from({ length: 28 }, (_, index) => product(100 + index, {
      id: `ingredient-${String(index).padStart(3, '0')}`,
      productType: 'ingredient'
    }));
    mocks.records = [...sellable, ...ingredients];

    const first = await queryInventoryCatalogPage({ productType: 'sellable' });
    const second = await queryInventoryCatalogPage({
      productType: 'sellable',
      cursor: first.nextCursor
    });

    expect(first.data).toHaveLength(INVENTORY_CATALOG_PAGE_SIZE);
    expect(first.requestedLimit).toBe(51);
    expect(first.hasMore).toBe(true);
    expect(second.data).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect([...first.data, ...second.data].every((item) => (
      isInventoryCatalogEligible(item, { productType: 'sellable' })
    ))).toBe(true);
  });

  it('excludes deleted products and fills a selected inventory category', async () => {
    const otherCategory = Array.from({ length: 70 }, (_, index) => product(200 + index, {
      id: `other-${index}`,
      categoryId: 'other'
    }));
    const selectedCategory = Array.from({ length: 55 }, (_, index) => product(index, {
      id: `selected-${index}`,
      categoryId: 'selected'
    }));
    const deleted = Array.from({ length: 15 }, (_, index) => product(400 + index, {
      id: `deleted-${index}`,
      categoryId: 'selected',
      deletedAt: '2026-01-02T00:00:00.000Z'
    }));
    mocks.records = [...otherCategory, ...deleted, ...selectedCategory];

    const result = await queryInventoryCatalogPage({
      categoryId: 'selected',
      productType: 'sellable'
    });

    expect(result.data).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.data.every((item) => item.categoryId === 'selected' && !item.deletedAt)).toBe(true);
  });

  it('paginates inventory deterministically when all createdAt values are equal', async () => {
    mocks.records = Array.from({ length: 75 }, (_, index) => product(index, {
      createdAt: '2026-01-01T00:00:00.000Z'
    }));
    const first = await queryInventoryCatalogPage({ productType: 'sellable' });
    const second = await queryInventoryCatalogPage({
      productType: 'sellable',
      cursor: first.nextCursor
    });
    const ids = [...first.data, ...second.data].map(({ id }) => id);

    expect(ids).toHaveLength(75);
    expect(new Set(ids).size).toBe(75);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it.each([
    [0, 0, false],
    [12, 12, false],
    [50, 50, false],
    [51, 50, true],
    [120, 50, true]
  ])('computes inventory hasMore exactly for %i eligible records', async (count, length, hasMore) => {
    mocks.records = Array.from({ length: count }, (_, index) => product(index));
    const result = await queryInventoryCatalogPage({ productType: 'sellable' });
    expect(result.data).toHaveLength(length);
    expect(result.hasMore).toBe(hasMore);
  });

  it('keeps the ingredient inventory view independent', async () => {
    mocks.records = [
      ...Array.from({ length: 60 }, (_, index) => product(index)),
      ...Array.from({ length: 53 }, (_, index) => product(100 + index, {
        id: `ingredient-${index}`,
        productType: 'ingredient'
      }))
    ];
    const first = await queryInventoryCatalogPage({ productType: 'ingredient' });
    const second = await queryInventoryCatalogPage({
      productType: 'ingredient',
      cursor: first.nextCursor
    });
    expect(first.data).toHaveLength(50);
    expect(second.data).toHaveLength(3);
    expect([...first.data, ...second.data].every((item) => item.productType === 'ingredient')).toBe(true);
  });

  it('returns every active ingredient for configuration independently of catalog pages', async () => {
    mocks.records = [
      product(1, { id: 'ingredient-z', name: 'Zanahoria', productType: 'ingredient', stock: 0 }),
      product(2, { id: 'ingredient-a', name: 'Aceite', productType: null, product_type: 'ingredient', stock: 12 }),
      product(3, { id: 'sellable', productType: 'sellable' }),
      product(4, { id: 'inactive', productType: 'ingredient', isActive: false }),
      product(5, { id: 'deleted', productType: 'ingredient', deletedAt: '2026-01-02' })
    ];

    const result = await queryActiveIngredientsForConfiguration();
    expect(result.map((item) => item.id)).toEqual(['ingredient-a', 'ingredient-z']);
    expect(result[1]).toMatchObject({ stock: 0, productType: 'ingredient' });
  });

  it('loads 50 eligible products, requests 51, and exposes a stable cursor', async () => {
    mocks.records = Array.from({ length: 60 }, (_, index) => product(index));

    const result = await queryPosCatalogPage();

    expect(result.data).toHaveLength(POS_CATALOG_PAGE_SIZE);
    expect(result.requestedLimit).toBe(51);
    expect(mocks.limits[0]).toBe(51);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual({
      sortValue: result.data[49].createdAt,
      id: result.data[49].id
    });
  });

  it('filters inactive, deleted, ingredients, stock and category before filling the page', async () => {
    const excluded = Array.from({ length: 30 }, (_, index) => product(100 + index, {
      id: `excluded-${index}`,
      ...(index % 4 === 0 ? { isActive: false } : {}),
      ...(index % 4 === 1 ? { deletedAt: '2026-01-01' } : {}),
      ...(index % 4 === 2 ? { productType: 'ingredient' } : {}),
      ...(index % 4 === 3 ? { stock: 0 } : {})
    }));
    mocks.records = [...excluded, ...Array.from({ length: 55 }, (_, index) => product(index))];

    const result = await queryPosCatalogPage({ categoryId: 'general' });

    expect(result.data).toHaveLength(50);
    expect(result.data.every((item) => isPosCatalogEligible(item) && item.stock > 0)).toBe(true);
  });

  it('returns 35 and stops when the total is smaller than the page', async () => {
    mocks.records = Array.from({ length: 35 }, (_, index) => product(index));
    const result = await queryPosCatalogPage();
    expect(result.data).toHaveLength(35);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('does not invent a third page when the total is an exact multiple', async () => {
    mocks.records = Array.from({ length: 100 }, (_, index) => product(index));
    const first = await queryPosCatalogPage();
    const second = await queryPosCatalogPage({ cursor: first.nextCursor });

    expect(first.data).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(second.data).toHaveLength(50);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map(({ id }) => id)).size).toBe(100);
  });

  it('uses id as the tie breaker when createdAt values are equal', async () => {
    mocks.records = Array.from({ length: 75 }, (_, index) => product(index, {
      createdAt: '2026-01-01T00:00:00.000Z'
    }));
    const first = await queryPosCatalogPage();
    const second = await queryPosCatalogPage({ cursor: first.nextCursor });
    const ids = [...first.data, ...second.data].map(({ id }) => id);

    expect(ids).toHaveLength(75);
    expect(new Set(ids).size).toBe(75);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it('paginates dynamic out-of-stock and expired views independently', async () => {
    mocks.records = Array.from({ length: 120 }, (_, index) => product(index, {
      stock: index % 2 === 0 ? 0 : 10,
      expired: index % 2 === 1
    }));
    const out = await queryPosCatalogPage({ outOfStockOnly: true });
    const expired = await queryPosCatalogPage({ expiredOnly: true });

    expect(out.data).toHaveLength(50);
    expect(out.data.every((item) => item.stock === 0)).toBe(true);
    expect(expired.data).toHaveLength(50);
    expect(expired.data.every((item) => item.stock > 0 && item.expired)).toBe(true);
  });

  it('reads one current IndexedDB product and applies the active POS view', async () => {
    mocks.get.mockResolvedValue(product(1, { id: 'product-1', categoryId: 'drinks' }));
    await expect(queryPosCatalogProductById('product-1', { categoryId: 'drinks' }))
      .resolves.toMatchObject({ id: 'product-1' });
    await expect(queryPosCatalogProductById('product-1', { categoryId: 'food' }))
      .resolves.toBeNull();
  });
});
