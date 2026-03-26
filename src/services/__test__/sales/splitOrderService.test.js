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
});
