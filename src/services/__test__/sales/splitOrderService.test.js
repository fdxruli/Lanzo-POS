import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../sales/postSaleEffects', () => ({
  runPostSaleEffects: vi.fn(async () => undefined)
}));

vi.mock('../../salesCloud/salesCloudShadowService', () => ({
  salesCloudShadowService: {
    syncSaleShadowAfterLocalCommit: vi.fn(async () => ({ skipped: true }))
  }
}));

vi.mock('../../salesCloud/salesCloudCashierService', () => ({
  salesCloudCashierService: {
    processCloudSplitTableSale: vi.fn(async () => ({ success: true, childSales: [] }))
  }
}));

import { splitOpenTableOrderCore } from '../../sales/splitOrderService';
import { salesCloudCashierService } from '../../salesCloud/salesCloudCashierService';
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
  splitIntent: 'by_items',
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

const expectNoCommitOrShadow = (deps) => {
  expect(deps.executeSplitOpenTableOrderTransactionSafe).not.toHaveBeenCalled();
  expect(salesCloudShadowService.syncSaleShadowAfterLocalCommit).not.toHaveBeenCalled();
};

describe('splitOpenTableOrderCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runPostSaleEffects.mockImplementation(async () => undefined);
    salesCloudShadowService.syncSaleShadowAfterLocalCommit.mockResolvedValue({ skipped: true });
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

  it('maps the legacy manual mode to the new by_items contract', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);
    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, { splitIntent: undefined, mode: 'manual' }),
      deps
    );

    expect(result).toMatchObject({ success: true, splitIntent: 'by_items' });
    expect(result.childSales.every((sale) => sale.metadata.splitIntent === 'by_items')).toBe(true);
  });

  it.each([
    { quantity: 1.5, parts: [0.5, 1], unitPrice: 10 },
    { quantity: 0.5, parts: [0.25, 0.25], unitPrice: 20 },
    { quantity: 2.75, parts: [1.25, 1.5], unitPrice: 4 },
    { quantity: 3.3333, parts: [1.1111, 2.2222], unitPrice: 1.5 }
  ])('preserves fractional quantity $quantity across two item tickets', async ({ quantity, parts, unitPrice }) => {
    const total = (Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100).toFixed(2);
    const item = {
      id: 'prod-1',
      name: 'Producto fraccionario',
      saleType: 'weight',
      quantity,
      price: unitPrice,
      inventoryReservation: { source: 'table', committedQuantity: quantity, committedBatches: [] }
    };
    const parentSale = { ...buildParentSale(), total, items: [item] };
    const tickets = parts.map((part, index) => ({
      label: `T${index + 1}`,
      paymentData: {
        paymentMethod: 'efectivo',
        amountPaid: (Math.round((part * unitPrice + Number.EPSILON) * 100) / 100).toFixed(2)
      },
      lines: [{ lineIndex: 0, quantity: part }]
    }));
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(makeParams(parentSale, { tickets }), deps);

    expect(result.success).toBe(true);
    const children = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0].childPayloads;
    const childQuantityTotal = children.reduce((sum, child) => sum + child.sale.items[0].quantity, 0);
    expect(childQuantityTotal).toBeCloseTo(quantity, 4);
    expect(childQuantityTotal).not.toBe(Math.ceil(quantity));
    expect(children.map((child) => child.sale.items[0].price)).toEqual([unitPrice, unitPrice]);
    expect(children.reduce((sum, child) => sum + Number(child.sale.total), 0)).toBeCloseTo(Number(total), 2);
  });

  it.each([
    { quantities: [1, 0.5], reason: 'pool' },
    { quantities: [1.5, 1], reason: 'over-assignment' }
  ])('rejects $reason quantities instead of changing the source amount', async ({ quantities }) => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);
    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: quantities.map((quantity, index) => ({
          label: `T${index + 1}`,
          paymentData: { paymentMethod: 'efectivo', amountPaid: '500' },
          lines: [{ lineIndex: 0, quantity }]
        }))
      }),
      deps
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('no está balanceada');
    expectNoCommitOrShadow(deps);
  });

  it('splits unit products with original unit prices', async () => {
    const parentSale = {
      ...buildParentSale(),
      total: '50',
      items: [{ id: 'prod-1', name: 'Producto unitario', saleType: 'unit', quantity: 2, price: 25 }]
    };
    const deps = makeDeps(parentSale);
    const result = await splitOpenTableOrderCore(makeParams(parentSale), deps);

    expect(result.success).toBe(true);
    const children = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0].childPayloads;
    expect(children.map((child) => child.sale.items[0].quantity)).toEqual([1, 1]);
    expect(children.map((child) => child.sale.items[0].price)).toEqual([25, 25]);
  });

  it('accepts the kitchen-reconciled snapshot and excludes an already-cancelled product line', async () => {
    const activeItem = buildParentSale().items[0];
    const parentSale = {
      ...buildParentSale(),
      items: [activeItem, { id: 'cancelled-1', name: 'Cancelado en cocina', quantity: 0, price: 999 }]
    };
    const deps = makeDeps(parentSale);
    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        orderSnapshot: [activeItem],
        tickets: [
          { label: 'A', paymentData: { paymentMethod: 'efectivo', amountPaid: '250' }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'B', paymentData: { paymentMethod: 'efectivo', amountPaid: '250' }, lines: [{ lineIndex: 0, quantity: 1 }] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(true);
    expect(result.childSales.flatMap((sale) => sale.items).some((item) => item.id === 'cancelled-1')).toBe(false);
  });

  it('returns the race-condition result without running post-sale effects', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale, {
      executeSplitOpenTableOrderTransactionSafe: vi.fn(async () => ({ success: false, isConcurrencyError: true }))
    });

    const result = await splitOpenTableOrderCore(makeParams(parentSale), deps);

    expect(result).toMatchObject({ success: false, errorType: 'RACE_CONDITION' });
    expect(runPostSaleEffects).not.toHaveBeenCalled();
    expect(salesCloudShadowService.syncSaleShadowAfterLocalCommit).not.toHaveBeenCalled();
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

  it('applies the existing customer credit limit across multiple fiado tickets', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale, {
      loadMultipleData: vi.fn(async (store) => (
        store === 'customers'
          ? [{ id: 'cust-1', debt: '0', creditLimit: '300', name: 'Cliente' }]
          : [{ id: 'prod-1', name: 'Producto 1', trackStock: true, cost: 100 }]
      ))
    });

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          { label: 'T1', paymentData: { paymentMethod: 'fiado', amountPaid: '0', customerId: 'cust-1' }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'T2', paymentData: { paymentMethod: 'fiado', amountPaid: '0', customerId: 'cust-1' }, lines: [{ lineIndex: 0, quantity: 1 }] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('excede el límite de crédito');
    expectNoCommitOrShadow(deps);
  });

  it('blocks split if local snapshot differs from open order in db', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);
    const dirtySnapshot = structuredClone(parentSale.items);
    dirtySnapshot[0].quantity = 3;

    const result = await splitOpenTableOrderCore(makeParams(parentSale, { orderSnapshot: dirtySnapshot }), deps);

    expect(result).toMatchObject({ success: false, errorType: 'DIRTY_ORDER' });
    expectNoCommitOrShadow(deps);
  });

  it('applies a one-cent rounding adjustment without changing an item price', async () => {
    const parentSale = {
      ...buildParentSale(),
      total: '5.01',
      items: [
        {
          id: 'prod-1',
          name: 'Producto 1',
          quantity: 1,
          price: 5.01,
          inventoryReservation: {
            source: 'table',
            committedQuantity: 1,
            committedBatches: []
          }
        }
      ]
    };
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          { label: 'A', paymentData: { paymentMethod: 'efectivo', amountPaid: '5.01', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 0.5 }] },
          { label: 'B', paymentData: { paymentMethod: 'efectivo', amountPaid: '5.01', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 0.5 }] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(true);
    const payload = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0];
    const childA = payload.childPayloads.find((item) => item.sale.splitLabel === 'A').sale;
    const childB = payload.childPayloads.find((item) => item.sale.splitLabel === 'B').sale;

    expect(Number(childA.roundingAdjustment) + Number(childB.roundingAdjustment)).toBeCloseTo(-0.01, 5);
    expect(Number(childA.total) + Number(childB.total)).toBeCloseTo(5.01, 5);
    expect(Number(result.total)).toBeCloseTo(5.01, 5);
    expect(childA.items[0].price).toBe(5.01);
    expect(childB.items[0].price).toBe(5.01);
    expect(childA.items[0].splitRoundingAdjustment).toBe('-0.01');
    expect(childB.items[0].splitRoundingAdjustment).toBeUndefined();
  });

  it('distributes unavoidable rounding cents across eligible item tickets', async () => {
    const parentSale = {
      ...buildParentSale(),
      total: '10.03',
      items: [
        {
          id: 'prod-1',
          name: 'Producto 1',
          quantity: 4,
          price: 2.50,
          inventoryReservation: {
            source: 'table',
            committedQuantity: 4,
            committedBatches: []
          }
        }
      ]
    };
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          { label: 'T1', paymentData: { paymentMethod: 'efectivo', amountPaid: '2.51', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'T2', paymentData: { paymentMethod: 'efectivo', amountPaid: '2.51', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'T3', paymentData: { paymentMethod: 'efectivo', amountPaid: '2.51', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'T4', paymentData: { paymentMethod: 'efectivo', amountPaid: '2.50', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 1 }] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(true);
    expect(result.childSaleIds).toHaveLength(4);
    expect(result.childSales).toHaveLength(4);
    const payload = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0];
    const totals = payload.childPayloads.map((child) => Number(child.sale.total));
    expect(totals.filter((total) => total === 2.51)).toHaveLength(3);
    expect(totals.filter((total) => total === 2.50)).toHaveLength(1);
    expect(totals.reduce((sum, total) => sum + total, 0)).toBeCloseTo(10.03, 5);
    expect(Number(result.total)).toBeCloseTo(10.03, 5);
    expect(payload.childPayloads.flatMap((child) => child.sale.items).every((item) => item.price === 2.5)).toBe(true);
  });

  it('rejects split with fewer than 2 tickets', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          { label: 'T1', paymentData: { paymentMethod: 'efectivo', amountPaid: '500', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 2 }] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('al menos dos tickets');
    expectNoCommitOrShadow(deps);
  });

  it('rejects duplicate ticket labels', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          { label: 'A', paymentData: { paymentMethod: 'efectivo', amountPaid: '250', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'A', paymentData: { paymentMethod: 'efectivo', amountPaid: '250', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 1 }] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('etiquetas únicas');
    expectNoCommitOrShadow(deps);
  });

  it('rejects tickets without items', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          { label: 'T1', paymentData: { paymentMethod: 'efectivo', amountPaid: '500', sendReceipt: false }, lines: [{ lineIndex: 0, quantity: 2 }] },
          { label: 'T2', paymentData: { paymentMethod: 'efectivo', amountPaid: '0', sendReceipt: false }, lines: [] }
        ]
      }),
      deps
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('debe contener al menos un producto');
    expectNoCommitOrShadow(deps);
  });

  it('keeps proportional inventory reservations for N-way split without batch loss', async () => {
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
    const children = ['T1', 'T2', 'T3'].map((label) => payload.childPayloads.find((child) => child.sale.splitLabel === label));

    children.forEach((child) => {
      expect(child.sale.items[0].inventoryReservation.committedQuantity).toBe(2);
    });

    const totalBatchQty = children.reduce(
      (sum, child) => sum + child.sale.items[0].inventoryReservation.committedBatches[0].quantity,
      0
    );
    expect(totalBatchQty).toBe(6);
  });

  it('preserves $500 and $100 item prices in by_items and uses the same rejection in local and cloud', async () => {
    const parentSale = {
      ...buildParentSale(),
      total: '600',
      items: [
        {
          id: 'prod-1',
          name: 'Producto caro',
          quantity: 1,
          price: 500,
          inventoryReservation: { source: 'table', committedQuantity: 1, committedBatches: [] }
        },
        {
          id: 'prod-2',
          name: 'Producto barato',
          quantity: 1,
          price: 100,
          inventoryReservation: { source: 'table', committedQuantity: 1, committedBatches: [] }
        }
      ]
    };
    const deps = makeDeps(parentSale, {
      loadMultipleData: vi.fn(async (store) => (
        store === 'customers'
          ? []
          : [
            { id: 'prod-1', name: 'Producto caro', trackStock: true, cost: 250 },
            { id: 'prod-2', name: 'Producto barato', trackStock: true, cost: 50 }
          ]
      ))
    });

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, {
        tickets: [
          {
            label: 'A',
            paymentData: { paymentMethod: 'efectivo', amountPaid: '500', sendReceipt: false },
            lines: [{ lineIndex: 0, quantity: 1 }]
          },
          {
            label: 'B',
            paymentData: { paymentMethod: 'efectivo', amountPaid: '100', sendReceipt: false },
            lines: [{ lineIndex: 1, quantity: 1 }]
          }
        ]
      }),
      deps
    );

    expect(result.success).toBe(true);
    const childPayloads = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0].childPayloads;
    const childA = childPayloads.find((child) => child.sale.splitLabel === 'A').sale;
    const childB = childPayloads.find((child) => child.sale.splitLabel === 'B').sale;
    expect(childA).toMatchObject({ total: '500', splitIntent: 'by_items' });
    expect(childB).toMatchObject({ total: '100', splitIntent: 'by_items' });
    expect(childA.items[0].price).toBe(500);
    expect(childB.items[0].price).toBe(100);
    expect(childA.items[0].price).not.toBe(300);
    expect(childB.items[0].price).not.toBe(300);

    salesCloudCashierService.processCloudSplitTableSale.mockResolvedValueOnce({ success: false, errorType: 'TEST_HANDOFF' });
    const cloudDeps = makeDeps(parentSale, { loadMultipleData: deps.loadMultipleData });
    await splitOpenTableOrderCore(
      makeParams(parentSale, {
        cloudSpecialFlows: true,
        tickets: [
          { label: 'A', paymentData: { paymentMethod: 'efectivo', amountPaid: '500' }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'B', paymentData: { paymentMethod: 'efectivo', amountPaid: '100' }, lines: [{ lineIndex: 1, quantity: 1 }] }
        ]
      }),
      cloudDeps
    );
    const cloudChildren = salesCloudCashierService.processCloudSplitTableSale.mock.calls[0][0].childDefinitions;
    expect(cloudChildren.map((child) => child.sale.total)).toEqual(['500', '100']);
    expect(cloudChildren.map((child) => child.sale.items[0].price)).toEqual([500, 100]);
    expect(cloudChildren.every((child) => child.sale.metadata.splitIntent === 'by_items')).toBe(true);
    salesCloudCashierService.processCloudSplitTableSale.mockClear();

    const inconsistentParent = { ...parentSale, total: '800' };
    for (const cloudSpecialFlows of [false, true]) {
      const inconsistentDeps = makeDeps(inconsistentParent, {
        loadMultipleData: deps.loadMultipleData
      });
      const blocked = await splitOpenTableOrderCore(
        makeParams(inconsistentParent, {
          cloudSpecialFlows,
          tickets: [
            { label: 'A', paymentData: { paymentMethod: 'efectivo', amountPaid: '500' }, lines: [{ lineIndex: 0, quantity: 1 }] },
            { label: 'B', paymentData: { paymentMethod: 'efectivo', amountPaid: '100' }, lines: [{ lineIndex: 1, quantity: 1 }] }
          ]
        }),
        inconsistentDeps
      );
      expect(blocked).toMatchObject({ success: false, errorType: 'SPLIT_ROUNDING_INVALID', code: 'SPLIT_ROUNDING_INVALID' });
      expect(inconsistentDeps.executeSplitOpenTableOrderTransactionSafe).not.toHaveBeenCalled();
      expect(salesCloudCashierService.processCloudSplitTableSale).not.toHaveBeenCalled();
    }
  });

  it('rejects legacy equal as deferred equal_payment before either local or cloud execution', async () => {
    const parentSale = buildParentSale();

    for (const cloudSpecialFlows of [false, true]) {
      const deps = makeDeps(parentSale);
      const result = await splitOpenTableOrderCore(
        makeParams(parentSale, { splitIntent: undefined, mode: 'equal', cloudSpecialFlows }),
        deps
      );

      expect(result).toMatchObject({
        success: false,
        splitIntent: 'equal_payment',
        errorType: 'SPLIT_INTENT_NOT_SUPPORTED',
        code: 'SPLIT_INTENT_NOT_SUPPORTED'
      });
      expect(deps.loadData).not.toHaveBeenCalled();
      expectNoCommitOrShadow(deps);
      expect(salesCloudCashierService.processCloudSplitTableSale).not.toHaveBeenCalled();
    }
  });

  it('does not block successful split when post-sale effects fail for a child', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);
    const postEffectsError = new Error('stats write failed');
    runPostSaleEffects
      .mockRejectedValueOnce(postEffectsError)
      .mockResolvedValueOnce(undefined);

    const result = await splitOpenTableOrderCore(makeParams(parentSale), deps);

    expect(result.success).toBe(true);
    expect(deps.executeSplitOpenTableOrderTransactionSafe).toHaveBeenCalledOnce();
    expect(runPostSaleEffects).toHaveBeenCalledTimes(2);
    expect(salesCloudShadowService.syncSaleShadowAfterLocalCommit).toHaveBeenCalledTimes(2);
    expect(salesCloudShadowService.syncSaleShadowAfterLocalCommit).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.childSaleIds[0] }),
      expect.objectContaining({
        postEffectsFailed: true,
        postEffectsError: expect.objectContaining({ message: 'stats write failed' })
      })
    );
  });
});
