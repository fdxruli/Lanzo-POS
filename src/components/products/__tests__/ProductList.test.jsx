// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductList from '../ProductList';

const { queryBatchesByProductIdsAndActive } = vi.hoisted(() => ({
  queryBatchesByProductIdsAndActive: vi.fn(async () => [])
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasBulk: true, hasExpiry: true, hasMinMax: false, hasLabFields: false, hasSKU: false, hasWholesale: false, hasWaste: false, hasDailyPricing: false })
}));
vi.mock('../../../hooks/useDebounce', () => ({ useDebounce: (value) => value }));
vi.mock('../../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: (selector) => selector({ fetchPage: vi.fn(), loadInitialProducts: vi.fn(), hasMore: false, isLoading: false, filters: { status: 'all' }, setFilters: vi.fn() })
}));
vi.mock('../../../services/database', () => ({
  searchProductsInDB: vi.fn(async () => []),
  queryBatchesByProductIdsAndActive
}));
vi.mock('../../../services/products/productCatalogQueryService', () => ({ isInventoryCatalogEligible: () => true }));
vi.mock('../../../services/utils', () => ({ getProductAlerts: () => ({ isLowStock: false }) }));
vi.mock('../../common/LazyImage', () => ({ default: () => <div /> }));
vi.mock('../WasteModal', () => ({ default: () => null }));
vi.mock('../ProductCloudSyncIndicators', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  queryBatchesByProductIdsAndActive.mockReset();
  queryBatchesByProductIdsAndActive.mockResolvedValue([]);
});

describe('ProductList batch-backed grocery details', () => {
  it('uses sale units and the nearest active batch expiry on cards', async () => {
    queryBatchesByProductIdsAndActive.mockResolvedValue([
      { id: 'later', productId: 'rice', isActive: true, expiryDate: '2026-08-20' },
      { id: 'near', productId: 'rice', isActive: true, expiryDate: '2026-08-12', alertTargetDate: '2026-08-12' }
    ]);
    render(<ProductList products={[{
      id: 'rice', name: 'Arroz a granel', categoryId: '', price: 20, cost: 10, stock: 12, trackStock: true,
      saleType: 'bulk', bulkData: { sale: { unit: 'kg' } }, expirationMode: 'SHELF_LIFE', shelfLifeValue: 4, shelfLifeUnit: 'weeks'
    }]} categories={[]} isLoading={false} onEdit={vi.fn()} onDelete={vi.fn()} onToggleStatus={vi.fn()} onManageBatches={vi.fn()} />);

    await waitFor(() => expect(queryBatchesByProductIdsAndActive).toHaveBeenCalledWith(['rice']));
    await waitFor(() => expect(screen.getByText('Próxima caducidad:')).toBeInTheDocument());
    expect(screen.getAllByText('12/08/2026')).toHaveLength(2);
    expect(screen.getByText(/Caduca en \d+ días/)).toBeInTheDocument();
    expect(screen.getByText('Vida útil para nuevas entradas:')).toBeInTheDocument();
    expect(screen.getByText('4 semanas')).toBeInTheDocument();
    expect(screen.getByText('kg')).toBeInTheDocument();
  });
});
