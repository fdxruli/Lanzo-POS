import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { customerCreditRepository } from '../customerCreditRepository';
import { db, STORES } from '../dexie';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';

describe('customerCreditRepository.processPayment', () => {
  beforeEach(async () => {
    await openTestTenantRuntime();
    await db.table(STORES.CUSTOMER_LEDGER).clear();
    await db.table(STORES.MOVIMIENTOS_CAJA).clear();
    await db.table(STORES.CAJAS).clear();
    await db.table(STORES.SALES).clear();
    await db.table(STORES.CUSTOMERS).clear();
  });

  afterEach(() => closeTestTenantRuntime());

  it('rechaza abono en efectivo sin cajaId y no modifica deuda ni ledger', async () => {
    await db.table(STORES.CUSTOMERS).put({
      id: 'cust-1',
      name: 'Cliente Test',
      debt: '100',
      debtCents: 10000,
      createdAt: '2026-06-16T10:00:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z'
    });

    await expect(
      customerCreditRepository.processPayment('cust-1', 30, 'efectivo')
    ).rejects.toMatchObject({
      name: 'DatabaseError',
      code: 'VALIDATION_ERROR',
      message: 'CAJA_REQUIRED: No se puede registrar un abono en efectivo sin caja abierta.'
    });

    const customer = await db.table(STORES.CUSTOMERS).get('cust-1');
    expect(customer.debt).toBe('100');
    expect(await db.table(STORES.CUSTOMER_LEDGER).count()).toBe(0);
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
  });

  it('rechaza abono en cash si la caja existe pero esta cerrada', async () => {
    await db.table(STORES.CUSTOMERS).put({
      id: 'cust-1',
      name: 'Cliente Test',
      debt: '100',
      debtCents: 10000,
      createdAt: '2026-06-16T10:00:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z'
    });

    await db.table(STORES.CAJAS).put({
      id: 'caja-1',
      estado: 'cerrada',
      entradas_efectivo: '0',
      salidas_efectivo: '0',
      fecha_apertura: '2026-06-16T09:00:00.000Z'
    });

    await expect(
      customerCreditRepository.processPayment('cust-1', 30, 'cash', 'caja-1')
    ).rejects.toMatchObject({
      name: 'DatabaseError',
      code: 'VALIDATION_ERROR',
      message: 'CAJA_REQUIRED: No se puede registrar un abono en efectivo sin caja abierta.'
    });

    const customer = await db.table(STORES.CUSTOMERS).get('cust-1');
    expect(customer.debt).toBe('100');
    expect(await db.table(STORES.CUSTOMER_LEDGER).count()).toBe(0);
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
  });

  it('registra un abono con caja dentro de la misma transaccion', async () => {
    await db.table(STORES.CUSTOMERS).put({
      id: 'cust-1',
      name: 'Cliente Test',
      debt: '100',
      debtCents: 10000,
      createdAt: '2026-06-16T10:00:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z'
    });

    await db.table(STORES.CAJAS).put({
      id: 'caja-1',
      estado: 'abierta',
      entradas_efectivo: '0',
      salidas_efectivo: '0',
      fecha_apertura: '2026-06-16T09:00:00.000Z'
    });

    await db.table(STORES.SALES).put({
      id: 'sale-1',
      customerId: 'cust-1',
      paymentMethod: 'fiado',
      saldoPendiente: 100,
      total: 100,
      abono: 0,
      timestamp: '2026-06-16T09:30:00.000Z'
    });

    const result = await customerCreditRepository.processPayment(
      'cust-1',
      30,
      'efectivo',
      'caja-1',
      'Abono de cliente: Cliente Test'
    );

    expect(result).toMatchObject({ success: true, newDebt: '70' });

    const customer = await db.table(STORES.CUSTOMERS).get('cust-1');
    expect(customer.debt).toBe('70');
    expect(customer.debtCents).toBe(7000);

    const sale = await db.table(STORES.SALES).get('sale-1');
    expect(sale.saldoPendiente).toBe(70);
    expect(sale.creditStatus).toBe('PARCIAL');
    expect(sale.paymentCollections).toEqual([expect.objectContaining({
      paymentId: expect.any(String),
      method: 'efectivo',
      amount: '30',
      cashSessionId: 'caja-1',
      cashMovementId: expect.any(String)
    })]);

    const ledgerEntries = await db.table(STORES.CUSTOMER_LEDGER).toArray();
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toMatchObject({
      customerId: 'cust-1',
      type: 'PAYMENT',
      amount: '-30',
      paymentMethod: 'efectivo',
      allocations: [{ saleId: 'sale-1', amountApplied: '30' }],
      cashSessionId: 'caja-1',
      cashMovementId: expect.any(String)
    });

    const caja = await db.table(STORES.CAJAS).get('caja-1');
    expect(caja.entradas_efectivo).toBe('30');

    const movements = await db.table(STORES.MOVIMIENTOS_CAJA).toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      caja_id: 'caja-1',
      cash_session_id: 'caja-1',
      tipo: 'entrada',
      monto: '30',
      concepto: 'Abono de cliente: Cliente Test'
    });
    expect(ledgerEntries[0].cashMovementId).toBe(movements[0].id);
  });

  it('conserva el medio no efectivo de un abono fiado sin crear una entrada de caja', async () => {
    await db.table(STORES.CUSTOMERS).put({ id: 'cust-1', name: 'Cliente Test', debt: '50', debtCents: 5000 });
    await db.table(STORES.SALES).put({
      id: 'sale-1', customerId: 'cust-1', paymentMethod: 'fiado', saldoPendiente: 50, total: 50, abono: 0
    });

    await customerCreditRepository.processPayment(
      'cust-1', 20, 'tarjeta', null, 'Abono con tarjeta', [{ saleId: 'sale-1', amountApplied: '20' }]
    );

    const sale = await db.table(STORES.SALES).get('sale-1');
    const [ledger] = await db.table(STORES.CUSTOMER_LEDGER).toArray();
    expect(sale.paymentCollections).toEqual([expect.objectContaining({ method: 'tarjeta', amount: '20', cashSessionId: null, cashMovementId: null })]);
    expect(ledger).toMatchObject({ paymentMethod: 'tarjeta', allocations: [{ saleId: 'sale-1', amountApplied: '20' }] });
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
  });

  it('no reabre el saldo de una venta fiada cancelada al reparar deudas', async () => {
    await db.table(STORES.CUSTOMERS).put({ id: 'cust-1', name: 'Cliente Test', debt: '5', debtCents: 500 });
    await db.table(STORES.SALES).bulkPut([
      {
        id: 'sale-active', customerId: 'cust-1', paymentMethod: 'fiado',
        saldoPendiente: 5, total: 10, abono: 0, timestamp: '2026-06-16T10:00:00.000Z'
      },
      {
        id: 'sale-cancelled', customerId: 'cust-1', paymentMethod: 'fiado', status: 'cancelled',
        saldoPendiente: 0, total: 20, abono: 0, timestamp: '2026-06-16T09:00:00.000Z',
        cancellationFinancials: { version: 1, refunds: [] }
      }
    ]);

    await customerCreditRepository.healCustomerSalesDebt('cust-1');

    expect((await db.table(STORES.SALES).get('sale-active')).saldoPendiente).toBe(5);
    expect((await db.table(STORES.SALES).get('sale-cancelled')).saldoPendiente).toBe(0);
    expect((await db.table(STORES.SALES).get('sale-cancelled')).creditStatus).not.toBe('PARCIAL');
  });
});
