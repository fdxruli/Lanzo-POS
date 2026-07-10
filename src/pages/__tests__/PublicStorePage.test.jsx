// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicStorePage from '../PublicStorePage';
import usePublicCart, { getPublicCartStorageKey } from '../../hooks/ecommerce/usePublicCart';
import { EcommercePublicError } from '../../services/ecommerce/ecommercePublicService';

const serviceMocks = vi.hoisted(() => ({
  getPublicPortalBySlug: vi.fn(),
  getPublicCatalog: vi.fn(),
}));

vi.mock('../../services/ecommerce/ecommercePublicService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getPublicPortalBySlug: serviceMocks.getPublicPortalBySlug,
    getPublicCatalog: serviceMocks.getPublicCatalog,
  };
});

const portalResult = {
  portal: {
    slug: 'mi-negocio',
    name: 'Mi negocio',
    headline: 'Comida hecha al momento',
    description: 'Descripción pública',
    logoUrl: '',
    coverImageUrl: '',
    address: 'Centro, Chiapas',
    orderingEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: true,
    minOrderTotal: 100,
    maxOrderItems: 30,
    maxItemQuantity: 99,
  },
  hours: {
    weekly: [{ weekday: new Date().getDay(), isOpen: true, opensAt: '14:00:00', closesAt: '22:00:00' }],
    exceptions: [],
  },
  features: { stockVisibility: false },
};

const makeProduct = (id, overrides = {}) => ({
  id,
  name: `Producto ${id}`,
  description: 'Descripción',
  categoryName: 'General',
  price: 10,
  currency: 'MXN',
  imageUrl: '',
  isAvailable: true,
  stock: { mode: 'hidden', status: null, quantity: null },
  ...overrides,
});

const catalogResult = {
  items: [
    makeProduct('a', {
      name: 'Alitas BBQ',
      description: 'Cinco piezas',
      categoryName: 'Alitas',
      price: 80,
    }),
    makeProduct('b', {
      name: 'Papas',
      description: 'Crujientes',
      categoryName: 'Complementos',
      price: 35,
      isAvailable: false,
    }),
  ],
  pagination: { limit: 100, offset: 0, hasMore: false },
};

const renderPage = (path = '/tienda/mi-negocio') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/tienda/:slug" element={<PublicStorePage />} />
    </Routes>
  </MemoryRouter>
);

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('PublicStorePage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    serviceMocks.getPublicPortalBySlug.mockReset().mockResolvedValue(portalResult);
    serviceMocks.getPublicCatalog.mockReset().mockResolvedValue(catalogResult);
  });

  afterEach(() => {
    cleanup();
  });

  it('loads the public portal and catalog without POS shell elements', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Mi negocio' })).toBeInTheDocument();
    expect(screen.getByText('Comida hecha al momento')).toBeInTheDocument();
    expect(screen.getByText(/Abierto hoy de 14:00 a 22:00/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Alitas BBQ' })).toBeInTheDocument();
    expect(screen.queryByText('WelcomeModal')).not.toBeInTheDocument();
    expect(screen.queryByText(/licencia/i)).not.toBeInTheDocument();
  });

  it('restores a persisted product from the second catalog page with its current price', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('mi-negocio'), JSON.stringify({
      version: 1,
      items: [{ id: 'product-120', quantity: 2 }],
    }));
    const firstPage = Array.from({ length: 100 }, (_, index) => makeProduct(`product-${index + 1}`));
    const product120 = makeProduct('product-120', { name: 'Producto 120', price: 55 });
    serviceMocks.getPublicCatalog.mockImplementation((slug, options) => Promise.resolve(
      options.offset === 0
        ? { items: firstPage, pagination: { limit: 100, offset: 0, hasMore: true } }
        : { items: [product120], pagination: { limit: 100, offset: 100, hasMore: false } }
    ));

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(serviceMocks.getPublicCatalog).toHaveBeenCalledTimes(2));
    expect(serviceMocks.getPublicCatalog).toHaveBeenNthCalledWith(2, 'mi-negocio', {
      limit: 100,
      offset: 100,
    });
    await user.click(await screen.findByRole('button', { name: 'Ver carrito, 2 unidades' }));

    expect(screen.getByRole('dialog', { name: 'Carrito (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Producto 120' })).toBeInTheDocument();
    expect(screen.getByText('$55.00 cada uno')).toBeInTheDocument();
    expect(screen.getAllByText('$110.00').length).toBeGreaterThan(0);
    expect(JSON.parse(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).items).toEqual([
      { id: 'product-120', quantity: 2 },
    ]);
  });

  it('removes a nonexistent persisted ID only after exhausting pagination', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('mi-negocio'), JSON.stringify({
      version: 1,
      items: [{ id: 'missing', quantity: 1 }],
    }));
    serviceMocks.getPublicCatalog.mockImplementation((slug, options) => Promise.resolve(
      options.offset === 0
        ? { items: [makeProduct('first')], pagination: { limit: 100, offset: 0, hasMore: true } }
        : { items: [makeProduct('last')], pagination: { limit: 100, offset: 100, hasMore: false } }
    ));

    renderPage();

    await waitFor(() => expect(serviceMocks.getPublicCatalog).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).toBeNull());
    expect(serviceMocks.getPublicCatalog).toHaveBeenNthCalledWith(2, 'mi-negocio', {
      limit: 100,
      offset: 100,
    });
  });

  it('drops an exact-zero product found on a later page and disables it in the catalog', async () => {
    window.sessionStorage.setItem(getPublicCartStorageKey('mi-negocio'), JSON.stringify({
      version: 1,
      items: [{ id: 'product-120', quantity: 2 }],
    }));
    const exhaustedProduct = makeProduct('product-120', {
      name: 'Producto agotado',
      stock: { mode: 'exact', status: null, quantity: 0 },
    });
    serviceMocks.getPublicCatalog.mockImplementation((slug, options) => Promise.resolve(
      options.offset === 0
        ? { items: [makeProduct('first')], pagination: { limit: 100, offset: 0, hasMore: true } }
        : { items: [exhaustedProduct], pagination: { limit: 100, offset: 100, hasMore: false } }
    ));

    renderPage();

    expect(await screen.findByRole('button', { name: 'Producto agotado no disponible' })).toBeDisabled();
    expect(screen.getByText('Agotado')).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).toBeNull());
  });

  it('does not preload later pages when there is no stored cart', async () => {
    serviceMocks.getPublicCatalog.mockImplementation((slug, options) => Promise.resolve(
      options.offset === 0
        ? {
            items: [makeProduct('first', { name: 'Primero' })],
            pagination: { limit: 100, offset: 0, hasMore: true },
          }
        : {
            items: [makeProduct('second', { name: 'Segundo' })],
            pagination: { limit: 100, offset: 100, hasMore: false },
          }
    ));

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Primero' })).toBeInTheDocument();
    expect(serviceMocks.getPublicCatalog).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByRole('heading', { name: 'Segundo' })).toBeInTheDocument();
    expect(serviceMocks.getPublicCatalog).toHaveBeenCalledTimes(2);
  });

  it('does not infer available status and treats exact zero as sold out', async () => {
    serviceMocks.getPublicCatalog.mockResolvedValue({
      items: [
        makeProduct('unknown', {
          name: 'Estado desconocido',
          stock: { mode: 'status', status: null, quantity: null },
        }),
        makeProduct('zero', {
          name: 'Stock cero',
          stock: { mode: 'exact', status: null, quantity: 0 },
        }),
      ],
      pagination: { limit: 100, offset: 0, hasMore: false },
    });

    renderPage();

    expect(await screen.findByRole('button', { name: 'Agregar Estado desconocido' })).toBeEnabled();
    expect(screen.queryByText('Disponible')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stock cero no disponible' })).toBeDisabled();
    expect(screen.getByText('Agotado')).toBeInTheDocument();
  });

  it('ignores a late catalog response after changing slug', async () => {
    const oldCatalog = deferred();
    serviceMocks.getPublicPortalBySlug.mockImplementation((slug) => Promise.resolve({
      ...portalResult,
      portal: {
        ...portalResult.portal,
        slug,
        name: slug === 'tienda-a' ? 'Tienda A' : 'Tienda B',
      },
    }));
    serviceMocks.getPublicCatalog.mockImplementation((slug) => (
      slug === 'tienda-a'
        ? oldCatalog.promise
        : Promise.resolve({
            items: [makeProduct('b-product', { name: 'Producto B' })],
            pagination: { limit: 100, offset: 0, hasMore: false },
          })
    ));

    const router = createMemoryRouter([
      { path: '/tienda/:slug', element: <PublicStorePage /> },
    ], { initialEntries: ['/tienda/tienda-a'] });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(serviceMocks.getPublicCatalog).toHaveBeenCalledWith('tienda-a', {
      limit: 100,
      offset: 0,
    }));
    await act(async () => {
      await router.navigate('/tienda/tienda-b');
    });

    expect(await screen.findByRole('heading', { name: 'Tienda B' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Producto B' })).toBeInTheDocument();

    await act(async () => {
      oldCatalog.resolve({
        items: [makeProduct('a-product', { name: 'Producto A tardío' })],
        pagination: { limit: 100, offset: 0, hasMore: false },
      });
      await oldCatalog.promise;
    });

    expect(screen.queryByRole('heading', { name: 'Producto A tardío' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Producto B' })).toBeInTheDocument();
  });

  it('filters by search and category and disables unavailable products', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Alitas BBQ' });

    await user.type(screen.getByRole('searchbox', { name: 'Buscar productos' }), 'papas');
    expect(screen.queryByRole('heading', { name: 'Alitas BBQ' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Papas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Papas no disponible' })).toBeDisabled();

    await user.clear(screen.getByRole('searchbox', { name: 'Buscar productos' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por categoría' }), 'Alitas');
    expect(screen.getByRole('heading', { name: 'Alitas BBQ' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Papas' })).not.toBeInTheDocument();
  });

  it('adds products to the visual cart and calculates the current subtotal', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Alitas BBQ' });

    await user.click(screen.getByRole('button', { name: 'Agregar Alitas BBQ' }));
    await user.click(screen.getByRole('button', { name: 'Ver carrito, 1 unidades' }));

    expect(screen.getByRole('dialog', { name: 'Carrito (1)' })).toBeInTheDocument();
    expect(screen.getAllByText('$80.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/Te faltan.*20\.00.*pedido mínimo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar pedido' })).toBeDisabled();
    expect(serviceMocks.getPublicCatalog).toHaveBeenCalledTimes(1);
  });

  it('keeps the portal header when the catalog request fails and allows retry', async () => {
    serviceMocks.getPublicCatalog
      .mockRejectedValueOnce(new EcommercePublicError('ECOMMERCE_PUBLIC_NETWORK_ERROR', 'safe'))
      .mockResolvedValueOnce(catalogResult);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Mi negocio' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'No se pudo cargar el catálogo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Alitas BBQ' })).toBeInTheDocument();
  });

  it('shows the same generic state for an unavailable portal', async () => {
    serviceMocks.getPublicPortalBySlug.mockRejectedValue(
      new EcommercePublicError('ECOMMERCE_PORTAL_NOT_FOUND', 'Esta tienda no está disponible.')
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Esta tienda no está disponible' })).toBeInTheDocument();
    expect(screen.getByText(/El enlace puede ser incorrecto/)).toBeInTheDocument();
    expect(serviceMocks.getPublicCatalog).not.toHaveBeenCalled();
  });

  it('restores the previous document title on unmount', async () => {
    document.title = 'Lanzo POS';
    const view = renderPage();
    await waitFor(() => expect(document.title).toBe('Mi negocio | Tienda online'));
    view.unmount();
    expect(document.title).toBe('Lanzo POS');
  });

  it('keeps checkout creation outside the public page', () => {
    expect(PublicStorePage.toString()).not.toContain('ecommerce_create_order');
    expect(usePublicCart.toString()).not.toContain('ecommerce_create_order');
  });
});
