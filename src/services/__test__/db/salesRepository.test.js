import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const STORES = {
    SALES: 'sales',
    PRODUCT_BATCHES: 'product_batches',
    MENU: 'menu',
    TRANSACTION_LOG: 'transaction_log',
    CUSTOMERS: 'customers',
    CUSTOMER_LEDGER: 'customer_ledger'
  };

  const maps = {
    [STORES.SALES]: new Map(),
    [STORES.PRODUCT_BATCHES]: new Map(),
    [STORES.MENU]: new Map(),
    [STORES.TRANSACTION_LOG]: new Map(),
    [STORES.CUSTOMERS]: new Map(),
    [STORES.CUSTOMER_LEDGER]: new Map()
  };

  const reset = () => {
    Object.values(maps).forEach((map) => map.clear());
  };

  const getMap = (storeName) => {
    const target = maps[storeName];
    if (!target) throw new Error(`Store no mockeado: ${storeName}`);
    return target;
  };

  const buildTable = (storeName) => {
    const backingMap = getMap(storeName);

    return {
      get: vi.fn(async (id) => backingMap.get(id) || null),
      add: vi.fn(async (record) => {
        backingMap.set(record.id, structuredClone(record));
        return record.id;
      }),
      put: vi.fn(async (record) => {
        backingMap.set(record.id, structuredClone(record));
        return record.id;
      }),
      update: vi.fn(async (id, changes) => {
        const current = backingMap.get(id) || { id };
        backingMap.set(id, { ...current, ...structuredClone(changes) });
        return 1;
      }),
      where: vi.fn((field) => ({
        equals: vi.fn((value) => ({
          toArray: vi.fn(async () => Array.from(backingMap.values()).filter((record) => record?.[field] === value))
        }))
      }))
    };
  };

  const db = {
    transaction: vi.fn(async (_mode, _tables, callback) => callback()),
    table: vi.fn((storeName) => buildTable(storeName))
  };

  return { STORES, maps, reset, db };
});

vi.mock('../../db/dexie', () => ({
  db: state.db,
  STORES: state.STORES
}));

import { salesRepository } from '../../db/sales';

describe('salesRepository.executeSaleTransaction', () => {
  beforeEach(() => {
    state.reset();
    vi.clearAllMocks();
  });

  it('mantiene committedStock intacto en retail directo', async () => {
    state.maps[state.STORES.MENU].set('beer', {
      id: 'beer',
      name: 'Cerveza',
      trackStock: true,
      stock: 10,
      committedStock: 4
    });

    const result = await salesRepository.executeSaleTransaction(
      {
        id: 'sale-retail',
        total: 30,
        saldoPendiente: 0,
        items: [
          { id: 'beer', quantity: 3, stockDeducted: 3, batchesUsed: [] }
        ]
      },
      []
    );

    expect(result.success).toBe(true);
    expect(state.maps[state.STORES.MENU].get('beer')).toMatchObject({
      stock: 7,
      committedStock: 4
    });
  });

  it('convierte stock comprometido de lote a descuento real', async () => {
    state.maps[state.STORES.MENU].set('milk', {
      id: 'milk',
      name: 'Leche',
      trackStock: true,
      stock: 10,
      committedStock: 4,
      batchManagement: { enabled: true }
    });
    state.maps[state.STORES.PRODUCT_BATCHES].set('batch-1', {
      id: 'batch-1',
      productId: 'milk',
      sku: 'L-1',
      stock: 10,
      committedStock: 4,
      isActive: true
    });

    const result = await salesRepository.executeSaleTransaction(
      {
        id: 'sale-table',
        total: 40,
        saldoPendiente: 0,
        items: [
          {
            id: 'milk',
            quantity: 4,
            batchesUsed: [{ batchId: 'batch-1', ingredientId: 'milk', quantity: 4 }],
            inventoryReservation: {
              source: 'table',
              committedQuantity: 4,
              committedBatches: [{ batchId: 'batch-1', ingredientId: 'milk', quantity: 4 }]
            }
          }
        ]
      },
      [{ batchId: 'batch-1', quantity: 4, productId: 'milk', fromCommittedStock: true }]
    );

    expect(result.success).toBe(true);
    expect(state.maps[state.STORES.PRODUCT_BATCHES].get('batch-1')).toMatchObject({
      stock: 6,
      committedStock: 0,
      isActive: true
    });
    expect(state.maps[state.STORES.MENU].get('milk')).toMatchObject({
      stock: 6,
      committedStock: 0
    });
  });

  it('split bill cancela padre open y crea dos hijos closed con conversión committed', async () => {
    state.maps[state.STORES.SALES].set('sale-open-parent', {
      id: 'sale-open-parent',
      status: 'open',
      orderType: 'table',
      total: 40,
      items: [
        {
          id: 'beer',
          quantity: 4,
          price: 10,
          inventoryReservation: {
            source: 'table',
            committedQuantity: 4,
            committedBatches: []
          }
        }
      ],
      updatedAt: '2026-03-19T18:00:00.000Z'
    });

    state.maps[state.STORES.MENU].set('beer', {
      id: 'beer',
      name: 'Cerveza',
      trackStock: true,
      stock: 10,
      committedStock: 4
    });

    const buildChildSale = (id, label) => ({
      id,
      total: 20,
      saldoPendiente: 0,
      status: 'closed',
      splitLabel: label,
      splitParentId: 'sale-open-parent',
      items: [
        {
          id: 'beer',
          quantity: 2,
          price: 10,
          stockDeducted: 2,
          batchesUsed: [],
          inventoryReservation: {
            source: 'table',
            committedQuantity: 2,
            committedBatches: []
          }
        }
      ]
    });

    const result = await salesRepository.executeSplitOpenTableOrderTransaction({
      parentOrderId: 'sale-open-parent',
      parentExpectedVersion: '2026-03-19T18:00:00.000Z',
      splitGroupId: 'spl-1',
      childPayloads: [
        { sale: buildChildSale('sale-child-a', 'A'), deductions: [] },
        { sale: buildChildSale('sale-child-b', 'B'), deductions: [] }
      ]
    });

    expect(result.success).toBe(true);
    expect(result.childSaleIds).toEqual(['sale-child-a', 'sale-child-b']);

    expect(state.maps[state.STORES.SALES].get('sale-open-parent')).toMatchObject({
      status: 'cancelled',
      cancelReason: 'split_settled',
      splitGroupId: 'spl-1',
      splitChildIds: ['sale-child-a', 'sale-child-b']
    });

    expect(state.maps[state.STORES.SALES].get('sale-child-a')).toMatchObject({
      status: 'closed',
      splitParentId: 'sale-open-parent',
      splitLabel: 'A'
    });

    expect(state.maps[state.STORES.SALES].get('sale-child-b')).toMatchObject({
      status: 'closed',
      splitParentId: 'sale-open-parent',
      splitLabel: 'B'
    });

    expect(state.maps[state.STORES.MENU].get('beer')).toMatchObject({
      stock: 6,
      committedStock: 0
    });
  });
});
