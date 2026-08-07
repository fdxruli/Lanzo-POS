import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrderActions } from '../orderActions';
import { db } from '../../services/db/dexie';

vi.mock('../../services/db/dexie', () => ({
  STORES: { PRODUCT_BATCHES: 'product_batches' },
  db: { table: vi.fn() }
}));
vi.mock('../../services/db/utils', () => ({
  getAvailableStock: (batch) => Number(batch.stock || 0) - Number(batch.committedStock || 0),
  getCommittedStock: () => 0,
  normalizeStock: (value) => Number(value || 0)
}));
vi.mock('../../services/sales/inventoryFlow', () => ({
  commitStock: vi.fn(), releaseCommittedStock: vi.fn(),
  getSortedBatchesForProduct: (batches) => [...batches].sort((left, right) => String(left.expiryDate || '').localeCompare(String(right.expiryDate || '')))
}));
vi.mock('../../services/sales/financialStats', () => ({ SALE_STATUS: {} }));

const batchTable = (batches) => ({
  where: () => ({
    equals: () => ({
      filter: () => ({ toArray: async () => batches })
    })
  })
});

const addWithBatches = async (product, batches) => {
  const added = vi.fn();
  let state = { currentOrderId: 'order-1', pendingInventoryResolutions: new Map() };
  const set = (updater) => { state = { ...state, ...(typeof updater === 'function' ? updater(state) : updater) }; };
  const get = () => ({ ...state, addItem: added });
  db.table.mockReturnValue(batchTable(batches));

  await createOrderActions(set, get).addSmartItem(product);
  return added.mock.calls[0][0];
};

beforeEach(() => vi.clearAllMocks());

describe('addSmartItem batch pricing', () => {
  it('uses parent price and selected FEFO batch cost for a physical pharmacy batch', async () => {
    const item = await addWithBatches(
      { id: 'med-1', price: 23, hasVariants: false, rubroContext: 'farmacia', batchManagement: { enabled: true } },
      [{ id: 'batch-a', price: 25, cost: 12, stock: 10, isActive: true, expiryDate: '2026-10-15' }]
    );

    expect(item).toMatchObject({ price: 23, originalPrice: 23, cost: 12, batchId: 'batch-a', isVariant: false });
  });

  it('keeps the nearest FEFO batch while preserving the product sale price', async () => {
    const item = await addWithBatches(
      { id: 'med-1', price: 23, hasVariants: false, rubroContext: 'farmacia', batchManagement: { enabled: true } },
      [{ id: 'batch-b', price: 27, cost: 13, stock: 10, isActive: true, expiryDate: '2026-12-01' }, { id: 'batch-a', price: 25, cost: 12, stock: 10, isActive: true, expiryDate: '2026-09-20' }]
    );

    expect(item).toMatchObject({ price: 23, cost: 12, batchId: 'batch-a', isVariant: false });
  });

  it('keeps the selected commercial variant price', async () => {
    const item = await addWithBatches(
      { id: 'shirt-1', price: 200, hasVariants: true, rubroContext: 'apparel', batchManagement: { enabled: true } },
      [{ id: 'variant-m', price: 220, cost: 100, stock: 4, isActive: true, attributes: { talla: 'M', color: 'Negro' } }]
    );

    expect(item).toMatchObject({ price: 220, originalPrice: 220, cost: 100, batchId: 'variant-m', isVariant: true });
  });
});
