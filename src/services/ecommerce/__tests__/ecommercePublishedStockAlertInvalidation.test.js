import { describe, expect, it, vi } from 'vitest';
import { createEcommercePublishedStockAlertService } from '../ecommercePublishedStockAlertService';

const createDeferred = () => {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('ecommerce published stock invalidation', () => {
  it('inicia una lectura nueva cuando la evaluacion anterior ya fue invalidada', async () => {
    const state = {
      licenseDetails: { license_key: 'license-a' },
      currentDeviceRole: 'admin',
      currentStaffUser: null,
      deviceFingerprint: 'device-a'
    };
    const firstRead = createDeferred();
    const secondRead = createDeferred();
    const getProductsByIds = vi.fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    const service = createEcommercePublishedStockAlertService({
      getState: () => state,
      getPortal: vi.fn(async () => ({
        success: true,
        portal: { id: 'portal-a', status: 'published' }
      })),
      getPublishedProducts: vi.fn(async () => ({
        success: true,
        products: [{
          id: 'published-a',
          localProductRef: 'local-a',
          publicName: 'Producto A',
          isPublished: true
        }]
      })),
      localSource: {
        getProductsByIds,
        getBatchesByProductIds: vi.fn(async () => new Map())
      }
    });

    const firstRequest = service.evaluatePublishedProductStockAlerts();
    await vi.waitFor(() => expect(getProductsByIds).toHaveBeenCalledTimes(1));

    service.invalidateEcommercePublishedStockAlerts({
      contextKey: 'license-a:admin:admin:device-a'
    });
    const secondRequest = service.evaluatePublishedProductStockAlerts({
      force: true,
      reason: 'inventory-event'
    });
    await vi.waitFor(() => expect(getProductsByIds).toHaveBeenCalledTimes(2));

    secondRead.resolve(new Map([[
      'local-a',
      {
        id: 'local-a',
        trackStock: true,
        stock: 4,
        committedStock: 0
      }
    ]]));
    const secondResult = await secondRequest;

    firstRead.resolve(new Map([[
      'local-a',
      {
        id: 'local-a',
        trackStock: true,
        stock: 0,
        committedStock: 0
      }
    ]]));
    const firstResult = await firstRequest;

    expect(secondResult.stale).not.toBe(true);
    expect(secondResult.products[0]).toMatchObject({
      status: 'in_stock',
      availableStock: 4
    });
    expect(firstResult.stale).toBe(true);
  });
});
