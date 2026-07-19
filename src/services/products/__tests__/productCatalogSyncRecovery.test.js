import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = {
  categories: new Map(),
  menu: new Map(),
  productBatches: new Map()
};
let transactionImpl;

const table = (name) => ({
  get: vi.fn(async (id) => rows[name].get(id) || null),
  put: vi.fn(async (record) => {
    rows[name].set(record.id, record);
    return record.id;
  })
});

vi.mock('../../db/dexie', () => ({
  db: {
    isOpen: () => true,
    open: vi.fn(),
    table,
    transaction: (...args) => transactionImpl(...args)
  },
  STORES: {
    CATEGORIES: 'categories',
    MENU: 'menu',
    PRODUCT_BATCHES: 'productBatches',
    DELETED_CATEGORIES: 'deletedCategories',
    DELETED_MENU: 'deletedMenu'
  }
}));

vi.mock('../../database', () => ({
  createProductWithInitialInventorySafe: vi.fn(), loadData: vi.fn(), loadDataPaginated: vi.fn(),
  saveBatchAndSyncProductSafe: vi.fn(), saveImageToDB: vi.fn(), softDeleteWithCascadeSafe: vi.fn(), updateProductSafe: vi.fn()
}));
vi.mock('../../db/general', () => ({ categoriesRepository: { getActiveCategories: vi.fn() } }));
vi.mock('../../utils', () => ({ generateID: vi.fn(() => 'generated') }));

beforeEach(() => {
  Object.values(rows).forEach((store) => store.clear());
  transactionImpl = async (...args) => args.at(-1)();
});

describe('product catalog snapshot application', () => {
  it('commits valid records and identifies one invalid legacy record without hiding it', async () => {
    const { productLocalRepository } = await import('../productLocalRepository');
    const result = await productLocalRepository.applyCloudCatalog({
      products: [
        { id: 'legacy-1', name: 'Producto valido', price: 10, stock: 1, server_version: 2 },
        { name: 'Producto sin id', price: 10 }
      ],
      batches: [{ id: 'batch-1', product_id: 'legacy-1', stock: 1, cost: 2, price: 10 }]
    });

    expect(result).toMatchObject({ products: 1, batches: 1 });
    expect(result.rejected).toEqual([expect.objectContaining({
      entityType: 'product', entityId: null, index: 1, code: 'PRODUCT_CATALOG_RECORD_ID_REQUIRED'
    })]);
    expect(rows.menu.get('legacy-1')).toMatchObject({ serverVersion: 2, syncStatus: 'synced' });
  });

  it('surfaces an IndexedDB transaction failure with an actionable phase', async () => {
    transactionImpl = async () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    const { productLocalRepository } = await import('../productLocalRepository');

    await expect(productLocalRepository.applyCloudCatalog({
      products: [{ id: 'product-1', name: 'Producto', price: 10 }]
    })).rejects.toMatchObject({
      code: 'PRODUCT_CATALOG_INDEXEDDB_APPLY_FAILED',
      catalogSyncContext: { phase: 'indexeddb_transaction_commit' }
    });
  });
});
