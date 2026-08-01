// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scanProductFast: vi.fn(),
  loadBatchesForProduct: vi.fn(),
  updateProductBatch: vi.fn(),
  removeProductBatch: vi.fn(),
  notifyProductsChanged: vi.fn()
}));

vi.mock('../../services/inventoryMovement', () => ({
  scanProductFast: mocks.scanProductFast,
  loadBatchesForProduct: mocks.loadBatchesForProduct,
  updateProductBatch: mocks.updateProductBatch,
  removeProductBatch: mocks.removeProductBatch
}));
vi.mock('../../services/products/productEvents', () => ({
  notifyProductsChanged: mocks.notifyProductsChanged
}));

import { useInventoryMovement } from '../useInventoryMovement';

beforeEach(() => {
  vi.clearAllMocks();
});
describe('inventory movement access independent from visible catalog pages', () => {
  it('returns a barcode product even when no visual store contains it', async () => {
    const hiddenFromCurrentPage = { id: 'product-page-7', barcode: '7501234567890' };
    mocks.scanProductFast.mockResolvedValue(hiddenFromCurrentPage);
    const { result } = renderHook(() => useInventoryMovement());

    let scanned;
    await act(async () => {
      scanned = await result.current.scanProductFast('7501234567890');
    });

    expect(scanned).toEqual(hiddenFromCurrentPage);
    expect(mocks.scanProductFast).toHaveBeenCalledWith('7501234567890');
  });

  it('notifies both catalogs after a batch mutation without calling either store', async () => {
    mocks.updateProductBatch.mockResolvedValue({ id: 'batch-1' });
    const { result } = renderHook(() => useInventoryMovement());

    await act(async () => {
      await result.current.updateProductBatch('product-1', 'batch-1', { stock: 5 });
    });

    expect(mocks.notifyProductsChanged).toHaveBeenCalledWith({
      source: 'inventoryMovement.updateProductBatch',
      productIds: ['product-1']
    });
  });
});
