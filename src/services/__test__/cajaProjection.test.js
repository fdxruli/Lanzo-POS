import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCashSessionProjection } from '../cajaProjection';

describe('loadCashSessionProjection', () => {
  let testDb;

  const cashSession = {
    id: 'cash-2',
    fecha_apertura: '2026-06-14T10:00:00.000Z',
    fecha_cierre: '2026-06-14T18:00:00.000Z'
  };

  beforeEach(async () => {
    testDb = new Dexie(`cash-projection-${crypto.randomUUID()}`, {
      indexedDB,
      IDBKeyRange
    });
    testDb.version(1).stores({
      sales: 'id, timestamp, cash_session_id, [cash_session_id+timestamp]',
      movimientos_caja: 'id, cash_session_id',
      deleted_sales: 'id, deletedAt',
      waste_logs: 'id, timestamp'
    });
    await testDb.open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDb.delete();
  });

  it('limita ventas y eventos al turno solicitado usando indices', async () => {
    await testDb.table('sales').bulkAdd([
      {
        id: 'sale-current',
        cash_session_id: cashSession.id,
        timestamp: '2026-06-14T12:00:00.000Z',
        status: 'closed',
        paymentMethod: 'efectivo',
        total: '125.50'
      },
      {
        id: 'sale-other-session',
        cash_session_id: 'cash-1',
        timestamp: '2026-06-14T12:30:00.000Z',
        status: 'closed',
        paymentMethod: 'efectivo',
        total: '999'
      },
      {
        id: 'sale-legacy-current',
        timestamp: '2026-06-14T13:00:00.000Z',
        status: 'closed',
        paymentMethod: 'fiado',
        abono: '20'
      },
      {
        id: 'sale-before',
        timestamp: '2026-06-13T13:00:00.000Z',
        status: 'closed',
        paymentMethod: 'efectivo',
        total: '500'
      }
    ]);
    await testDb.table('movimientos_caja').add({
      id: 'movement-current',
      cash_session_id: cashSession.id,
      tipo: 'entrada',
      monto: '10',
      fecha: '2026-06-14T11:00:00.000Z'
    });
    await testDb.table('deleted_sales').bulkAdd([
      {
        id: 'deleted-current',
        deletedAt: '2026-06-14T14:00:00.000Z',
        total: '40'
      },
      {
        id: 'deleted-old',
        deletedAt: '2026-06-13T14:00:00.000Z',
        total: '400'
      }
    ]);
    await testDb.table('waste_logs').bulkAdd([
      {
        id: 'waste-current',
        timestamp: '2026-06-14T15:00:00.000Z',
        productName: 'Cafe',
        quantity: 1,
        unit: 'pz',
        lossAmount: '5'
      },
      {
        id: 'waste-old',
        timestamp: '2026-06-13T15:00:00.000Z',
        productName: 'Leche',
        quantity: 1,
        unit: 'pz',
        lossAmount: '50'
      }
    ]);

    const deletedWhere = vi.spyOn(testDb.table('deleted_sales'), 'where');
    const wasteWhere = vi.spyOn(testDb.table('waste_logs'), 'where');
    const result = await loadCashSessionProjection(testDb, cashSession);

    expect(result.totals).toEqual({
      ventasContado: '125.5',
      abonosFiado: '20'
    });
    expect(result.movements.map((movement) => movement.id)).toEqual([
      'waste-current',
      'del-sale-deleted-current',
      'sale-legacy-current',
      'sale-current',
      'movement-current'
    ]);
    expect(deletedWhere).toHaveBeenCalledWith('deletedAt');
    expect(wasteWhere).toHaveBeenCalledWith('timestamp');
  });
});
