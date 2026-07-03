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
      bulkPut: async (records) => {
        records.forEach((record) => backingMap.set(record.id, structuredClone(record)));
        return records.map((record) => record.id);
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

const buildRestaurantProducts = () => [
  {
    id: 'burger',
    name: 'Hamburguesa',
    trackStock: false,
    price: 100,
    recipe: [
      { ingredientId: 'pan', quantity: 1, unit: 'pza' },
      { ingredientId: 'carne', quantity: 150, unit: 'g' }
    ]
  },
  { id: 'pan', name: 'Pan', trackStock: true, stock: 20, committedStock: 0, cost: 2 },
  { id: 'carne', name: 'Carne', trackStock: true, stock: 3000, committedStock: 0, cost: 0.1 },
  { id: 'queso', name: 'Queso', trackStock: true, stock: 1000, committedStock: 0, cost: 0.2 },
  { id: 'tocino', name: 'Tocino', trackStock: true, stock: 1000, committedStock: 0, cost: 0.25 },
  { id: 'cebolla', name: 'Cebolla', trackStock: true, stock: 1000, committedStock: 0, cost: 0.05 }
];

const commitRestaurantItems = async (items, products = buildRestaurantProducts()) => {
  const db = createFakeDb({ products });
  const reservedItems = await commitStock(items, { db, STORES, allProducts: products });
  return { db, reservedItems, products };
};

const getCommittedComponentsById = (item) => new Map(
  (item?.inventoryReservation?.committedComponents || []).map((component) => [
    component.ingredientId,
    component.quantity
  ])
);

describe('inventoryFlow restaurant local recipe and modifiers', () => {
  it('reserva ingredientes de receta base por cantidad del producto', async () => {
    const { db, reservedItems } = await commitRestaurantItems([
      { id: 'burger', name: 'Hamburguesa', quantity: 2 }
    ]);

    expect(db.__menu.get('pan').committedStock).toBe(2);
    expect(db.__menu.get('carne').committedStock).toBe(300);

    const components = getCommittedComponentsById(reservedItems[0]);
    expect(components.get('pan')).toBe(2);
    expect(components.get('carne')).toBe(300);
  });

  it('reserva extra normalizado con ingredientQuantity multiplicado por cantidad', async () => {
    const { db, reservedItems } = await commitRestaurantItems([
      {
        id: 'burger',
        name: 'Hamburguesa',
        quantity: 2,
        selectedModifiers: [
          {
            name: 'Queso extra',
            ingredientId: 'queso',
            ingredientQuantity: 30,
            ingredientUnit: 'g',
            tracksInventory: true
          }
        ]
      }
    ]);

    expect(db.__menu.get('queso').committedStock).toBe(60);

    const components = getCommittedComponentsById(reservedItems[0]);
    expect(components.get('queso')).toBe(60);
  });

  it('no reserva extra solo texto con tracksInventory false', async () => {
    const { db } = await commitRestaurantItems([
      {
        id: 'burger',
        name: 'Hamburguesa',
        quantity: 1,
        selectedModifiers: [
          { name: 'Sin cebolla', tracksInventory: false }
        ]
      }
    ]);

    expect(db.__menu.get('cebolla').committedStock).toBe(0);
    expect(db.__menu.get('pan').committedStock).toBe(1);
    expect(db.__menu.get('carne').committedStock).toBe(150);
  });

  it('no reserva extra con precio pero sin ingrediente', async () => {
    const { db, reservedItems } = await commitRestaurantItems([
      {
        id: 'burger',
        name: 'Hamburguesa',
        quantity: 1,
        selectedModifiers: [
          { name: 'Empaque extra', price: 5, tracksInventory: true }
        ]
      }
    ]);

    const components = getCommittedComponentsById(reservedItems[0]);
    expect(components.has('Empaque extra')).toBe(false);
    expect(db.__menu.get('pan').committedStock).toBe(1);
    expect(db.__menu.get('carne').committedStock).toBe(150);
  });

  it('mantiene compatibilidad legacy usando quantity cuando no existe ingredientQuantity', async () => {
    const { db, reservedItems } = await commitRestaurantItems([
      {
        id: 'burger',
        name: 'Hamburguesa',
        quantity: 2,
        selectedModifiers: [
          { name: 'Tocino extra', ingredientId: 'tocino', quantity: 25, unit: 'g' }
        ]
      }
    ]);

    expect(db.__menu.get('tocino').committedStock).toBe(50);

    const components = getCommittedComponentsById(reservedItems[0]);
    expect(components.get('tocino')).toBe(50);
  });

  it('libera receta y extras reservados al cancelar o eliminar la mesa', async () => {
    const products = buildRestaurantProducts();
    const db = createFakeDb({ products });
    const reservedItems = await commitStock([
      {
        id: 'burger',
        name: 'Hamburguesa',
        quantity: 2,
        selectedModifiers: [
          {
            name: 'Queso extra',
            ingredientId: 'queso',
            ingredientQuantity: 30,
            ingredientUnit: 'g',
            tracksInventory: true
          }
        ]
      }
    ], { db, STORES, allProducts: products });

    await releaseCommittedStock(reservedItems, { db, STORES, allProducts: products });

    expect(db.__menu.get('pan').committedStock).toBe(0);
    expect(db.__menu.get('carne').committedStock).toBe(0);
    expect(db.__menu.get('queso').committedStock).toBe(0);
  });

  it('no duplica reservas al guardar, reabrir y guardar sin cambios', async () => {
    const products = buildRestaurantProducts();
    const db = createFakeDb({ products });
    const orderItems = [
      {
        id: 'burger',
        name: 'Hamburguesa',
        quantity: 2,
        selectedModifiers: [
          {
            name: 'Queso extra',
            ingredientId: 'queso',
            ingredientQuantity: 30,
            ingredientUnit: 'g',
            tracksInventory: true
          }
        ]
      }
    ];

    const firstReservation = await commitStock(orderItems, { db, STORES, allProducts: products });
    await releaseCommittedStock(firstReservation, { db, STORES, allProducts: products });
    await commitStock(orderItems, { db, STORES, allProducts: products });

    expect(db.__menu.get('pan').committedStock).toBe(2);
    expect(db.__menu.get('carne').committedStock).toBe(300);
    expect(db.__menu.get('queso').committedStock).toBe(60);
  });

  it('convierte reserva con componentes a deducción final local sin duplicar lotes', () => {
    const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
      itemsToProcess: [
        {
          id: 'burger',
          name: 'Hamburguesa',
          quantity: 2,
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
      ],
      allProducts: buildRestaurantProducts(),
      batchesMap: new Map(),
      roundCurrency: (value) => Math.round(value * 100) / 100
    });

    expect(batchesToDeduct).toEqual([]);
    expect(processedItems[0].inventoryComponentsUsed).toEqual([
      { ingredientId: 'pan', quantity: 2, cost: 2, fromCommittedStock: true },
      { ingredientId: 'carne', quantity: 300, cost: 0.1, fromCommittedStock: true },
      { ingredientId: 'queso', quantity: 60, cost: 0.2, fromCommittedStock: true }
    ]);
  });
});
