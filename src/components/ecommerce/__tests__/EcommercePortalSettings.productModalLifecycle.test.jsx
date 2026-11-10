// @vitest-environment jsdom
import { grantTestActor } from '../../../services/auth/__tests__/actorAccessTestHarness';
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, MemoryRouter, RouterProvider } from 'react-router-dom';
import toast from 'react-hot-toast';
import MessageModal from '../../common/MessageModal';
import { useMessageStore } from '../../../store/useMessageStore';
import { ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT } from '../../../services/ecommerce/ecommerceCatalogSyncService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EcommercePortalSettings from '../EcommercePortalSettings';
import { useAppStore } from '../../../store/useAppStore';
import {
  getEcommercePortal,
  listPublishedProducts,
  savePublishedProduct,
  saveEcommercePortal,
  setProductPublished
} from '../../../services/ecommerce/ecommerceAdminService';
import { productRepository } from '../../../services/products/productRepository';

const render = (ui, options) => {
  const view = rtlRender(<MemoryRouter>{ui}</MemoryRouter>, options);
  return { ...view, rerender: (nextUi) => view.rerender(<MemoryRouter>{nextUi}</MemoryRouter>) };
};

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
const publishedProduct = {
  id: 'published-1',
  localProductRef: productOne.id,
  publicName: 'Producto Uno',
  publicDescription: 'Descripción uno',
  price: 25,
  categoryName: 'General',
  isPublished: true,
  isAvailable: true,
  manualAvailable: true
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

const getProductSelect = () => screen.getAllByRole('combobox')[0];

const waitForCatalogRequest = async (searchTerm, cursor, expectedCalls) => {
  await waitFor(() => {
    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(expectedCalls);
    expect(productRepository.listProductsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchTerm, cursor })
    );
  }, { timeout: 1000 });
};

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
  grantTestActor({ actorType: 'admin', actorId: 'admin-fixture' });
  useAppStore.setState({
    companyProfile: { name: 'Negocio de prueba', business_type: 'abarrotes' },
    licenseDetails: AUTHORIZED_ECOMMERCE_LICENSE,
    currentDeviceRole: 'admin',
    currentAdminUser: { id: 'admin-fixture' },
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
  await act(async () => {
    render(<EcommercePortalSettings requestedSection="catalog" />);
  });
  await waitFor(() => expect(getEcommercePortal).toHaveBeenCalledTimes(1));
  await screen.findByRole('button', { name: 'Publicar producto' });
};

const openPublishModal = async () => {
  const previousRequests = productRepository.listProductsPage.mock.calls.length;
  // Dialog presence alone precedes its passive initialization effect, which resets
  // the search field. Finish this opening before a test can issue its first search.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Publicar producto' }));
    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(previousRequests + 1);
    await productRepository.listProductsPage.mock.results[previousRequests].value;
  });
  await screen.findByRole('dialog', { name: 'Publicar producto' });
};

const preparePublishedEditor = async (response = freePortalResponse) => {
  getEcommercePortal.mockResolvedValue(response);
  listPublishedProducts.mockResolvedValue({ success: true, products: [publishedProduct] });
  productRepository.getProductById.mockResolvedValue(productOne);
  await renderCatalog();
  fireEvent.click(screen.getByRole('button', { name: 'Editar Producto Uno' }));
  await screen.findByRole('dialog', { name: 'Editar producto' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar producto' })).not.toBeDisabled());
};

const createCatalogRoute = () => {
  useMessageStore.setState({ isOpen: false, message: '', onConfirm: null, options: {} });
  const router = createMemoryRouter([
    {
      path: '/portal-online',
      element: (
        <>
          <EcommercePortalSettings requestedSection="catalog" />
          <Link to="/productos">Ir a Productos</Link>
          <MessageModal />
        </>
      )
    },
    { path: '/productos', element: <div>Productos</div> }
  ], { initialEntries: ['/portal-online'] });
  rtlRender(<RouterProvider router={router} />);
  return router;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the fixture-owned queues too: a failed test can leave a once-response unused.
  [getEcommercePortal, listPublishedProducts, savePublishedProduct, saveEcommercePortal,
    setProductPublished, ...Object.values(productRepository)].forEach((mock) => mock.mockReset());
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
  vi.restoreAllMocks();
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
    // Install the clock before opening can schedule a modal debounce.
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Publicar producto' }));
      });
      expect(screen.getByRole('dialog', { name: 'Publicar producto' })).toBeInTheDocument();
      expect(productRepository.listProductsPage).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTimeAsync(300));
    } finally {
      vi.useRealTimers();
    }
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
    await waitForCatalogRequest('dos', null, 2);

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
    await waitForCatalogRequest('pro', null, 2);
    fireEvent.change(searchInput, { target: { value: 'producto' } });
    await waitForCatalogRequest('producto', null, 3);

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
    await waitForCatalogRequest('producto', null, 3);
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

  it('closes an unchanged product editor without a discard confirmation', async () => {
    await renderCatalog();
    await openPublishModal();
    const confirm = vi.spyOn(window, 'confirm');
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
      expect(screen.queryByRole('dialog', { name: 'Publicar producto' })).toBeNull();
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });

  it('invalidates a pending request when the modal closes and starts the next opening cleanly', async () => {
    await renderCatalog();
    await openPublishModal();
    fireEvent.change(getProductSelect(), { target: { value: productOne.id } });
    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();

    const pendingSearch = deferred();
    productRepository.listProductsPage.mockImplementationOnce(() => pendingSearch.promise);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'pendiente' }
    });
    await waitForCatalogRequest('pendiente', null, 2);
    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Cargando productos…')).toBeInTheDocument();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
      expect(confirm).toHaveBeenCalledWith('¿Descartar los cambios sin guardar de este producto?');
      expect(screen.getByRole('dialog', { name: 'Publicar producto' })).toBeInTheDocument();
      expect(getProductSelect().value).toBe(productOne.id);
      expect(screen.getByText('Cargando productos…')).toBeInTheDocument();

      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('dialog', { name: 'Publicar producto' })).toBeNull();
    } finally {
      confirm.mockRestore();
    }

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [productTwo],
      nextCursor: null
    });
    await openPublishModal();
    expect(screen.getByPlaceholderText('Buscar por nombre, código o SKU').value).toBe('');
    expect(getProductSelect().value).toBe('');
    await waitFor(() => expect(productRepository.listProductsPage).toHaveBeenCalledTimes(3));
    await screen.findByRole('option', { name: /Producto Dos/ });
    expect(screen.queryByRole('option', { name: /Producto Uno/ })).toBeNull();
    expect(screen.queryByDisplayValue(productOne.name)).toBeNull();
    expect(screen.queryByText('Cargando productos…')).toBeNull();

    await act(async () => {
      pendingSearch.resolve({ data: [staleProduct], nextCursor: null });
      await Promise.resolve();
    });

    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Seleccionar Producto Stale/ })).toBeNull();
    expect(getProductSelect().value).toBe('');
    expect(screen.queryByText('Cargando productos…')).toBeNull();
    expect(savePublishedProduct).not.toHaveBeenCalled();
  });

  it('guards a modified catalog product during React Router navigation, preserving the rejected draft', async () => {
    listPublishedProducts.mockResolvedValue({ success: true, products: [publishedProduct] });
    productRepository.getProductById.mockResolvedValue(productOne);
    const router = createCatalogRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Producto Uno' }));
    await screen.findByRole('dialog', { name: 'Editar producto' });
    fireEvent.change(screen.getByLabelText('Nombre público *'), {
      target: { value: 'Nombre pendiente' }
    });
    fireEvent.click(screen.getByRole('link', { name: 'Ir a Productos' }));
    expect(await screen.findByText('¿Salir sin guardar?')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/portal-online');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(screen.getByLabelText('Nombre público *').value).toBe('Nombre pendiente');
    expect(router.state.location.pathname).toBe('/portal-online');
    fireEvent.click(screen.getByRole('link', { name: 'Ir a Productos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/productos'));
  });

  it('allows React Router navigation with an unchanged catalog editor', async () => {
    listPublishedProducts.mockResolvedValue({ success: true, products: [publishedProduct] });
    productRepository.getProductById.mockResolvedValue(productOne);
    const router = createCatalogRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Producto Uno' }));
    await screen.findByRole('dialog', { name: 'Editar producto' });
    fireEvent.click(screen.getByRole('link', { name: 'Ir a Productos' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/productos'));
    expect(screen.queryByText('¿Salir sin guardar?')).toBeNull();
  });

  it('preserves the product draft and server error when saving is rejected', async () => {
    await preparePublishedEditor();
    const notifyError = vi.spyOn(toast, 'error');
    const notifySuccess = vi.spyOn(toast, 'success');
    savePublishedProduct.mockResolvedValue({ success: false, message: 'El servidor rechazó el producto.' });
    fireEvent.change(screen.getByLabelText('Nombre público *'), {
      target: { value: 'Cambio rechazado' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('El servidor rechazó el producto.'));
    expect(screen.getByRole('dialog', { name: 'Editar producto' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre público *').value).toBe('Cambio rechazado');
    expect(savePublishedProduct).toHaveBeenCalledTimes(1);
    expect(listPublishedProducts).toHaveBeenCalledTimes(1);
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('confirms a saved product after the catalog refresh succeeds', async () => {
    await preparePublishedEditor();
    const notifySuccess = vi.spyOn(toast, 'success');
    savePublishedProduct.mockResolvedValue({ success: true });
    listPublishedProducts.mockResolvedValueOnce({
      success: true, products: [{ ...publishedProduct, publicName: 'Nombre confirmado' }]
    });
    fireEvent.change(screen.getByLabelText('Nombre público *'), {
      target: { value: 'Nombre confirmado' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar producto' })).toBeNull());
    expect(await screen.findByRole('button', { name: 'Editar Nombre confirmado' })).toBeInTheDocument();
    expect(notifySuccess).toHaveBeenCalledWith('Producto actualizado.');
    expect(savePublishedProduct).toHaveBeenCalledTimes(1);
  });

  it('allows leaving without a catalog draft warning after a confirmed save', async () => {
    listPublishedProducts.mockResolvedValue({ success: true, products: [publishedProduct] });
    productRepository.getProductById.mockResolvedValue(productOne);
    savePublishedProduct.mockResolvedValue({ success: true });
    const router = createCatalogRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Producto Uno' }));
    await screen.findByRole('dialog', { name: 'Editar producto' });
    fireEvent.change(screen.getByLabelText('Nombre público *'), {
      target: { value: 'Cambio guardado' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar producto' })).toBeNull());
    fireEvent.click(screen.getByRole('link', { name: 'Ir a Productos' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/productos'));
    expect(screen.queryByText('¿Salir sin guardar?')).toBeNull();
    expect(savePublishedProduct).toHaveBeenCalledTimes(1);
  });

  it('does not report an unpublish as failed when only catalog refresh fails', async () => {
    getEcommercePortal.mockResolvedValue(freePortalResponse);
    listPublishedProducts.mockResolvedValueOnce({ success: true, products: [publishedProduct] })
      .mockResolvedValueOnce({ success: false, message: 'Actualización no disponible' });
    setProductPublished.mockResolvedValue({ success: true });
    const notifyError = vi.spyOn(toast, 'error');
    const notifySuccess = vi.spyOn(toast, 'success');
    await renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: 'Despublicar Producto Uno' }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('Publicación actualizada, pero')));
    expect(setProductPublished).toHaveBeenCalledTimes(1);
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('closes on confirmed save despite refresh failure and still requests PRO sync once', async () => {
    await preparePublishedEditor(proPortalResponse);
    const notifyError = vi.spyOn(toast, 'error');
    const notifySuccess = vi.spyOn(toast, 'success');
    const syncListener = vi.fn();
    window.addEventListener(ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT, syncListener);
    try {
      savePublishedProduct.mockResolvedValue({ success: true });
      listPublishedProducts.mockResolvedValueOnce({
        success: false, message: 'La lista no se pudo consultar.'
      });
      fireEvent.change(screen.getByLabelText('Nombre público *'), {
        target: { value: 'Cambio persistido' }
      });
      fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar producto' })).toBeNull());
      expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('Producto guardado, pero'));
      expect(notifySuccess).not.toHaveBeenCalled();
      expect(savePublishedProduct).toHaveBeenCalledTimes(1);
      expect(syncListener).toHaveBeenCalledTimes(1);
      expect(syncListener.mock.calls[0][0].detail).toEqual(expect.objectContaining({
        productIds: [productOne.id], reason: 'published-product-saved'
      }));
    } finally {
      window.removeEventListener(ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT, syncListener);
    }
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
    await waitForCatalogRequest('coca', null, 2);
    await screen.findByRole('button', { name: 'Seleccionar Coca Uno' });

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [{ ...productTwo, id: 'pepsi-1', name: 'Pepsi Uno' }],
      nextCursor: 'cursor-pepsi'
    });
    fireEvent.change(searchInput, { target: { value: 'pepsi' } });
    await waitForCatalogRequest('pepsi', null, 3);
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
    await waitForCatalogRequest('coca', null, 2);
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
    await waitForCatalogRequest('dos', null, 2);
    await screen.findByRole('button', { name: 'Seleccionar Producto Dos' });

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [productOne], nextCursor: 'cursor-2' });
    fireEvent.change(searchInput, { target: { value: '' } });
    await waitForCatalogRequest('', null, 3);

    expect(productRepository.listProductsPage).toHaveBeenLastCalledWith(expect.objectContaining({
      searchTerm: '',
      cursor: null
    }));
    expect(screen.queryByRole('region', { name: 'Resultados de búsqueda' })).toBeNull();
    expect(screen.getByRole('option', { name: /Producto Uno/ })).toBeInTheDocument();
  });

});
