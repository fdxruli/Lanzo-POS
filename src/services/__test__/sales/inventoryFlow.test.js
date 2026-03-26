import { describe, expect, it } from 'vitest';
import {
  buildProcessedItemsAndDeductions,
  commitStock,
  releaseCommittedStock
} from '../../sales/inventoryFlow';

const STORES = {
  MENU: 'menu',
  PRODUCT_BATCHES: 'product_batches'
};

const createFakeDb = ({ products = [], batches = [] } = {}) => {
  const menuMap = new Map(products.map((product) => [product.id, structuredClone(product)]));
  const batchMap = new Map(batches.map((batch) => [batch.id, structuredClone(batch)]));

  const tableFactory = (storeName) => {
    const backingMap = storeName === STORES.MENU ? menuMap : batchMap;

    return {
      get: async (id) => backingMap.get(id) || null,
      put: async (record) => {
        backingMap.set(record.id, structuredClone(record));
        return record.id;
      },
      bulkGet: async (ids) => ids.map((id) => backingMap.get(id) || null),
      where: (field) => ({
        equals: (value) => ({
          toArray: async () => Array.from(backingMap.values()).filter((record) => record?.[field] === value)
        })
      })
    };
  };

  return {
    transaction: async (_mode, _tables, callback) => callback(),
    table: (storeName) => tableFactory(storeName),
    __menu: menuMap,
    __batches: batchMap
  };
};

describe('inventoryFlow committed stock', () => {
  it('reserva stock simple sin tocar el stock fisico', async () => {
    const db = createFakeDb({
      products: [
        { id: 'beer', name: 'Cerveza', trackStock: true, stock: 10, committedStock: 2 }
      ]
    });

    const reservedItems = await commitStock(
      [{ id: 'beer', name: 'Cerveza', quantity: 3 }],
      {
        db,
        STORES,
        allProducts: [{ id: 'beer', name: 'Cerveza', trackStock: true, stock: 10, committedStock: 2 }]
      }
    );

    expect(reservedItems[0].inventoryReservation).toMatchObject({
      source: 'table',
      committedQuantity: 3,
      committedBatches: []
    });

    expect(db.__menu.get('beer')).toMatchObject({
      stock: 10,
      committedStock: 5
    });
  });

  it('reserva lotes y sincroniza committedStock del padre', async () => {
    const db = createFakeDb({
      products: [
        {
          id: 'milk',
          name: 'Leche',
          trackStock: true,
          stock: 8,
          committedStock: 1,
          batchManagement: { enabled: true, selectionStrategy: 'fifo' }
        }
      ],
      batches: [
        { id: 'b-1', productId: 'milk', stock: 5, committedStock: 1, cost: 10, isActive: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'b-2', productId: 'milk', stock: 3, committedStock: 0, cost: 11, isActive: true, createdAt: '2026-01-02T00:00:00.000Z' }
      ]
    });

    const [reservedItem] = await commitStock(
      [{ id: 'milk', name: 'Leche', quantity: 4 }],
      {
        db,
        STORES,
        allProducts: [
          {
            id: 'milk',
            name: 'Leche',
            trackStock: true,
            stock: 8,
            committedStock: 1,
            batchManagement: { enabled: true, selectionStrategy: 'fifo' }
          }
        ]
      }
    );

    expect(reservedItem.inventoryReservation.committedBatches).toEqual([
      { batchId: 'b-1', ingredientId: 'milk', quantity: 4, cost: 10 }
    ]);
    expect(db.__batches.get('b-1').committedStock).toBe(5);
    expect(db.__menu.get('milk').committedStock).toBe(5);
    expect(db.__menu.get('milk').stock).toBe(8);
  });

  it('libera reservas y revierte committedStock', async () => {
    const db = createFakeDb({
      products: [
        { id: 'beer', name: 'Cerveza', trackStock: true, stock: 10, committedStock: 5 }
      ]
    });

    await releaseCommittedStock(
      [{
        id: 'beer',
        quantity: 3,
        inventoryReservation: {
          source: 'table',
          committedQuantity: 3,
          committedBatches: []
        }
      }],
      { db, STORES, allProducts: [{ id: 'beer', name: 'Cerveza', trackStock: true, stock: 10, committedStock: 5 }] }
    );

    expect(db.__menu.get('beer')).toMatchObject({
      stock: 10,
      committedStock: 2
    });
  });

  it('falla duro si releaseCommittedStock causa underflow', async () => {
    const db = createFakeDb({
      products: [
        { id: 'beer', name: 'Cerveza', trackStock: true, stock: 10, committedStock: 2 }
      ]
    });

    await expect(
      releaseCommittedStock(
        [{
          id: 'beer',
          quantity: 5,
          inventoryReservation: {
            source: 'table',
            committedQuantity: 5,
            committedBatches: []
          }
        }],
        { db, STORES, allProducts: [{ id: 'beer', name: 'Cerveza', trackStock: true, stock: 10, committedStock: 2 }] }
      )
    ).rejects.toThrow('CRITICAL_COMMITTED_UNDERFLOW');
  });

  it('convierte una reserva a deduccion real al construir la venta', () => {
    const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
      itemsToProcess: [{
        id: 'beer',
        name: 'Cerveza',
        quantity: 2,
        inventoryReservation: {
          source: 'table',
          committedQuantity: 2,
          committedBatches: [
            { batchId: 'b-1', ingredientId: 'beer', quantity: 2, cost: 12 }
          ]
        }
      }],
      allProducts: [{
        id: 'beer',
        name: 'Cerveza',
        trackStock: true,
        cost: 8
      }],
      batchesMap: new Map(),
      roundCurrency: (value) => Math.round(value * 100) / 100
    });

    expect(batchesToDeduct).toEqual([
      {
        batchId: 'b-1',
        quantity: 2,
        productId: 'beer',
        fromCommittedStock: true
      }
    ]);
    expect(processedItems[0]).toMatchObject({
      stockDeducted: 2,
      batchesUsed: [{ batchId: 'b-1', ingredientId: 'beer', quantity: 2, cost: 12 }]
    });
  });
});
