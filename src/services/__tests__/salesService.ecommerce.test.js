import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSale: vi.fn(),
  firstSale: vi.fn(),
  processSaleCore: vi.fn(),
  splitOpenTableOrderCore: vi.fn(),
  table: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn()
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
    info: vi.fn(),
    error: (...args) => mocks.loggerError(...args),
    warn: (...args) => mocks.loggerWarn(...args)
  }
}));

import { processSale, salesServiceInternals } from '../salesService';

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
  salesServiceInternals.clearEcommerceSalePromisesForTests();
  configureSalesTable();
});

describe('salesService ecommerce idempotency', () => {
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
