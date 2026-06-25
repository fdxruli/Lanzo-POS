import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCashSessionProjection, resolveCashSessionAmounts } from '../cajaProjection';

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

  it('mantiene calculo local desde ventas aunque la caja local tenga campos agregados locales', async () => {
    const localSession = {
      ...cashSession,
      id: 'local-cash-with-fields',
      ventas_efectivo: '0',
      entradas_efectivo: '0',
      salidas_efectivo: '0'
    };

    await testDb.table('sales').add({
      id: 'local-sale-current',
      cash_session_id: localSession.id,
      timestamp: '2026-06-14T12:00:00.000Z',
      status: 'closed',
      paymentMethod: 'efectivo',
      total: '100'
    });

    const result = await loadCashSessionProjection(testDb, localSession);

    expect(result.totals).toEqual({
      ventasContado: '100',
      abonosFiado: '0'
    });
  });

  it('usa agregados cloud para abonos y total teorico sin duplicar movimientos customer_payment', async () => {
    const cloudSession = {
      ...cashSession,
      id: 'cloud-cash-1',
      cloudCash: true,
      monto_inicial: '0',
      ventas_efectivo: '0',
      abonos_fiado: '50',
      entradas_efectivo: '0',
      salidas_efectivo: '0',
      total_teorico_cloud: '50'
    };

    await testDb.table('movimientos_caja').add({
      id: 'cloud-payment-1',
      cash_session_id: cloudSession.id,
      tipo: 'abono_cliente',
      origen: 'customer_payment',
      monto: '50',
      fecha: '2026-06-14T12:00:00.000Z'
    });

    const result = await loadCashSessionProjection(testDb, cloudSession);
    const amounts = resolveCashSessionAmounts(cloudSession, result.totals, { isCloudCash: true });

    expect(result.totals).toEqual({
      ventasContado: '0',
      abonosFiado: '50'
    });
    expect(amounts.totalTeorico).toBe('50');
    expect(result.movements.map((movement) => movement.id)).toContain('cloud-payment-1');
  });

  it('usa movimiento abono_cliente como fallback cloud solo si no existe agregado abonos_fiado', async () => {
    const cloudSessionWithoutAggregate = {
      ...cashSession,
      id: 'cloud-cash-2',
      cloudCash: true,
      monto_inicial: '0',
      ventas_efectivo: '0',
      entradas_efectivo: '0',
      salidas_efectivo: '0'
    };

    await testDb.table('movimientos_caja').add({
      id: 'cloud-payment-fallback',
      cash_session_id: cloudSessionWithoutAggregate.id,
      tipo: 'abono_cliente',
      origen: 'customer_payment',
      monto: '50',
      fecha: '2026-06-14T12:00:00.000Z'
    });

    const result = await loadCashSessionProjection(testDb, cloudSessionWithoutAggregate);

    expect(result.totals).toEqual({
      ventasContado: '0',
      abonosFiado: '50'
    });
  });
});
