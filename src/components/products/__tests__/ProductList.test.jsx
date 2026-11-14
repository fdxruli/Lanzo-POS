// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductList from '../ProductList';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { searchProductsInTable } from '../../../services/db/productSearch';
import { buildProductSearchFields } from '../../../services/db/productSearchIndex';

const mocks = vi.hoisted(() => ({
  queryBatchesByProductIdsAndActive: vi.fn(async () => []),
  searchProductsInDB: vi.fn(async () => []),
  catalogState: {
    filters: { status: 'all', categoryId: null },
    setFilters: vi.fn(),
    fetchPage: vi.fn(),
    loadInitialProducts: vi.fn(),
    hasMore: false,
    isLoading: false
  }
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasBulk: true, hasExpiry: true, hasMinMax: false, hasLabFields: false, hasSKU: false, hasWholesale: false, hasWaste: false, hasDailyPricing: false })
}));
vi.mock('../../../hooks/useDebounce', () => ({ useDebounce: (value) => value }));
vi.mock('../../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: (selector) => selector(mocks.catalogState)
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
  vi.restoreAllMocks();
  mocks.queryBatchesByProductIdsAndActive.mockReset();
  mocks.queryBatchesByProductIdsAndActive.mockResolvedValue([]);
});

beforeEach(() => {
  mocks.catalogState.filters = { status: 'all', categoryId: null };
  mocks.catalogState.hasMore = false;
  mocks.catalogState.isLoading = false;
  mocks.catalogState.setFilters.mockReset();
  mocks.catalogState.fetchPage.mockReset();
  mocks.catalogState.loadInitialProducts.mockReset();
  mocks.searchProductsInDB.mockReset();
  mocks.searchProductsInDB.mockResolvedValue([]);
});

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

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
    await waitFor(() => expect(mocks.searchProductsInDB).toHaveBeenCalledWith('agua', 'active', 'drinks', { eligible: expect.any(Function) }));
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

  it('keeps the search input and filters available while a search is pending without results', () => {
    mocks.searchProductsInDB.mockReturnValueOnce(createDeferred().promise);
    render(<ProductList products={[]} categories={[{ id: 'drinks', name: 'Bebidas' }]} isLoading={false} />);

    const input = screen.getByRole('textbox', { name: 'Buscar productos' });
    fireEvent.change(input, { target: { value: 'lento' } });

    expect(input).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filtrar por estado' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filtrar por categoría' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpiar búsqueda' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Buscando productos...');
  });

  it('recovers from a search that never resolves and allows retry', async () => {
    vi.useFakeTimers();
    mocks.searchProductsInDB
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce([{ id: 'recovered', name: 'Resultado recuperado', price: 10, stock: 5 }]);
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'lento' } });

    expect(screen.getByRole('status')).toHaveTextContent('Buscando productos...');
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    vi.useRealTimers();

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron buscar los productos. Intenta nuevamente.');
    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Resultado recuperado')).toBeInTheDocument();
    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a search error after rejection and retries successfully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.searchProductsInDB
      .mockRejectedValueOnce(new Error('internal database details'))
      .mockResolvedValueOnce([{ id: 'retry-result', name: 'Resultado reintentado', price: 10, stock: 5 }]);
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'agua' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron buscar los productos. Intenta nuevamente.');
    expect(screen.queryByText('internal database details')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Resultado reintentado')).toBeInTheDocument();
    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('clears a pending query, restores the paged catalog, and skips an empty search', () => {
    mocks.searchProductsInDB.mockReturnValueOnce(createDeferred().promise);
    const products = [{ id: 'page', name: 'Producto paginado', price: 10, stock: 5 }];
    render(<ProductList products={products} categories={[]} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'pendiente' } });
    expect(screen.getByRole('status')).toHaveTextContent('Buscando productos...');

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));

    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toHaveFocus();
    expect(screen.getByText('Producto paginado')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh search when filters change during a pending query', async () => {
    mocks.searchProductsInDB
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce([
        { id: 'inactive', name: 'Resultado inactivo', isActive: false, price: 10, stock: 5 },
        { id: 'active', name: 'Resultado activo antiguo', isActive: true, price: 10, stock: 5 }
      ]);
    mocks.catalogState.setFilters.mockImplementation((patch) => {
      mocks.catalogState.filters = { ...mocks.catalogState.filters, ...patch };
    });
    const props = { products: [], categories: [], isLoading: false };
    const { rerender } = render(<ProductList {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'filtro' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por estado' }), { target: { value: 'inactive' } });
    rerender(<ProductList {...props} />);

    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(2);
    expect(mocks.searchProductsInDB).toHaveBeenLastCalledWith('filtro', 'inactive', null, { eligible: expect.any(Function) });
    expect(await screen.findByText('Resultado inactivo')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filtrar por estado' })).toHaveValue('inactive');
    expect(screen.queryByText('Resultado activo antiguo')).not.toBeInTheDocument();
  });

  it('shows an empty state, not an error, when search has no matches', async () => {
    mocks.searchProductsInDB.mockResolvedValueOnce([]);
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'sin coincidencias' } });

    expect(await screen.findByText('No se encontraron productos')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('restores catalog pagination after clearing a completed search', async () => {
    mocks.catalogState.hasMore = true;
    mocks.searchProductsInDB.mockResolvedValueOnce([
      { id: 'search', name: 'Producto encontrado', price: 10, stock: 5 }
    ]);
    const props = { products: [{ id: 'page', name: 'Producto paginado', price: 10, stock: 5 }], categories: [], isLoading: false };
    render(<ProductList {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'encontrado' } });
    expect(await screen.findByText('Producto encontrado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));

    expect(screen.getByText('Producto paginado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más productos' }));
    expect(mocks.catalogState.fetchPage).toHaveBeenCalledWith('next');
  });
});


it('F-04 finds sellable inventory after 60 ingredients using indexed search', async () => {
  const database = new Dexie(`f04-inventory-${crypto.randomUUID()}`, { indexedDB, IDBKeyRange });
  database.version(1).stores({ menu: 'id, name_lower, *search_tokens, barcode_normalized, sku_normalized, *search_ngrams' });
  try {
    await database.open();
    await database.table('menu').bulkPut(Array.from({ length: 65 }, (_, i) => {
      const product = { id: String(i).padStart(3, '0'), name: `QA AGUA ${String(i).padStart(3, '0')}`,
        isActive: true, productType: i < 60 ? 'ingredient' : 'sellable', categoryId: 'drinks', price: 10, stock: 5 };
      return { ...product, ...buildProductSearchFields(product) };
    }));
    mocks.catalogState.filters = { status: 'active', categoryId: 'drinks' };
    mocks.searchProductsInDB.mockImplementation((term, status, category, options) =>
      searchProductsInTable(database.table('menu'), term, status, 50, category, options));
    render(<ProductList products={[]} categories={[{ id: 'drinks', name: 'Bebidas' }]} isLoading={false} />);
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'QA AGUA' } });
    await waitFor(() => expect(screen.getByText('QA AGUA 064')).toBeInTheDocument(), { timeout: 1000 });
    for (let i = 60; i < 65; i++) expect(screen.getByText(`QA AGUA 0${i}`)).toBeInTheDocument();
  } finally { cleanup(); await database.delete(); }
});

it('ignores a previous inventory response after the term changes and restores pagination for empty text', async () => {
  let finishOld;
  mocks.searchProductsInDB.mockResolvedValueOnce([{ id: 'seed', name: 'Seed result', price: 10, stock: 5 }]);
  const props = { products: [{ id: 'page', name: 'Paged catalog', price: 10, stock: 5 }], categories: [], isLoading: false };
  render(<ProductList {...props} />);
  fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'seed' } });
  expect(await screen.findByText('Seed result')).toBeInTheDocument();
  const input = screen.getByPlaceholderText(/buscar/i);
  mocks.searchProductsInDB.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  fireEvent.change(input, { target: { value: 'old' } });
  await waitFor(() => expect(finishOld).toBeTypeOf('function'));
  mocks.searchProductsInDB.mockResolvedValue([{ id: 'new', name: 'New result', price: 10, stock: 5 }]);
  fireEvent.change(input, { target: { value: 'new' } });
  expect(await screen.findByText('New result')).toBeInTheDocument();
  act(() => finishOld([{ id: 'old', name: 'Old result', price: 10, stock: 5 }]));
  await waitFor(() => expect(screen.getByText('New result')).toBeInTheDocument());
  expect(screen.queryByText('Old result')).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: '' } });
  expect(await screen.findByText('Paged catalog')).toBeInTheDocument();
});
