import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSale: vi.fn(),
  firstSale: vi.fn(),
  processSaleCore: vi.fn(),
  splitOpenTableOrderCore: vi.fn(),
  table: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  grantedHandle: {
    actorKey: 'admin:test',
    generation: 1,
    tenant: { opaqueId: 'tenant-test', generation: 1 },
    assertCurrent: vi.fn()
  }
}));

vi.mock('../database', () => ({
  db: {
    table: (...args) => mocks.table(...args),
    transaction: vi.fn()
  },
  loadData: vi.fn(),
  saveData: vi.fn(),
  STORES: {
    SALES: 'sales',
    DELETED_SALES: 'deletedSales'
  },
  queryBatchesByProductIdAndActive: vi.fn(),
  queryByIndex: vi.fn(),
  executeSaleTransactionSafe: vi.fn(),
  executeSplitOpenTableOrderTransactionSafe: vi.fn(),
  loadMultipleData: vi.fn(),
  productsRepository: {
    restoreStockFromCancellation: vi.fn(),
    reapplyStockFromCancellation: vi.fn()
  }
}));

// This suite owns the ecommerce idempotency/retry contract, not ActorRuntime.
// Model the already-proven GRANTED boundary explicitly so these historical
// unit tests continue to exercise their original behavior without restoring a
// permissive production fallback for LOCKED/HANDOFF_CHECK.
vi.mock('../auth/actorOperationalHandoff', () => ({
  runCheckoutActorOperation: async ({ operation }) => operation({ handle: mocks.grantedHandle }),
  runTrackedActorOperationIfGranted: async (_label, operation) => operation({ handle: mocks.grantedHandle })
}));

vi.mock('../sales/processSaleCore', () => ({
  processSaleCore: (...args) => mocks.processSaleCore(...args)
}));

vi.mock('../sales/splitOrderService', () => ({
  splitOpenTableOrderCore: (...args) => mocks.splitOpenTableOrderCore(...args)
}));

vi.mock('../sales/receiptWhatsApp', () => ({ sendReceiptWhatsApp: vi.fn() }));
vi.mock('../sales/cancelSaleCore', () => ({ cancelSaleCore: vi.fn() }));
vi.mock('../sales/restoreDeletedSaleCore', () => ({ restoreDeletedSaleCore: vi.fn() }));
vi.mock('../salesCloud/salesCloudCancellationService', () => ({
  salesCloudCancellationService: { cancelCloudSale: vi.fn() }
}));
vi.mock('../salesCloud/salesCloudCancellationMapper', () => ({ isCloudCommittedSale: vi.fn(() => false) }));
vi.mock('../../store/useStatsStore', () => ({
  useStatsStore: { getState: () => ({ rebuildFinancialStats: vi.fn(), adjustInventoryValue: vi.fn() }) }
}));
vi.mock('../utils', () => ({
  generateID: vi.fn(() => 'generated-id'),
  roundCurrency: vi.fn((value) => value),
  sendWhatsAppMessage: vi.fn()
}));
vi.mock('../pricingLogic', () => ({ calculatePricingDetails: vi.fn() }));
vi.mock('../Logger', () => ({
  default: {
    log: vi.fn(),
    info: vi.fn(),
    error: (...args) => mocks.loggerError(...args),
    warn: (...args) => mocks.loggerWarn(...args)
  }
}));

import { processSale, salesServiceInternals, splitOpenTableOrder } from '../salesService';

const ecommerceParams = {
  activeOrderId: 'ecom-order-1',
  order: [{ id: 'product-1', quantity: 1, price: 10 }],
  paymentData: {
    paymentMethod: 'cash',
    __ecommerceCheckout: {
      origin: 'ecommerce',
      idempotencyKey: 'ecommerce:order-1'
    }
  },
  total: 10,
  allProducts: [],
  features: {}
};

const configureSalesTable = () => {
  mocks.table.mockImplementation((store) => {
    if (store !== 'sales') throw new Error(`Unexpected store: ${store}`);
    return {
      get: (...args) => mocks.getSale(...args),
      filter: () => ({ first: (...args) => mocks.firstSale(...args) })
    };
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grantedHandle.assertCurrent.mockReset();
  salesServiceInternals.clearEcommerceSalePromisesForTests();
  configureSalesTable();
});

describe('salesService ecommerce idempotency', () => {
  it('requires the confirming POS actor and rebinds the split to its tracked handle', async () => {
    mocks.splitOpenTableOrderCore.mockResolvedValueOnce({ success: true });

    const result = await splitOpenTableOrder({ actorContext: mocks.grantedHandle });

    expect(result).toEqual({ success: true });
    expect(mocks.grantedHandle.assertCurrent).toHaveBeenCalledWith('pos');
    expect(mocks.splitOpenTableOrderCore).toHaveBeenCalledWith(
      expect.objectContaining({ actorContext: mocks.grantedHandle }),
      expect.any(Object)
    );
  });

  it('blocks a split call that does not carry the confirmation actor context', async () => {
    await expect(splitOpenTableOrder({})).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(mocks.splitOpenTableOrderCore).not.toHaveBeenCalled();
  });

  it.each([
    { source: 'local', committedResult: { success: true, parentOrderId: 'table-1', childSaleIds: ['child-1'] } },
    { source: 'Cloud', committedResult: { success: true, cloudCommitted: true, sourceMode: 'cloud_committed' } }
  ])('preserves an already committed $source split if actor authority changes before returning', async ({ committedResult }) => {
    mocks.grantedHandle.assertCurrent
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
      });
    mocks.splitOpenTableOrderCore.mockResolvedValueOnce(committedResult);

    const result = await splitOpenTableOrder({ parentOrderId: 'table-1', actorContext: mocks.grantedHandle });

    expect(result).toEqual(committedResult);
    expect(mocks.splitOpenTableOrderCore).toHaveBeenCalledTimes(1);
  });

  it('fails closed before processSaleCore when Dexie cannot read existing sales', async () => {
    mocks.getSale.mockRejectedValueOnce(new Error('DEXIE_READ_FAILED'));

    const result = await processSale(ecommerceParams);

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_SALE_READ_FAILED',
      errorType: 'ECOMMERCE_SALE_READ_FAILED',
      preserveEcommerceReservation: true
    });
    expect(mocks.processSaleCore).not.toHaveBeenCalled();
  });

  it('fails closed when the verification read fails after an internal sale error', async () => {
    mocks.getSale
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mocks.firstSale
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('DEXIE_SECOND_READ_FAILED'));
    mocks.processSaleCore.mockResolvedValueOnce({
      success: false,
      errorType: 'CLOUD_CASHIER_FAILED',
      message: 'Resultado de commit incierto'
    });

    const result = await processSale(ecommerceParams);

    expect(mocks.processSaleCore).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_SALE_READ_FAILED',
      preserveEcommerceReservation: true
    });
  });

  it('does not apply ecommerce read guards to a normal POS sale', async () => {
    const normalParams = {
      ...ecommerceParams,
      activeOrderId: 'normal-order-1',
      paymentData: { paymentMethod: 'cash' }
    };
    mocks.processSaleCore.mockResolvedValueOnce({ success: true, saleId: 'normal-order-1' });

    const result = await processSale(normalParams);

    expect(result).toEqual({ success: true, saleId: 'normal-order-1' });
    expect(mocks.getSale).not.toHaveBeenCalled();
    expect(mocks.processSaleCore).toHaveBeenCalledTimes(1);
  });

  it('keeps normal POS RACE_CONDITION retries unchanged', async () => {
    vi.useFakeTimers();
    try {
      const normalParams = {
        ...ecommerceParams,
        activeOrderId: 'normal-order-race',
        paymentData: { paymentMethod: 'cash' }
      };
      mocks.processSaleCore
        .mockResolvedValueOnce({ success: false, errorType: 'RACE_CONDITION' })
        .mockResolvedValueOnce({ success: true, saleId: 'normal-order-race' });

      const promise = processSale(normalParams, 2);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ success: true, saleId: 'normal-order-race' });
      expect(mocks.processSaleCore).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
