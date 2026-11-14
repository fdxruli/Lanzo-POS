// @vitest-environment jsdom
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchProductsInTable } from '../../../services/db/productSearch';
import { buildProductSearchFields } from '../../../services/db/productSearchIndex';
import { usePosSearch } from '../usePosSearch';
import { searchProductsInDB } from '../../../services/database';

const context = vi.hoisted(() => ({ db: null, state: null }));
vi.mock('../../../services/database', () => ({
  db: { table: (...args) => context.db.table(...args) },
  STORES: { MENU: 'menu', PRODUCT_BATCHES: 'batches' },
  searchProductsInDB: vi.fn((term, status, category, options) =>
    searchProductsInTable(context.db.table('menu'), term, status, 50, category, options))
}));
vi.mock('../../../store/usePosCatalogStore', () => ({
  usePosCatalogStore: (selector) => selector(context.state)
}));
vi.mock('../../useDebounce', () => ({ useDebounce: (value) => value }));
const make = (id, overrides = {}) => {
  const product = { id, name: `QA AGUA ${id}`, categoryId: 'B', productType: 'sellable',
    isActive: true, trackStock: true, stock: 10, ...overrides };
  return { ...product, ...buildProductSearchFields(product) };
};
beforeEach(async () => {
  searchProductsInDB.mockClear();
  context.db = new Dexie(`f04-${crypto.randomUUID()}`, { indexedDB, IDBKeyRange });
  context.db.version(1).stores({ menu: 'id, name_lower, *search_tokens, barcode_normalized, sku_normalized, *search_ngrams', batches: 'id, productId' });
  await context.db.open();
  context.state = { items: [], categories: [], categoryId: null, outOfStockOnly: false, expiredOnly: false,
    setFilters: vi.fn(), checkHasOutOfStockProducts: vi.fn(async () => false), checkHasExpiredProducts: vi.fn(async () => false) };
});
afterEach(async () => { cleanup(); await context.db.delete(); });

describe('F-04 POS hook with Dexie and fake-indexeddb', () => {
  it.each(['category', 'mixed', 'outOfStock', 'expired'])(
    'finds eligible products after 60 %s candidates', async (kind) => {
      if (kind === 'category') context.state.categoryId = 'B';
      const overrides = kind === 'category' ? { categoryId: 'A' }
        : kind === 'outOfStock' ? { stock: 0 }
          : kind === 'expired' ? { expiryDate: '2000-01-01' } : null;
      const mixed = [{ productType: 'ingredient' }, { isActive: false }, { stock: 0 }, { expiryDate: '2000-01-01' }];
      await context.db.table('menu').bulkPut([
        ...Array.from({ length: 60 }, (_, i) => make(`a${String(i).padStart(2, '0')}`, overrides || mixed[i % 4])),
        ...Array.from({ length: 5 }, (_, i) => make(`z${i}`))
      ]);
      const { result } = renderHook(() => usePosSearch());
      act(() => result.current.setSearchTerm('QA AGUA'));
      await waitFor(() => expect(result.current.menuVisual.map((p) => p.id)).toEqual(['z0', 'z1', 'z2', 'z3', 'z4']), { timeout: 1000 });
    }
  );
});


it.each(['all', 'outOfStock', 'expired'])('classifies %s after 120 mixed indexed matches and keeps batch rules', async (mode) => {
  context.state.outOfStockOnly = mode === 'outOfStock';
  context.state.expiredOnly = mode === 'expired';
  await context.db.table('menu').bulkPut([
    ...Array.from({ length: 60 }, (_, i) => make(`a${i}`, { productType: 'ingredient' })),
    ...Array.from({ length: 60 }, (_, i) => make(`b${i}`, { categoryId: 'A', stock: 0 })),
    make('z-available'), make('z-empty', { stock: 0 }),
    make('z-expired', { batchManagement: { enabled: true }, expirationMode: 'STRICT' }),
    make('z-mixed', { batchManagement: { enabled: true }, expirationMode: 'STRICT' })
  ]);
  await context.db.table('batches').bulkPut([
    { id: 'old', productId: 'z-expired', stock: 10, isActive: true, expiryDate: '2000-01-01' },
    { id: 'mixed-old', productId: 'z-mixed', stock: 5, isActive: true, expiryDate: '2000-01-01' },
    { id: 'mixed-current', productId: 'z-mixed', stock: 5, isActive: true, expiryDate: '2099-01-01' }
  ]);
  context.state.categoryId = 'B';
  const { result } = renderHook(() => usePosSearch());
  act(() => result.current.setSearchTerm('QA AGUA'));
  const expected = mode === 'all' ? ['z-available', 'z-mixed'] : mode === 'expired' ? ['z-expired'] : ['z-empty'];
  await waitFor(() => expect(result.current.menuVisual.map((p) => p.id)).toEqual(expected), { timeout: 1000 });
});

it('stops at 50 eligible results and does not repeat batch lookups across index routes', async () => {
  await context.db.table('menu').bulkPut(Array.from({ length: 125 }, (_, i) => make(String(i).padStart(3, '0'), {
    batchManagement: { enabled: true }, expirationMode: 'STRICT'
  })));
  const tableSpy = vi.spyOn(context.db, 'table');
  const { result } = renderHook(() => usePosSearch());
  act(() => result.current.setSearchTerm('QA AGUA'));
  await waitFor(() => expect(result.current.menuVisual).toHaveLength(50), { timeout: 1000 });
  expect(tableSpy.mock.calls.filter(([name]) => name === 'batches')).toHaveLength(50);
  tableSpy.mockRestore();
});

it('ignores an older search response and restores the menu for empty search', async () => {
  context.state.items = [make('menu')];
  let finishOld;
  searchProductsInDB.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  const { result } = renderHook(() => usePosSearch());
  await waitFor(() => expect(result.current.menuVisual.map((p) => p.id)).toEqual(['menu']));
  act(() => result.current.setSearchTerm('old'));
  await waitFor(() => expect(finishOld).toBeTypeOf('function'));
  await context.db.table('menu').put(make('new', { name: 'new water' }));
  act(() => result.current.setSearchTerm('new'));
  await waitFor(() => expect(result.current.menuVisual.map((p) => p.id)).toEqual(['new']));
  await act(async () => finishOld([make('old')]));
  expect(result.current.menuVisual.map((p) => p.id)).toEqual(['new']);
  act(() => result.current.setSearchTerm(''));
  await waitFor(() => expect(result.current.menuVisual.map((p) => p.id)).toEqual(['menu']));
});

it('continues past 60 batch-expired products without querying the same lots twice', async () => {
  const products = Array.from({ length: 65 }, (_, i) => make(String(i).padStart(3, '0'), {
    batchManagement: { enabled: true }, expirationMode: 'STRICT'
  }));
  await context.db.table('menu').bulkPut(products);
  await context.db.table('batches').bulkPut(products.map((p, i) => ({
    id: `batch-${p.id}`, productId: p.id, stock: 10, isActive: true,
    expiryDate: i < 60 ? '2000-01-01' : '2099-01-01'
  })));
  const tableSpy = vi.spyOn(context.db, 'table');
  const { result } = renderHook(() => usePosSearch());
  act(() => result.current.setSearchTerm('QA AGUA'));
  await waitFor(() => expect(result.current.menuVisual.map((p) => p.id)).toEqual(['060', '061', '062', '063', '064']), { timeout: 1000 });
  expect(tableSpy.mock.calls.filter(([name]) => name === 'batches')).toHaveLength(65);
  tableSpy.mockRestore();
});

it('counts distinct products before limiting a multi-entry token prefix', async () => {
  await context.db.table('menu').bulkPut(Array.from({ length: 60 }, (_, i) => make(String(i).padStart(3, '0'), {
    name: `x agua azul${String(i).padStart(3, '0')}`
  })));
  const products = await searchProductsInTable(context.db.table('menu'), 'a');
  expect(products).toHaveLength(50);
  expect(new Set(products.map((p) => p.id)).size).toBe(50);
});
