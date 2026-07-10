// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublicStorePage from '../PublicStorePage';
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
    maxOrderItems: 2,
    maxItemQuantity: 3,
  },
  hours: {
    weekly: [{ weekday: new Date().getDay(), isOpen: true, opensAt: '14:00:00', closesAt: '22:00:00' }],
    exceptions: [],
  },
  features: { stockVisibility: false },
};

const catalogResult = {
  items: [
    {
      id: 'a',
      name: 'Alitas BBQ',
      description: 'Cinco piezas',
      categoryName: 'Alitas',
      price: 80,
      currency: 'MXN',
      imageUrl: '',
      isAvailable: true,
      stock: { mode: 'hidden', status: null, quantity: null },
    },
    {
      id: 'b',
      name: 'Papas',
      description: 'Crujientes',
      categoryName: 'Complementos',
      price: 35,
      currency: 'MXN',
      imageUrl: '',
      isAvailable: false,
      stock: { mode: 'hidden', status: null, quantity: null },
    },
  ],
  pagination: { limit: 100, offset: 0, hasMore: false },
};

const renderPage = () => render(
  <MemoryRouter initialEntries={['/tienda/mi-negocio']}>
    <Routes>
      <Route path="/tienda/:slug" element={<PublicStorePage />} />
    </Routes>
  </MemoryRouter>
);

describe('PublicStorePage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    serviceMocks.getPublicPortalBySlug.mockReset().mockResolvedValue(portalResult);
    serviceMocks.getPublicCatalog.mockReset().mockResolvedValue(catalogResult);
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
});
