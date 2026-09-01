import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSale: vi.fn(),
  pullSalesSnapshot: vi.fn(),
  saveCloudCommittedSaleSnapshot: vi.fn(),
  applyCloudSalesPayload: vi.fn(),
  createCloudCashierSale: vi.fn(),
  createCloudCashierInventorySale: vi.fn(),
  createCloudCreditSale: vi.fn(),
  executeFinancialOperation: vi.fn(),
  markProjectionApplied: vi.fn(),
  markProjectionFailed: vi.fn(),
  pullCatalogChanges: vi.fn(),
  recoveryTrace: [],
  cloudCashierEnabled: true,
  actorHandle: { assertCurrent: vi.fn() }
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
  isCloudSalesCashierEnabled: vi.fn(() => mocks.cloudCashierEnabled),
  isCloudSalesCreditEnabled: vi.fn(() => true),
  isCloudSalesInventoryEnabled: vi.fn(() => true),
  SYNC_ENTITY_TYPES: {
    CASH: 'cash',
    CASH_SESSION: 'cash_session',
    CASH_MOVEMENT: 'cash_movement'
  },
  SYNC_OPERATIONS: {
    MOVEMENT: 'movement',
    OPEN: 'open',
    CLOSE: 'close'
  }
}));

vi.mock('../../products/productSyncHandler', () => ({ pullCatalogChanges: mocks.pullCatalogChanges }));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: {
    capture: () => mocks.actorHandle,
    subscribe: () => () => {}
  }
}));
vi.mock('../../financial/financialIntentLedger', () => ({
  markFinancialIntentProjectionApplied: (...args) => mocks.markProjectionApplied(...args),
  markFinancialIntentProjectionFailed: (...args) => mocks.markProjectionFailed(...args)
}));
vi.mock('../salesCloudRepository', () => ({
  salesCloudRepository: {
    getSale: (...args) => mocks.getSale(...args),
    pullSalesSnapshot: (...args) => mocks.pullSalesSnapshot(...args),
    createCloudCashierSale: (...args) => mocks.createCloudCashierSale(...args),
    createCloudCashierInventorySale: (...args) => mocks.createCloudCashierInventorySale(...args),
    createCloudCreditSale: (...args) => mocks.createCloudCreditSale(...args)
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
  vi.stubEnv('VITE_ENABLE_CLOUD_CASHIER_SALES', 'true');
  mocks.recoveryTrace.splice(0);
  mocks.cloudCashierEnabled = true;
  mocks.saveCloudCommittedSaleSnapshot.mockResolvedValue({ id: 'sale-1', status: 'closed' });
  mocks.applyCloudSalesPayload.mockResolvedValue({ success: true });
  mocks.markProjectionApplied.mockResolvedValue(undefined);
  mocks.markProjectionFailed.mockResolvedValue(undefined);
  mocks.pullCatalogChanges.mockResolvedValue(undefined);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true }
  });
});

const makeSale = () => ({
  id: 'sale-1',
  timestamp: '2026-08-29T12:34:56.000Z',
  status: 'closed',
  items: [{ id: 'product-1', name: 'Producto', quantity: 1, price: 10, cost: 4 }],
  total: '10.00',
  subtotal: '10.00',
  paymentMethod: 'cash',
  abono: '10.00',
  saldoPendiente: '0.00',
  metadata: { origin: 'pos' }
});

const makeResponse = () => ({
  success: true,
  financialIntentId: 'intent-1',
  sale: {
    id: 'cloud-sale-1',
    local_sale_id: 'sale-1',
    effects_status: 'payment_recorded',
    inventory_effect_status: 'applied'
  },
  items: [],
  payments: []
});

const projectResponse = async (options, response, operationType = 'sale.cashier_inventory') => {
  const result = await options.project({
    intent: {
      operationType,
      requestPayload: {
        sale: options.sale,
        items: options.items,
        payments: options.payments
      },
      responsePayload: response
    },
    actorHandle: options.actorHandle
  });
  return { ...response, projection: { outcome: 'projection_applied', result } };
};

describe('salesCloudCashierService ecommerce idempotency', () => {
  it('routes Local/Free feature-disabled licenses to the local checkout path', async () => {
    mocks.cloudCashierEnabled = false;

    await expect(salesCloudCashierService.shouldUseCloudCashierSale({
      paymentData: { paymentMethod: 'cash' },
      cart: [{ id: 'product-1', quantity: 1 }]
    })).resolves.toEqual({
      useCloud: false,
      reason: 'feature_disabled'
    });
  });

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

  it('has one synchronous projection owner after BLOCKED + NOT_FOUND + SUCCESS recovery', async () => {
    const response = makeResponse();
    mocks.createCloudCashierInventorySale.mockImplementation(async (options) => {
      mocks.recoveryTrace.push('BLOCKED', 'NOT_FOUND');
      mocks.executeFinancialOperation(options);
      mocks.recoveryTrace.push('SUCCESS');
      return projectResponse(options, response);
    });

    const result = await salesCloudCashierService.processCloudCashierSale({
      sale: makeSale(),
      processedItems: makeSale().items,
      paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-1' },
      total: '10.00'
    });

    expect(result).toMatchObject({ success: true, response });
    expect(mocks.recoveryTrace).toEqual(['BLOCKED', 'NOT_FOUND', 'SUCCESS']);
    expect(mocks.executeFinancialOperation).toHaveBeenCalledTimes(1);
    expect(mocks.saveCloudCommittedSaleSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.applyCloudSalesPayload).toHaveBeenCalledTimes(1);
    expect(mocks.markProjectionApplied).not.toHaveBeenCalled();
    expect(mocks.markProjectionFailed).not.toHaveBeenCalled();
  });

  it('projects a completed receipt exactly once without a second financial execute', async () => {
    const response = makeResponse();
    mocks.recoveryTrace.push('COMPLETED_RECEIPT');
    mocks.createCloudCashierInventorySale.mockImplementation((options) => projectResponse(options, response));

    const result = await salesCloudCashierService.processCloudCashierSale({
      sale: makeSale(),
      processedItems: makeSale().items,
      paymentData: { paymentMethod: 'cash', amountPaid: 10, cashSessionId: 'session-1' },
      total: '10.00'
    });

    expect(result).toMatchObject({ success: true, response });
    expect(mocks.recoveryTrace).toEqual(['COMPLETED_RECEIPT']);
    expect(mocks.executeFinancialOperation).toHaveBeenCalledTimes(0);
    expect(mocks.saveCloudCommittedSaleSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.applyCloudSalesPayload).toHaveBeenCalledTimes(1);
    expect(mocks.markProjectionApplied).not.toHaveBeenCalled();
  });
});
