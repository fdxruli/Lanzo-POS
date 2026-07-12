import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSale: vi.fn(),
  pullSalesSnapshot: vi.fn(),
  saveCloudCommittedSaleSnapshot: vi.fn(),
  applyCloudSalesPayload: vi.fn()
}));

vi.mock('../../supabase', () => ({
  getStableDeviceId: vi.fn(async () => 'device-a')
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({ licenseDetails: { license_key: 'LIC-1' } })
  }
}));

vi.mock('../../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: vi.fn((details) => details?.license_key || null),
  isCloudSalesCashierEnabled: vi.fn(() => true),
  isCloudSalesCreditEnabled: vi.fn(() => true),
  isCloudSalesInventoryEnabled: vi.fn(() => true)
}));

vi.mock('../../products/productSyncHandler', () => ({ pullCatalogChanges: vi.fn() }));
vi.mock('../salesCloudRepository', () => ({
  salesCloudRepository: {
    getSale: (...args) => mocks.getSale(...args),
    pullSalesSnapshot: (...args) => mocks.pullSalesSnapshot(...args),
    createCloudCashierSale: vi.fn(),
    createCloudCashierInventorySale: vi.fn(),
    createCloudCreditSale: vi.fn()
  }
}));
vi.mock('../salesCloudLocalRepository', () => ({
  salesCloudLocalRepository: {
    saveCloudCommittedSaleSnapshot: (...args) => mocks.saveCloudCommittedSaleSnapshot(...args),
    applyCloudSalesPayload: (...args) => mocks.applyCloudSalesPayload(...args)
  }
}));

import {
  salesCloudCashierService,
  salesCloudCashierServiceInternals
} from '../salesCloudCashierService';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true }
  });
});

describe('salesCloudCashierService ecommerce idempotency', () => {
  it('uses the ecommerce business key without a device suffix', () => {
    const result = salesCloudCashierServiceInternals.buildCloudSaleIdempotencyKey({
      sale: {
        id: 'ecom-order-1',
        metadata: {
          origin: 'ecommerce',
          ecommerceOrderId: 'order-1',
          ecommerceConversionKey: 'ecommerce:order-1'
        }
      },
      payload: { idempotencyKey: 'sales.cloud_commit:ecom-order-1' },
      deviceId: 'device-a'
    });

    expect(result).toBe('ecommerce:order-1');
  });

  it('preserves the historical device suffix for normal POS sales', () => {
    const result = salesCloudCashierServiceInternals.buildCloudSaleIdempotencyKey({
      sale: { id: 'normal-sale-1', metadata: { origin: 'pos' } },
      payload: { idempotencyKey: 'sales.cloud_commit:normal-sale-1' },
      deviceId: 'device-a'
    });

    expect(result).toBe('sales.cloud_commit:normal-sale-1:device-a');
  });

  it('recovers a committed cloud sale into Dexie using local_sale_id', async () => {
    mocks.getSale.mockResolvedValueOnce({ success: false, code: 'SALE_NOT_FOUND' });
    mocks.pullSalesSnapshot.mockResolvedValueOnce({
      success: true,
      sales: [{
        id: 'cloud-sale-1',
        local_sale_id: 'ecom-order-1',
        status: 'closed',
        metadata: { ecommerceConversionKey: 'ecommerce:order-1' }
      }],
      items: [{ sale_id: 'cloud-sale-1', id: 'item-1' }],
      payments: [{ sale_id: 'cloud-sale-1', id: 'payment-1' }]
    });
    mocks.saveCloudCommittedSaleSnapshot.mockResolvedValueOnce({
      id: 'ecom-order-1',
      cloudSaleId: 'cloud-sale-1',
      status: 'closed',
      metadata: { ecommerceConversionKey: 'ecommerce:order-1' }
    });

    const result = await salesCloudCashierService.verifyCommittedSale({
      localSaleId: 'ecom-order-1',
      idempotencyKey: 'ecommerce:order-1',
      startedAt: '2026-07-11T20:00:00.000Z'
    });

    expect(result).toMatchObject({
      success: true,
      exists: true,
      saleId: 'ecom-order-1',
      cloudSaleId: 'cloud-sale-1'
    });
    expect(mocks.saveCloudCommittedSaleSnapshot).toHaveBeenCalledWith({
      localSale: expect.objectContaining({
        id: 'ecom-order-1',
        sourceMode: 'cloud_committed',
        metadata: expect.objectContaining({
          ecommerceConversionKey: 'ecommerce:order-1'
        })
      }),
      response: expect.objectContaining({
        sale: expect.objectContaining({
          id: 'cloud-sale-1',
          local_sale_id: 'ecom-order-1'
        })
      })
    });
  });

  it('returns a conclusive absence only after the cloud snapshot is exhausted', async () => {
    mocks.getSale.mockResolvedValueOnce({ success: false, code: 'SALE_NOT_FOUND' });
    mocks.pullSalesSnapshot.mockResolvedValueOnce({ success: true, sales: [], items: [], payments: [] });

    const result = await salesCloudCashierService.verifyCommittedSale({
      localSaleId: 'ecom-order-1',
      idempotencyKey: 'ecommerce:order-1'
    });

    expect(result).toEqual({ success: true, exists: false });
  });

  it('keeps verification pending when cloud lookup fails', async () => {
    mocks.getSale.mockRejectedValueOnce(new Error('DIRECT_LOOKUP_FAILED'));
    mocks.pullSalesSnapshot.mockRejectedValueOnce(new Error('SNAPSHOT_FAILED'));

    const result = await salesCloudCashierService.verifyCommittedSale({
      localSaleId: 'ecom-order-1',
      idempotencyKey: 'ecommerce:order-1'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_SALE_VERIFICATION_PENDING'
    });
  });
});
