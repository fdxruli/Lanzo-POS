import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getExpiringProductsReport, getLowStockProductsReport } from '../inventoryAnalysis';
const mocks = vi.hoisted(() => ({ load: vi.fn(), batches: vi.fn() }));
vi.mock('../database', () => ({ loadData: mocks.load, getExpiringBatchesInRange: mocks.batches, STORES: {} }));
vi.mock('../Logger', () => ({ default: { error: vi.fn() } }));
beforeEach(() => { mocks.load.mockReset(); mocks.batches.mockReset(); });
describe('Strict inventory reads for the assistant', () => {
  it('does not load history, batches or waste for a stock-only worker query', async () => {
    const products = [{ id: 'a', stock: 2, minStock: 5 }];
    mocks.load.mockResolvedValue(products);
    const compute = vi.fn().mockResolvedValue([{ name: 'A', currentStock: 2 }]);
    await expect(getLowStockProductsReport({ operationalOnly: true, throwOnError: true, compute })).resolves.toEqual([{ name: 'A', currentStock: 2 }]);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(compute).toHaveBeenCalledWith(products);
  });

  it('rejects an incomplete read instead of claiming no low-stock products', async () => {
    mocks.load.mockResolvedValue(null);
    await expect(getLowStockProductsReport({ throwOnError: true })).rejects.toThrow('INVENTORY_READ_INCOMPLETE');
    await expect(getLowStockProductsReport()).resolves.toEqual([]);
  });
  it('propagates storage errors only for strict consumers', async () => {
    mocks.load.mockRejectedValue(new Error('Storage unavailable'));
    await expect(getLowStockProductsReport({ throwOnError: true })).rejects.toThrow('Storage unavailable');
    await expect(getLowStockProductsReport()).resolves.toEqual([]);
  });
  it('distinguishes missing expiration data from a valid empty collection', async () => {
    mocks.batches.mockResolvedValue([]); mocks.load.mockResolvedValue(null);
    await expect(getExpiringProductsReport({ throwOnError: true })).rejects.toThrow('INVENTORY_READ_INCOMPLETE');
    mocks.load.mockResolvedValue([]);
    await expect(getExpiringProductsReport({ throwOnError: true })).resolves.toEqual([]);
  });
});
