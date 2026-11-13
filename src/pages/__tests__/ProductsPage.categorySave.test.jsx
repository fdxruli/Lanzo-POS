// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  app: null,
  catalog: null,
  stats: null,
  repository: {
    saveCategory: vi.fn(),
    deleteCategory: vi.fn(),
    getCategoryProductCounts: vi.fn()
  },
  broadcastDBChange: vi.fn(),
  showMessageModal: vi.fn(),
  showConfirmModal: vi.fn()
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(shared.app)
}));
vi.mock('../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: (selector) => selector(shared.catalog)
}));
vi.mock('../../store/useStatsStore', () => ({
  useStatsStore: (selector) => selector(shared.stats)
}));
vi.mock('../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasRecipes: false, hasVariants: false })
}));
vi.mock('../../hooks/useNavigationGuard', () => ({
  useNavigationGuard: () => ({ runWithoutBlocking: (callback) => callback() })
}));
vi.mock('../../hooks/useBotScreenContext', () => ({
  usePublishBotScreen: vi.fn()
}));
vi.mock('../../services/products/productRepository', () => ({
  productRepository: shared.repository
}));
vi.mock('../../services/products/productCatalogEvents', () => ({
  broadcastDBChange: shared.broadcastDBChange
}));
vi.mock('../../services/utils', () => ({
  showConfirmModal: shared.showConfirmModal,
  showMessageModal: shared.showMessageModal
}));
vi.mock('../../components/products/form-v2/ProductFormV2', async () => {
  const React = await import('react');
  return {
    default: function MockProductFormV2({ productToEdit, onOpenCategoryManager }) {
      const [categoryId, setCategoryId] = React.useState('');
      const [productName, setProductName] = React.useState(productToEdit?.name || '');

      return (
        <div>
          <label>
            Nombre del producto
            <input aria-label="Nombre del producto" value={productName} onChange={(event) => setProductName(event.target.value)} />
          </label>
          <label>
            Categoría del producto
            <select aria-label="Categoría del producto" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Sin categoría</option>
              <option value="category-a">QA Categoría A</option>
              <option value="category-b">Categoría B</option>
              <option value="category-b-created">QA Categoría B</option>
            </select>
          </label>
          <button type="button" onClick={() => onOpenCategoryManager((category) => setCategoryId(category.id))}>
            Administrar categorías del producto
          </button>
        </div>
      );
    }
  };
});
vi.mock('../../components/products/ProductList', () => ({
  default: function MockProductList({ onEdit }) {
    return <button type="button" onClick={() => onEdit({ id: 'product-b', name: 'Producto B' })}>Editar producto B</button>;
  }
}));

import ProductsPage from '../ProductsPage';

const PRO_LICENSE = {
  license_key: 'test-pro-license',
  features: { cloud_pos_sync: true, cloud_products_sync: true }
};

const makeCategory = (overrides = {}) => ({
  id: 'category-1',
  name: 'Bebidas',
  color: '#123abc',
  sortOrder: 3,
  serverVersion: 4,
  ...overrides
});

const renderPage = (initialEntry = '/productos?tab=categories') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <ProductsPage />
  </MemoryRouter>
);

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const beginCreate = async (name) => {
  await screen.findByRole('heading', { name: 'Nueva categoría' });
  fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
};

describe('ProductsPage category save flow', () => {
  beforeEach(() => {
    shared.app = {
      companyProfile: { business_type: [] },
      licenseDetails: null,
      canAccess: vi.fn(() => true)
    };
    shared.catalog = {
      categories: [makeCategory()],
      menu: [],
      filters: { productType: 'sellable', categoryId: null },
      setFilters: vi.fn(),
      loadInitialProducts: vi.fn().mockResolvedValue(undefined),
      refreshCategories: vi.fn().mockResolvedValue(undefined)
    };
    shared.stats = { adjustInventoryValue: vi.fn() };
    shared.repository.saveCategory.mockReset();
    shared.repository.deleteCategory.mockReset().mockResolvedValue({ success: true });
    shared.repository.getCategoryProductCounts.mockReset().mockResolvedValue({ complete: false, counts: {} });
    shared.broadcastDBChange.mockReset();
    shared.showMessageModal.mockReset();
    shared.showConfirmModal.mockReset().mockResolvedValue(true);
  });

  afterEach(() => cleanup());

  it('does not assign a delayed category from product A to product B', async () => {
    const pendingSave = createDeferred();
    shared.repository.saveCategory.mockReturnValueOnce(pendingSave.promise);
    renderPage('/productos?tab=add');

    fireEvent.click(await screen.findByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Categoría A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(shared.repository.saveCategory).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Productos (Venta)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar producto B' }));
    const categorySelect = await screen.findByRole('combobox', { name: 'Categoría del producto' });
    fireEvent.change(categorySelect, { target: { value: 'category-b' } });

    fireEvent.click(screen.getByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    pendingSave.resolve({ id: 'category-a', name: 'QA Categoría A' });
    await waitFor(() => expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category-created',
      categoryId: 'category-a'
    })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(categorySelect).toHaveValue('category-b');
    expect(screen.getByLabelText('Nombre del producto')).toHaveValue('Producto B');
  });

  it('does not apply an older save after closing and reopening the new-product form with the same React key', async () => {
    const pendingSaveA = createDeferred();
    const pendingSaveB = createDeferred();
    shared.repository.saveCategory
      .mockReturnValueOnce(pendingSaveA.promise)
      .mockReturnValueOnce(pendingSaveB.promise);
    renderPage('/productos?tab=add');

    fireEvent.click(await screen.findByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Categoría A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(shared.repository.saveCategory).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Productos (Venta)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar Producto' }));
    const categorySelect = await screen.findByRole('combobox', { name: 'Categoría del producto' });
    expect(categorySelect).toHaveValue('');
    fireEvent.change(categorySelect, { target: { value: 'category-b' } });

    fireEvent.click(screen.getByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Categoría B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(shared.repository.saveCategory).toHaveBeenCalledTimes(2));

    pendingSaveB.resolve({ id: 'category-b-created', name: 'QA Categoría B' });
    await waitFor(() => expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category-created',
      categoryId: 'category-b-created'
    })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(categorySelect).toHaveValue('category-b-created');

    pendingSaveA.resolve({ id: 'category-a', name: 'QA Categoría A' });
    await waitFor(() => expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category-created',
      categoryId: 'category-a'
    })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(categorySelect).toHaveValue('category-b-created');
  });

  it('selects a category created in the current form session and preserves other product fields', async () => {
    const pendingSave = createDeferred();
    shared.repository.saveCategory.mockReturnValueOnce(pendingSave.promise);
    renderPage('/productos?tab=add');

    const productName = await screen.findByLabelText('Nombre del producto');
    fireEvent.change(productName, { target: { value: 'Producto sin cambios' } });
    fireEvent.click(screen.getByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Categoría normal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(shared.repository.saveCategory).toHaveBeenCalledOnce());
    pendingSave.resolve({ id: 'category-a', name: 'QA Categoría normal' });

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Categoría del producto' })).toHaveValue('category-a'));
    expect(productName).toHaveValue('Producto sin cambios');
  });

  it('accepts a Free category object without success:true and broadcasts after persistence', async () => {
    shared.repository.saveCategory.mockResolvedValue({
      id: 'category-new',
      name: 'QA Bebidas',
      color: '#3b82f6',
      sortOrder: 0
    });
    renderPage();
    await beginCreate('QA Bebidas');

    await waitFor(() => expect(shared.broadcastDBChange).toHaveBeenCalledOnce());
    expect(shared.catalog.refreshCategories).toHaveBeenCalled();
    expect(shared.catalog.loadInitialProducts).toHaveBeenCalled();
    expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category-created',
      categoryId: 'category-new',
      categoryName: 'QA Bebidas'
    }));
    expect(screen.getByRole('status')).toHaveTextContent('Categoría guardada.');
  });

  it('refreshes the Cloud category after a PRO conflict without clearing or saving the stale edit', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'La categoria fue modificada en otro dispositivo.',
      response: {
        server_version: 9,
        category: { id: 'category-1', name: 'Bebidas Cloud', color: '#abcdef', sort_order: 8, server_version: 9 }
      }
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Nueva categoría' });
    fireEvent.click(screen.getByRole('button', { name: 'Editar Bebidas' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeInTheDocument());
    shared.catalog.loadInitialProducts.mockClear();
    shared.catalog.refreshCategories.mockClear();

    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Bebidas actualizadas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cambió en otro dispositivo');
    expect(screen.getByRole('alert')).toHaveTextContent('vuelve a abrir la categoría');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Bebidas actualizadas');
    expect(shared.repository.saveCategory).toHaveBeenCalledWith(expect.objectContaining({
      id: 'category-1',
      serverVersion: 4,
      name: 'Bebidas actualizadas'
    }));
    expect(shared.catalog.refreshCategories).toHaveBeenCalledOnce();
    expect(shared.catalog.loadInitialProducts).not.toHaveBeenCalled();
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
    expect(shared.showMessageModal).not.toHaveBeenCalled();
  });

  it('shows a PRO duplicate rejection inline without announcing a successful category event', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: false,
      code: 'DUPLICATE_CATEGORY_NAME',
      message: 'Ya existe una categoria activa con este nombre.',
      field: 'name'
    });
    renderPage();
    await beginCreate('Bebidas repetidas');

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una categoria activa');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Bebidas repetidas');
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
    expect(shared.catalog.refreshCategories).not.toHaveBeenCalled();
  });

  it('explains PRO authorization rejections without clearing the form', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: false,
      code: 'PRODUCTS_WRITE_PERMISSION_REQUIRED',
      message: 'PRODUCTS_WRITE_PERMISSION_REQUIRED'
    });
    renderPage();
    await beginCreate('QA permiso');

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes autorización');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('QA permiso');
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
  });

  it('keeps a Free form after a local database exception without announcing success', async () => {
    const error = new Error('IndexedDB write failed');
    error.name = 'ConstraintError';
    shared.repository.saveCategory.mockRejectedValue(error);
    renderPage();
    await screen.findByRole('heading', { name: 'Nueva categoría' });
    shared.catalog.loadInitialProducts.mockClear();

    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('IndexedDB write failed');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('QA local');
    expect(shared.catalog.refreshCategories).not.toHaveBeenCalled();
    expect(shared.catalog.loadInitialProducts).not.toHaveBeenCalled();
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
  });

  it('shows an explicit cloud confirmation only after the PRO repository resolves successfully', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: true,
      id: 'category-new',
      name: 'QA PRO',
      color: '#3b82f6',
      sortOrder: 0
    });
    renderPage();
    await beginCreate('QA PRO');

    expect(await screen.findByRole('status')).toHaveTextContent('Categoría guardada y confirmada en la nube.');
    expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'category-created' }));
  });

  it('rejects a cloud category result that lacks the RPC confirmation flag', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      id: 'category-new',
      name: 'QA sin confirmar'
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Nueva categoría' });
    shared.catalog.loadInitialProducts.mockClear();

    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA sin confirmar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La nube no confirmó el guardado');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('QA sin confirmar');
    expect(shared.catalog.refreshCategories).not.toHaveBeenCalled();
    expect(shared.catalog.loadInitialProducts).not.toHaveBeenCalled();
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
  });

  it('labels accepted PRO offline writes as pending synchronization', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      id: 'category-new',
      name: 'QA pendiente',
      success: true,
      pending: true
    });
    renderPage();
    await beginCreate('QA pendiente');

    expect(await screen.findByRole('status')).toHaveTextContent('guardada en este dispositivo');
    expect(screen.getByRole('status')).toHaveTextContent('sincronización está pendiente');
    expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'category-created' }));
  });

  it('explains the category and product impact before deletion when the count is reliable', async () => {
    shared.repository.getCategoryProductCounts.mockResolvedValue({
      complete: true,
      counts: { 'category-1': 12 }
    });
    renderPage();

    expect(await screen.findByText('12 productos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Bebidas' }));

    await waitFor(() => expect(shared.showConfirmModal).toHaveBeenCalledWith(
      'Los 12 productos asociados quedarán sin categoría. Los productos no se eliminarán.',
      expect.objectContaining({
        title: '¿Eliminar «Bebidas»?',
        confirmButtonText: 'Eliminar categoría',
        cancelButtonText: 'Cancelar'
      })
    ));
    await waitFor(() => expect(shared.repository.deleteCategory).toHaveBeenCalledWith('category-1'));
  });

  it('uses a generic deletion warning when the category count is not reliable', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Bebidas' }));

    await waitFor(() => expect(shared.showConfirmModal).toHaveBeenCalledWith(
      'Los productos asociados quedarán sin categoría. Los productos no se eliminarán.',
      expect.objectContaining({ title: '¿Eliminar «Bebidas»?' })
    ));
    expect(shared.showConfirmModal.mock.calls[0][0]).not.toContain('0 productos');
  });
});
