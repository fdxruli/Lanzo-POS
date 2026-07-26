import { describe, expect, it } from 'vitest';
import {
  auditLayawayFinancialLinks,
  buildCashReconciliation,
  buildLayawayFinancialProjection,
  hasHistoricalIntegrityWarning
} from '../layawayFinancialProjection';

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

const buildExplicitLinkProjection = ({ payment = {}, movement, layaway = {} } = {}) => {
  const explicitPayment = {
    id: 'payment-explicit',
    amount: 100,
    status: 'confirmed',
    cashMovementId: 'move-explicit',
    cajaId: 'cash-1',
    ...payment
  };
  const explicitLayaway = {
    id: 'layaway-explicit',
    status: 'ready',
    payments: [explicitPayment],
    ...layaway
  };
  const cashMovements = movement === null ? [] : [{
    id: 'move-explicit',
    tipo: 'entrada',
    monto: 100,
    cash_session_id: 'cash-1',
    fecha: '2026-07-25T10:00:00.000Z',
    source: 'layaway_payment',
    referenceType: 'layaway',
    referenceId: explicitLayaway.id,
    layawayId: explicitLayaway.id,
    paymentId: explicitPayment.id,
    ...movement
  }];

  return buildLayawayFinancialProjection({
    layaways: [explicitLayaway],
    cashMovements,
    cashSessionId: 'cash-1',
    range: { start: session.fecha_apertura, end: session.fecha_cierre }
  });
};

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

  it('attributes a unique exact legacy entry without changing Caja or recognized sales', () => {
    const historicalSession = {
      id: 'cash-historical', monto_inicial: 0, entradas_efectivo: 450, salidas_efectivo: 0,
      fecha_apertura: '2026-07-25T08:00:00.000Z', fecha_cierre: '2026-07-25T18:00:00.000Z'
    };
    const historicalLayaway = {
      id: 'layaway-historical', status: 'completed', totalAmount: 175, paidAmount: 175,
      payments: [
        { id: 'payment-unverified', amount: 75, status: 'confirmed', cajaId: 'cash-historical', date: '2026-07-25T09:00:00.000Z' },
        { id: 'payment-legacy-backed', amount: 100, status: 'confirmed', cajaId: 'cash-historical', date: '2026-07-25T10:00:00.000Z' }
      ]
    };
    const historicalMovements = [
      { id: 'move-legacy-100', cash_session_id: 'cash-historical', tipo: 'entrada', monto: 100, fecha: '2026-07-25T10:00:00.000Z', concepto: 'Apartado anterior' },
      { id: 'move-entry-150', cash_session_id: 'cash-historical', tipo: 'entrada', monto: 150, fecha: '2026-07-25T11:00:00.000Z' },
      { id: 'move-entry-200', cash_session_id: 'cash-historical', tipo: 'entrada', monto: 200, fecha: '2026-07-25T12:00:00.000Z' }
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
      layawayCashCollected: 0,
      theoreticalCash: 680,
      recognizedSales: 755,
      layawayPendingAdvances: 0,
      unclassifiedDifference: 0,
      unlinkedTechnicalPaymentsAmount: 175,
      probableLegacyCashBackingAmount: 100,
      unverifiedHistoricalPaymentsAmount: 75
    });
    expect(reconciliation.theoreticalCash).toBe(680);
    expect(reconciliation.recognizedSales).toBe(755);
    expect(reconciliation.unclassifiedDifference).toBe(0);
    expect(reconciliation.unlinkedTechnicalPayments).toHaveLength(2);
    expect(reconciliation.probableLegacyCashMatches).toEqual([
      expect.objectContaining({
        paymentId: 'payment-legacy-backed',
        cashMovementId: 'move-legacy-100',
        amount: 100,
        reason: 'probable_legacy_cash_match'
      })
    ]);
    expect(reconciliation.unverifiedHistoricalPayments).toEqual([
      expect.objectContaining({ layawayId: 'layaway-historical', paymentId: 'payment-unverified', amount: 75, reason: 'missing_cash_movement' })
    ]);
    expect(audit).toMatchObject({
      unlinkedTechnicalPaymentsAmount: 175,
      probableLegacyCashBackingAmount: 100,
      unverifiedHistoricalPaymentsAmount: 75
    });
  });

  it('keeps an unlinked payment unverified when two exact legacy entries are possible', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-ambiguous',
        payments: [{ id: 'payment-ambiguous', amount: 100, status: 'confirmed', cajaId: 'cash-1', date: '2026-07-25T10:00:00.000Z' }]
      }],
      cashMovements: [
        { id: 'legacy-1', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100, fecha: '2026-07-25T10:05:00.000Z' },
        { id: 'legacy-2', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100, fecha: '2026-07-25T10:10:00.000Z' }
      ],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.probableLegacyCashBackingAmount).toBe(0);
    expect(projection.unverifiedHistoricalPayments).toEqual([
      expect.objectContaining({ paymentId: 'payment-ambiguous', reason: 'ambiguous_legacy_cash_match' })
    ]);
  });

  it('attributes a unique legacy entry when its timestamp is close to the payment', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-close-time',
        payments: [{ id: 'payment-close-time', amount: 100, status: 'confirmed', cajaId: 'cash-1', date: '2026-07-25T10:00:00.000Z' }]
      }],
      cashMovements: [
        { id: 'legacy-close-time', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100, fecha: '2026-07-25T10:10:00.000Z' }
      ],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.probableLegacyCashMatches).toEqual([
      expect.objectContaining({ paymentId: 'payment-close-time', cashMovementId: 'legacy-close-time', reason: 'probable_legacy_cash_match' })
    ]);
  });

  it('does not attribute a legacy entry outside the temporal window', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-far-time',
        payments: [{ id: 'payment-far-time', amount: 100, status: 'confirmed', cajaId: 'cash-1', date: '2026-07-25T08:00:00.000Z' }]
      }],
      cashMovements: [
        { id: 'legacy-far-time', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100, fecha: '2026-07-25T20:00:00.000Z' }
      ],
      cashSessionId: 'cash-1',
      range: { start: '2026-07-25T08:00:00.000Z', end: '2026-07-25T22:00:00.000Z' }
    });

    expect(projection.probableLegacyCashMatches).toEqual([]);
    expect(projection.unverifiedHistoricalPayments).toEqual([
      expect.objectContaining({ paymentId: 'payment-far-time', reason: 'missing_cash_movement' })
    ]);
  });

  it('requires a compatible legacy concept when the payment has no reliable date', () => {
    const compatible = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-no-date-compatible',
        createdAt: '2026-07-01T10:00:00.000Z',
        payments: [{ id: 'payment-no-date-compatible', amount: 100, status: 'confirmed', cajaId: 'cash-1' }]
      }],
      cashMovements: [{
        id: 'legacy-compatible-concept', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100,
        fecha: '2026-07-25T10:10:00.000Z', concepto: 'ÁBÓNO Apartado #0096'
      }],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });
    const generic = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-no-date-generic',
        createdAt: '2026-07-01T10:00:00.000Z',
        payments: [{ id: 'payment-no-date-generic', amount: 100, status: 'confirmed', cajaId: 'cash-1' }]
      }],
      cashMovements: [{
        id: 'legacy-generic-concept', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100,
        fecha: '2026-07-25T10:10:00.000Z', concepto: 'Entrada de efectivo'
      }],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(compatible.probableLegacyCashMatches).toEqual([
      expect.objectContaining({ cashMovementId: 'legacy-compatible-concept', reason: 'probable_legacy_cash_match' })
    ]);
    expect(generic.probableLegacyCashMatches).toEqual([]);
    expect(generic.unverifiedHistoricalPaymentsAmount).toBe(100);
  });

  it('keeps both payments ambiguous when one legacy entry could back either one', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-shared-candidate',
        payments: [
          { id: 'payment-shared-1', amount: 100, status: 'confirmed', cajaId: 'cash-1', date: '2026-07-25T10:00:00.000Z' },
          { id: 'payment-shared-2', amount: 100, status: 'confirmed', cajaId: 'cash-1', date: '2026-07-25T10:05:00.000Z' }
        ]
      }],
      cashMovements: [
        { id: 'legacy-shared', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100, fecha: '2026-07-25T10:10:00.000Z' }
      ],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.probableLegacyCashMatches).toEqual([]);
    expect(projection.unverifiedHistoricalPayments).toHaveLength(2);
    expect(projection.unverifiedHistoricalPayments.every((item) => item.reason === 'ambiguous_legacy_cash_match')).toBe(true);
  });

  it('does not attribute an exact legacy entry from another cash session', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-session',
        payments: [{ id: 'payment-session', amount: 100, status: 'confirmed', cajaId: 'cash-1', date: '2026-07-25T10:00:00.000Z' }]
      }],
      cashMovements: [
        { id: 'legacy-other-session', cash_session_id: 'cash-2', tipo: 'entrada', monto: 100, fecha: '2026-07-25T10:00:00.000Z' }
      ],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.probableLegacyCashBackingAmount).toBe(0);
    expect(projection.unverifiedHistoricalPaymentsAmount).toBe(100);
  });

  it('does not reuse a legacy entry already claimed by a modern linked payment', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-claimed',
        payments: [
          { id: 'payment-modern', amount: 100, status: 'confirmed', cashMovementId: 'legacy-claimed', cajaId: 'cash-1' },
          { id: 'payment-unlinked', amount: 100, status: 'confirmed', cajaId: 'cash-1', date: '2026-07-25T10:00:00.000Z' }
        ]
      }],
      cashMovements: [
        { id: 'legacy-claimed', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100, fecha: '2026-07-25T10:00:00.000Z' }
      ],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.unlinkedTechnicalPayments).toHaveLength(1);
    expect(projection.probableLegacyCashBackingAmount).toBe(0);
    expect(projection.unverifiedHistoricalPaymentsAmount).toBe(100);
    expect(projection.layawayCashCollected).toBe(100);
  });

  it('does not match a legacy entry with a different amount', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-amount',
        payments: [{ id: 'payment-amount', amount: 100, status: 'confirmed', cajaId: 'cash-1', date: '2026-07-25T10:00:00.000Z' }]
      }],
      cashMovements: [
        { id: 'legacy-different-amount', cash_session_id: 'cash-1', tipo: 'entrada', monto: 99.99, fecha: '2026-07-25T10:00:00.000Z' }
      ],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.probableLegacyCashBackingAmount).toBe(0);
    expect(projection.unverifiedHistoricalPaymentsAmount).toBe(100);
  });

  it('keeps modern payments with cashMovementId out of historical attribution', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-modern',
        payments: [{ id: 'payment-modern', amount: 100, status: 'confirmed', cashMovementId: 'move-modern', cajaId: 'cash-1' }]
      }],
      cashMovements: [{
        id: 'move-modern', cash_session_id: 'cash-1', tipo: 'entrada', monto: 100,
        fecha: '2026-07-25T10:00:00.000Z', source: 'layaway_payment',
        referenceType: 'layaway', referenceId: 'layaway-modern', layawayId: 'layaway-modern', paymentId: 'payment-modern'
      }],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.unlinkedTechnicalPayments).toEqual([]);
    expect(projection.probableLegacyCashMatches).toEqual([]);
    expect(projection.unverifiedHistoricalPayments).toEqual([]);
    expect(projection.layawayCashCollected).toBe(100);
    expect(projection.linkedPaymentMovementLinks).toEqual([
      expect.objectContaining({ paymentId: 'payment-modern', reason: 'linked_to_cash' })
    ]);
  });

  it('surfaces a broken cashMovementId as an integrity warning without increasing Caja', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-broken-link',
        status: 'completed',
        payments: [{
          id: 'payment-broken-link',
          amount: 100,
          status: 'confirmed',
          cashMovementId: 'move-does-not-exist',
          cajaId: 'cash-1'
        }]
      }],
      cashMovements: [],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.paymentsWithMissingCashMovementRecord).toHaveLength(1);
    expect(projection.paymentsWithInvalidCashMovementLink).toEqual([]);
    expect(projection.unlinkedTechnicalPayments).toEqual([]);
    expect(projection.unverifiedHistoricalPayments).toHaveLength(1);
    expect(projection.unverifiedHistoricalPaymentsAmount).toBe(100);
    expect(projection.layawayCashCollected).toBe(0);
    expect(hasHistoricalIntegrityWarning(projection)).toBe(true);
  });

  it.each([
    {
      name: 'different amount',
      movement: { monto: 75 },
      reason: 'cash_movement_amount_mismatch',
      expected: { paymentAmount: 100, movementAmount: 75 }
    },
    {
      name: 'different cash session',
      movement: { cash_session_id: 'cash-2' },
      reason: 'cash_movement_session_mismatch',
      expected: { paymentSessionId: 'cash-1', movementSessionId: 'cash-2' }
    },
    {
      name: 'different payment',
      movement: { paymentId: 'payment-other' },
      reason: 'cash_movement_payment_mismatch',
      expected: { movementPaymentId: 'payment-other' }
    },
    {
      name: 'different layaway',
      movement: { layawayId: 'layaway-other' },
      reason: 'cash_movement_layaway_mismatch',
      expected: { movementLayawayId: 'layaway-other' }
    },
    {
      name: 'incompatible source',
      movement: { source: 'customer_payment' },
      reason: 'cash_movement_source_mismatch',
      expected: { movementSource: 'customer_payment' }
    },
    {
      name: 'cash adjustment type',
      movement: { tipo: 'ajuste_entrada' },
      reason: 'cash_movement_not_layaway_entry',
      expected: { movementAmount: 100 }
    }
  ])('rejects an explicit cash movement link with $name', ({ movement, reason, expected }) => {
    const projection = buildExplicitLinkProjection({ movement });

    expect(projection.layawayCashCollected).toBe(0);
    expect(projection.paymentsWithMissingCashMovementRecord).toEqual([]);
    expect(projection.paymentsWithInvalidCashMovementLink).toEqual([
      expect.objectContaining({
        layawayId: 'layaway-explicit',
        paymentId: 'payment-explicit',
        cashMovementId: 'move-explicit',
        reason,
        ...expected
      })
    ]);
    expect(projection.paymentsWithInvalidCashMovementLinkAmount).toBe(100);
    expect(projection.unverifiedHistoricalPaymentsAmount).toBe(100);
    expect(hasHistoricalIntegrityWarning(projection)).toBe(true);
  });

  it('accepts a structurally valid explicit legacy cash movement link', () => {
    const projection = buildExplicitLinkProjection({
      movement: {
        source: undefined,
        referenceType: undefined,
        referenceId: undefined,
        layawayId: undefined,
        paymentId: undefined
      }
    });

    expect(projection.layawayCashCollected).toBe(100);
    expect(projection.paymentsWithInvalidCashMovementLink).toEqual([]);
    expect(projection.unverifiedHistoricalPayments).toEqual([]);
    expect(projection.linkedPaymentMovementLinks).toEqual([
      expect.objectContaining({ reason: 'linked_to_cash_legacy_id' })
    ]);
  });

  it('validates canonical layaway fields stored inside movement.metadata', () => {
    const projection = buildExplicitLinkProjection({
      movement: {
        source: undefined,
        referenceType: undefined,
        referenceId: undefined,
        layawayId: undefined,
        paymentId: undefined,
        metadata: {
          source: 'layaway_payment',
          referenceType: 'layaway',
          referenceId: 'layaway-explicit',
          layawayId: 'layaway-explicit',
          paymentId: 'payment-explicit'
        }
      }
    });

    expect(projection.layawayCashCollected).toBe(100);
    expect(projection.paymentsWithInvalidCashMovementLink).toEqual([]);
    expect(projection.linkedPaymentMovementLinks).toEqual([
      expect.objectContaining({ reason: 'linked_to_cash' })
    ]);
  });

  it('never counts the same explicitly linked movement twice', () => {
    const projection = buildLayawayFinancialProjection({
      layaways: [{
        id: 'layaway-duplicate-explicit',
        status: 'ready',
        payments: [
          { id: 'payment-duplicate-1', amount: 100, status: 'confirmed', cashMovementId: 'move-duplicate-explicit', cajaId: 'cash-1' },
          { id: 'payment-duplicate-2', amount: 100, status: 'confirmed', cashMovementId: 'move-duplicate-explicit', cajaId: 'cash-1' }
        ]
      }],
      cashMovements: [{
        id: 'move-duplicate-explicit',
        tipo: 'entrada',
        monto: 100,
        cash_session_id: 'cash-1',
        fecha: '2026-07-25T10:00:00.000Z'
      }],
      cashSessionId: 'cash-1',
      range: { start: session.fecha_apertura, end: session.fecha_cierre }
    });

    expect(projection.layawayCashCollected).toBe(100);
    expect(projection.duplicatePaymentMovementLinks).toHaveLength(1);
    expect(projection.paymentsWithInvalidCashMovementLink).toEqual([
      expect.objectContaining({
        paymentId: 'payment-duplicate-2',
        reason: 'cash_movement_linked_to_multiple_payments'
      })
    ]);
    expect(projection.unverifiedHistoricalPaymentsAmount).toBe(100);
  });
});
