// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductList from '../ProductList';

const mocks = vi.hoisted(() => ({
  queryBatchesByProductIdsAndActive: vi.fn(async () => []),
  searchProductsInDB: vi.fn(async () => []),
  catalogState: {
    filters: { status: 'all', categoryId: null },
    setFilters: vi.fn()
  }
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasBulk: true, hasExpiry: true, hasMinMax: false, hasLabFields: false, hasSKU: false, hasWholesale: false, hasWaste: false, hasDailyPricing: false })
}));
vi.mock('../../../hooks/useDebounce', () => ({ useDebounce: (value) => value }));
vi.mock('../../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: (selector) => selector({
    fetchPage: vi.fn(),
    loadInitialProducts: vi.fn(),
    hasMore: false,
    isLoading: false,
    ...mocks.catalogState
  })
}));
vi.mock('../../../services/database', () => ({
  searchProductsInDB: mocks.searchProductsInDB,
  queryBatchesByProductIdsAndActive: mocks.queryBatchesByProductIdsAndActive
}));
vi.mock('../../../services/products/productCatalogQueryService', () => ({
  INVENTORY_UNCATEGORIZED_FILTER: Object.freeze({ type: 'uncategorized' }),
  isInventoryUncategorizedFilter: (categoryId) => categoryId?.type === 'uncategorized',
  isInventoryCatalogEligible: (product, options = {}) => {
    if (product?.deletedAt || product?.deletedTimestamp) return false;
    const active = product?.isActive !== false;
    if (options.status === 'active' && !active) return false;
    if (options.status === 'inactive' && active) return false;
    const productType = product?.productType ?? product?.product_type ?? null;
    if (options.productType === 'sellable' && productType !== null && productType !== 'sellable') return false;
    const productCategoryId = [product?.categoryId, product?.category_id]
      .find((value) => value !== null && value !== undefined && value !== '') ?? null;
    if (options.categoryId?.type === 'uncategorized') return productCategoryId === null;
    if (options.categoryId !== null && options.categoryId !== undefined) return productCategoryId === options.categoryId;
    return true;
  }
}));
vi.mock('../../../services/utils', () => ({ getProductAlerts: () => ({ isLowStock: false }) }));
vi.mock('../../common/LazyImage', () => ({ default: () => <div /> }));
vi.mock('../WasteModal', () => ({ default: () => null }));
vi.mock('../ProductCloudSyncIndicators', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.queryBatchesByProductIdsAndActive.mockReset();
  mocks.queryBatchesByProductIdsAndActive.mockResolvedValue([]);
});

beforeEach(() => {
  mocks.catalogState.filters = { status: 'all', categoryId: null };
  mocks.catalogState.setFilters.mockReset();
  mocks.searchProductsInDB.mockReset();
  mocks.searchProductsInDB.mockResolvedValue([]);
});

describe('ProductList batch-backed grocery details', () => {
  it('uses sale units and the nearest active batch expiry on cards', async () => {
    const nearestExpiryDate = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
    const laterExpiryDate = new Date(Date.now() + (10 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
    const [year, month, day] = nearestExpiryDate.split('-');
    const formattedNearestExpiryDate = `${day}/${month}/${year}`;
    mocks.queryBatchesByProductIdsAndActive.mockResolvedValue([
      { id: 'later', productId: 'rice', isActive: true, expiryDate: laterExpiryDate },
      { id: 'near', productId: 'rice', isActive: true, expiryDate: nearestExpiryDate, alertTargetDate: nearestExpiryDate }
    ]);
    render(<ProductList products={[{
      id: 'rice', name: 'Arroz a granel', categoryId: '', price: 20, cost: 10, stock: 12, trackStock: true,
      saleType: 'bulk', bulkData: { sale: { unit: 'kg' } }, expirationMode: 'SHELF_LIFE', shelfLifeValue: 4, shelfLifeUnit: 'weeks'
    }]} categories={[]} isLoading={false} onEdit={vi.fn()} onDelete={vi.fn()} onToggleStatus={vi.fn()} onManageBatches={vi.fn()} />);

    await waitFor(() => expect(mocks.queryBatchesByProductIdsAndActive).toHaveBeenCalledWith(['rice']));
    await waitFor(() => expect(screen.getByText('Próxima caducidad:')).toBeInTheDocument());
    expect(screen.getAllByText(formattedNearestExpiryDate)).toHaveLength(2);
    expect(screen.getByText(/Caduca en \d+ días/)).toBeInTheDocument();
    expect(screen.getByText('Vida útil para nuevas entradas:')).toBeInTheDocument();
    expect(screen.getByText('4 semanas')).toBeInTheDocument();
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('filters database search results by category and state at the same time', async () => {
    mocks.catalogState.filters = { status: 'active', categoryId: 'drinks' };
    mocks.searchProductsInDB.mockResolvedValue([
      { id: 'drink', name: 'Agua mineral', categoryId: 'drinks', isActive: true, price: 20, cost: 10, stock: 5 },
      { id: 'food', name: 'Pan dulce', categoryId: 'food', isActive: true, price: 15, cost: 8, stock: 4 },
      { id: 'inactive-drink', name: 'Agua antigua', categoryId: 'drinks', isActive: false, price: 10, cost: 5, stock: 0 }
    ]);
    render(<ProductList products={[]} categories={[{ id: 'drinks', name: 'Bebidas' }]} isLoading={false} />);

    fireEvent.change(screen.getByPlaceholderText(/Buscar: Nombre, Código/i), { target: { value: 'agua' } });

    expect(await screen.findByText('Agua mineral')).toBeInTheDocument();
    await waitFor(() => expect(mocks.searchProductsInDB).toHaveBeenCalledWith('agua', 'active', 'drinks'));
    expect(screen.queryByText('Pan dulce')).not.toBeInTheDocument();
    expect(screen.queryByText('Agua antigua')).not.toBeInTheDocument();
  });

  it('offers all, uncategorized, and active category filters with a non-ID sentinel', () => {
    render(<ProductList products={[]} categories={[{ id: 'drinks', name: 'Bebidas' }]} isLoading={false} />);
    const categoryFilter = screen.getByRole('combobox', { name: 'Filtrar por categoría' });

    expect(screen.getByRole('option', { name: 'Todas las categorías' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sin categoría' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bebidas' })).toBeInTheDocument();
    fireEvent.change(categoryFilter, { target: { value: 'inventory:uncategorized' } });

    expect(mocks.catalogState.setFilters).toHaveBeenCalledWith({
      categoryId: { type: 'uncategorized' }
    });
  });
});
