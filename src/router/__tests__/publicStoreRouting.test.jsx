// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { isPublicStorePath } from '../isPublicStorePath';
import { publicStoreRoutes } from '../publicStoreRoutes';

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

describe('public store routing', () => {
  it('recognizes only the supported public store paths', () => {
    expect(isPublicStorePath('/tienda')).toBe(true);
    expect(isPublicStorePath('/tienda/')).toBe(true);
    expect(isPublicStorePath('/tienda/mi-negocio')).toBe(true);
    expect(isPublicStorePath('/tienda/mi-negocio/')).toBe(true);
    expect(isPublicStorePath('/')).toBe(false);
    expect(isPublicStorePath('/configuracion')).toBe(false);
    expect(isPublicStorePath('/tienda/uno/dos')).toBe(false);
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
});
