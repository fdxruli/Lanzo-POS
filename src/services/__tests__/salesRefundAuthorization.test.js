import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelSaleCore: vi.fn(),
  table: vi.fn(),
  transaction: vi.fn(),
  adjustInventoryValue: vi.fn(),
  rebuildFinancialStats: vi.fn()
}));

vi.mock('../database', () => ({
  db: {
    table: (...args) => mocks.table(...args),
    transaction: (...args) => mocks.transaction(...args)
  },
  loadData: vi.fn(),
  saveData: vi.fn(),
  STORES: {
    SALES: 'sales',
    DELETED_SALES: 'deletedSales',
    PRODUCT_BATCHES: 'productBatches',
    MENU: 'menu',
    INVENTORY_EVENTS: 'inventoryEvents',
    TRANSACTION_LOG: 'transactionLog',
    WASTE: 'waste'
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

vi.mock('../sales/cancelSaleCore', () => ({
  cancelSaleCore: (...args) => mocks.cancelSaleCore(...args)
}));
vi.mock('../sales/restoreDeletedSaleCore', () => ({ restoreDeletedSaleCore: vi.fn() }));
vi.mock('../sales/processSaleCore', () => ({ processSaleCore: vi.fn() }));
vi.mock('../sales/splitOrderService', () => ({ splitOpenTableOrderCore: vi.fn() }));
vi.mock('../sales/receiptWhatsApp', () => ({ sendReceiptWhatsApp: vi.fn() }));
vi.mock('../salesCloud/salesCloudCancellationService', () => ({
  salesCloudCancellationService: { cancelCloudSale: vi.fn() }
}));
vi.mock('../salesCloud/salesCloudCancellationMapper', () => ({
  isCloudCommittedSale: vi.fn(() => false)
}));
vi.mock('../../store/useStatsStore', () => ({
  useStatsStore: {
    getState: () => ({
      adjustInventoryValue: mocks.adjustInventoryValue,
      rebuildFinancialStats: mocks.rebuildFinancialStats
    })
  }
}));
vi.mock('../utils', () => ({
  generateID: vi.fn(() => 'generated-id'),
  roundCurrency: vi.fn((value) => value),
  sendWhatsAppMessage: vi.fn()
}));
vi.mock('../pricingLogic', () => ({ calculatePricingDetails: vi.fn() }));
vi.mock('../Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));

import { cancelSale } from '../salesService';

const sale = {
  id: 'sale-1',
  timestamp: '2026-08-24T10:00:00.000Z',
  status: 'closed',
  items: []
};

describe('sales cancellation authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelSaleCore.mockResolvedValue({ success: true, sale, restoreStock: false });
  });

  it('denies direct service invocation before cancellation core for a non-refunds actor', async () => {
    const error = new Error('ACTOR_PERMISSION_DENIED');
    error.code = 'ACTOR_PERMISSION_DENIED';
    const actorHandle = { assertCurrent: vi.fn(() => { throw error; }) };

    await expect(cancelSale({
      saleId: sale.id,
      currentSales: [sale],
      actorHandle
    })).rejects.toMatchObject({ code: 'ACTOR_PERMISSION_DENIED' });
    expect(mocks.cancelSaleCore).not.toHaveBeenCalled();
  });

  it('lets refunds authority reach the existing sale-state and financial core', async () => {
    const actorHandle = {
      actorKey: 'staff:refunds',
      assertCurrent: vi.fn(() => ({ actorKey: 'staff:refunds' }))
    };

    await expect(cancelSale({
      saleId: sale.id,
      currentSales: [sale],
      actorHandle
    })).resolves.toMatchObject({ success: true });
    expect(mocks.cancelSaleCore).toHaveBeenCalledTimes(1);
    expect(mocks.cancelSaleCore.mock.calls[0][1]).toEqual(expect.objectContaining({
      assertActorCurrent: expect.any(Function)
    }));
  });

  it('rejects a handle made stale before the first local write', async () => {
    const stale = new Error('ACTOR_CONTEXT_STALE');
    stale.code = 'ACTOR_CONTEXT_STALE';
    let checks = 0;
    const actorHandle = {
      assertCurrent: vi.fn(() => {
        checks += 1;
        if (checks >= 2) throw stale;
        return { actorKey: 'staff:a' };
      })
    };

    await expect(cancelSale({
      saleId: sale.id,
      currentSales: [sale],
      actorHandle
    })).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(mocks.cancelSaleCore).not.toHaveBeenCalled();
  });
});
