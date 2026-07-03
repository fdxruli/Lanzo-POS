import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../sales/postSaleEffects', () => ({
  runPostSaleEffects: vi.fn(async () => undefined)
}));

import { splitOpenTableOrderCore } from '../../sales/splitOrderService';

const buildParentSale = () => ({
  id: 'sale-open-restaurant-1',
  timestamp: '2026-07-03T14:00:00.000Z',
  updatedAt: '2026-07-03T14:05:00.000Z',
  status: 'open',
  orderType: 'table',
  tableData: 'Mesa 7',
  total: '300',
  items: [
    {
      id: 'burger',
      name: 'Hamburguesa',
      quantity: 2,
      price: 150,
      selectedModifiers: [
        {
          id: 'opt_queso_extra',
          optionId: 'opt_queso_extra',
          name: 'Queso extra',
          price: 10,
          ingredientId: 'queso',
          ingredientQuantity: 30,
          ingredientUnit: 'g',
          tracksInventory: true
        }
      ],
      inventoryReservation: {
        source: 'table',
        committedQuantity: 2,
        committedBatches: [],
        committedComponents: [
          { ingredientId: 'pan', quantity: 2, cost: 2 },
          { ingredientId: 'carne', quantity: 300, cost: 0.1 },
          { ingredientId: 'queso', quantity: 60, cost: 0.2 }
        ]
      }
    }
  ]
});

const makeDeps = (parentSale = buildParentSale()) => ({
  loadData: vi.fn(async (store, key) => {
    if (store === 'sales' && key === parentSale.id) return structuredClone(parentSale);
    return null;
  }),
  loadMultipleData: vi.fn(async (store, ids) => {
    if (store !== 'menu') return [];
    const products = new Map([
      ['burger', { id: 'burger', name: 'Hamburguesa', trackStock: false }],
      ['pan', { id: 'pan', name: 'Pan', trackStock: true, cost: 2 }],
      ['carne', { id: 'carne', name: 'Carne', trackStock: true, cost: 0.1 }],
      ['queso', { id: 'queso', name: 'Queso', trackStock: true, cost: 0.2 }]
    ]);
    return ids.map((id) => products.get(id)).filter(Boolean);
  }),
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
  }
});

const makeParams = (parentSale = buildParentSale()) => ({
  parentOrderId: parentSale.id,
  orderSnapshot: structuredClone(parentSale.items),
  mode: 'manual',
  tickets: [
    {
      label: 'A',
      paymentData: { paymentMethod: 'efectivo', amountPaid: '150', sendReceipt: false },
      lines: [{ lineIndex: 0, quantity: 1 }]
    },
    {
      label: 'B',
      paymentData: { paymentMethod: 'efectivo', amountPaid: '150', sendReceipt: false },
      lines: [{ lineIndex: 0, quantity: 1 }]
    }
  ],
  features: { hasKDS: false },
  companyName: 'Mi negocio'
});

describe('splitOpenTableOrderCore local restaurant inventory reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('divide reservas de receta y extras proporcionalmente sin duplicar inventario', async () => {
    const parentSale = buildParentSale();
    const deps = makeDeps(parentSale);

    const result = await splitOpenTableOrderCore(makeParams(parentSale), deps);

    expect(result.success).toBe(true);
    expect(deps.executeSplitOpenTableOrderTransactionSafe).toHaveBeenCalledOnce();

    const payload = deps.executeSplitOpenTableOrderTransactionSafe.mock.calls[0][0];
    expect(payload.childPayloads).toHaveLength(2);

    payload.childPayloads.forEach((childPayload) => {
      const childItem = childPayload.sale.items[0];

      expect(childPayload.deductions).toEqual([]);
      expect(childItem.quantity).toBe(1);
      expect(childItem.selectedModifiers[0]).toMatchObject({
        id: 'opt_queso_extra',
        optionId: 'opt_queso_extra',
        name: 'Queso extra',
        price: 10,
        ingredientId: 'queso',
        ingredientQuantity: 30,
        ingredientUnit: 'g',
        tracksInventory: true
      });

      expect(childItem.inventoryReservation.committedComponents).toEqual([
        { ingredientId: 'carne', quantity: 150, cost: 0.1 },
        { ingredientId: 'pan', quantity: 1, cost: 2 },
        { ingredientId: 'queso', quantity: 30, cost: 0.2 }
      ]);

      expect(childItem.inventoryComponentsUsed).toEqual([
        { ingredientId: 'carne', quantity: 150, cost: 0.1, fromCommittedStock: true },
        { ingredientId: 'pan', quantity: 1, cost: 2, fromCommittedStock: true },
        { ingredientId: 'queso', quantity: 30, cost: 0.2, fromCommittedStock: true }
      ]);
    });
  });
});
