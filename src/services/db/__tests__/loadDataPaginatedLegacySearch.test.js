// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../dexie';
import { loadDataPaginated } from '../index';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';

beforeEach(async () => {
  await openTestTenantRuntime();
  await db.table(STORES.MENU).clear();
});

afterEach(() => {
  closeTestTenantRuntime();
});

describe('loadDataPaginated legacy product search compatibility', () => {
  it('finds an active legacy product without createdAt when searchTerm is active and cursor is empty', async () => {
    await db.table(STORES.MENU).put({
      id: 'legacy-search-product',
      name: 'Producto Legacy Buscable',
      isActive: true,
      createdAt: undefined
    });

    const page = await loadDataPaginated(STORES.MENU, {
      searchTerm: 'legacy',
      status: 'active'
    });

    expect(page.data.map((product) => product.id)).toContain('legacy-search-product');
    expect(page.data.find((product) => product.id === 'legacy-search-product')).toMatchObject({
      name: 'Producto Legacy Buscable',
      isActive: true
    });
  });
});
