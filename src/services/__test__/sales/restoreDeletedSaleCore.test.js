import { describe, expect, it, vi } from 'vitest';
import { restoreDeletedSaleCore } from '../../sales/restoreDeletedSaleCore';

const STORES = {
  DELETED_SALES: 'deleted_sales',
  SALES: 'sales',
  PRODUCT_BATCHES: 'product_batches',
  MENU: 'menu',
  INVENTORY_EVENTS: 'inventory_events',
  TRANSACTION_LOG: 'transaction_log',
  WASTE: 'waste_logs'
};

const makeDb = (deletedSale) => {
  const maps = Object.fromEntries(Object.values(STORES).map((store) => [store, new Map()]));
  if (deletedSale) maps[STORES.DELETED_SALES].set(deletedSale.id, structuredClone(deletedSale));

  return {
    maps,
    table: vi.fn((store) => ({
      get: vi.fn(async (key) => maps[store].get(key)),
      add: vi.fn(async (value) => {
        if (maps[store].has(value.id)) throw new Error('duplicate');
        maps[store].set(value.id, structuredClone(value));
      }),
      delete: vi.fn(async (key) => maps[store].delete(key)),
      bulkAdd: vi.fn(async (values) => {
        values.forEach((value) => maps[store].set(value.id, structuredClone(value)));
      }),
      bulkUpdate: vi.fn(async (updates) => {
        updates.forEach(({ key, changes }) => {
          const current = maps[store].get(key);
          if (current) maps[store].set(key, { ...current, ...changes });
        });
      })
    })),
    transaction: vi.fn(async (_mode, _stores, callback) => callback())
  };
};

const makeSale = (overrides = {}) => ({
  id: 'sale-1',
  timestamp: '2026-06-14T10:00:00.000Z',
  status: 'cancelled',
  fulfillmentStatus: 'cancelled',
  items: [{ id: 'product-1', name: 'Producto', quantity: 2 }],
  cancellationDisposition: [{
    lineId: 'product-1:0',
    itemIndex: 0,
    productId: 'product-1',
    action: 'restock'
  }],
  ...overrides
});

const makeDeps = (db, reapplyStockFromCancellation) => ({
  db,
  STORES,
  reapplyStockFromCancellation,
  generateId: () => 'txn-restore',
  now: () => '2026-06-14T13:00:00.000Z',
  Logger: { error: vi.fn() }
});

describe('restoreDeletedSaleCore', () => {
  it('restaura la venta y reaplica la salida previamente compensada', async () => {
    const sale = makeSale();
    const db = makeDb(sale);
    const result = await restoreDeletedSaleCore(
      { saleId: sale.id },
      makeDeps(db, vi.fn(async () => ({
        deducted: [{
          type: 'product',
          id: 'product-1',
          productId: 'product-1',
          deductedQuantity: 2
        }]
      })))
    );

    expect(result).toMatchObject({ success: true, code: 'RESTORED' });
    expect(db.maps[STORES.DELETED_SALES].has(sale.id)).toBe(false);
    expect(db.maps[STORES.SALES].get(sale.id)).toMatchObject({
      status: 'closed',
      restoredFromTrash: true
    });
    expect(db.maps[STORES.INVENTORY_EVENTS]
      .get('inventory-reinstatement:sale-1:product-1')).toMatchObject({
        type: 'INVENTORY_REINSTATEMENT',
        delta: -2
      });
  });

  it('no modifica inventario para una venta que nunca fue devuelta a stock', async () => {
    const sale = makeSale({
      cancellationDisposition: [{
        lineId: 'product-1:0',
        itemIndex: 0,
        action: 'no_return'
      }]
    });
    const db = makeDb(sale);
    const reapply = vi.fn();
    const result = await restoreDeletedSaleCore(
      { saleId: sale.id },
      makeDeps(db, reapply)
    );

    expect(result.success).toBe(true);
    expect(reapply).not.toHaveBeenCalled();
    expect(result.inventoryReinstatementEventIds).toEqual([]);
  });

  it('mantiene la venta en papelera si no puede reaplicar el inventario', async () => {
    const sale = makeSale();
    const db = makeDb(sale);
    const result = await restoreDeletedSaleCore(
      { saleId: sale.id },
      makeDeps(db, vi.fn(async () => {
        throw new Error('Stock insuficiente');
      }))
    );

    expect(result).toMatchObject({
      success: false,
      code: 'RESTORE_FAILED'
    });
    expect(db.maps[STORES.DELETED_SALES].has(sale.id)).toBe(true);
    expect(db.maps[STORES.SALES].has(sale.id)).toBe(false);
  });
});
