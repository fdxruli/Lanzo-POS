import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../sales/postSaleEffects', () => ({
  runPostSaleEffects: vi.fn(async () => undefined)
}));

vi.mock('../../salesCloud/salesCloudShadowService', () => ({
  salesCloudShadowService: {
    syncSaleShadowAfterLocalCommit: vi.fn(async () => ({ skipped: true }))
  }
}));

import { splitOpenTableOrderCore } from '../../sales/splitOrderService';
import { runPostSaleEffects } from '../../sales/postSaleEffects';
import { salesCloudShadowService } from '../../salesCloud/salesCloudShadowService';

const buildParentSale = () => ({
  id: 'sale-open-1',
  timestamp: '2026-03-19T18:00:00.000Z',
  updatedAt: '2026-03-19T18:10:00.000Z',
  status: 'open',
  orderType: 'table',
  tableData: 'Mesa 5',
  total: '500',
  items: [
    {
      id: 'prod-1',
      name: 'Producto 1',
      quantity: 2,
      price: 250,
      inventoryReservation: {
        source: 'table',
        committedQuantity: 2,
        committedBatches: []
      }
    }
  ]
});

const makeDeps = (parentSale = buildParentSale(), overrides = {}) => ({
  loadData: vi.fn(async (store, key) => {
    if (store === 'sales' && key === parentSale.id) return structuredClone(parentSale);
    return null;
  }),
  loadMultipleData: vi.fn(async (store) => {
    if (store === 'customers') return [{ id: 'cust-1', debt: '0', creditLimit: '1000' }];
    return [{ id: 'prod-1', name: 'Producto 1', trackStock: true, cost: 100 }];
  }),
  STORES: { SALES: 'sales', MENU: 'menu', CUSTOMERS: 'customers' },
  executeSplitOpenTableOrderTransactionSafe: vi.fn(async () => ({ success: true })),
  useStatsStore: { getState: () => ({ updateStatsForNewSale: vi.fn() }) },
  roundCurrency: (value) => Math.round(value * 100) / 100,
  sendReceiptWhatsApp: vi.fn(async () => true),
  Logger: { time: vi.fn(), timeEnd: vi.fn(), warn: vi.fn(), error: vi.fn() },
  ...overrides
});

const makeParams = (parentSale = buildParentSale(), overrides = {}) => ({
  parentOrderId: parentSale.id,
  orderSnapshot: structuredClone(parentSale.items),
  mode: 'manual',
  tickets: [
    {
      label: 'A',
      paymentData: { paymentMethod: 'efectivo', amountPaid: '250', sendReceipt: false },
      lines: [{ lineIndex: 0, quantity: 1 }]
    },
    {
      label: 'B',
      paymentData: { paymentMethod: 'efectivo', amountPaid: '250', sendReceipt: false },
      lines: [{ lineIndex: 0, quantity: 1 }]
    }
  ],
  features: { hasKDS: false },
  companyName: 'Mi negocio',
  ...overrides
});

describe('splitOpenTableOrderCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('splits table order into closed child sales and returns cloud-safe split payload', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(makeParams(parentSale), deps);

    expect(result.success).toBe(true);
    expect(result.splitGroupId).toBeTruthy();
    expect(result.parentOrderId).toBe(parentSale.id);
    expect(result.childSaleIds).toHaveLength(2);
    expect(result.childSales).toHaveLength(2);
    expect(result.total).toBe('500');
    expect(result.paymentSummary).toMatchObject({
      source: 'split_bill',
      splitGroupId: result.splitGroupId,
      parentOrderId: parentSale.id,
      childSaleIds: result.childSaleIds,
      methods: ['efectivo'],
      amountPaidTotal: '500',
      balanceDueTotal: '0',
      total: '500',
      sourceMode: 'shadow/local_applied'
    });
    expect(result.paymentSummary.tickets).toEqual([
      expect.objectContaining({ label: 'A', saleId: result.childSaleIds[0], paymentMethod: 'efectivo', amountPaid: '250', saldoPendiente: '0', total: '250' }),
      expect.objectContaining({ label: 'B', saleId: result.childSaleIds[1], paymentMethod: 'efectivo', amountPaid: '250', saldoPendiente: '0', total: '250' })
    ]);

    const transactionPayload = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0];
    expect(transactionPayload.parentOrderId).toBe(parentSale.id);
    expect(transactionPayload.parentExpectedVersion).toBe(parentSale.updatedAt);
    expect(transactionPayload.childPayloads).toHaveLength(2);
    expect(transactionPayload.childPayloads[0].sale).toMatchObject({
      status: 'closed',
      splitParentId: parentSale.id,
      splitLabel: 'A',
      total: '250',
      orderType: 'table',
      metadata: {
        source: 'split_bill_child',
        splitGroupId: result.splitGroupId,
        splitParentId: parentSale.id,
        splitLabel: 'A'
      }
    });

    expect(runPostSaleEffects).toHaveBeenCalledTimes(2);
    expect(salesCloudShadowService.syncSaleShadowAfterLocalCommit).toHaveBeenCalledTimes(2);
    expect(salesCloudShadowService.syncSaleShadowAfterLocalCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.childSaleIds[0],
        splitGroupId: result.splitGroupId,
        splitParentId: parentSale.id,
        splitLabel: 'A',
        orderType: 'table'
      }),
      expect.objectContaining({
        reason: 'split_bill_child',
        source: 'split_bill_child',
        splitGroupId: result.splitGroupId,
        splitParentId: parentSale.id,
        splitLabel: 'A',
        paymentSummary: result.paymentSummary
      })
    );
  });

  it('includes fiado ticket details in paymentSummary', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          { label: 'T1', paymentData: { paymentMethod: 'efectivo', amountPaid: '250', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'T2', paymentData: { paymentMethod: 'fiado', amountPaid: '100', customerId: 'cust-1', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 1 }] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(true);
    expect(result.paymentSummary.methods).toEqual(['efectivo', 'fiado']);
    expect(result.paymentSummary.amountPaidTotal).toBe('350');
    expect(result.paymentSummary.balanceDueTotal).toBe('150');
    expect(result.paymentSummary.tickets[1]).toMatchObject({
      label: 'T2',
      paymentMethod: 'fiado',
      amountPaid: '100',
      saldoPendiente: '150',
      customerId: 'cust-1',
      total: '250'
    });
  });

  it('blocks split if local snapshot differs from open order in db', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);
    const dirtySnapshot = structuredClone(parentSale.items);
    dirtySnapshot[0].quantity = 3;

    const result = await splitOpenTableOrderCore(makeParams(parentSale, { orderSnapshot: dirtySnapshot }), deps);

    expect(result).toMatchObject({ success: false, errorType: 'DIRTY_ORDER' });
    expect(deps.executeSplitOpenTableOrderTransactionSafe).not.toHaveBeenCalled();
    expect(salesCloudShadowService.syncSaleShadowAfterLocalCommit).not.toHaveBeenCalled();
  });

  it('keeps N-way inventory reservation split behavior', async () => {
    const parentSale = {
      ...buildParentSale(),
      total: '600',
      items: [
        {
          id: 'prod-1',
          name: 'Producto 1',
          quantity: 6,
          price: 100,
          inventoryReservation: {
            source: 'table',
            committedQuantity: 6,
            committedBatches: [{ batchId: 'batch-1', ingredientId: 'ing-1', quantity: 6, cost: 50 }]
          }
        }
      ]
    };

    const deps = makeDeps(parentSale);
    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          { label: 'T1', paymentData: { paymentMethod: 'efectivo', amountPaid: '200', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 2 }] },
          { label: 'T2', paymentData: { paymentMethod: 'efectivo', amountPaid: '200', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 2 }] },
          { label: 'T3', paymentData: { paymentMethod: 'efectivo', amountPaid: '200', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 2 }] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(true);
    const payload = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0];
    const childT1 = payload.childPayloads.find((c) => c.sale.splitLabel === 'T1');
    const childT2 = payload.childPayloads.find((c) => c.sale.splitLabel === 'T2');
    const childT3 = payload.childPayloads.find((c) => c.sale.splitLabel === 'T3');

    expect(childT1.sale.items[0].inventoryReservation.committedQuantity).toBe(2);
    expect(childT2.sale.items[0].inventoryReservation.committedQuantity).toBe(2);
    expect(childT3.sale.items[0].inventoryReservation.committedQuantity).toBe(2);

    const totalBatchQty = childT1.sale.items[0].inventoryReservation.committedBatches[0].quantity +
      childT2.sale.items[0].inventoryReservation.committedBatches[0].quantity +
      childT3.sale.items[0].inventoryReservation.committedBatches[0].quantity;
    expect(totalBatchQty).toBe(6);
  });
});