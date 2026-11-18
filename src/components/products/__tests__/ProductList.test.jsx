// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
vi.mock('../InventoryEntryModal', () => ({ default: ({ product }) => (
  <div role="dialog" aria-label="Recepción de medicamento">Formulario para {product.name}</div>
) }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('Agua mineral')).toBeInTheDocument();
    await waitFor(() => expect(mocks.searchProductsInDB).toHaveBeenCalledWith('agua', 'active', 'drinks', { eligible: expect.any(Function) }));
    expect(screen.queryByText('Pan dulce')).not.toBeInTheDocument();
    expect(screen.queryByText('Agua antigua')).not.toBeInTheDocument();
  });

  it('does not search while the user types slowly or waits between characters', () => {
    vi.useFakeTimers();
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    const input = screen.getByRole('textbox', { name: 'Buscar productos' });

    for (const value of ['C', 'Co', 'Coc', 'Coca Cola 600']) {
      fireEvent.change(input, { target: { value } });
      act(() => vi.advanceTimersByTime(400));
      expect(mocks.searchProductsInDB).not.toHaveBeenCalled();
    }

    expect(screen.queryByText('Buscando productos...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeEnabled();
  });

  it('executes one search with the complete term when Buscar is pressed', async () => {
    mocks.searchProductsInDB.mockResolvedValueOnce([
      { id: 'coca', name: 'Coca Cola 600', price: 20, stock: 5 }
    ]);
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'Coca Cola 600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('Coca Cola 600')).toBeInTheDocument();
    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(1);
    expect(mocks.searchProductsInDB).toHaveBeenCalledWith('Coca Cola 600', 'all', null, { eligible: expect.any(Function) });
  });

  it('submits once with Enter and skips empty or whitespace-only terms', async () => {
    const user = userEvent.setup();
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    const input = screen.getByRole('textbox', { name: 'Buscar productos' });

    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('search', { name: 'Buscar productos' }));
    expect(mocks.searchProductsInDB).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'SKU 90001{Enter}');

    await waitFor(() => expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(1));
    expect(mocks.searchProductsInDB).toHaveBeenCalledWith('SKU 90001', 'all', null, { eligible: expect.any(Function) });
    expect(input).toHaveAttribute('enterKeyHint', 'search');
  });

  it('keeps the last applied results while editing and updates them on the next search', async () => {
    mocks.searchProductsInDB
      .mockResolvedValueOnce([{ id: 'water', name: 'Agua mineral', price: 10, stock: 5 }])
      .mockResolvedValueOnce([{ id: 'soda', name: 'Coca Cola 600', price: 20, stock: 5 }]);
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    const input = screen.getByRole('textbox', { name: 'Buscar productos' });

    fireEvent.change(input, { target: { value: 'agua' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Agua mineral')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Coca Cola 600' } });
    expect(screen.getByText('Agua mineral')).toBeInTheDocument();
    expect(screen.getByText('Consulta aplicada: «agua». Pulsa Buscar para aplicar el texto editado.')).toBeInTheDocument();
    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Coca Cola 600')).toBeInTheDocument();
    expect(screen.queryByText('Agua mineral')).not.toBeInTheDocument();
    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(2);
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
    expect(mocks.searchProductsInDB).not.toHaveBeenCalled();
  });

  it('keeps the search input and filters available while a search is pending without results', () => {
    mocks.searchProductsInDB.mockReturnValueOnce(createDeferred().promise);
    render(<ProductList products={[]} categories={[{ id: 'drinks', name: 'Bebidas' }]} isLoading={false} />);

    const input = screen.getByRole('textbox', { name: 'Buscar productos' });
    fireEvent.change(input, { target: { value: 'lento' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(input).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filtrar por estado' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filtrar por categoría' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpiar búsqueda' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Buscando productos...');
  });

  it('recovers from a search timeout and retries the applied term, not the edited text', async () => {
    vi.useFakeTimers();
    mocks.searchProductsInDB
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce([{ id: 'recovered', name: 'Resultado recuperado', price: 10, stock: 5 }]);
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'lento' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(screen.getByRole('status')).toHaveTextContent('Buscando productos...');
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    vi.useRealTimers();

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron buscar los productos. Intenta nuevamente.');
    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'todavía sin enviar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Resultado recuperado')).toBeInTheDocument();
    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(2);
    expect(mocks.searchProductsInDB).toHaveBeenLastCalledWith('lento', 'all', null, { eligible: expect.any(Function) });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a search error after rejection and retries successfully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.searchProductsInDB
      .mockRejectedValueOnce(new Error('internal database details'))
      .mockResolvedValueOnce([{ id: 'retry-result', name: 'Resultado reintentado', price: 10, stock: 5 }]);
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'agua' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Buscando productos...');

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));

    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Buscar productos' })).toHaveFocus();
    expect(screen.getByText('Producto paginado')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh search when filters change during a pending query', async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    mocks.searchProductsInDB
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise)
      .mockResolvedValueOnce([
        { id: 'inactive', name: 'Resultado inactivo', categoryId: 'drinks', isActive: false, price: 10, stock: 5 },
        { id: 'wrong-category', name: 'Resultado de otra categoría', categoryId: 'food', isActive: false, price: 10, stock: 5 }
      ]);
    mocks.catalogState.setFilters.mockImplementation((patch) => {
      mocks.catalogState.filters = { ...mocks.catalogState.filters, ...patch };
    });
    const props = { products: [], categories: [{ id: 'drinks', name: 'Bebidas' }], isLoading: false };
    const { rerender } = render(<ProductList {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'filtro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por estado' }), { target: { value: 'inactive' } });
    rerender(<ProductList {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por categoría' }), { target: { value: 'category:drinks' } });
    rerender(<ProductList {...props} />);

    expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(3);
    expect(mocks.searchProductsInDB).toHaveBeenLastCalledWith('filtro', 'inactive', 'drinks', { eligible: expect.any(Function) });
    expect(await screen.findByText('Resultado inactivo')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filtrar por estado' })).toHaveValue('inactive');
    expect(screen.getByRole('combobox', { name: 'Filtrar por categoría' })).toHaveValue('category:drinks');
    expect(screen.queryByText('Resultado de otra categoría')).not.toBeInTheDocument();

    await act(async () => {
      firstRequest.resolve([{ id: 'stale-first', name: 'Respuesta de filtro anterior', categoryId: 'drinks', isActive: false, price: 10, stock: 5 }]);
      secondRequest.resolve([{ id: 'stale-second', name: 'Respuesta de filtro intermedio', categoryId: 'drinks', isActive: false, price: 10, stock: 5 }]);
      await Promise.resolve();
    });
    expect(screen.getByText('Resultado inactivo')).toBeInTheDocument();
    expect(screen.queryByText('Respuesta de filtro anterior')).not.toBeInTheDocument();
    expect(screen.queryByText('Respuesta de filtro intermedio')).not.toBeInTheDocument();
  });

  it('shows an empty state, not an error, when search has no matches', async () => {
    mocks.searchProductsInDB.mockResolvedValueOnce([]);
    render(<ProductList products={[]} categories={[]} isLoading={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar productos' }), { target: { value: 'sin coincidencias' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Producto encontrado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));

    expect(screen.getByText('Producto paginado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más productos' }));
    expect(mocks.catalogState.fetchPage).toHaveBeenCalledWith('next');
  });
});

describe('ProductList inventory entry availability', () => {
  const medicine = (overrides = {}) => ({
    id: 'medicine-vi', name: 'Medicamento VI', trackStock: true, isActive: true,
    recipe: [], batchManagement: { enabled: true },
    metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } },
    ...overrides
  });

  it.each(['Free/Local', 'PRO/Nube'])('offers and opens the medicine receipt form for %s', async () => {
    render(<ProductList products={[medicine()]} categories={[]} isLoading={false} />);

    const receive = screen.getByRole('button', { name: '＋ Recibir medicamento' });
    expect(receive).toBeEnabled();
    fireEvent.click(receive);
    expect(await screen.findByRole('dialog', { name: 'Recepción de medicamento' }))
      .toHaveTextContent('Medicamento VI');
  });

  it.each([
    ['recipe: []', { recipe: [] }, true],
    ['recipe: null', { recipe: null }, true],
    ['recipe ausente', { recipe: undefined }, true],
    ['recipe con ingredientes', { recipe: [{ ingredientId: 'ingredient-1', quantity: 1 }] }, false]
  ])('matches service recipe semantics for %s', (_label, recipe, visible) => {
    const product = medicine(recipe);
    if (recipe.recipe === undefined) delete product.recipe;
    render(<ProductList products={[product]} categories={[]} isLoading={false} />);

    const button = screen.queryByRole('button', { name: '＋ Recibir medicamento' });
    expect(Boolean(button)).toBe(visible);
  });

  it.each(['I', 'II', 'III'])('keeps controlled fraction %s inactive and its receipt action disabled', (fraction) => {
    render(<ProductList products={[medicine({
      isActive: false,
      metadata: { pharmacy: { kind: 'medicine', fraction, status: 'confirmed' } }
    })]} categories={[]} isLoading={false} />);
    expect(screen.getByRole('button', { name: '＋ Recibir medicamento' })).toBeDisabled();
  });

  it('keeps pending and inactive products disabled, and offers regular stock to a pharmacy other item', () => {
    const pending = medicine({ isActive: false, metadata: { pharmacy: { kind: 'medicine', status: 'pending' } } });
    const other = medicine({ id: 'thermometer', name: 'Termómetro', metadata: { pharmacy: { kind: 'other', status: 'confirmed' } } });
    render(<ProductList products={[pending, other]} categories={[]} isLoading={false} />);

    expect(screen.getByRole('button', { name: '＋ Recibir medicamento' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '＋ Agregar existencia' })).toBeEnabled();
  });

  it('does not offer stock entries without tracking, for recipe dishes, or without inventory permission', () => {
    const products = [
      medicine({ id: 'not-tracked', trackStock: false }),
      medicine({ id: 'recipe-dish', recipe: [{ ingredientId: 'rice', quantity: 1 }] }),
      medicine({ id: 'general', metadata: {} })
    ];
    const { rerender } = render(<ProductList products={products} categories={[]} isLoading={false} canManageInventory={true} />);
    expect(screen.queryByRole('button', { name: '＋ Recibir medicamento' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ Agregar existencia' })).toBeEnabled();
    rerender(<ProductList products={[medicine()]} categories={[]} isLoading={false} canManageInventory={false} />);
    expect(screen.queryByRole('button', { name: '＋ Recibir medicamento' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(screen.getByText('QA AGUA 064')).toBeInTheDocument(), { timeout: 1000 });
    for (let i = 60; i < 65; i++) expect(screen.getByText(`QA AGUA 0${i}`)).toBeInTheDocument();
  } finally { cleanup(); await database.delete(); }
});

it('ignores an older submitted response and restores pagination when cleared', async () => {
  const oldRequest = createDeferred();
  mocks.searchProductsInDB.mockResolvedValueOnce([{ id: 'seed', name: 'Seed result', price: 10, stock: 5 }]);
  const props = { products: [{ id: 'page', name: 'Paged catalog', price: 10, stock: 5 }], categories: [], isLoading: false };
  render(<ProductList {...props} />);
  const input = screen.getByPlaceholderText(/buscar/i);
  fireEvent.change(input, { target: { value: 'seed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  expect(await screen.findByText('Seed result')).toBeInTheDocument();

  mocks.searchProductsInDB.mockReturnValueOnce(oldRequest.promise);
  fireEvent.change(input, { target: { value: 'old' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  await waitFor(() => expect(mocks.searchProductsInDB).toHaveBeenCalledTimes(2));

  mocks.searchProductsInDB.mockResolvedValueOnce([{ id: 'new', name: 'New result', price: 10, stock: 5 }]);
  fireEvent.change(input, { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  expect(await screen.findByText('New result')).toBeInTheDocument();
  await act(async () => {
    oldRequest.resolve([{ id: 'old', name: 'Old result', price: 10, stock: 5 }]);
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByText('New result')).toBeInTheDocument());
  expect(screen.queryByText('Old result')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
  expect(await screen.findByText('Paged catalog')).toBeInTheDocument();
});
