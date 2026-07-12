import { describe, expect, it, vi } from 'vitest';
import { createEcommercePublishedStockAlertService } from '../ecommercePublishedStockAlertService';

const buildService = (batches) => createEcommercePublishedStockAlertService({
  getState: () => ({
    licenseDetails: { license_key: 'license-a' },
    currentDeviceRole: 'admin',
    currentStaffUser: null,
    deviceFingerprint: 'device-a'
  }),
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
    getProductsByIds: vi.fn(async () => new Map([[
      'local-a',
      {
        id: 'local-a',
        trackStock: true,
        batchManagement: { enabled: true },
        expirationMode: 'STRICT'
      }
    ]])),
    getBatchesByProductIds: vi.fn(async () => new Map([['local-a', batches]]))
  },
  getNow: () => new Date('2026-07-12T12:00:00.000Z')
});

describe('malformed batch stock', () => {
  it('clasifica como unverified cuando el unico lote activo no tiene stock verificable', async () => {
    const service = buildService([{
      id: 'batch-a',
      productId: 'local-a',
      stock: null,
      committedStock: 0,
      isActive: true,
      expiryDate: '2026-08-01'
    }]);

    const result = await service.evaluatePublishedProductStockAlerts();

    expect(result.outOfStockCount).toBe(0);
    expect(result.unverifiedCount).toBe(1);
    expect(result.products[0].status).toBe('unverified');
  });

  it('mantiene in_stock si otro lote vendible confirmado tiene existencias', async () => {
    const service = buildService([
      {
        id: 'batch-bad',
        productId: 'local-a',
        stock: null,
        committedStock: 0,
        isActive: true,
        expiryDate: '2026-08-01'
      },
      {
        id: 'batch-good',
        productId: 'local-a',
        stock: 5,
        committedStock: 1,
        isActive: true,
        expiryDate: '2026-08-01'
      }
    ]);

    const result = await service.evaluatePublishedProductStockAlerts();

    expect(result.products[0]).toMatchObject({
      status: 'in_stock',
      availableStock: 4
    });
  });
});
