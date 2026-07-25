import { describe, expect, it } from 'vitest';
import { auditLayawayFinancialLinks, buildCashReconciliation, buildLayawayFinancialProjection } from '../layawayFinancialProjection';

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

  it('does not turn an unlinked historical payment into Caja cash', () => {
    const historicalSession = {
      id: 'cash-historical', monto_inicial: 0, entradas_efectivo: 450, salidas_efectivo: 0,
      fecha_apertura: '2026-07-25T08:00:00.000Z', fecha_cierre: '2026-07-25T18:00:00.000Z'
    };
    const historicalLayaway = {
      id: 'layaway-historical', status: 'completed', totalAmount: 175, paidAmount: 175,
      payments: [
        { id: 'payment-unverified', amount: 75, status: 'confirmed', cajaId: 'cash-historical' },
        { id: 'payment-verified', amount: 100, status: 'confirmed', cashMovementId: 'move-layaway-100', cajaId: 'cash-historical' }
      ]
    };
    const historicalMovements = [
      { id: 'move-layaway-100', cash_session_id: 'cash-historical', tipo: 'entrada', monto: 100, fecha: '2026-07-25T09:00:00.000Z', source: 'layaway_payment', referenceType: 'layaway', referenceId: 'layaway-historical', layawayId: 'layaway-historical', paymentId: 'payment-verified' },
      { id: 'move-legacy-100', cash_session_id: 'cash-historical', tipo: 'entrada', monto: 100, fecha: '2026-07-25T10:00:00.000Z', concepto: 'Apartado anterior' },
      { id: 'move-entry-75a', cash_session_id: 'cash-historical', tipo: 'entrada', monto: 75, fecha: '2026-07-25T11:00:00.000Z' },
      { id: 'move-entry-100', cash_session_id: 'cash-historical', tipo: 'entrada', monto: 100, fecha: '2026-07-25T12:00:00.000Z' },
      { id: 'move-entry-75b', cash_session_id: 'cash-historical', tipo: 'entrada', monto: 75, fecha: '2026-07-25T13:00:00.000Z' }
    ];
    const historicalSales = [
      { id: 'sale-cash-210', timestamp: '2026-07-25T09:30:00.000Z', cash_session_id: 'cash-historical', status: 'closed', paymentMethod: 'efectivo', total: 210 },
      { id: 'sale-cash-20', timestamp: '2026-07-25T10:30:00.000Z', cash_session_id: 'cash-historical', status: 'closed', paymentMethod: 'efectivo', total: 20 },
      { id: 'sale-card-350', timestamp: '2026-07-25T11:30:00.000Z', cash_session_id: 'cash-historical', status: 'closed', paymentMethod: 'tarjeta', total: 350 },
      { id: 'sale-layaway-175', timestamp: '2026-07-25T14:00:00.000Z', cash_session_id: 'cash-historical', status: 'closed', paymentMethod: 'layaway_completed', total: 175, isLayawayConversion: true, originalLayawayId: 'layaway-historical', items: [{ quantity: 1, cost: 100 }] }
    ];

    const reconciliation = buildCashReconciliation({
      cashSession: historicalSession, sales: historicalSales, layaways: [historicalLayaway], cashMovements: historicalMovements
    });
    const audit = auditLayawayFinancialLinks({ layaways: [historicalLayaway], sales: historicalSales, cashMovements: historicalMovements });

    expect(reconciliation).toMatchObject({
      directCashSales: 230,
      layawayPaymentsRecorded: 175,
      layawayCashCollected: 100,
      theoreticalCash: 680,
      recognizedSales: 755,
      layawayPendingAdvances: 0,
      unclassifiedDifference: 0,
      unverifiedHistoricalPaymentsAmount: 75
    });
    expect(reconciliation.theoreticalCash).toBe(680);
    expect(reconciliation.unclassifiedDifference).toBe(0);
    expect(reconciliation.confirmedPaymentsWithoutCashMovement).toEqual([
      expect.objectContaining({ layawayId: 'layaway-historical', paymentId: 'payment-unverified', amount: 75, reason: 'missing_cash_movement' })
    ]);
    expect(audit.legacyUnclassifiedCashEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ cashMovementId: 'move-legacy-100', amount: 100 })
    ]));
  });
});
