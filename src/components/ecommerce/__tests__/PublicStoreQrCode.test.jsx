// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import PublicStoreQrCode from '../PublicStoreQrCode';
import EcommercePortalSettings from '../EcommercePortalSettings';
import {
  getEcommercePortal,
  listPublishedProducts
} from '../../../services/ecommerce/ecommerceAdminService';

const { encode } = vi.hoisted(() => ({
  encode: vi.fn(() => ({
    getWidth: () => 2,
    getHeight: () => 2,
    get: (x, y) => x === y
  }))
}));

vi.mock('@zxing/library', () => ({
  BarcodeFormat: { QR_CODE: 'QR_CODE' },
  QRCodeWriter: class QRCodeWriter {
    encode(...args) {
      return encode(...args);
    }
  }
}));

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

const publicStoreUrl = 'https://lanzo-store.vercel.app/tienda/negocio-ejemplo';
const matrix = {
  getWidth: () => 2,
  getHeight: () => 2,
  get: (x, y) => x === y
};

beforeEach(() => {
  vi.clearAllMocks();
  encode.mockReturnValue(matrix);
});

afterEach(() => {
  cleanup();
});

describe('PublicStoreQrCode', () => {
  it('passes the complete public URL to the QR encoder', () => {
    render(<PublicStoreQrCode value={publicStoreUrl} />);

    expect(encode).toHaveBeenCalledWith(
      publicStoreUrl,
      'QR_CODE',
      168,
      168,
      expect.any(Map)
    );
    expect(encode.mock.calls[0][4]).toBeInstanceOf(Map);
    expect(screen.getByRole('img', { name: 'Codigo QR de la tienda' }))
      .toHaveAttribute('data-qr-value', publicStoreUrl);
  });

  it('shows a non-blocking fallback when the encoder throws', () => {
    encode.mockImplementationOnce(() => {
      throw new Error('sensitive QR encoder stack data');
    });

    expect(() => render(<PublicStoreQrCode value={publicStoreUrl} />)).not.toThrow();

    const fallback = screen.getByRole('status');
    expect(fallback).toHaveTextContent(
      'No se pudo generar el código QR. Puedes copiar el enlace de la tienda.'
    );
    expect(fallback).toHaveAttribute('data-qr-value', publicStoreUrl);
    expect(screen.queryByRole('img', { name: 'Codigo QR de la tienda' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sensitive QR encoder stack data/i)).not.toBeInTheDocument();
  });
});

describe('EcommercePortalSettings QR isolation', () => {
  it('keeps the public store actions available when only QR generation fails', async () => {
    encode.mockImplementation(() => {
      throw new Error('sensitive QR encoder stack data');
    });
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

    render(<EcommercePortalSettings />);

    expect(await screen.findByText(publicStoreUrl)).toBeInTheDocument();
    expect(screen.getByText(
      'No se pudo generar el código QR. Puedes copiar el enlace de la tienda.'
    ).closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir tienda' }))
      .toHaveAttribute('href', publicStoreUrl);
    expect(screen.getByRole('button', { name: 'Copiar link' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Compartir' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href'))
      .toContain(encodeURIComponent(publicStoreUrl));
    expect(screen.queryByRole('img', { name: 'Codigo QR de la tienda' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sensitive QR encoder stack data/i)).not.toBeInTheDocument();
  });
});
