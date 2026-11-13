// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  app: null,
  catalog: null,
  stats: null,
  repository: { saveCategory: vi.fn() },
  broadcastDBChange: vi.fn(),
  showMessageModal: vi.fn()
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
  showConfirmModal: vi.fn(),
  showMessageModal: shared.showMessageModal
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

const renderPage = () => render(
  <MemoryRouter initialEntries={['/productos?tab=categories']}>
    <ProductsPage />
  </MemoryRouter>
);

const beginCreate = async (name) => {
  await screen.findByRole('heading', { name: 'Nueva categoria' });
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
    shared.broadcastDBChange.mockReset();
    shared.showMessageModal.mockReset();
  });

  afterEach(() => cleanup());

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

  it('does not refresh, broadcast, or clear the edit form after a PRO conflict', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'La categoria fue modificada en otro dispositivo.',
      response: { server_version: 9 }
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Nueva categoria' });
    fireEvent.click(screen.getByRole('button', { name: 'Editar Bebidas' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeInTheDocument());
    shared.catalog.loadInitialProducts.mockClear();
    shared.catalog.refreshCategories.mockClear();

    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Bebidas actualizadas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('modificada en otro dispositivo');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Bebidas actualizadas');
    expect(shared.repository.saveCategory).toHaveBeenCalledWith(expect.objectContaining({
      id: 'category-1',
      serverVersion: 4,
      name: 'Bebidas actualizadas'
    }));
    expect(shared.catalog.refreshCategories).not.toHaveBeenCalled();
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
    await screen.findByRole('heading', { name: 'Nueva categoria' });
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
    await screen.findByRole('heading', { name: 'Nueva categoria' });
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
});
