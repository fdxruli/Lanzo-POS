import { describe, expect, it, vi } from 'vitest';
import { createEcommercePublishedStockAlertService } from '../ecommercePublishedStockAlertService';

const NOW = new Date('2026-07-12T12:00:00.000Z');

const published = (id, localProductRef = `local-${id}`) => ({
  id: `published-${id}`,
  localProductRef,
  publicName: `Producto ${id}`,
  isPublished: true
});

const createHarness = ({
  portalStatus = 'published',
  publishedProducts = [],
  localProducts = [],
  batchesByProductId = new Map(),
  getProductsByIds,
  getBatchesByProductIds,
  state
} = {}) => {
  const currentState = state || {
    licenseDetails: { license_key: 'license-a' },
    currentDeviceRole: 'admin',
    currentStaffUser: null,
    deviceFingerprint: 'device-a'
  };
  const localProductsById = new Map(localProducts.map((product) => [product.id, product]));
  const localSource = {
    getProductsByIds: getProductsByIds || vi.fn(async () => localProductsById),
    getBatchesByProductIds: getBatchesByProductIds
      || vi.fn(async () => batchesByProductId)
  };
  const getPortal = vi.fn(async () => ({
    success: true,
    portal: { id: 'portal-a', status: portalStatus }
  }));
  const getPublishedProducts = vi.fn(async () => ({
    success: true,
    products: publishedProducts
  }));
  const service = createEcommercePublishedStockAlertService({
    getState: () => currentState,
    getPortal,
    getPublishedProducts,
    localSource,
    getNow: () => new Date(NOW)
  });

  return {
    currentState,
    getPortal,
    getPublishedProducts,
    localSource,
    service
  };
};

describe('ecommercePublishedStockAlertService', () => {
  it('distingue stock cero, negativo, positivo, no controlado, faltante e inactivo', async () => {
    const publishedProducts = [
      published('zero'),
      published('negative'),
      published('positive'),
      published('not-tracked'),
      published('missing'),
      published('inactive'),
      { ...published('hidden'), isPublished: false },
      { ...published('no-ref'), localProductRef: null }
    ];
    const localProducts = [
      { id: 'local-zero', trackStock: true, stock: 0, committedStock: 0 },
      { id: 'local-negative', trackStock: true, stock: -3, committedStock: 0 },
      { id: 'local-positive', trackStock: true, stock: 4, committedStock: 1 },
      { id: 'local-not-tracked', trackStock: false, stock: 0 },
      { id: 'local-inactive', trackStock: true, stock: 5, isActive: false }
    ];
    const { service } = createHarness({ publishedProducts, localProducts });

    const result = await service.evaluatePublishedProductStockAlerts();
    const statuses = new Map(result.products.map((product) => [
      product.localProductRef,
      product.status
    ]));

    expect(result.success).toBe(true);
    expect(result.publishedCount).toBe(6);
    expect(result.outOfStockCount).toBe(2);
    expect(statuses.get('local-zero')).toBe('out_of_stock');
    expect(statuses.get('local-negative')).toBe('out_of_stock');
    expect(statuses.get('local-positive')).toBe('in_stock');
    expect(statuses.get('local-not-tracked')).toBe('not_tracked');
    expect(statuses.get('local-missing')).toBe('source_missing');
    expect(statuses.get('local-inactive')).toBe('inactive_source');
    expect(statuses.has('local-hidden')).toBe(false);
    expect(statuses.has('local-no-ref')).toBe(false);
  });

  it('no convierte una lectura local fallida en stock cero', async () => {
    const getProductsByIds = vi.fn(async () => {
      throw new Error('Dexie unavailable');
    });
    const { service } = createHarness({
      publishedProducts: [published('one')],
      getProductsByIds
    });

    const result = await service.evaluatePublishedProductStockAlerts();

    expect(result.success).toBe(true);
    expect(result.outOfStockCount).toBe(0);
    expect(result.unverifiedCount).toBe(1);
    expect(result.products[0].status).toBe('unverified');
  });

  it('usa solo lotes vendibles y excluye vencidos, bloqueados y agotados', async () => {
    const localProduct = {
      id: 'local-batches',
      trackStock: true,
      batchManagement: { enabled: true },
      expirationMode: 'STRICT'
    };
    const batchesByProductId = new Map([[
      localProduct.id,
      [
        {
          id: 'expired',
          productId: localProduct.id,
          stock: 10,
          committedStock: 0,
          isActive: true,
          expiryDate: '2026-07-10'
        },
        {
          id: 'blocked',
          productId: localProduct.id,
          stock: 8,
          committedStock: 0,
          isActive: true,
          status: 'blocked',
          expiryDate: '2026-08-01'
        },
        {
          id: 'empty',
          productId: localProduct.id,
          stock: 3,
          committedStock: 3,
          isActive: true,
          expiryDate: '2026-08-01'
        }
      ]
    ]]);
    const { service } = createHarness({
      publishedProducts: [published('batches')],
      localProducts: [localProduct],
      batchesByProductId
    });

    const result = await service.evaluatePublishedProductStockAlerts();

    expect(result.products[0]).toMatchObject({
      status: 'out_of_stock',
      availableStock: 0
    });
  });

  it('considera un lote vigente y las cantidades reservadas', async () => {
    const localProduct = {
      id: 'local-batches',
      trackStock: true,
      batchManagement: { enabled: true },
      expirationMode: 'STRICT'
    };
    const batchesByProductId = new Map([[
      localProduct.id,
      [{
        id: 'sellable',
        productId: localProduct.id,
        stock: 6,
        committedStock: 2,
        isActive: true,
        expiryDate: '2026-08-01'
      }]
    ]]);
    const { service } = createHarness({
      publishedProducts: [published('batches')],
      localProducts: [localProduct],
      batchesByProductId
    });

    const result = await service.evaluatePublishedProductStockAlerts();

    expect(result.products[0]).toMatchObject({
      status: 'in_stock',
      availableStock: 4
    });
  });

  it('convierte el inventario a la unidad vendible real', async () => {
    const { service } = createHarness({
      publishedProducts: [published('conversion')],
      localProducts: [{
        id: 'local-conversion',
        trackStock: true,
        stock: 1,
        committedStock: 0,
        conversionFactor: { enabled: true, factor: 12 }
      }]
    });

    const result = await service.evaluatePublishedProductStockAlerts();

    expect(result.products[0]).toMatchObject({
      status: 'in_stock',
      availableStock: 12
    });
  });

  it('resuelve mas de 500 referencias mediante lecturas masivas sin N+1', async () => {
    const publishedProducts = Array.from({ length: 601 }, (_, index) => (
      published(String(index))
    ));
    const localProducts = publishedProducts.map((item) => ({
      id: item.localProductRef,
      trackStock: true,
      stock: 1,
      committedStock: 0
    }));
    const { service, localSource } = createHarness({
      publishedProducts,
      localProducts
    });

    const result = await service.evaluatePublishedProductStockAlerts();

    expect(result.publishedCount).toBe(601);
    expect(result.outOfStockCount).toBe(0);
    expect(localSource.getProductsByIds).toHaveBeenCalledTimes(1);
    expect(localSource.getProductsByIds.mock.calls[0][0]).toHaveLength(601);
    expect(localSource.getBatchesByProductIds).not.toHaveBeenCalled();
  });

  it('deduplica evaluaciones concurrentes mediante single-flight', async () => {
    let resolveProducts;
    const productsPromise = new Promise((resolve) => {
      resolveProducts = resolve;
    });
    const getProductsByIds = vi.fn(() => productsPromise);
    const harness = createHarness({
      publishedProducts: [published('one')],
      getProductsByIds
    });

    const requests = [
      harness.service.evaluatePublishedProductStockAlerts(),
      harness.service.evaluatePublishedProductStockAlerts(),
      harness.service.evaluatePublishedProductStockAlerts()
    ];
    resolveProducts(new Map([[
      'local-one',
      { id: 'local-one', trackStock: true, stock: 1, committedStock: 0 }
    ]]));
    const results = await Promise.all(requests);

    expect(results.every((result) => result.success)).toBe(true);
    expect(harness.getPortal).toHaveBeenCalledTimes(1);
    expect(harness.getPublishedProducts).toHaveBeenCalledTimes(1);
    expect(getProductsByIds).toHaveBeenCalledTimes(1);
  });

  it('descarta la respuesta cuando cambia la identidad de licencia', async () => {
    const currentState = {
      licenseDetails: { license_key: 'license-a' },
      currentDeviceRole: 'admin',
      currentStaffUser: null,
      deviceFingerprint: 'device-a'
    };
    let resolveProducts;
    const productsPromise = new Promise((resolve) => {
      resolveProducts = resolve;
    });
    const harness = createHarness({
      state: currentState,
      publishedProducts: [published('one')],
      getProductsByIds: vi.fn(() => productsPromise)
    });

    const pending = harness.service.evaluatePublishedProductStockAlerts();
    currentState.licenseDetails = { license_key: 'license-b' };
    resolveProducts(new Map([[
      'local-one',
      { id: 'local-one', trackStock: true, stock: 0, committedStock: 0 }
    ]]));
    const result = await pending;

    expect(result.stale).toBe(true);
  });

  it('evalua productos en portal pausado sin convertirlos en alerta operacional', async () => {
    const { service } = createHarness({
      portalStatus: 'paused',
      publishedProducts: [published('zero')],
      localProducts: [{
        id: 'local-zero',
        trackStock: true,
        stock: 0,
        committedStock: 0
      }]
    });

    const result = await service.evaluatePublishedProductStockAlerts();

    expect(result.portalStatus).toBe('paused');
    expect(result.outOfStockCount).toBe(1);
  });
});
