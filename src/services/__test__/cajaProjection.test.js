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
    const amounts = resolveCashSessionAmounts(cloudSession, {
      ...result.totals,
      reconciliation: { theoreticalCash: '999' }
    }, { isCloudCash: true });

    expect(result.totals).toEqual({
      ventasContado: '0',
      abonosFiado: '50'
    });
    expect(amounts.totalTeorico).toBe('50');
    expect(amounts.source).toBe('cloud_aggregate');
    expect(amounts.reconciliation).toBeUndefined();
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

  it('enriquece el movimiento oficial ecommerce y omite el sintetico equivalente sin cambiar totales', async () => {
    const cloudSession = {
      ...cashSession,
      id: 'cloud-ecommerce-cash',
      cloudCash: true,
      ventas_efectivo: '31',
      abonos_fiado: '0',
      total_teorico_cloud: '31'
    };
    const sale = {
      id: 'ecom-order-1',
      cash_session_id: cloudSession.id,
      timestamp: '2026-06-14T12:00:00.000Z',
      status: 'closed',
      folio: 'V-000034',
      salesChannel: 'ecommerce',
      ecommerceOrderId: 'order-uuid-1',
      ecommerceOrderCode: 'EC-00000115',
      paymentMethod: 'cash',
      total: 31
    };

    await testDb.table('sales').add(sale);
    await testDb.table('movimientos_caja').add({
      id: 'mov-1',
      cash_session_id: cloudSession.id,
      tipo: 'venta',
      monto: '31',
      concepto: 'Venta V-000034',
      referenceType: 'sale',
      referenceId: 'ecom-order-1',
      saleId: 'ecom-order-1',
      metadata: { sale_id: 'ecom-order-1' },
      fecha: '2026-06-14T12:00:00.000Z'
    });

    const result = await loadCashSessionProjection(testDb, cloudSession);

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).toMatchObject({
      id: 'mov-1',
      primaryReference: 'EC-00000115',
      secondaryReference: 'Venta V-000034 · Ecommerce',
      salesChannel: 'ecommerce',
      ecommerceOrderId: 'order-uuid-1',
      ecommerceOrderCode: 'EC-00000115'
    });
    expect(result.totals).toEqual({
      ventasContado: '31',
      abonosFiado: '0'
    });
  });

  it('conserva un sintetico si no existe movimiento oficial y no elimina efectos distintos', async () => {
    const session = { ...cashSession, id: 'cash-effects' };
    await testDb.table('sales').add({
      id: 'sale-effects',
      cash_session_id: session.id,
      timestamp: '2026-06-14T12:00:00.000Z',
      status: 'closed',
      folio: 'V-000035',
      paymentMethod: 'cash',
      total: 50
    });
    await testDb.table('movimientos_caja').add({
      id: 'cancel-effect',
      cash_session_id: session.id,
      tipo: 'cancelacion',
      monto: '50',
      referenceType: 'sale',
      referenceId: 'sale-effects',
      fecha: '2026-06-14T13:00:00.000Z'
    });

    const result = await loadCashSessionProjection(testDb, session);

    expect(result.movements.map((movement) => movement.id)).toEqual([
      'cancel-effect',
      'sale-effects'
    ]);
    expect(result.movements[1]).toMatchObject({
      concepto: 'V-000035',
      secondaryReference: 'Venta local'
    });
  });

  it('conserva el abono inicial sintetico si el oficial es un abono posterior de monto distinto', async () => {
    const session = { ...cashSession, id: 'cash-later-payment' };
    await testDb.table('sales').add({
      id: 'credit-sale',
      cash_session_id: session.id,
      timestamp: '2026-06-14T12:00:00.000Z',
      status: 'closed',
      folio: 'V-000040',
      paymentMethod: 'fiado',
      total: 50,
      abono: 10
    });
    await testDb.table('movimientos_caja').add({
      id: 'later-payment',
      cash_session_id: session.id,
      tipo: 'abono_cliente',
      monto: '15',
      sale_id: 'credit-sale',
      fecha: '2026-06-14T13:00:00.000Z'
    });

    const result = await loadCashSessionProjection(testDb, session);

    expect(result.movements.map((movement) => movement.id)).toEqual([
      'later-payment',
      'credit-sale'
    ]);
    expect(result.movements[1]).toMatchObject({ tipo: 'abono', monto: '10' });
  });

  it.each([
    { sale_id: 'sale-alias' },
    { reference_id: 'sale-alias' },
    { reference_type: 'sale', reference_id: 'sale-alias' },
    { referenceType: 'sale', referenceId: 'sale-alias' },
    { metadata: { sale_id: 'sale-alias' } },
    { metadata: { saleId: 'sale-alias' } }
  ])('resuelve aliases cloud para deduplicar: %o', async (alias) => {
    const session = { ...cashSession, id: `cash-${crypto.randomUUID()}` };
    await testDb.table('sales').add({
      id: 'sale-alias',
      cash_session_id: session.id,
      timestamp: '2026-06-14T12:00:00.000Z',
      status: 'closed',
      folio: 'V-000036',
      paymentMethod: 'cash',
      total: 25
    });
    await testDb.table('movimientos_caja').add({
      id: `mov-${crypto.randomUUID()}`,
      cash_session_id: session.id,
      tipo: 'venta',
      monto: '25',
      fecha: '2026-06-14T12:00:00.000Z',
      ...alias
    });

    const result = await loadCashSessionProjection(testDb, session);

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0].sale?.id).toBe('sale-alias');
  });

  it('no enlaza reference_id cuando reference_type pertenece a otra entidad', async () => {
    const session = { ...cashSession, id: 'cash-customer-ledger-reference' };
    await testDb.table('sales').add({
      id: 'sale-customer-ledger-collision',
      cash_session_id: session.id,
      timestamp: '2026-06-14T12:00:00.000Z',
      status: 'closed',
      folio: 'V-000041',
      paymentMethod: 'cash',
      total: 40
    });
    await testDb.table('movimientos_caja').add({
      id: 'customer-ledger-movement',
      cash_session_id: session.id,
      tipo: 'venta',
      monto: '40',
      reference_type: 'customer_ledger',
      reference_id: 'sale-customer-ledger-collision',
      fecha: '2026-06-14T12:00:00.000Z'
    });

    const result = await loadCashSessionProjection(testDb, session);

    expect(result.movements).toHaveLength(2);
    expect(result.movements.find((movement) => movement.id === 'customer-ledger-movement')?.sale).toBeUndefined();
    expect(result.movements.find((movement) => movement.id === 'sale-customer-ledger-collision')?.sale?.id)
      .toBe('sale-customer-ledger-collision');
  });

  it('enlaza sale_id explicito aunque reference_type pertenezca a otra entidad', async () => {
    const session = { ...cashSession, id: 'cash-explicit-sale-reference' };
    await testDb.table('sales').add({
      id: 'sale-explicit-reference',
      cash_session_id: session.id,
      timestamp: '2026-06-14T12:00:00.000Z',
      status: 'closed',
      folio: 'V-000042',
      paymentMethod: 'cash',
      total: 42
    });
    await testDb.table('movimientos_caja').add({
      id: 'explicit-sale-movement',
      cash_session_id: session.id,
      tipo: 'venta',
      monto: '42',
      reference_type: 'customer_ledger',
      reference_id: 'ledger-1',
      sale_id: 'sale-explicit-reference',
      fecha: '2026-06-14T12:00:00.000Z'
    });

    const result = await loadCashSessionProjection(testDb, session);

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).toMatchObject({
      id: 'explicit-sale-movement',
      sale: { id: 'sale-explicit-reference' }
    });
  });
});
