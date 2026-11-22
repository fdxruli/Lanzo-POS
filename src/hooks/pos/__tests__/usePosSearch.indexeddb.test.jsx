// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import forceCloseDatabase from 'fake-indexeddb/lib/forceCloseDatabase';
import Dexie from 'dexie';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import * as database from '../../../services/database';
import { getNativeTenantReconnect } from '../../../services/db/databaseRuntime';
import { closeTenantRuntime, getActiveTenantRuntime } from '../../../services/db/tenantRuntimeRouter';
import {
  assertLocalTenantAccess,
  initializeLocalTenantGuard,
  resetLocalTenantGuardForTests
} from '../../../services/tenant/localTenantGuard';
import { usePosCatalogStore } from '../../../store/usePosCatalogStore';
import { usePosSearch } from '../usePosSearch';

const { db, STORES } = database;

const product = (id, name, fields) => ({
  id,
  name,
  createdAt: '2026-11-01T00:00:00.000Z',
  isActive: true,
  trackStock: true,
  productType: 'sellable',
  stock: 19,
  ...fields
});

const waitForSearch = (assertion) => waitFor(assertion, { timeout: 1500 });
const ids = (result) => result.current.menuVisual.map(({ id }) => id);
let databaseName;

beforeEach(async () => {
  initializeLocalTenantGuard('pos-search-test');
  await assertLocalTenantAccess({ license_key: `POS-SEARCH-${crypto.randomUUID()}` });
  databaseName = getActiveTenantRuntime().databaseName;
  actorRuntimeController.beginAuthentication({ actorType: 'admin' });
  actorRuntimeController.grant({
    actorType: 'admin', actorId: 'admin', sessionId: 'test-session',
    authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString()
  });

  await db.table(STORES.CATEGORIES).put({ id: 'general', name: 'General', isActive: true });
  await db.table(STORES.MENU).bulkPut([
    product('pilas', 'Pilas QA AA', {
      barcode: '7501234567893',
      sku: 'QA-AA',
      categoryId: 'general',
      batchManagement: { enabled: true },
      expirationMode: 'STRICT'
    }),
    product('para', 'Paracetamol', { category_id: 'general', expiryDate: '2099-01-01' }),
    product('expired', 'Paracetamol vencido', { categoryId: 'general', expiryDate: '2000-01-01' }),
    product('empty', 'Pilas agotadas', { categoryId: 'general', stock: 0 })
  ]);
  await db.table(STORES.PRODUCT_BATCHES).put({
    id: 'pilas-lote', productId: 'pilas', stock: 19, isActive: true, expiryDate: '2099-01-01'
  });
  await usePosCatalogStore.getState().loadFirstPage({ includeCategories: true });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  usePosCatalogStore.getState().reset();
  actorRuntimeController.lock('test_cleanup');
  closeTenantRuntime();
  resetLocalTenantGuardForTests();
  if (databaseName) await new Dexie(databaseName).delete();
});

describe('POS search against the operational IndexedDB and store', () => {
  it('finds persisted eligible products by full and partial name, barcode and SKU, then restores the catalog', async () => {
    const index = await db.table(STORES.MENU).get('pilas');
    expect(index).toMatchObject({
      name_lower: 'pilas qa aa',
      barcode_normalized: '7501234567893',
      sku_normalized: 'qa-aa',
      search_tokens: ['pilas', 'qa', 'aa']
    });
    expect(index.search_ngrams).toContain('ila');
    await expect(database.searchProductsInDB('Pilas QA AA')).resolves.toMatchObject([{ id: 'pilas' }]);

    const { result } = renderHook(() => usePosSearch({ debounceMs: 10 }));
    await waitForSearch(() => expect(ids(result)).toEqual(['pilas', 'para']));

    for (const [term, expected] of [
      ['Pilas QA AA', ['pilas']],
      ['Pilas', ['pilas']],
      ['Paracetamol', ['para']],
      ['7501234567893', ['pilas']],
      ['QA-AA', ['pilas']]
    ]) {
      act(() => result.current.setSearchTerm(term));
      await waitForSearch(() => {
        expect(result.current.isLoadingInitial).toBe(false);
        expect(ids(result)).toEqual(expected);
      });
    }

    const runSearch = vi.spyOn(database, 'searchProductsInDB');
    act(() => result.current.setSearchTerm('sin coincidencias'));
    await waitForSearch(() => expect(runSearch).toHaveBeenCalledOnce());
    await act(async () => { await runSearch.mock.results[0].value; });
    expect(result.current.isLoadingInitial).toBe(false);
    expect(ids(result)).toEqual([]);

    act(() => result.current.setSearchTerm(''));
    expect(ids(result)).toEqual(['pilas', 'para']);
  });

  it('reports an aborted IndexedDB query and restores the current catalog immediately on clear', async () => {
    const { result } = renderHook(() => usePosSearch({ debounceMs: 10 }));
    await waitForSearch(() => expect(ids(result)).toEqual(['pilas', 'para']));

    const nativeIndex = IDBObjectStore.prototype.index;
    let aborted = false;
    vi.spyOn(IDBObjectStore.prototype, 'index').mockImplementation(function (name) {
      if (!aborted && this.name === STORES.MENU && name === 'barcode_normalized') {
        aborted = true;
        this.transaction.abort();
      }
      return nativeIndex.call(this, name);
    });
    act(() => result.current.setSearchTerm('Pilas QA AA'));
    await waitForSearch(() => expect(aborted).toBe(true));
    await waitForSearch(() => {
      expect(result.current.isLoadingInitial).toBe(false);
      expect(result.current.searchFailed).toBe(true);
    });
    expect(ids(result)).toEqual([]);

    act(() => result.current.setSearchTerm(''));
    expect(result.current.searchFailed).toBe(false);
    expect(ids(result)).toEqual(['pilas', 'para']);

    act(() => result.current.setSearchTerm('Pilas'));
    await waitForSearch(() => expect(ids(result)).toEqual(['pilas']));
  });

  it('renders the filtered store page when clearing, including products with a legacy category field', async () => {
    const { result } = renderHook(() => usePosSearch({ debounceMs: 10 }));
    await waitForSearch(() => expect(ids(result)).toEqual(['pilas', 'para']));

    act(() => result.current.handleSelectCategory('general'));
    await waitForSearch(() => {
      expect(usePosCatalogStore.getState().items.map(({ id }) => id)).toEqual(['pilas', 'para']);
      expect(ids(result)).toEqual(['pilas', 'para']);
    });
    act(() => result.current.setSearchTerm('Paracetamol'));
    await waitForSearch(() => expect(ids(result)).toEqual(['para']));
    act(() => result.current.setSearchTerm(''));
    expect(ids(result)).toEqual(['pilas', 'para']);
  });

  it('resumes the search and restores the catalog after a native connection close', async () => {
    const { result } = renderHook(() => usePosSearch({ debounceMs: 10 }));
    act(() => result.current.setSearchTerm('Pilas'));
    await waitForSearch(() => expect(ids(result)).toEqual(['pilas']));

    const native = db.backendDB();
    const closed = new Promise((resolve) => native.addEventListener('close', resolve, { once: true }));
    await act(async () => {
      forceCloseDatabase(native);
      await closed;
      expect(getNativeTenantReconnect()?.status).toBe('reconnecting');
    });
    expect(ids(result)).toEqual([]);
    expect(result.current.isLoadingInitial).toBe(true);

    await waitForSearch(() => {
      expect(getNativeTenantReconnect()?.status).toBe('ready');
      expect(ids(result)).toEqual(['pilas']);
    });
    expect(db.backendDB()).not.toBe(native);
    act(() => result.current.setSearchTerm(''));
    expect(ids(result)).toEqual(['pilas', 'para']);
  });

  it('does not repeat a completed query when the input changes only in whitespace', async () => {
    const runSearch = vi.spyOn(database, 'searchProductsInDB');
    const { result } = renderHook(() => usePosSearch({ debounceMs: 10 }));
    act(() => result.current.setSearchTerm('Pilas'));
    await waitForSearch(() => expect(ids(result)).toEqual(['pilas']));

    act(() => result.current.setSearchTerm('  Pilas  '));
    expect(ids(result)).toEqual(['pilas']);
    expect(runSearch).toHaveBeenCalledTimes(1);
  });
});
