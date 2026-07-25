import { Money } from '../utils/moneyMath';
import { isFinanciallyClosedSale } from './sales/financialStats';

const amount = (value) => Money.init(value || 0);
const number = (value) => Money.toNumber(value);

const dateInRange = (value, { start = null, end = null } = {}) => {
  if (!start && !end) return true;
  const timestamp = Date.parse(value || 0);
  if (!Number.isFinite(timestamp)) return false;
  return (!start || timestamp >= Date.parse(start)) && (!end || timestamp <= Date.parse(end));
};

const movementAmount = (movement) => movement?.monto ?? movement?.amount ?? 0;
const movementSessionId = (movement) => movement?.cash_session_id || movement?.caja_id || movement?.cashSessionId || null;
const paymentSessionId = (payment) => payment?.cash_session_id || payment?.cajaId || payment?.cashSessionId || null;
const movementDate = (movement) => movement?.fecha || movement?.createdAt || null;
const paymentDate = (payment, layaway) => payment?.date || payment?.createdAt || layaway?.createdAt || null;
const isConfirmedPayment = (payment) => payment?.status !== 'pending' && payment?.status !== 'failed';
const movementType = (movement = {}) => String(movement.tipo || movement.type || '').toLowerCase();
const movementSource = (movement = {}) => String(movement.source || movement.origen || '').toLowerCase();
const LEGACY_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const isLayawayPaymentMovement = (movement = {}) => (
  movementSource(movement) === 'layaway_payment'
  || (String(movement.referenceType || '').toLowerCase() === 'layaway' && Boolean(movement.paymentId))
);
const isLayawayRefundMovement = (movement = {}) => (
  movementSource(movement) === 'layaway_refund'
  || (String(movement.referenceType || '').toLowerCase() === 'layaway' && Boolean(movement.refundId))
);
const isCustomerCollection = (movement = {}) => (
  movementType(movement) === 'abono_cliente' || movementSource(movement) === 'customer_payment'
);
const isCashEntryMovement = (movement = {}) => (
  ['entrada', 'ajuste_entrada', 'abono_cliente'].includes(movementType(movement)) || isCustomerCollection(movement)
);
const isCashSale = (sale = {}) => {
  const method = String(sale.paymentMethod || sale.payment_method || '').toLowerCase();
  return method === 'efectivo' || method === 'cash' || (!method && Number(sale.paymentData?.amount) > 0);
};
const lineCost = (item = {}) => amount(item.cost || 0).times(Number(item.quantity || 0));

const movementLayawayId = (movement = {}) => movement.layawayId || movement.referenceId || null;
const movementMatchesLayaway = (movement, layawayId) => !layawayId || movementLayawayId(movement) === layawayId;
const inScopeMovement = (movement, cashSessionId, range) => (
  (!cashSessionId || movementSessionId(movement) === cashSessionId)
  && dateInRange(movementDate(movement), range)
);

const paymentAuditItem = (layaway, payment, reason, cashMovementId = payment?.cashMovementId || null) => ({
  layawayId: layaway?.id || null,
  paymentId: payment?.id || payment?.paymentId || null,
  cashMovementId,
  amount: number(amount(payment?.amount)),
  status: payment?.status || null,
  reason
});

const hasCanonicalMovementMetadata = (movement = {}) => Boolean(
  movement.source
  || movement.origen
  || movement.referenceType
  || movement.reference_type
  || movement.referenceId
  || movement.reference_id
  || movement.layawayId
  || movement.layaway_id
  || movement.paymentId
  || movement.payment_id
);

const isLegacyCashDateCompatible = (payment, layaway, movement, range = {}) => {
  const movementTimestamp = Date.parse(movementDate(movement) || 0);
  if (!Number.isFinite(movementTimestamp) || !dateInRange(movementDate(movement), range)) return false;

  const recordedPaymentDate = paymentDate(payment, layaway);
  const paymentTimestamp = Date.parse(recordedPaymentDate || 0);
  if (range.start || range.end) {
    return !recordedPaymentDate || dateInRange(recordedPaymentDate, range);
  }
  return Number.isFinite(paymentTimestamp)
    && Math.abs(movementTimestamp - paymentTimestamp) <= LEGACY_MATCH_WINDOW_MS;
};

const reconcileLegacyCashBacking = ({
  unresolvedPayments = [],
  cashMovements = [],
  claimedMovementIds = new Set(),
  range = {}
} = {}) => {
  const eligibleMovements = cashMovements.filter((movement) => (
    Boolean(movement?.id)
    && movementType(movement) === 'entrada'
    && !hasCanonicalMovementMetadata(movement)
    && !claimedMovementIds.has(movement.id)
  ));
  const candidateMovementsByPayment = new Map();
  const candidatePaymentCountByMovement = new Map();

  for (const entry of unresolvedPayments) {
    const sessionId = paymentSessionId(entry.payment);
    const candidates = eligibleMovements.filter((movement) => (
      Boolean(sessionId)
      && movementSessionId(movement) === sessionId
      && amount(movementAmount(movement)).eq(amount(entry.payment.amount))
      && isLegacyCashDateCompatible(entry.payment, entry.layaway, movement, range)
    ));
    candidateMovementsByPayment.set(entry, candidates);
    for (const movement of candidates) {
      candidatePaymentCountByMovement.set(
        movement.id,
        (candidatePaymentCountByMovement.get(movement.id) || 0) + 1
      );
    }
  }

  const probableLegacyCashMatches = [];
  const unverifiedHistoricalPayments = [];
  for (const entry of unresolvedPayments) {
    const candidates = candidateMovementsByPayment.get(entry) || [];
    const isUniqueOneToOne = candidates.length === 1
      && candidatePaymentCountByMovement.get(candidates[0].id) === 1;
    if (isUniqueOneToOne) {
      const movement = candidates[0];
      claimedMovementIds.add(movement.id);
      probableLegacyCashMatches.push({
        ...entry.item,
        cashMovementId: movement.id,
        reason: 'probable_legacy_cash_match',
        legacyHint: movement.concepto || movement.concept || null
      });
      continue;
    }

    const isAmbiguous = candidates.length > 1
      || candidates.some((movement) => candidatePaymentCountByMovement.get(movement.id) > 1);
    unverifiedHistoricalPayments.push(isAmbiguous
      ? { ...entry.item, reason: 'ambiguous_legacy_cash_match' }
      : entry.item);
  }

  return { probableLegacyCashMatches, unverifiedHistoricalPayments };
};

const hasCanonicalCashLink = (movement, layawayId, paymentId) => (
  isLayawayPaymentMovement(movement)
  && Boolean(paymentId)
  && movement.paymentId === paymentId
  && movementMatchesLayaway(movement, layawayId)
);

const buildPaymentIndexes = (cashMovements = []) => {
  const movementById = new Map();
  const movementsByPaymentId = new Map();
  const movementsByLayawayId = new Map();

  for (const movement of cashMovements) {
    if (movement?.id) movementById.set(movement.id, movement);
    if (movement?.paymentId) {
      const group = movementsByPaymentId.get(movement.paymentId) || [];
      group.push(movement);
      movementsByPaymentId.set(movement.paymentId, group);
    }
    const layawayId = movementLayawayId(movement);
    if (layawayId) {
      const group = movementsByLayawayId.get(layawayId) || [];
      group.push(movement);
      movementsByLayawayId.set(layawayId, group);
    }
  }

  return { movementById, movementsByPaymentId, movementsByLayawayId };
};

const resolvePaymentMovement = (payment, layaway, indexes) => {
  const cashMovementId = payment?.cashMovementId || null;
  if (cashMovementId) {
    const movement = indexes.movementById.get(cashMovementId);
    if (!movement) return { movement: null, reason: 'cash_movement_not_found' };
    if (!isCashEntryMovement(movement)) return { movement: null, reason: 'cash_movement_not_cash_entry' };
    return { movement, reason: 'linked_to_cash' };
  }

  const paymentId = payment?.id || payment?.paymentId;
  const candidates = (indexes.movementsByPaymentId.get(paymentId) || [])
    .filter((movement) => hasCanonicalCashLink(movement, layaway?.id, paymentId) && isCashEntryMovement(movement));
  if (candidates.length === 1) return { movement: candidates[0], reason: 'linked_to_cash_metadata' };
  if (candidates.length > 1) return { movement: null, reason: 'duplicate_canonical_cash_links' };
  return { movement: null, reason: 'missing_cash_movement' };
};

/**
 * Canonical, read-only financial projection. Cash is always derived from actual
 * cash movements. Layaway payment records provide audit and revenue context, not
 * independent evidence that physical cash entered the drawer.
 */
export const buildLayawayFinancialProjection = ({
  layaways = [], sales = [], cashMovements = [], range = {}, cashSessionId = null
} = {}) => {
  const completedSales = sales.filter((sale) => (
    isFinanciallyClosedSale(sale)
    && sale.isLayawayConversion === true
    && sale.originalLayawayId
    && dateInRange(sale.timestamp, range)
  ));
  const completedSaleByLayaway = new Map();
  for (const sale of completedSales) {
    if (!completedSaleByLayaway.has(sale.originalLayawayId)) completedSaleByLayaway.set(sale.originalLayawayId, sale);
  }

  const indexes = buildPaymentIndexes(cashMovements);
  const scopedMovementIds = new Set(cashMovements
    .filter((movement) => inScopeMovement(movement, cashSessionId, range))
    .map((movement) => movement.id)
    .filter(Boolean));
  const claimedMovementIds = new Set();
  const paymentKeys = new Set();
  const paymentByCashMovementId = new Map();
  let paymentsRecorded = amount(0);
  let cashCollected = amount(0);
  let pendingAdvances = amount(0);
  let completedRevenue = amount(0);
  let completedCost = amount(0);
  let refunds = amount(0);
  let retainedPenalties = amount(0);
  const confirmedPaymentsWithoutCashMovement = [];
  const paymentsWithMissingCashMovementRecord = [];
  const duplicatePaymentMovementLinks = [];
  const unlinkedPaymentEntries = [];
  const unresolvedPaymentsWithTechnicalLink = [];

  for (const layaway of layaways) {
    const isPending = ['active', 'ready'].includes(String(layaway.status || '').toLowerCase())
      && !completedSaleByLayaway.has(layaway.id);

    for (const payment of layaway.payments || []) {
      if (!isConfirmedPayment(payment)) continue;
      const resolved = resolvePaymentMovement(payment, layaway, indexes);
      const linkMovement = resolved.movement;
      const belongsToSession = !cashSessionId
        || paymentSessionId(payment) === cashSessionId
        || movementSessionId(linkMovement) === cashSessionId;
      const date = movementDate(linkMovement) || paymentDate(payment, layaway);
      // Historical payments can have a session ID but no trustworthy timestamp.
      // Keep them visible as an anomaly for that session; never turn them into cash.
      if (!belongsToSession || (date && !dateInRange(date, range)) || (!date && !cashSessionId)) continue;

      const key = `${layaway.id}:${payment.id || payment.paymentId || payment.idempotencyKey || date}:${payment.amount}`;
      if (paymentKeys.has(key)) continue;
      paymentKeys.add(key);
      const paymentAmount = amount(payment.amount);
      paymentsRecorded = paymentsRecorded.plus(paymentAmount);

      if (!linkMovement) {
        const item = paymentAuditItem(layaway, payment, resolved.reason);
        confirmedPaymentsWithoutCashMovement.push(item);
        if (payment.cashMovementId) {
          paymentsWithMissingCashMovementRecord.push(item);
          unresolvedPaymentsWithTechnicalLink.push({ layaway, payment, item });
        } else {
          unlinkedPaymentEntries.push({ layaway, payment, item });
        }
        continue;
      }
      if (!scopedMovementIds.has(linkMovement.id)) continue;
      if (claimedMovementIds.has(linkMovement.id)) {
        duplicatePaymentMovementLinks.push(paymentAuditItem(layaway, payment, 'cash_movement_linked_to_multiple_payments', linkMovement.id));
        continue;
      }

      claimedMovementIds.add(linkMovement.id);
      paymentByCashMovementId.set(linkMovement.id, { layaway, payment });
      const movementCash = amount(movementAmount(linkMovement));
      cashCollected = cashCollected.plus(movementCash);
      if (isPending) pendingAdvances = pendingAdvances.plus(movementCash);
    }

    if (String(layaway.status || '').toLowerCase() === 'cancelled' && layaway.retainedMoney === true) {
      retainedPenalties = retainedPenalties.plus(layaway.paidAmount || 0);
    }
  }

  for (const sale of completedSales) {
    completedRevenue = completedRevenue.plus(sale.total || 0);
    completedCost = completedCost.plus((sale.items || []).reduce((sum, item) => sum.plus(lineCost(item)), amount(0)));
  }

  for (const movement of cashMovements) {
    if (!inScopeMovement(movement, cashSessionId, range)) continue;
    if (isLayawayRefundMovement(movement)) refunds = refunds.plus(movementAmount(movement));
  }

  const {
    probableLegacyCashMatches,
    unverifiedHistoricalPayments: unverifiedUnlinkedPayments
  } = reconcileLegacyCashBacking({
    unresolvedPayments: unlinkedPaymentEntries,
    cashMovements,
    claimedMovementIds,
    range
  });
  const unlinkedTechnicalPayments = unlinkedPaymentEntries.map((entry) => entry.item);
  const unverifiedHistoricalPayments = [
    ...unverifiedUnlinkedPayments,
    ...unresolvedPaymentsWithTechnicalLink.map((entry) => entry.item)
  ];

  return {
    // `layawayPaymentsCollected` is kept as a compatibility alias for cash-backed payments.
    layawayPaymentsCollected: number(cashCollected),
    layawayPaymentsRecorded: number(paymentsRecorded),
    layawayCashCollected: number(cashCollected),
    layawayPendingAdvances: number(pendingAdvances),
    unlinkedTechnicalPayments,
    unlinkedTechnicalPaymentsAmount: number(unlinkedTechnicalPayments.reduce((total, item) => total.plus(item.amount), amount(0))),
    probableLegacyCashMatches,
    probableLegacyCashBackingAmount: number(probableLegacyCashMatches.reduce((total, item) => total.plus(item.amount), amount(0))),
    unverifiedHistoricalPayments,
    unverifiedHistoricalPaymentsAmount: number(unverifiedHistoricalPayments.reduce((total, item) => total.plus(item.amount), amount(0))),
    confirmedPaymentsWithoutCashMovement,
    paymentsWithMissingCashMovementRecord,
    duplicatePaymentMovementLinks,
    linkedCashMovementIds: Array.from(paymentByCashMovementId.keys()),
    layawayCompletedRevenue: number(completedRevenue),
    layawayCompletedCost: number(completedCost),
    layawayCompletedGrossProfit: number(completedRevenue.minus(completedCost)),
    layawayRefunds: number(refunds),
    layawayRetainedPenalties: number(retainedPenalties),
    completedLayawaySaleIds: completedSales.map((sale) => sale.id),
    completedLayawayIds: completedSales.map((sale) => sale.originalLayawayId)
  };
};

export const buildCashReconciliation = ({ cashSession = {}, sales = [], layaways = [], cashMovements = [] } = {}) => {
  const sessionId = cashSession.id || null;
  const period = { start: cashSession.fecha_apertura || null, end: cashSession.fecha_cierre || new Date().toISOString() };
  const layaway = buildLayawayFinancialProjection({ layaways, sales, cashMovements, range: period, cashSessionId: sessionId });
  const sessionMovements = cashMovements.filter((movement) => inScopeMovement(movement, sessionId, period));
  const sessionSales = sales.filter((sale) => dateInRange(sale.timestamp, period) && (!sale.cash_session_id || sale.cash_session_id === sessionId));
  let directCashSales = amount(0);
  let customerCreditCollections = amount(0);
  let manualEntries = amount(0);
  let positiveAdjustments = amount(0);
  let exits = amount(0);
  let negativeAdjustments = amount(0);
  const linkedCashMovementIds = new Set(layaway.linkedCashMovementIds || []);
  const isLayawayCashMovement = (movement) => (
    isLayawayPaymentMovement(movement) || linkedCashMovementIds.has(movement.id)
  );

  for (const sale of sessionSales) {
    if (isFinanciallyClosedSale(sale) && sale.isLayawayConversion !== true && isCashSale(sale)) {
      directCashSales = directCashSales.plus(sale.total || sale.paymentData?.amount || 0);
    }
  }
  for (const movement of sessionMovements) {
    const type = movementType(movement);
    if (isCustomerCollection(movement)) customerCreditCollections = customerCreditCollections.plus(movementAmount(movement));
    else if (type === 'entrada' && !isLayawayCashMovement(movement)) manualEntries = manualEntries.plus(movementAmount(movement));
    else if (type === 'ajuste_entrada') positiveAdjustments = positiveAdjustments.plus(movementAmount(movement));
    else if (type === 'salida') exits = exits.plus(movementAmount(movement));
    else if (type === 'ajuste_salida') negativeAdjustments = negativeAdjustments.plus(movementAmount(movement));
  }

  // Every cash movement enters exactly one branch above. Linked layaway cash is
  // already in MOVIMIENTOS_CAJA, so it is shown separately but never added again.
  const theoreticalCash = amount(cashSession.monto_inicial)
    .plus(directCashSales).plus(customerCreditCollections).plus(manualEntries)
    .plus(positiveAdjustments).minus(exits).minus(negativeAdjustments)
    .plus(sessionMovements.reduce((total, movement) => (
      isLayawayCashMovement(movement) && isCashEntryMovement(movement)
        ? total.plus(movementAmount(movement))
        : total
    ), amount(0)));
  const recognizedSales = sessionSales.reduce((total, sale) => (
    isFinanciallyClosedSale(sale) ? total.plus(sale.total || 0) : total
  ), amount(0));
  const recordedCash = amount(cashSession.monto_inicial).plus(directCashSales)
    .plus(cashSession.entradas_efectivo || 0).minus(cashSession.salidas_efectivo || 0);

  return {
    ...layaway,
    cashSessionId: sessionId,
    directCashSales: number(directCashSales),
    customerCreditCollections: number(customerCreditCollections),
    manualEntries: number(manualEntries),
    positiveAdjustments: number(positiveAdjustments),
    exits: number(exits),
    negativeAdjustments: number(negativeAdjustments),
    theoreticalCash: number(theoreticalCash),
    recognizedSales: number(recognizedSales),
    directSalesRevenue: number(recognizedSales.minus(amount(layaway.layawayCompletedRevenue))),
    unclassifiedDifference: number(recordedCash.minus(theoreticalCash))
  };
};

export const auditLayawayFinancialLinks = ({ layaways = [], sales = [], cashMovements = [] } = {}) => {
  const saleGroups = new Map();
  for (const sale of sales) {
    if (sale.isLayawayConversion === true && sale.originalLayawayId) {
      const group = saleGroups.get(sale.originalLayawayId) || [];
      group.push(sale);
      saleGroups.set(sale.originalLayawayId, group);
    }
  }
  const layawayIds = new Set(layaways.map((layaway) => layaway.id));
  const indexes = buildPaymentIndexes(cashMovements);
  const movementClaims = new Map();
  const confirmedPaymentsWithoutCashMovement = [];
  const paymentsWithMissingCashMovementRecord = [];
  const unlinkedPaymentEntries = [];
  const unresolvedPaymentsWithTechnicalLink = [];

  for (const layaway of layaways) for (const payment of layaway.payments || []) {
    if (!isConfirmedPayment(payment)) continue;
    const resolved = resolvePaymentMovement(payment, layaway, indexes);
    if (!resolved.movement) {
      const item = paymentAuditItem(layaway, payment, resolved.reason);
      confirmedPaymentsWithoutCashMovement.push(item);
      if (payment.cashMovementId) {
        paymentsWithMissingCashMovementRecord.push(item);
        unresolvedPaymentsWithTechnicalLink.push({ layaway, payment, item });
      } else {
        unlinkedPaymentEntries.push({ layaway, payment, item });
      }
      continue;
    }
    const claims = movementClaims.get(resolved.movement.id) || [];
    claims.push(paymentAuditItem(layaway, payment, resolved.reason, resolved.movement.id));
    movementClaims.set(resolved.movement.id, claims);
  }

  const linkedMovementIds = new Set(movementClaims.keys());
  const {
    probableLegacyCashMatches,
    unverifiedHistoricalPayments: unverifiedUnlinkedPayments
  } = reconcileLegacyCashBacking({
    unresolvedPayments: unlinkedPaymentEntries,
    cashMovements,
    claimedMovementIds: linkedMovementIds
  });
  const unlinkedTechnicalPayments = unlinkedPaymentEntries.map((entry) => entry.item);
  const unverifiedHistoricalPayments = [
    ...unverifiedUnlinkedPayments,
    ...unresolvedPaymentsWithTechnicalLink.map((entry) => entry.item)
  ];
  return {
    completedWithoutSale: layaways.filter((layaway) => layaway.status === 'completed' && !saleGroups.has(layaway.id))
      .map((layaway) => ({ layawayId: layaway.id, status: layaway.status, reason: 'completed_without_conversion_sale' })),
    duplicateConversions: Array.from(saleGroups.entries()).filter(([, group]) => group.length > 1)
      .map(([layawayId, group]) => ({ layawayId, saleIds: group.map((sale) => sale.id), reason: 'multiple_conversion_sales' })),
    confirmedPaymentsWithoutCashMovement,
    paymentsWithMissingCashMovementRecord,
    unlinkedTechnicalPayments,
    unlinkedTechnicalPaymentsAmount: number(unlinkedTechnicalPayments.reduce((total, item) => total.plus(item.amount), amount(0))),
    probableLegacyCashMatches,
    probableLegacyCashBackingAmount: number(probableLegacyCashMatches.reduce((total, item) => total.plus(item.amount), amount(0))),
    unverifiedHistoricalPayments,
    unverifiedHistoricalPaymentsAmount: number(unverifiedHistoricalPayments.reduce((total, item) => total.plus(item.amount), amount(0))),
    cashMovementsWithoutPayment: cashMovements.filter((movement) => isLayawayPaymentMovement(movement) && !linkedMovementIds.has(movement.id))
      .map((movement) => ({ layawayId: movementLayawayId(movement), paymentId: movement.paymentId || null, cashMovementId: movement.id || null, amount: number(amount(movementAmount(movement))), status: null, reason: 'cash_movement_without_payment' })),
    duplicatePaymentMovementLinks: Array.from(movementClaims.entries()).filter(([, claims]) => claims.length > 1)
      .map(([cashMovementId, claims]) => ({ cashMovementId, paymentIds: claims.map((claim) => claim.paymentId), amount: claims[0]?.amount || 0, status: 'duplicate_link', reason: 'cash_movement_linked_to_multiple_payments' })),
    conversionsWithoutLayaway: sales.filter((sale) => sale.isLayawayConversion === true && sale.originalLayawayId && !layawayIds.has(sale.originalLayawayId))
      .map((sale) => ({ layawayId: sale.originalLayawayId, saleId: sale.id, status: sale.status || null, reason: 'conversion_without_layaway' })),
    legacyUnclassifiedCashEntries: cashMovements.filter((movement) => (
      movementType(movement) === 'entrada'
      && !movement.source && !movement.origen && !movement.referenceType && !movement.referenceId
      && !movement.layawayId && !movement.paymentId
    )).map((movement) => ({ layawayId: null, paymentId: null, cashMovementId: movement.id || null, amount: number(amount(movementAmount(movement))), status: null, reason: 'legacy_unclassified_cash_entry', legacyHint: movement.concepto || null }))
  };
};

export { isLayawayPaymentMovement, isLayawayRefundMovement };
