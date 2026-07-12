// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import EcommercePortalSettings from '../EcommercePortalSettings';
import {
  getEcommercePortal,
  listPublishedProducts,
  savePublishedProduct,
  setProductPublished
} from '../../../services/ecommerce/ecommerceAdminService';

vi.mock('../../../services/ecommerce/ecommerceAdminService', () => ({
  getEcommercePortal: vi.fn(),
  listPublishedProducts: vi.fn(),
  saveEcommercePortal: vi.fn(),
  savePublishedProduct: vi.fn(),
  setProductPublished: vi.fn()
}));

vi.mock('../../../services/products/productRepository', () => ({
  productRepository: {
    listProductsPage: vi.fn(),
    listCategories: vi.fn()
  }
}));

vi.mock('../EcommerceProductPublishModal', () => ({
  default: () => null
}));

const portal = {
  id: 'portal-a',
  name: 'Tienda de prueba',
  slug: 'tienda-prueba',
  status: 'paused',
  pickupEnabled: true,
  deliveryEnabled: false,
  minOrderTotal: 0
};

const product = {
  id: 'published-a',
  localProductRef: 'local-a',
  publicName: 'Producto publicado',
  categoryName: 'General',
  price: 25,
  isPublished: true,
  isAvailable: true,
  displayOrder: 1
};

const setAuthorizedStore = ({ snapshot, loadStockAlerts, reconcile } = {}) => {
  useAppStore.setState({
    companyProfile: { name: 'Tienda de prueba' },
    currentDeviceRole: 'admin',
    currentStaffUser: null,
    licenseDetails: { license_key: 'license-a' },
    deviceFingerprint: 'device-a',
    _isInitializing: false,
    canAccess: vi.fn(() => true),
    ecommercePublishedStockAlertSnapshot: snapshot || null,
    ecommercePublishedStockAlertLoading: false,
    ecommercePublishedStockAlertError: null,
    ecommercePublishedStockAlertContextKey: 'license-a:admin:admin:device-a',
    loadEcommercePublishedStockAlerts: loadStockAlerts || vi.fn(async () => ({ success: true })),
    invalidateEcommercePublishedStockAlerts: vi.fn(),
    reconcileEcommercePublishedStockAlertProducts: reconcile || vi.fn()
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  getEcommercePortal.mockResolvedValue({
    success: true,
    portal,
    plan: { code: 'free_trial', name: 'Plan Free' },
    features: { customSlug: false, maxPublishedProducts: 10 }
  });
  listPublishedProducts.mockResolvedValue({ success: true, products: [product] });
  savePublishedProduct.mockResolvedValue({ success: true });
  setProductPublished.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({
    currentDeviceRole: null,
    currentStaffUser: null,
    licenseDetails: null,
    ecommercePublishedStockAlertSnapshot: null,
    ecommercePublishedStockAlertContextKey: null
  });
});

describe('EcommercePortalSettings published stock alerts', () => {
  it('muestra banner y warning individual aun con el portal pausado', async () => {
    setAuthorizedStore({
      snapshot: {
        success: true,
        portalStatus: 'paused',
        outOfStockCount: 1,
        sourceMissingCount: 0,
        inactiveSourceCount: 0,
        unverifiedCount: 0,
        products: [{
          publishedProductId: product.id,
          localProductRef: product.localProductRef,
          status: 'out_of_stock',
          availableStock: 0
        }]
      }
    });

    render(<EcommercePortalSettings />);

    expect(await screen.findByText('Productos publicados sin stock'))
      .toBeInTheDocument();
    expect(screen.getByText('Publicado sin stock')).toBeInTheDocument();
    expect(screen.getByLabelText('Productos publicados en portal')).toHaveAttribute(
      'id',
      'ecommerce-published-products'
    );
  });

  it('diferencia referencia faltante, producto inactivo y lectura no verificable', async () => {
    const products = [
      product,
      { ...product, id: 'published-b', localProductRef: 'local-b', publicName: 'Producto B' },
      { ...product, id: 'published-c', localProductRef: 'local-c', publicName: 'Producto C' }
    ];
    listPublishedProducts.mockResolvedValue({ success: true, products });
    setAuthorizedStore({
      snapshot: {
        success: true,
        portalStatus: 'published',
        outOfStockCount: 0,
        sourceMissingCount: 1,
        inactiveSourceCount: 1,
        unverifiedCount: 1,
        products: [
          { publishedProductId: 'published-a', localProductRef: 'local-a', status: 'source_missing' },
          { publishedProductId: 'published-b', localProductRef: 'local-b', status: 'inactive_source' },
          { publishedProductId: 'published-c', localProductRef: 'local-c', status: 'unverified' }
        ]
      }
    });

    render(<EcommercePortalSettings />);

    expect(await screen.findByText('Algunos productos publicados requieren revision'))
      .toBeInTheDocument();
    expect(screen.getByText('Producto original no encontrado')).toBeInTheDocument();
    expect(screen.getByText('Producto original inactivo')).toBeInTheDocument();
    expect(screen.getByText('No se pudo verificar el stock')).toBeInTheDocument();
    expect(screen.queryByText('Productos publicados sin stock')).not.toBeInTheDocument();
  });

  it('no muestra warning para un producto despublicado', async () => {
    listPublishedProducts.mockResolvedValue({
      success: true,
      products: [{ ...product, isPublished: false }]
    });
    setAuthorizedStore({
      snapshot: {
        success: true,
        portalStatus: 'published',
        outOfStockCount: 1,
        sourceMissingCount: 0,
        inactiveSourceCount: 0,
        unverifiedCount: 0,
        products: [{
          publishedProductId: product.id,
          localProductRef: product.localProductRef,
          status: 'out_of_stock'
        }]
      }
    });

    render(<EcommercePortalSettings />);

    expect(await screen.findByText('Producto publicado')).toBeInTheDocument();
    expect(screen.queryByText('Publicado sin stock')).not.toBeInTheDocument();
  });

  it('reconcilia y fuerza evaluacion despues de despublicar', async () => {
    const loadStockAlerts = vi.fn(async () => ({ success: true }));
    const reconcile = vi.fn();
    listPublishedProducts
      .mockResolvedValueOnce({ success: true, products: [product] })
      .mockResolvedValueOnce({
        success: true,
        products: [{ ...product, isPublished: false }]
      });
    setAuthorizedStore({
      loadStockAlerts,
      reconcile,
      snapshot: {
        success: true,
        portalStatus: 'paused',
        outOfStockCount: 1,
        products: [{
          publishedProductId: product.id,
          localProductRef: product.localProductRef,
          status: 'out_of_stock'
        }]
      }
    });

    render(<EcommercePortalSettings />);
    const button = await screen.findByRole('button', {
      name: 'Despublicar Producto publicado'
    });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(setProductPublished).toHaveBeenCalledWith(
      product.id,
      false
    ));
    expect(reconcile).toHaveBeenCalledWith({
      portal,
      publishedProducts: [{ ...product, isPublished: false }]
    });
    expect(loadStockAlerts).toHaveBeenLastCalledWith(expect.objectContaining({
      force: true,
      reason: 'published-product-toggled',
      publishedProducts: [{ ...product, isPublished: false }]
    }));
  });
});
