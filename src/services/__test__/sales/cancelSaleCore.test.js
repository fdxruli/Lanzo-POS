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
  WASTE: 'waste_logs',
  CUSTOMERS: 'customers',
  CUSTOMER_LEDGER: 'customer_ledger',
  CAJAS: 'cajas',
  MOVIMIENTOS_CAJA: 'movimientos_caja'
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
    update: vi.fn(async (key, changes) => {
      const current = maps[store].get(key);
      if (!current) return 0;
      maps[store].set(key, { ...current, ...changes });
      return 1;
    }),
    toCollection: vi.fn(() => ({
      filter: vi.fn((predicate) => ({
        first: vi.fn(async () => Array.from(maps[store].values()).find(predicate))
      }))
    })),
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
    transaction: vi.fn(async (_mode, _stores, callback) => callback({ table }))
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
  assertActorCurrent: vi.fn(),
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
  it('falla cerrado cuando se invoca sin una asercion de actor', async () => {
    const sale = makeSale();
    const db = makeDb([sale]);
    const deps = makeDeps(db);
    delete deps.assertActorCurrent;

    const result = await cancelSaleCore(
      { saleId: sale.id, currentSales: [sale] },
      deps
    );

    expect(result).toMatchObject({ success: false, code: 'ACTOR_SESSION_REQUIRED' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('cancela sin regresar inventario y conserva la venta auditable', async () => {
    const sale = makeSale({ total: '20', paymentMethod: 'efectivo', payments: [{ method: 'cash', amount: '20' }] });
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
      fulfillmentStatus: 'cancelled',
      cancellationFinancials: { version: 1, refunds: [], cashRefundTotal: '0' }
    });
    expect(db.maps[STORES.MOVIMIENTOS_CAJA].size).toBe(0);
  });

  it('registra solo la devolución en efectivo confirmada y no duplica al reintentar', async () => {
    const sale = makeSale({
      total: '20',
      paymentMethod: 'efectivo',
      cash_session_id: 'cash-1',
      payments: [{ method: 'cash', amount: '20' }]
    });
    const cashSession = {
      id: 'cash-1', estado: 'abierta', actorKey: 'admin:1', localStationKey: 'local:device:test-terminal',
      entradas_efectivo: '0', salidas_efectivo: '0'
    };
    const db = makeDb([sale]);
    db.maps[STORES.CAJAS].set(cashSession.id, structuredClone(cashSession));
    const input = {
      saleId: sale.id,
      currentSales: [sale],
      refunds: [{ method: 'cash', amount: '20' }],
      cashSession,
      cashActorContext: { assertCurrent: vi.fn() }
    };

    const first = await cancelSaleCore(input, makeDeps(db));
    const retry = await cancelSaleCore(input, makeDeps(db));

    expect(first).toMatchObject({ success: true, cashRefundMovementId: 'cash-refund:cancel:sale-1' });
    expect(db.maps[STORES.MOVIMIENTOS_CAJA].size).toBe(1);
    expect(db.maps[STORES.CAJAS].get('cash-1').salidas_efectivo).toBe('20');
    expect(db.maps[STORES.MOVIMIENTOS_CAJA].get('cash-refund:cancel:sale-1')).toMatchObject({
      tipo: 'salida', monto: '20', idempotencyKey: 'sale-cancellation-refund:cancel:sale-1:cash',
      source: 'sale_cancellation', saleId: sale.id
    });
    expect(retry).toMatchObject({ success: true, code: 'ALREADY_CANCELLED', alreadyCancelled: true });
  });

  it('permite una devolución parcial válida sin inventar el resto del pago', async () => {
    const sale = makeSale({
      total: '20', paymentMethod: 'cash', payments: [{ method: 'cash', amount: '20' }]
    });
    const db = makeDb([sale]);
    const cashSession = {
      id: 'cash-1', estado: 'abierta', actorKey: 'admin:1', localStationKey: 'local:device:test-terminal',
      entradas_efectivo: '0', salidas_efectivo: '0'
    };
    db.maps[STORES.CAJAS].set(cashSession.id, cashSession);

    const result = await cancelSaleCore({
      saleId: sale.id,
      refunds: [{ method: 'cash', amount: '5.50' }],
      cashSession,
      cashActorContext: { assertCurrent: vi.fn() }
    }, makeDeps(db));

    expect(result.success).toBe(true);
    expect(db.maps[STORES.CAJAS].get('cash-1').salidas_efectivo).toBe('5.5');
    expect(db.maps[STORES.SALES].get(sale.id).cancellationFinancials.refunds[0])
      .toMatchObject({ method: 'cash', amount: '5.5', sourcePayments: [{ paymentId: sale.payments[0].id || 'sale:0' }] });
  });

  it('valida cada medio en pagos mixtos y revierte el saldo fiado con abonos posteriores', async () => {
    const mixedSale = makeSale({
      total: '20', paymentMethod: 'mixed', payments: [
        { method: 'cash', amount: '8' }, { method: 'card', amount: '12' }
      ]
    });
    const mixedDb = makeDb([mixedSale]);
    const mixedSession = {
      id: 'cash-1', estado: 'abierta', actorKey: 'admin:1', localStationKey: 'local:device:test-terminal',
      entradas_efectivo: '0', salidas_efectivo: '0'
    };
    mixedDb.maps[STORES.CAJAS].set(mixedSession.id, mixedSession);
    const mixedResult = await cancelSaleCore({
      saleId: mixedSale.id,
      refunds: [{ method: 'cash', amount: '3' }, { method: 'card', amount: '12' }],
      cashSession: mixedSession,
      cashActorContext: { assertCurrent: vi.fn() }
    }, makeDeps(mixedDb));
    expect(mixedResult.success).toBe(true);
    expect(mixedDb.maps[STORES.CAJAS].get('cash-1').salidas_efectivo).toBe('3');

    const creditSale = makeSale({
      id: 'credit-sale', customerId: 'customer-1', paymentMethod: 'mixed', total: '20',
      abono: '5', saldoPendiente: '5',
      payments: [{ method: 'cash', amount: '5' }],
      paymentCollections: [{ id: 'ledger-1:credit-sale', paymentId: 'ledger-1', method: 'efectivo', amount: '10' }]
    });
    const creditDb = makeDb([creditSale]);
    creditDb.maps[STORES.CUSTOMERS].set('customer-1', { id: 'customer-1', debt: '5' });
    const creditSession = {
      id: 'cash-2', estado: 'abierta', actorKey: 'admin:1', localStationKey: 'local:device:test-terminal',
      entradas_efectivo: '0', salidas_efectivo: '0'
    };
    creditDb.maps[STORES.CAJAS].set(creditSession.id, creditSession);
    const creditResult = await cancelSaleCore({
      saleId: creditSale.id,
      refunds: [{ method: 'cash', amount: '15' }],
      cashSession: creditSession,
      cashActorContext: { assertCurrent: vi.fn() }
    }, makeDeps(creditDb));

    expect(creditResult.success).toBe(true);
    expect(creditResult.refunds[0].sourcePayments).toHaveLength(2);
    expect(creditDb.maps[STORES.CUSTOMERS].get('customer-1')).toMatchObject({ debt: '0', debtCents: 0 });
    expect(creditDb.maps[STORES.CUSTOMER_LEDGER].get('cancel-credit:cancel:credit-sale'))
      .toMatchObject({ type: 'CANCEL_CHARGE', amount: '-5', reference: 'credit-sale' });
    expect(creditDb.maps[STORES.SALES].get('credit-sale')).toMatchObject({ status: 'cancelled', saldoPendiente: 0 });
  });

  it('rechaza devoluciones superiores a la fuente identificada y conserva ventas históricas sin reembolso inventado', async () => {
    const sale = makeSale({ total: '20', paymentMethod: 'card', payments: [{ method: 'card', amount: '20' }] });
    const db = makeDb([sale]);
    const rejected = await cancelSaleCore({
      saleId: sale.id,
      refunds: [{ method: 'cash', amount: '1' }]
    }, makeDeps(db));
    expect(rejected).toMatchObject({ success: false, code: 'REFUND_EXCEEDS_PAID_AMOUNT' });
    expect(db.maps[STORES.SALES].get(sale.id).status).toBe('closed');

    const legacy = makeSale({ id: 'legacy-credit', paymentMethod: 'fiado', total: '20', abono: '10' });
    const legacyDb = makeDb([legacy]);
    const cancelled = await cancelSaleCore({ saleId: legacy.id }, makeDeps(legacyDb));
    expect(cancelled.success).toBe(true);
    expect(legacyDb.maps[STORES.SALES].get(legacy.id).cancellationFinancials.refunds).toEqual([]);
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
