import { describe, expect, it } from 'vitest';
import { buildCashReconciliation, buildLayawayFinancialProjection } from '../layawayFinancialProjection';

const session = {
  id: 'cash-1',
  monto_inicial: 0,
  entradas_efectivo: 275,
  salidas_efectivo: 0,
  fecha_apertura: '2026-07-25T08:00:00.000Z',
  fecha_cierre: '2026-07-25T18:00:00.000Z'
};

const cashSale = {
  id: 'sale-direct', timestamp: '2026-07-25T10:00:00.000Z', cash_session_id: 'cash-1',
  status: 'closed', paymentMethod: 'efectivo', total: 210, items: [{ quantity: 1, price: 210, cost: 125 }]
};

const pendingLayaway = {
  id: 'layaway-1', status: 'ready', totalAmount: 275,
  payments: [
    { id: 'payment-1', amount: 75, status: 'confirmed', cashMovementId: 'move-1', cajaId: 'cash-1' },
    { id: 'payment-2', amount: 100, status: 'confirmed', cashMovementId: 'move-2', cajaId: 'cash-1' },
    { id: 'payment-3', amount: 100, status: 'confirmed', cashMovementId: 'move-3', cajaId: 'cash-1' }
  ]
};

const paymentMovements = pendingLayaway.payments.map((payment) => ({
  id: payment.cashMovementId, cash_session_id: 'cash-1', tipo: 'entrada', monto: payment.amount,
  fecha: '2026-07-25T11:00:00.000Z', source: 'layaway_payment', referenceType: 'layaway',
  referenceId: 'layaway-1', layawayId: 'layaway-1', paymentId: payment.id
}));

describe('layaway financial projection', () => {
  it('reconciles direct sales and pending advances without treating advances as recognized revenue', () => {
    const reconciliation = buildCashReconciliation({
      cashSession: session,
      sales: [cashSale],
      layaways: [pendingLayaway],
      cashMovements: paymentMovements
    });

    expect(reconciliation).toMatchObject({
      theoreticalCash: 485,
      recognizedSales: 210,
      directSalesRevenue: 210,
      layawayPaymentsCollected: 275,
      layawayPendingAdvances: 275,
      layawayCompletedRevenue: 0,
      layawayCompletedGrossProfit: 0,
      unclassifiedDifference: 0
    });
  });

  it('moves a delivered layaway from advance to recognized revenue without increasing Caja', () => {
    const deliveredSale = {
      id: 'sale-layaway', timestamp: '2026-07-25T15:00:00.000Z', status: 'closed',
      paymentMethod: 'layaway_completed', total: 275, isLayawayConversion: true,
      originalLayawayId: 'layaway-1', items: [{ quantity: 1, price: 275, cost: 100 }]
    };
    const reconciliation = buildCashReconciliation({
      cashSession: session,
      sales: [cashSale, deliveredSale],
      layaways: [{ ...pendingLayaway, status: 'completed' }],
      cashMovements: paymentMovements
    });

    expect(reconciliation).toMatchObject({
      theoreticalCash: 485,
      recognizedSales: 485,
      layawayPendingAdvances: 0,
      layawayCompletedRevenue: 275,
      layawayCompletedCost: 100,
      layawayCompletedGrossProfit: 175,
      unclassifiedDifference: 0
    });
  });

  it('keeps refunds and retained penalties outside merchandise revenue', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{ ...pendingLayaway, status: 'cancelled', paidAmount: 275, retainedMoney: true }],
      cashMovements: [{
        id: 'refund-1', cash_session_id: 'cash-1', tipo: 'salida', monto: 275,
        fecha: '2026-07-25T16:00:00.000Z', source: 'layaway_refund', layawayId: 'layaway-1'
      }],
      cashSessionId: 'cash-1'
    });

    expect(projection).toMatchObject({
      layawayCompletedRevenue: 0,
      layawayCompletedGrossProfit: 0,
      layawayRefunds: 275,
      layawayRetainedPenalties: 275
    });
  });
});
