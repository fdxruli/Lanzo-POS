import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBarcode } from '../barcodeResolver';
import { db } from '../db/dexie';

vi.mock('../db/dexie', () => ({
  STORES: { PRODUCT_BATCHES: 'product_batches', MENU: 'menu' },
  db: { table: vi.fn(), transaction: vi.fn(async (_mode, _stores, callback) => callback()) }
}));
vi.mock('../db/utils', () => ({ getAvailableStock: (record) => Number(record.stock || 0) - Number(record.committedStock || 0) }));
vi.mock('../Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));

const resolveScannedBatch = async ({ product, batch }) => {
  db.table.mockImplementation((store) => {
    if (store === 'product_batches') return { where: () => ({ equals: () => ({ first: async () => batch }) }) };
    return { get: async () => product };
  });
  return resolveBarcode(batch.sku);
};

beforeEach(() => vi.clearAllMocks());

describe('resolveBarcode batch pricing', () => {
  it('keeps product.price for a directly scanned physical pharmacy batch', async () => {
    const result = await resolveScannedBatch({
      product: { id: 'med-1', name: 'Medicamento', price: 23, cost: 8, rubroContext: 'farmacia', batchManagement: { enabled: true } },
      batch: { id: 'batch-1', productId: 'med-1', sku: 'MED-LOT', price: 25, cost: 12, stock: 10, isActive: true }
    });

    expect(result).toMatchObject({ price: 23, originalPrice: 23, cost: 12, batchId: 'batch-1', isVariant: false });
  });

  it('keeps batch.price for a directly scanned apparel variant', async () => {
    const result = await resolveScannedBatch({
      product: { id: 'shirt-1', name: 'Playera', price: 200, hasVariants: true, rubroContext: 'apparel', batchManagement: { enabled: true } },
      batch: { id: 'variant-m', productId: 'shirt-1', sku: 'SHIRT-M', price: 220, cost: 100, stock: 4, isActive: true, attributes: { talla: 'M', color: 'Negro' } }
    });

    expect(result).toMatchObject({ price: 220, originalPrice: 220, cost: 100, batchId: 'variant-m', isVariant: true });
  });
});
