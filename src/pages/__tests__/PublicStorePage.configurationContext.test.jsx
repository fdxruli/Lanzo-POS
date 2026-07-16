// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicStorePage from '../PublicStorePage';

const mocks = vi.hoisted(() => ({
  getPublicPortalBySlug: vi.fn(),
  getPublicCatalog: vi.fn(),
  catalogProps: vi.fn()
}));

vi.mock('../../services/ecommerce/ecommercePublicService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getPublicPortalBySlug: mocks.getPublicPortalBySlug,
    getPublicCatalog: mocks.getPublicCatalog
  };
});

vi.mock('../../components/ecommerce/public/PublicCatalog', () => ({
  default: (props) => {
    mocks.catalogProps(props);
    return <div data-testid="public-catalog-context" />;
  }
}));

const portalResult = {
  portal: {
    slug: 'mi-negocio',
    name: 'Mi negocio',
    orderingEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: false,
    minOrderTotal: 0,
    maxOrderItems: 30,
    maxItemQuantity: 10
  },
  hours: { weekly: [], exceptions: [] },
  features: { orderInbox: true },
  availability: {
    acceptingOrders: true,
    code: 'OPEN',
    timezone: 'America/Mexico_City',
    scheduleSource: 'disabled'
  },
  catalogRevision: 12,
  source: 'cache',
  offline: true
};

const catalogResult = {
  catalogRevision: 12,
  source: 'cache',
  offline: true,
  items: [{
    id: 'product-1',
    name: 'Producto',
    description: '',
    categoryName: 'General',
    price: 50,
    currency: 'MXN',
    imageUrl: '',
    isAvailable: true,
    stock: { mode: 'hidden', status: 'available', quantity: null },
    configuration: {
      type: 'configurable',
      version: 1,
      hasVariants: true,
      hasOptionGroups: false,
      requiresConfiguration: true
    }
  }],
  pagination: { offset: 0, limit: 100, hasMore: false }
};

const renderPage = () => render(
  <MemoryRouter initialEntries={['/tienda/mi-negocio']}>
    <Routes>
      <Route path="/tienda/:slug" element={<PublicStorePage />} />
    </Routes>
  </MemoryRouter>
);

describe('PublicStorePage configuration context', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.catalogProps.mockReset();
    mocks.getPublicPortalBySlug.mockReset().mockResolvedValue(portalResult);
    mocks.getPublicCatalog.mockReset().mockResolvedValue(catalogResult);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => cleanup());

  it('passes catalog revision, cache-offline state and portal quantity directly', async () => {
    renderPage();

    await waitFor(() => expect(mocks.catalogProps).toHaveBeenCalled());
    const props = mocks.catalogProps.mock.calls.at(-1)[0];
    expect(props.catalogRevision).toBe(12);
    expect(props.offline).toBe(true);
    expect(props.maxItemQuantity).toBe(10);
    expect(window.navigator.onLine).toBe(true);
  });

  it('keeps checkout context offline even when navigator reports online', async () => {
    renderPage();
    await waitFor(() => expect(mocks.catalogProps).toHaveBeenCalled());
    const props = mocks.catalogProps.mock.calls.at(-1)[0];
    expect(props.offline).toBe(true);
    expect(mocks.getPublicCatalog).toHaveBeenCalledWith('mi-negocio', expect.objectContaining({
      catalogRevision: 12,
      offline: true
    }));
  });
});
