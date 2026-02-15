import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  queryByIndex: vi.fn(),
  queryBatchesByProductIdAndActive: vi.fn(),
  saveBatchAndSyncProductSafe: vi.fn(),
  searchProductByBarcode: vi.fn(),
  searchProductBySKU: vi.fn(),
  STORES: {
    PRODUCT_BATCHES: 'product_batches'
  }
}));

vi.mock('../database', () => ({
  ...dbMocks
}));

vi.mock('../Logger', () => ({
  default: {
    error: vi.fn()
  }
}));

import {
  removeProductBatch,
  scanProductFast,
  sortBatchesByStrategy,
  updateProductBatch
} from '../inventoryMovement';

describe('scanProductFast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resuelve FEFO cuando el producto lo indica', async () => {
    dbMocks.searchProductByBarcode.mockResolvedValue({
      id: 'prod-1',
      name: 'Producto FEFO',
      price: 10,
      cost: 5,
      batchManagement: { enabled: true, selectionStrategy: 'fefo' }
    });

    dbMocks.queryBatchesByProductIdAndActive.mockResolvedValue([
      { id: 'b-1', stock: 5, price: 12, cost: 6, expiryDate: '2026-02-25T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', isActive: true },
      { id: 'b-2', stock: 7, price: 15, cost: 7, expiryDate: '2026-02-20T00:00:00.000Z', createdAt: '2026-01-10T00:00:00.000Z', isActive: true }
    ]);

    const result = await scanProductFast('750000001');

    expect(result.batchId).toBe('b-2');
    expect(result.price).toBe(15);
    expect(result.cost).toBe(7);
  });

  it('no sobrescribe variantes detectadas por SKU', async () => {
    const variant = {
      id: 'parent-1',
      name: 'Tenis',
      isVariant: true,
      batchId: 'batch-sku',
      price: 999
    };

    dbMocks.searchProductByBarcode.mockResolvedValue(null);
    dbMocks.searchProductBySKU.mockResolvedValue(variant);

    const result = await scanProductFast('SKU-123');

    expect(result).toEqual(variant);
    expect(dbMocks.queryBatchesByProductIdAndActive).not.toHaveBeenCalled();
  });

  it('hace fallback a FIFO cuando la estrategia es desconocida', () => {
    const batches = [
      { id: 'b2', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'b1', createdAt: '2026-01-01T00:00:00.000Z' }
    ];

    const sorted = sortBatchesByStrategy(batches, 'unknown');
    expect(sorted[0].id).toBe('b1');
  });
});

describe('updateProductBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('actualiza el lote cuando pertenece al producto', async () => {
    dbMocks.loadData.mockResolvedValue({
      id: 'batch-1',
      productId: 'prod-1',
      cost: 10,
      stock: 5,
      isActive: true
    });
    dbMocks.saveBatchAndSyncProductSafe.mockResolvedValue({ success: true });

    await updateProductBatch('prod-1', 'batch-1', { expiryDate: '2026-03-01' });

    expect(dbMocks.saveBatchAndSyncProductSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'batch-1',
        productId: 'prod-1',
        expiryDate: '2026-03-01'
      })
    );
  });

  it('rechaza actualizacion cuando el lote no pertenece al producto', async () => {
    dbMocks.loadData.mockResolvedValue({
      id: 'batch-1',
      productId: 'another-product'
    });

    await expect(updateProductBatch('prod-1', 'batch-1', {}))
      .rejects
      .toThrow('El lote no pertenece al producto seleccionado.');
  });
});

describe('removeProductBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('archiva logicamente un lote', async () => {
    dbMocks.loadData.mockResolvedValue({
      id: 'batch-2',
      productId: 'prod-2',
      stock: 4,
      isActive: true
    });
    dbMocks.saveBatchAndSyncProductSafe.mockResolvedValue({ success: true });

    await removeProductBatch('prod-2', 'batch-2');

    expect(dbMocks.saveBatchAndSyncProductSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'batch-2',
        productId: 'prod-2',
        isActive: false,
        isArchived: true
      })
    );
  });
});

