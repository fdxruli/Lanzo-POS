// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicStorePath } from '../isPublicStorePath';
import { publicStoreRoutes } from '../publicStoreRoutes';
import { preparePublicStoreDocument } from '../preparePublicStoreDocument';

vi.mock('../../services/ecommerce/ecommercePublicService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getPublicPortalBySlug: vi.fn().mockImplementation((slug) => (
      slug === 'mi-negocio'
        ? Promise.resolve({
            portal: {
              slug: 'mi-negocio',
              name: 'Mi negocio',
              pickupEnabled: true,
              deliveryEnabled: false,
              orderingEnabled: true,
              minOrderTotal: 0,
              maxOrderItems: 30,
              maxItemQuantity: 99,
            },
            hours: { weekly: [], exceptions: [] },
            features: {},
          })
        : Promise.reject(new Error('Tienda inexistente.'))
    )),
    getPublicCatalog: vi.fn().mockResolvedValue({
      items: [],
      pagination: { limit: 100, offset: 0, hasMore: false },
    }),
  };
});

afterEach(() => {
  cleanup();
});

describe('public store routing', () => {
  it('recognizes only the supported paths delegated from the administrative app', () => {
    expect(isPublicStorePath('/tienda')).toBe(true);
    expect(isPublicStorePath('/tienda/')).toBe(true);
    expect(isPublicStorePath('/tienda/mi-negocio')).toBe(true);
    expect(isPublicStorePath('/tienda/mi-negocio/')).toBe(true);
    expect(isPublicStorePath('/mi-negocio')).toBe(false);
    expect(isPublicStorePath(`/mi-negocio/pedido/trk1_${'A'.repeat(43)}`)).toBe(false);
    expect(isPublicStorePath('/conoce-lanzo')).toBe(true);
    expect(isPublicStorePath('/conoce-lanzo/')).toBe(true);
    // The standalone lanzo-store bundle owns /. The admin origin must keep / for the POS.
    expect(isPublicStorePath('/')).toBe(false);
    expect(isPublicStorePath('/configuracion')).toBe(false);
    expect(isPublicStorePath('/tienda/uno/dos')).toBe(false);
  });

  it('removes zoom restrictions from the public document viewport', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">';

    preparePublicStoreDocument(document);

    const content = document.querySelector('meta[name="viewport"]').getAttribute('content');
    expect(content).toContain('width=device-width');
    expect(content).toContain('initial-scale=1');
    expect(content).toContain('viewport-fit=cover');
    expect(content).not.toContain('maximum-scale');
    expect(content).not.toContain('user-scalable');
  });

  it('opens the store product landing at / without mounting the POS shell', () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    expect(screen.getByRole('heading', {
      name: 'Una tienda en línea lista para compartir, conectada a tu negocio.'
    })).toBeInTheDocument();
    const acquisitionLinks = screen.getAllByRole('link', { name: 'Crear mi tienda con Lanzo' });
    expect(acquisitionLinks.length).toBeGreaterThan(1);
    acquisitionLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', 'https://lanzo-pos.vercel.app/?welcome=1');
    });
    expect(screen.getByRole('link', { name: 'Ver cómo funciona' }))
      .toHaveAttribute('href', '#como-funciona');
    expect(document.title).toBe('Lanzo Tienda Online | Vende por internet con Lanzo');
    expect(document.querySelector('link[rel="canonical"]'))
      .toHaveAttribute('href', 'https://lanzo-store.vercel.app/');
    expect(screen.queryByText('WelcomeModal')).not.toBeInTheDocument();
    expect(screen.queryByText('StaffLoginModal')).not.toBeInTheDocument();
    expect(screen.queryByText('Navbar')).not.toBeInTheDocument();
  });

  it('mounts the public page for /tienda/:slug without POS shell UI', async () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/tienda/mi-negocio'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Mi negocio' })).toBeInTheDocument();
    expect(screen.queryByText('WelcomeModal')).not.toBeInTheDocument();
    expect(screen.queryByText('StaffLoginModal')).not.toBeInTheDocument();
    expect(screen.queryByText('Navbar')).not.toBeInTheDocument();
  });

  it('mounts the public page for /:slug without POS shell UI', async () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/mi-negocio'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Mi negocio' })).toBeInTheDocument();
    expect(screen.queryByText('WelcomeModal')).not.toBeInTheDocument();
    expect(screen.queryByText('StaffLoginModal')).not.toBeInTheDocument();
    expect(screen.queryByText('Navbar')).not.toBeInTheDocument();
  });

  it('keeps both short and legacy order tracking routes in the public router', () => {
    const routePaths = publicStoreRoutes.map(({ path }) => path);
    expect(routePaths).toContain('/:slug/pedido/:trackingToken');
    expect(routePaths).toContain('/tienda/:slug/pedido/:trackingToken');
  });

  it('shows a friendly public state for /tienda', () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/tienda'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { name: 'Enlace de tienda no válido' })).toBeInTheDocument();
  });

  it('shows the unavailable state for an unknown one-segment slug', async () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/esto-no-existe'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'No se pudo cargar la tienda' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', {
      name: 'Una tienda en línea lista para compartir, conectada a tu negocio.'
    })).not.toBeInTheDocument();
  });

  it('opens the Lanzo landing without mounting the POS shell', () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/conoce-lanzo?tienda=mi-negocio'] });
    render(<RouterProvider router={router} />);

    expect(screen.getByRole('heading', {
      name: 'Todo lo que necesitas para vender, controlar y crecer.'
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a la tienda' })).toHaveAttribute('href', '/mi-negocio');
    expect(screen.queryByText('Navbar')).not.toBeInTheDocument();
  });
});
