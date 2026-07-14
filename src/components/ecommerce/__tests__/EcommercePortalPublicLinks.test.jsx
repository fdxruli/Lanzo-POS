// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import EcommercePortalSettings from '../EcommercePortalSettings';
import { getEcommercePortal, listPublishedProducts } from '../../../services/ecommerce/ecommerceAdminService';

vi.mock('../../../services/ecommerce/ecommerceAdminService', () => ({
  getEcommercePortal: vi.fn(),
  listPublishedProducts: vi.fn(),
  saveEcommercePortal: vi.fn(),
  savePublishedProduct: vi.fn(),
  setProductPublished: vi.fn(),
  syncPublishedCatalog: vi.fn()
}));

vi.mock('../../../services/products/productRepository', () => ({
  productRepository: { listProductsPage: vi.fn(), listCategories: vi.fn() }
}));

vi.mock('../EcommerceProductPublishModal', () => ({ default: () => null }));
vi.mock('../PublicStoreQrCode', () => ({
  default: ({ value }) => (
    <svg role="img" aria-label="Codigo QR de la tienda" data-qr-value={value} />
  )
}));

const publicStoreUrl = 'https://lanzo-store.vercel.app/tienda/negocio-ejemplo';

const renderPortal = async () => {
  render(<EcommercePortalSettings />);
  await screen.findByText(publicStoreUrl);
};

describe('EcommercePortalSettings public link cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEcommercePortal.mockResolvedValue({
      success: true,
      portal: {
        slug: 'negocio-ejemplo',
        name: 'Negocio ejemplo',
        status: 'published',
        catalogRevision: 3
      },
      plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
      features: { customSlug: true, cloudCatalogSource: true, maxPublishedProducts: -1 }
    });
    listPublishedProducts.mockResolvedValue({ success: true, products: [] });
    act(() => useAppStore.setState({
      companyProfile: { name: 'Negocio ejemplo' },
      currentDeviceRole: 'admin',
      currentStaffUser: null,
      licenseDetails: { license_key: 'license-fixture' },
      _isInitializing: false
    }));
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined)
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  it('shows, opens and encodes the standalone public URL in the QR', async () => {
    await renderPortal();
    expect(screen.getByRole('link', { name: 'Abrir tienda' }))
      .toHaveAttribute('href', publicStoreUrl);
    expect(screen.getByRole('img', { name: 'Codigo QR de la tienda' }))
      .toHaveAttribute('data-qr-value', publicStoreUrl);
  });

  it('copies the standalone public URL', async () => {
    await renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publicStoreUrl));
  });

  it('shares the standalone public URL through navigator.share', async () => {
    await renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
      url: publicStoreUrl
    })));
  });

  it('falls back to clipboard when navigator.share is unavailable', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    await renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publicStoreUrl));
  });

  it('includes the standalone public URL in the WhatsApp text', async () => {
    await renderPortal();
    const href = screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
    expect(new URL(href).origin).toBe('https://wa.me');
    expect(new URL(href).searchParams.get('text')).toContain(publicStoreUrl);
  });
});
