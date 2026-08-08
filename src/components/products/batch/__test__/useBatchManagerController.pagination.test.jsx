// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadBatchesForManager: vi.fn(),
  loadNextBatchManagerPage: vi.fn(),
  loadData: vi.fn(),
  searchProductsInDB: vi.fn(),
  refreshData: vi.fn(),
  saveBatch: vi.fn()
}));

vi.mock('../../../../hooks/useDebounce', () => ({ useDebounce: (value) => value }));
vi.mock('../../../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: Object.assign(() => null, {
    getState: () => ({ loadInitialProducts: vi.fn() })
  })
}));
vi.mock('../../../../services/database', () => ({
  executeBatchWithPaymentSafe: vi.fn(),
  executeProductionBatchSafe: vi.fn(),
  loadData: mocks.loadData,
  searchProductsInDB: mocks.searchProductsInDB,
  STORES: { MENU: 'menu' }
}));
vi.mock('../../../../services/products/productRepository', () => ({
  productRepository: {
    saveProduct: vi.fn(),
    saveBatch: mocks.saveBatch,
    deleteBatch: vi.fn()
  }
}));
vi.mock('../../../../services/products/productMapper', () => ({
  cloudProductToLocal: (product, existing) => ({
    ...existing,
    ...product,
    serverVersion: product.serverVersion ?? product.server_version ?? existing?.serverVersion
  })
}));
vi.mock('../../../../services/utils', () => ({ showMessageModal: vi.fn() }));
vi.mock('../../../../services/inventoryMovement', () => ({
  loadBatchesForManager: mocks.loadBatchesForManager,
  loadNextBatchManagerPage: mocks.loadNextBatchManagerPage
}));
vi.mock('../../../../services/products/batchManagerQueries', () => ({
  BATCH_MANAGER_PAGE_SIZE: 50
}));
vi.mock('../../../../store/useStatsStore', () => ({
  useStatsStore: (selector) => selector({ adjustInventoryValue: vi.fn() })
}));
vi.mock('../../../../services/Logger', () => ({
  default: { error: vi.fn() }
}));
vi.mock('../../../common/InputPromptModal', () => ({ showInputPromptModal: vi.fn() }));

import { useBatchManagerController } from '../hooks/useBatchManagerController';

const emptySummary = (totalRecords = 0) => ({
  totalRecords,
  activeRecords: totalRecords,
  archivedRecords: 0,
  totalPhysicalStock: totalRecords,
  totalAvailableStock: totalRecords,
  totalCommittedStock: 0,
  inventoryValue: totalRecords * 2
});

const snapshot = (id, options = {}) => ({
  items: [{ id, productId: options.productId || 'product-a' }],
  nextCursor: options.nextCursor ?? null,
  hasMore: options.hasMore ?? false,
  requestedLimit: 50,
  summary: emptySummary(options.totalRecords ?? 1)
});

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const products = {
  'product-a': { id: 'product-a', name: 'product-a', trackStock: true, batchManagement: { enabled: true } },
  'product-b': { id: 'product-b', name: 'product-b', trackStock: true, batchManagement: { enabled: true } }
};

const renderController = (initialProductId = 'product-a') => renderHook(
  ({ productId }) => useBatchManagerController({
    selectedProduct: products[productId],
    selectedProductId: productId,
    onProductSelect: vi.fn(),
    refreshData: mocks.refreshData
  }),
  { initialProps: { productId: initialProductId } }
);

describe('useBatchManagerController pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(null);
    mocks.searchProductsInDB.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('ignora una respuesta tardía del producto anterior', async () => {
    const requestA = deferred();
    const requestB = deferred();
    mocks.loadBatchesForManager.mockImplementation((productId) => (
      productId === 'product-a' ? requestA.promise : requestB.promise
    ));
    const { result, rerender } = renderController('product-a');

    rerender({ productId: 'product-b' });
    await act(async () => {
      requestB.resolve(snapshot('batch-b', { productId: 'product-b' }));
      await requestB.promise;
    });
    await waitFor(() => expect(result.current.productBatches[0]?.id).toBe('batch-b'));

    await act(async () => {
      requestA.resolve(snapshot('batch-a', { productId: 'product-a' }));
      await requestA.promise;
    });

    expect(result.current.selectedProduct.id).toBe('product-b');
    expect(result.current.productBatches.map((batch) => batch.id)).toEqual(['batch-b']);
  });

  it('acumula la página siguiente y deduplica por id', async () => {
    mocks.loadBatchesForManager.mockResolvedValue(snapshot('batch-2', {
      hasMore: true,
      nextCursor: { sortValue: 2, id: 'batch-2' },
      totalRecords: 3
    }));
    mocks.loadNextBatchManagerPage.mockResolvedValue({
      items: [
        { id: 'batch-2', productId: 'product-a' },
        { id: 'batch-1', productId: 'product-a' }
      ],
      nextCursor: null,
      hasMore: false,
      requestedLimit: 50
    });
    const { result } = renderController();
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    await act(async () => { await result.current.loadMoreBatches(); });

    expect(result.current.productBatches.map((batch) => batch.id)).toEqual(['batch-2', 'batch-1']);
    expect(result.current.totalCount).toBe(3);
    expect(result.current.hasMore).toBe(false);
  });

  it('convierte dos clics rápidos en una sola consulta efectiva', async () => {
    const nextRequest = deferred();
    mocks.loadBatchesForManager.mockResolvedValue(snapshot('batch-2', {
      hasMore: true,
      nextCursor: { sortValue: 2, id: 'batch-2' },
      totalRecords: 2
    }));
    mocks.loadNextBatchManagerPage.mockReturnValue(nextRequest.promise);
    const { result } = renderController();
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    let first;
    let second;
    act(() => {
      first = result.current.loadMoreBatches();
      second = result.current.loadMoreBatches();
    });
    expect(mocks.loadNextBatchManagerPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      nextRequest.resolve({
        items: [{ id: 'batch-1', productId: 'product-a' }],
        nextCursor: null,
        hasMore: false,
        requestedLimit: 50
      });
      await first;
      await second;
    });
    expect(result.current.productBatches).toHaveLength(2);
  });

  it('usa el producto autoritativo de la respuesta al guardar un lote', async () => {
    mocks.loadBatchesForManager.mockResolvedValue(snapshot('batch-1'));
    mocks.saveBatch.mockResolvedValue({
      success: true,
      response: {
        batch: { id: 'batch-1', price: 24.5 },
        product: { id: 'product-a', price: 24.5, serverVersion: 12 }
      }
    });
    const { result } = renderController();
    await waitFor(() => expect(result.current.selectedProduct.id).toBe('product-a'));

    let saveResult;
    await act(async () => {
      saveResult = await result.current.handleSaveBatch({
        id: 'batch-1', productId: 'product-a', price: 24.5, stock: 2, cost: 15, updateGlobalPrice: true
      });
    });

    expect(saveResult.success).toBe(true);
    expect(result.current.selectedProduct).toMatchObject({ price: 24.5, serverVersion: 12 });
  });
});
