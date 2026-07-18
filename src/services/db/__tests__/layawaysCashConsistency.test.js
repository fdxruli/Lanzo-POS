import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../dexie';
import { layawayRepository } from '../layaways';

const baseLayaway = (id = 'layaway-1') => ({
  id,
  customerId: 'customer-1',
  customerName: 'Cliente',
  items: [],
  totalAmount: 175,
  deadline: '2026-07-30'
});

beforeEach(async () => {
  await db.open();
  await db.table(STORES.LAYAWAYS).clear();
  await db.table(STORES.CAJAS).clear();
  await db.table(STORES.MOVIMIENTOS_CAJA).clear();
});

describe('layaway cash consistency in Free', () => {
  it('registers the initial deposit and installment exactly once in one cash ledger', async () => {
    await db.table(STORES.CAJAS).put({
      id: 'cash-1', estado: 'abierta', entradas_efectivo: '0', salidas_efectivo: '0'
    });

    const created = await layawayRepository.create(baseLayaway(), 75, 'cash-1', {
      payment: { id: 'payment-1', paymentType: 'initial_deposit' },
      cashMovement: {
        idempotencyKey: 'layaway:layaway-1:payment:payment-1',
        metadata: { source: 'layaway_payment', layawayId: 'layaway-1', paymentId: 'payment-1' }
      }
    });

    await layawayRepository.addPaymentWithCash('layaway-1', {
      id: 'payment-2', amount: 100, paymentType: 'installment'
    }, 'cash-1', {
      idempotencyKey: 'layaway:layaway-1:payment:payment-2',
      metadata: { source: 'layaway_payment', layawayId: 'layaway-1', paymentId: 'payment-2' }
    });

    const layaway = await layawayRepository.getById('layaway-1');
    const cash = await db.table(STORES.CAJAS).get('cash-1');
    const movements = await db.table(STORES.MOVIMIENTOS_CAJA).toArray();

    expect(created.layaway.payments[0]).toMatchObject({
      id: 'payment-1', paymentType: 'initial_deposit', cashMovementId: expect.any(String)
    });
    expect(layaway.paidAmount).toBe(175);
    expect(layaway.payments).toHaveLength(2);
    expect(movements).toHaveLength(2);
    expect(movements.map((movement) => movement.monto).sort()).toEqual(['100', '75']);
    expect(movements.every((movement) => movement.cash_session_id === 'cash-1')).toBe(true);
    expect(cash.entradas_efectivo).toBe('175');
  });

  it('rolls back the initial deposit when Caja is closed', async () => {
    await db.table(STORES.CAJAS).put({
      id: 'cash-1', estado: 'cerrada', entradas_efectivo: '0', salidas_efectivo: '0'
    });

    await expect(layawayRepository.create(baseLayaway(), 75, 'cash-1', {
      payment: { id: 'payment-1' },
      cashMovement: { idempotencyKey: 'layaway:layaway-1:payment:payment-1' }
    })).rejects.toThrow();

    expect(await db.table(STORES.LAYAWAYS).count()).toBe(0);
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
    expect((await db.table(STORES.CAJAS).get('cash-1')).entradas_efectivo).toBe('0');
  });

  it('registers cancellation refund as one canonical exit', async () => {
    await db.table(STORES.CAJAS).put({
      id: 'cash-1', estado: 'abierta', entradas_efectivo: '75', salidas_efectivo: '0'
    });
    await layawayRepository.create(baseLayaway(), 75, 'cash-1', {
      payment: { id: 'payment-1' },
      cashMovement: { idempotencyKey: 'layaway:layaway-1:payment:payment-1' }
    });

    await layawayRepository.cancel('layaway-1', 'Cliente', false, 'cash-1', {
      cashMovement: {
        idempotencyKey: 'layaway:layaway-1:refund:refund-1',
        metadata: { source: 'layaway_refund', layawayId: 'layaway-1', refundId: 'refund-1' }
      }
    });

    const cash = await db.table(STORES.CAJAS).get('cash-1');
    const refunds = (await db.table(STORES.MOVIMIENTOS_CAJA).toArray())
      .filter((movement) => movement.tipo === 'salida');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ monto: '75', cash_session_id: 'cash-1', refundId: 'refund-1' });
    expect(cash.salidas_efectivo).toBe('75');
  });

  it('reports legacy payments without creating a new cash movement', async () => {
    await db.table(STORES.LAYAWAYS).put({
      ...baseLayaway('legacy-layaway'),
      createdAt: '2026-07-01T10:00:00.000Z',
      payments: [{ id: 'legacy-payment', amount: 75, date: '2026-07-01T10:00:00.000Z', type: 'initial_deposit', cajaId: 'old-cash' }]
    });

    const report = await layawayRepository.getLegacyPaymentsForReconciliation();

    expect(report).toEqual([expect.objectContaining({
      layawayId: 'legacy-layaway', paymentId: 'legacy-payment', amount: 75, cajaId: 'old-cash', status: 'needs_reconciliation'
    })]);
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
  });
});
