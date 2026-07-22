// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicStorePage from '../PublicStorePage';
import { createDefaultEcommerceSiteDocument } from '../../utils/ecommerceSiteDocument';

const serviceMocks = vi.hoisted(() => ({
  getPublicPortalBySlug: vi.fn(),
  getPublicCatalog: vi.fn()
}));

vi.mock('../../services/ecommerce/ecommercePublicService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getPublicPortalBySlug: serviceMocks.getPublicPortalBySlug,
    getPublicCatalog: serviceMocks.getPublicCatalog
  };
});

const makePortalResult = ({ versionId, versionNumber, documentMode, document }) => ({
  portal: {
    slug: 'mi-negocio',
    name: 'Mi negocio',
    headline: 'Comida hecha al momento',
    description: 'Descripción pública',
    templateCode: 'classic',
    logoUrl: '',
    coverImageUrl: '',
    address: 'Centro, Chiapas',
    orderingEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: false,
    minOrderTotal: 0,
    maxOrderItems: 30,
    maxItemQuantity: 99
  },
  hours: { weekly: [], exceptions: [] },
  availability: {
    acceptingOrders: true,
    code: 'OPEN',
    timezone: 'America/Mexico_City',
    scheduleSource: 'disabled',
    legacy: true
  },
  features: { stockVisibility: false },
  catalogRevision: 7,
  cachePolicy: { schemaVersion: 1, freshSeconds: 300, maxStaleSeconds: 86400 },
  site: { schemaVersion: 1, versionId, versionNumber, documentMode, document }
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/tienda/mi-negocio']}>
    <Routes>
      <Route path="/tienda/:slug" element={<PublicStorePage />} />
    </Routes>
  </MemoryRouter>
);

describe('PublicStorePage published site versions', () => {
  beforeEach(() => {
    const v1 = createDefaultEcommerceSiteDocument();
    v1.sections[1].props = { showSearch: false, showCategories: false };
    let publicResult = makePortalResult({
      versionId: '11111111-1111-4111-8111-111111111111',
      versionNumber: 1,
      documentMode: 'custom',
      document: v1
    });

    serviceMocks.getPublicPortalBySlug.mockReset().mockImplementation(() => Promise.resolve(publicResult));
    serviceMocks.getPublicCatalog.mockReset().mockResolvedValue({
      catalogRevision: 7,
      items: [{
        id: 'p1',
        name: 'Producto',
        description: '',
        categoryName: 'General',
        price: 10,
        currency: 'MXN',
        imageUrl: '',
        isAvailable: true,
        stock: { mode: 'hidden', status: null, quantity: null }
      }],
      pagination: { limit: 100, offset: 0, hasMore: false }
    });

    serviceMocks.setPublicResult = (next) => {
      publicResult = next;
    };
  });

  afterEach(() => {
    cleanup();
    delete serviceMocks.setPublicResult;
  });

  it('keeps v1 while only the draft changes, then renders v2 without changing catalogRevision', async () => {
    renderPage();

    await waitFor(() => expect(document.querySelector('.public-store-shell[data-site-version="1"]')).toBeTruthy());
    const shell = document.querySelector('.public-store-shell');
    expect(shell).toHaveAttribute('data-catalog-revision', '7');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    // A mutable draft is not part of the public response; revalidation still returns v1.
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(serviceMocks.getPublicPortalBySlug).toHaveBeenCalledTimes(2));
    expect(document.querySelector('.public-store-shell')).toHaveAttribute('data-site-version', '1');
    expect(screen.queryByRole('searchbox')).toBeNull();

    const v2 = createDefaultEcommerceSiteDocument();
    serviceMocks.setPublicResult(makePortalResult({
      versionId: '22222222-2222-4222-8222-222222222222',
      versionNumber: 2,
      documentMode: 'default',
      document: v2
    }));

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(serviceMocks.getPublicPortalBySlug).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(document.querySelector('.public-store-shell')).toHaveAttribute('data-site-version', '2'));
    expect(document.querySelector('.public-store-shell')).toHaveAttribute('data-catalog-revision', '7');
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
