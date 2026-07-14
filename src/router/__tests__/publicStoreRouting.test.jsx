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
    getPublicPortalBySlug: vi.fn().mockResolvedValue({
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
    }),
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
  it('recognizes only the supported public store paths', () => {
    expect(isPublicStorePath('/tienda')).toBe(true);
    expect(isPublicStorePath('/tienda/')).toBe(true);
    expect(isPublicStorePath('/tienda/mi-negocio')).toBe(true);
    expect(isPublicStorePath('/tienda/mi-negocio/')).toBe(true);
    expect(isPublicStorePath('/conoce-lanzo')).toBe(true);
    expect(isPublicStorePath('/conoce-lanzo/')).toBe(true);
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

  it('mounts the public page for /tienda/:slug without POS shell UI', async () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/tienda/mi-negocio'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Mi negocio' })).toBeInTheDocument();
    expect(screen.queryByText('WelcomeModal')).not.toBeInTheDocument();
    expect(screen.queryByText('StaffLoginModal')).not.toBeInTheDocument();
    expect(screen.queryByText('Navbar')).not.toBeInTheDocument();
  });

  it('shows a friendly public state for /tienda', () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/tienda'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('heading', { name: 'Esta tienda no está disponible' })).toBeInTheDocument();
  });

  it('opens the Lanzo landing without mounting the POS shell', () => {
    const router = createMemoryRouter(publicStoreRoutes, { initialEntries: ['/conoce-lanzo?tienda=mi-negocio'] });
    render(<RouterProvider router={router} />);

    expect(screen.getByRole('heading', {
      name: 'Todo lo que necesitas para vender, controlar y crecer.'
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a la tienda' })).toHaveAttribute('href', '/tienda/mi-negocio');
    expect(screen.queryByText('Navbar')).not.toBeInTheDocument();
  });
});
