import { describe, expect, it, vi } from 'vitest';
import {
  CANCELLATION_ACTIONS,
  cancelSaleCore
} from '../../sales/cancelSaleCore';

const STORES = {
  SALES: 'sales',
  PRODUCT_BATCHES: 'product_batches',
  MENU: 'menu',
  INVENTORY_EVENTS: 'inventory_events',
  TRANSACTION_LOG: 'transaction_log',
  WASTE: 'waste_logs'
};

const makeDb = (initialSales = []) => {
  const maps = Object.fromEntries(
    Object.values(STORES).map((store) => [store, new Map()])
  );
  initialSales.forEach((sale) => maps[STORES.SALES].set(sale.id, structuredClone(sale)));

  const table = (store) => ({
    get: vi.fn(async (key) => maps[store].get(key)),
    put: vi.fn(async (value) => {
      maps[store].set(value.id, structuredClone(value));
      return value.id;
    }),
    add: vi.fn(async (value) => {
      if (maps[store].has(value.id)) throw new Error('duplicate');
      maps[store].set(value.id, structuredClone(value));
      return value.id;
    }),
    delete: vi.fn(async (key) => maps[store].delete(key)),
    bulkAdd: vi.fn(async (values) => {
      values.forEach((value) => {
        if (maps[store].has(value.id)) throw new Error('duplicate');
        maps[store].set(value.id, structuredClone(value));
      });
    }),
    where: vi.fn((index) => ({
      equals: vi.fn((value) => ({
        toArray: vi.fn(async () => Array.from(maps[store].values()).filter(
          (record) => record[index] === value
        ))
      }))
    }))
  });

  return {
    maps,
    table: vi.fn(table),
    transaction: vi.fn(async (_mode, _stores, callback) => callback())
  };
};

const makeDeps = (db, overrides = {}) => ({
  db,
  STORES,
  generateId: vi.fn(() => 'txn-1'),
  now: () => '2026-06-14T12:00:00.000Z',
  restoreStockFromCancellation: vi.fn(async () => ({
    restored: [],
    warnings: [],
    restoredInventoryValue: 0
  })),
  Logger: { error: vi.fn() },
  ...overrides
});

const makeSale = (overrides = {}) => ({
  id: 'sale-1',
  timestamp: '2026-06-14T10:00:00.000Z',
  status: 'closed',
  fulfillmentStatus: 'completed',
  items: [
    { id: 'product-1', name: 'Producto', quantity: 2, cost: 5 }
  ],
  ...overrides
});

describe('cancelSaleCore', () => {
  it('cancela sin regresar inventario y conserva la venta auditable', async () => {
    const sale = makeSale();
    const db = makeDb([sale]);
    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        currentSales: [sale],
        dispositionPlan: [{
          lineId: 'product-1:0',
          action: CANCELLATION_ACTIONS.NO_RETURN
        }]
      },
      makeDeps(db)
    );

    expect(result).toMatchObject({
      success: true,
      code: 'CANCELLED',
      warnings: [],
      inventoryReversalEventIds: []
    });
    expect(db.maps[STORES.SALES].get(sale.id)).toMatchObject({
      status: 'cancelled',
      fulfillmentStatus: 'cancelled'
    });
  });

  it('restaura inventario y registra un evento compensatorio', async () => {
    const sale = makeSale();
    const db = makeDb([sale]);
    const restoreStockFromCancellation = vi.fn(async () => ({
      restored: [{
        type: 'product',
        id: 'product-1',
        productId: 'product-1',
        restoredQuantity: 2
      }],
      warnings: [],
      restoredInventoryValue: 10
    }));

    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        currentSales: [sale],
        dispositionPlan: [{
          lineId: 'product-1:0',
          action: CANCELLATION_ACTIONS.RESTOCK
        }]
      },
      makeDeps(db, { restoreStockFromCancellation })
    );

    expect(result.restoreStock).toBe(true);
    expect(result.restoredInventoryValue).toBe(10);
    expect(result.inventoryReversalEventIds).toEqual([
      'inventory-reversal:sale-1:product-1'
    ]);
    expect(db.maps[STORES.INVENTORY_EVENTS].get(result.inventoryReversalEventIds[0]))
      .toMatchObject({
        type: 'INVENTORY_REVERSAL',
        delta: 2,
        saleId: sale.id
      });
  });

  it('registra merma sin ejecutar otra mutacion de inventario', async () => {
    const sale = makeSale();
    const db = makeDb([sale]);
    const deps = makeDeps(db);

    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        currentSales: [sale],
        allowWaste: true,
        dispositionPlan: [{
          lineId: 'product-1:0',
          action: CANCELLATION_ACTIONS.WASTE,
          reason: 'rechazo_cliente'
        }]
      },
      deps
    );

    expect(result.success).toBe(true);
    expect(deps.restoreStockFromCancellation).not.toHaveBeenCalled();
    expect(db.maps[STORES.WASTE].get('sale-waste:sale-1:0')).toMatchObject({
      quantity: 2,
      lossAmount: 10,
      affectsInventory: false,
      source: 'sale_cancellation'
    });
  });

  it('rechaza merma cuando el rubro no la permite', async () => {
    const sale = makeSale();
    const db = makeDb([sale]);
    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        currentSales: [sale],
        allowWaste: false,
        dispositionPlan: [{
          lineId: 'product-1:0',
          action: CANCELLATION_ACTIONS.WASTE
        }]
      },
      makeDeps(db)
    );

    expect(result).toMatchObject({
      success: false,
      code: 'WASTE_NOT_ALLOWED',
      warnings: []
    });
    expect(db.maps[STORES.SALES].get(sale.id).status).toBe('closed');
  });

  it('aborta cuando la restauracion de inventario produce warnings', async () => {
    const sale = makeSale();
    const db = makeDb([sale]);
    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        currentSales: [sale],
        dispositionPlan: [{
          lineId: 'product-1:0',
          action: CANCELLATION_ACTIONS.RESTOCK
        }]
      },
      makeDeps(db, {
        restoreStockFromCancellation: vi.fn(async () => ({
          restored: [],
          warnings: [{ code: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' }]
        }))
      })
    );

    expect(result).toMatchObject({
      success: false,
      code: 'RESTORE_FAILED',
      warnings: []
    });
    expect(db.maps[STORES.SALES].get(sale.id).status).toBe('closed');
  });

  it('retorna NOT_FOUND cuando la venta no existe', async () => {
    const db = makeDb();
    const result = await cancelSaleCore(
      {
        saleTimestamp: '2026-06-14T11:00:00.000Z',
        currentSales: []
      },
      makeDeps(db)
    );

    expect(result).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
      warnings: [],
      inventoryReversalEventIds: []
    });
  });
});
