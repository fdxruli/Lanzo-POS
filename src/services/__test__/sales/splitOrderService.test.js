import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../sales/postSaleEffects', () => ({
  runPostSaleEffects: vi.fn(async () => undefined)
}));

import { splitOpenTableOrderCore } from '../../sales/splitOrderService';
import { runPostSaleEffects } from '../../sales/postSaleEffects';

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
    if (store === 'customers' && key === 'cust-1') return { id: 'cust-1', debt: '0', creditLimit: '1000' };
    return null;
  }),
  loadMultipleData: vi.fn(async () => [{ id: 'prod-1', name: 'Producto 1', trackStock: true, cost: 100 }]),
  STORES: {
    SALES: 'sales',
    MENU: 'menu',
    CUSTOMERS: 'customers'
  },
  executeSplitOpenTableOrderTransactionSafe: vi.fn(async () => ({ success: true })),
  useStatsStore: { getState: () => ({ updateStatsForNewSale: vi.fn() }) },
  roundCurrency: (value) => Math.round(value * 100) / 100,
  sendReceiptWhatsApp: vi.fn(async () => true),
  Logger: {
    time: vi.fn(),
    timeEnd: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  ...overrides
});

const makeParams = (parentSale = buildParentSale(), overrides = {}) => ({
  parentOrderId: parentSale.id,
  orderSnapshot: structuredClone(parentSale.items),
  mode: 'manual',
  tickets: [
    {
      label: 'A',
      paymentData: {
        paymentMethod: 'efectivo',
        amountPaid: '250',
        sendReceipt: false
      },
      lines: [{ lineIndex: 0, quantity: 1 }]
    },
    {
      label: 'B',
      paymentData: {
        paymentMethod: 'efectivo',
        amountPaid: '250',
        sendReceipt: false
      },
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

  it('splits table order into two closed child sales', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(makeParams(parentSale), deps);

    expect(result.success).toBe(true);
    expect(result.childSaleIds).toHaveLength(2);
    expect(deps.executeSplitOpenTableOrderTransactionSafe).toHaveBeenCalledOnce();

    const payload = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0];
    expect(payload.parentOrderId).toBe(parentSale.id);
    expect(payload.parentExpectedVersion).toBe(parentSale.updatedAt);
    expect(payload.childPayloads).toHaveLength(2);

    expect(payload.childPayloads[0].sale).toMatchObject({
      status: 'closed',
      splitParentId: parentSale.id,
      splitLabel: 'A',
      total: '250'
    });

    expect(payload.childPayloads[1].sale).toMatchObject({
      status: 'closed',
      splitParentId: parentSale.id,
      splitLabel: 'B',
      total: '250'
    });

    expect(runPostSaleEffects).toHaveBeenCalledTimes(2);
  });

  it('blocks split if local snapshot differs from open order in db', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);

    const dirtySnapshot = structuredClone(parentSale.items);
    dirtySnapshot[0].quantity = 3;

    const result = await splitOpenTableOrderCore(
      makeParams(parentSale, { orderSnapshot: dirtySnapshot }),
      deps
    );

    expect(result).toMatchObject({
      success: false,
      errorType: 'DIRTY_ORDER'
    });

    expect(deps.executeSplitOpenTableOrderTransactionSafe).not.toHaveBeenCalled();
  });

  it('applies rounding adjustment in equal mode for odd cents', async () => {
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
        mode: 'equal',
        tickets: [
          {
            label: 'A',
            paymentData: { paymentMethod: 'efectivo', amountPaid: '5.01', sendReceipt: false },
            lines: [{ lineIndex: 0, quantity: 0.5 }]
          },
          {
            label: 'B',
            paymentData: { paymentMethod: 'efectivo', amountPaid: '5.01', sendReceipt: false },
            lines: [{ lineIndex: 0, quantity: 0.5 }]
          }
        ]
      }),
      deps
    );

    expect(result.success).toBe(true);

    const payload = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0];
    const childA = payload.childPayloads.find((item) => item.sale.splitLabel === 'A').sale;
    const childB = payload.childPayloads.find((item) => item.sale.splitLabel === 'B').sale;

    expect(Number(childA.roundingAdjustment) + Number(childB.roundingAdjustment)).toBeCloseTo(0.01, 5);
    expect(Number(childA.total) + Number(childB.total)).toBeCloseTo(5.01, 5);
  });

  describe('N-way split (dynamic tickets)', () => {
    it('splits into 4 tickets with correct remainder distribution', async () => {
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
          mode: 'equal',
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

      const payload = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0];
      const totals = payload.childPayloads.map((c) => Number(c.sale.total));

      // 10.03 / 4 = 2.5075 -> floor = 2.50, remainder = 3 cents
      // First 3 tickets get +1 cent = 2.51
      expect(totals).toContain(2.51);
      expect(totals).toContain(2.50);
      expect(totals.reduce((a, b) => a + b, 0)).toBeCloseTo(10.03, 5);
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
    });

    it('rejects split with duplicate labels', async () => {
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
    });

    it('rejects split when a ticket has no items', async () => {
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
      expect(result.message).toContain('al menos un producto');
    });

    it('correctly splits inventory reservations for N tickets', async () => {
      const parentSale = {
        ...buildParentSale(),
        items: [
          {
            id: 'prod-1',
            name: 'Producto 1',
            quantity: 6,
            price: 100,
            inventoryReservation: {
              source: 'table',
              committedQuantity: 6,
              committedBatches: [
                { batchId: 'batch-1', ingredientId: 'ing-1', quantity: 6, cost: 50 }
              ]
            }
          }
        ]
      };

      const deps = makeDeps(parentSale);

      const result = await splitOpenTableOrderCore(
        makeParams(parentSale, {
          mode: 'manual',
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

      // Each ticket should have proportional reservation
      expect(childT1.sale.items[0].inventoryReservation.committedQuantity).toBe(2);
      expect(childT2.sale.items[0].inventoryReservation.committedQuantity).toBe(2);
      expect(childT3.sale.items[0].inventoryReservation.committedQuantity).toBe(2);

      // Sum of batch quantities should equal original
      const totalBatchQty = childT1.sale.items[0].inventoryReservation.committedBatches[0].quantity +
        childT2.sale.items[0].inventoryReservation.committedBatches[0].quantity +
        childT3.sale.items[0].inventoryReservation.committedBatches[0].quantity;
      expect(totalBatchQty).toBe(6);
    });
  });
});
