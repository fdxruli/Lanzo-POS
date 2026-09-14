// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EcommercePortalSettings from '../EcommercePortalSettings';
import { useAppStore } from '../../../store/useAppStore';
import {
  getEcommercePortal,
  listPublishedProducts
} from '../../../services/ecommerce/ecommerceAdminService';
import { productRepository } from '../../../services/products/productRepository';

vi.mock('../../../services/ecommerce/ecommerceAdminService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getEcommercePortal: vi.fn(),
    listPublishedProducts: vi.fn(),
    saveEcommercePortal: vi.fn(),
    savePublishedProduct: vi.fn(),
    setProductPublished: vi.fn()
  };
});

vi.mock('../../../services/products/productRepository', () => ({
  productRepository: {
    listProductsPage: vi.fn(),
    listCategories: vi.fn(),
    getProductById: vi.fn()
  }
}));

vi.mock('../EcommerceCatalogSyncPanel', () => ({
  default: () => null,
  EcommerceCatalogSyncBadge: () => null
}));
vi.mock('../EcommerceBusinessInformationPanel', () => ({ default: () => null }));
vi.mock('../EcommerceOperatingHoursSettings', () => ({ default: () => null }));
vi.mock('../EcommerceOrderPauseControl', () => ({ default: () => null }));
vi.mock('../EcommercePortalCustomizationPanel', () => ({ default: () => null }));
vi.mock('../EcommerceSiteBuilderFoundation', () => ({ default: () => null }));

const portal = {
  id: 'portal-1',
  name: 'Negocio de prueba',
  slug: 'negocio-prueba',
  status: 'draft',
  whatsappPhone: '529610000000',
  addressStreet: 'Calle 1',
  addressNeighborhood: 'Centro',
  addressMunicipality: 'Tuxtla Gutiérrez',
  addressState: 'Chiapas',
  addressPostalCode: '29000',
  pickupEnabled: true,
  deliveryEnabled: false,
  minOrderTotal: 0
};

const productOne = {
  id: 'product-1',
  name: 'Producto Uno',
  description: 'Descripción uno',
  price: 25,
  categoryId: 'category-1',
  trackStock: true,
  isActive: true
};
const productTwo = {
  id: 'product-2',
  name: 'Producto Dos',
  description: 'Descripción dos',
  price: 40,
  categoryId: 'category-2',
  trackStock: false,
  isActive: true
};
const staleProduct = {
  id: 'product-stale',
  name: 'Producto Stale',
  description: 'Respuesta vieja',
  price: 10,
  categoryId: 'category-1',
  isActive: true
};

const AUTHORIZED_ECOMMERCE_LICENSE = {
  license_key: 'license-fixture',
  features: { ecommerce_portal_enabled: true }
};

const freePortalResponse = {
  success: true,
  portal,
  plan: { code: 'free_trial', name: 'Plan Free' },
  features: {
    customSlug: false,
    deliveryPickupSettings: 'basic',
    maxPublishedProducts: 10,
    cloudCatalogSource: false,
    stockVisibility: false
  }
};

const proPortalResponse = {
  success: true,
  portal,
  plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
  features: {
    customSlug: true,
    deliveryPickupSettings: 'advanced',
    maxPublishedProducts: -1,
    cloudCatalogSource: true,
    stockVisibility: true
  }
};

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const getProductSelect = () => screen.getAllByRole('combobox')[0];

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const setAuthorizedStore = () => {
  useAppStore.setState({
    companyProfile: { name: 'Negocio de prueba', business_type: 'abarrotes' },
    canAccess: vi.fn(() => true),
    licenseDetails: AUTHORIZED_ECOMMERCE_LICENSE,
    currentDeviceRole: 'admin',
    currentStaffUser: null,
    _isInitializing: false,
    ecommercePublishedStockAlertSnapshot: { products: [] },
    ecommercePublishedStockAlertLoading: false,
    loadEcommercePublishedStockAlerts: vi.fn(async () => ({ success: true })),
    invalidateEcommercePublishedStockAlerts: vi.fn(),
    reconcileEcommercePublishedStockAlertProducts: vi.fn()
  });
};

const renderCatalog = async () => {
  render(<EcommercePortalSettings requestedSection="catalog" />);
  await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
  await screen.findByRole('button', { name: 'Publicar producto' });
};

const openPublishModal = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Publicar producto' }));
  await screen.findByRole('dialog', { name: 'Publicar producto' });
};

beforeEach(() => {
  vi.clearAllMocks();
  setAuthorizedStore();
  getEcommercePortal.mockResolvedValue(freePortalResponse);
  listPublishedProducts.mockResolvedValue({ success: true, products: [] });
  productRepository.listCategories.mockResolvedValue([
    { id: 'category-1', name: 'General' },
    { id: 'category-2', name: 'Especial' }
  ]);
  productRepository.listProductsPage.mockResolvedValue({
    data: [productOne],
    nextCursor: 'cursor-2'
  });
  productRepository.getProductById.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  useAppStore.setState({
    currentDeviceRole: null,
    currentStaffUser: null,
    licenseDetails: null,
    companyProfile: null
  });
});

describe('EcommercePortalSettings + EcommerceProductPublishModal catalog lifecycle', () => {
  it.each([
    ['FREE', freePortalResponse],
    ['PRO', proPortalResponse]
  ])('preloads once and preserves selection after search for %s without background button flicker', async (_planName, portalResponse) => {
    getEcommercePortal.mockResolvedValue(portalResponse);
    await renderCatalog();
    await openPublishModal();

    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(1);
    await act(async () => delay(300));
    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(1);

    fireEvent.change(getProductSelect(), {
      target: { value: productOne.id }
    });
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();

    const searchRequest = deferred();
    productRepository.listProductsPage.mockImplementationOnce(() => searchRequest.promise);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'dos' }
    });
    await act(async () => delay(275));

    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Cargando productos…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar producto' }).disabled).toBe(false);

    await act(async () => {
      searchRequest.resolve({ data: [productTwo], nextCursor: null });
      await Promise.resolve();
    });

    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Producto Uno/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    const visibleResult = screen.getByRole('button', { name: 'Seleccionar Producto Dos' });
    expect(visibleResult).toBeInTheDocument();
    expect(visibleResult).toHaveTextContent('$40.00');
    fireEvent.click(visibleResult);
    expect(getProductSelect().value).toBe(productTwo.id);
    expect(screen.getByDisplayValue(productTwo.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productTwo.price))).toBeInTheDocument();
  });

  it('ignores a stale search response that resolves after the newest request', async () => {
    await renderCatalog();
    await openPublishModal();

    const firstSearch = deferred();
    const secondSearch = deferred();
    productRepository.listProductsPage
      .mockImplementationOnce(() => firstSearch.promise)
      .mockImplementationOnce(() => secondSearch.promise);

    const searchInput = screen.getByPlaceholderText('Buscar por nombre, código o SKU');
    fireEvent.change(searchInput, { target: { value: 'pro' } });
    await act(async () => delay(275));
    fireEvent.change(searchInput, { target: { value: 'producto' } });
    await act(async () => delay(275));

    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(3);

    await act(async () => {
      secondSearch.resolve({ data: [productTwo], nextCursor: null });
      await Promise.resolve();
    });
    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar Producto Dos' })).toBeInTheDocument();

    await act(async () => {
      firstSearch.resolve({ data: [staleProduct], nextCursor: null });
      await Promise.resolve();
    });

    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar Producto Dos' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seleccionar Producto Stale' })).toBeNull();
  });

  it('releases stale load-more loading after a newer search wins the catalog race', async () => {
    await renderCatalog();
    await openPublishModal();
    await screen.findByRole('option', { name: /Producto Uno/ });

    fireEvent.change(getProductSelect(), {
      target: { value: productOne.id }
    });
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();

    const loadMoreRequest = deferred();
    const searchRequest = deferred();
    productRepository.listProductsPage
      .mockImplementationOnce(() => loadMoreRequest.promise)
      .mockImplementationOnce(() => searchRequest.promise);

    const loadMoreButton = screen.getByRole('button', { name: 'Cargar más productos' });
    fireEvent.click(loadMoreButton);
    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Cargando productos…')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'producto' }
    });
    await act(async () => delay(275));
    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(3);

    await act(async () => {
      searchRequest.resolve({ data: [productTwo], nextCursor: 'search-cursor' });
      await Promise.resolve();
    });

    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.getByText('Cargando productos…')).toBeInTheDocument();

    await act(async () => {
      loadMoreRequest.resolve({ data: [staleProduct], nextCursor: 'stale-cursor' });
      await Promise.resolve();
    });

    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seleccionar Producto Stale' })).toBeNull();
    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();
    expect(screen.queryByText('Cargando productos…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cargar más resultados' }).disabled).toBe(false);
  });

  it('invalidates a pending request when the modal closes and starts the next opening cleanly', async () => {
    await renderCatalog();
    await openPublishModal();

    const pendingSearch = deferred();
    productRepository.listProductsPage.mockImplementationOnce(() => pendingSearch.promise);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'pendiente' }
    });
    await act(async () => delay(275));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog', { name: 'Publicar producto' })).toBeNull();

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [productTwo],
      nextCursor: null
    });
    await openPublishModal();
    expect(screen.getByPlaceholderText('Buscar por nombre, código o SKU').value).toBe('');
    expect(getProductSelect().value).toBe('');

    await act(async () => {
      pendingSearch.resolve({ data: [staleProduct], nextCursor: null });
      await Promise.resolve();
    });

    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
  });

  it('uses the cursor that belongs to the latest successful search term when loading more results', async () => {
    await renderCatalog();
    await openPublishModal();
    const searchInput = screen.getByPlaceholderText('Buscar por nombre, código o SKU');

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [{ ...productOne, id: 'coca-1', name: 'Coca Uno' }],
      nextCursor: 'cursor-coca'
    });
    fireEvent.change(searchInput, { target: { value: 'coca' } });
    await act(async () => delay(275));
    await screen.findByRole('button', { name: 'Seleccionar Coca Uno' });

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [{ ...productTwo, id: 'pepsi-1', name: 'Pepsi Uno' }],
      nextCursor: 'cursor-pepsi'
    });
    fireEvent.change(searchInput, { target: { value: 'pepsi' } });
    await act(async () => delay(275));
    await screen.findByRole('button', { name: 'Seleccionar Pepsi Uno' });

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [{ ...productTwo, id: 'pepsi-2', name: 'Pepsi Dos' }],
      nextCursor: null
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más resultados' }));
    await screen.findByRole('button', { name: 'Seleccionar Pepsi Dos' });

    expect(productRepository.listProductsPage).toHaveBeenLastCalledWith(expect.objectContaining({
      searchTerm: 'pepsi',
      cursor: 'cursor-pepsi'
    }));
    expect(screen.getByRole('button', { name: 'Seleccionar Pepsi Uno' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar Pepsi Dos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seleccionar Coca Uno' })).toBeNull();
  });

  it('appends the next page of the same active search without duplicates', async () => {
    await renderCatalog();
    await openPublishModal();
    const searchInput = screen.getByPlaceholderText('Buscar por nombre, código o SKU');
    const cocaOne = { ...productOne, id: 'coca-1', name: 'Coca Uno' };
    const cocaTwo = { ...productTwo, id: 'coca-2', name: 'Coca Dos' };

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [cocaOne], nextCursor: 'cursor-coca-2' });
    fireEvent.change(searchInput, { target: { value: 'coca' } });
    await act(async () => delay(275));
    await screen.findByRole('button', { name: 'Seleccionar Coca Uno' });

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [cocaOne, cocaTwo], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más resultados' }));
    await screen.findByRole('button', { name: 'Seleccionar Coca Dos' });

    expect(productRepository.listProductsPage).toHaveBeenLastCalledWith(expect.objectContaining({
      searchTerm: 'coca',
      cursor: 'cursor-coca-2'
    }));
    expect(screen.getAllByRole('button', { name: 'Seleccionar Coca Uno' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Seleccionar Coca Dos' })).toHaveLength(1);
  });

  it('restores the opening catalog when the user explicitly clears an active search', async () => {
    await renderCatalog();
    await openPublishModal();
    const searchInput = screen.getByPlaceholderText('Buscar por nombre, código o SKU');

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [productTwo], nextCursor: null });
    fireEvent.change(searchInput, { target: { value: 'dos' } });
    await act(async () => delay(275));
    await screen.findByRole('button', { name: 'Seleccionar Producto Dos' });

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [productOne], nextCursor: 'cursor-2' });
    fireEvent.change(searchInput, { target: { value: '' } });
    await act(async () => delay(275));

    expect(productRepository.listProductsPage).toHaveBeenLastCalledWith(expect.objectContaining({
      searchTerm: '',
      cursor: null
    }));
    expect(screen.queryByRole('region', { name: 'Resultados de búsqueda' })).toBeNull();
    expect(screen.getByRole('option', { name: /Producto Uno/ })).toBeInTheDocument();
  });

});
