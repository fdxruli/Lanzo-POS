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
const isConfirmedPayment = (payment) => payment?.status !== 'pending' && payment?.status !== 'failed';
const isLayawayPaymentMovement = (movement = {}) => (
  String(movement.source || movement.origen || '').toLowerCase() === 'layaway_payment'
  || (String(movement.referenceType || '').toLowerCase() === 'layaway' && Boolean(movement.paymentId))
);
const isLayawayRefundMovement = (movement = {}) => (
  String(movement.source || movement.origen || '').toLowerCase() === 'layaway_refund'
  || (String(movement.referenceType || '').toLowerCase() === 'layaway' && Boolean(movement.refundId))
);
const isCustomerCollection = (movement = {}) => (
  String(movement.tipo || movement.type || '').toLowerCase() === 'abono_cliente'
  || String(movement.source || movement.origen || '').toLowerCase() === 'customer_payment'
);
const isCashSale = (sale = {}) => {
  const method = String(sale.paymentMethod || sale.payment_method || '').toLowerCase();
  return method === 'efectivo' || method === 'cash' || (!method && Number(sale.paymentData?.amount) > 0);
};

const lineCost = (item = {}) => amount(item.cost || 0).times(Number(item.quantity || 0));

/**
 * Canonical, read-only financial projection. Stable IDs/metadata are the source
 * of truth; human-readable cash concepts are deliberately never used to classify money.
 */
export const buildLayawayFinancialProjection = ({
  layaways = [],
  sales = [],
  cashMovements = [],
  range = {},
  cashSessionId = null
} = {}) => {
  const saleByLayaway = new Map();
  const completedSales = [];

  for (const sale of sales) {
    if (!isFinanciallyClosedSale(sale)) continue;
    if (!dateInRange(sale.timestamp, range)) continue;
    if (sale.isLayawayConversion === true && sale.originalLayawayId) {
      if (!saleByLayaway.has(sale.originalLayawayId)) saleByLayaway.set(sale.originalLayawayId, sale);
      completedSales.push(sale);
    }
  }

  let paymentsCollected = amount(0);
  let pendingAdvances = amount(0);
  let completedRevenue = amount(0);
  let completedCost = amount(0);
  let refunds = amount(0);
  let retainedPenalties = amount(0);
  const paymentKeys = new Set();
  const paymentMovementIds = new Set();
  const layawayById = new Map(layaways.map((layaway) => [layaway.id, layaway]));

  const movementById = new Map(cashMovements.map((movement) => [movement.id, movement]));

  for (const layaway of layaways) {
    const relatedSale = saleByLayaway.get(layaway.id);
    const isPending = ['active', 'ready'].includes(String(layaway.status || '').toLowerCase()) && !relatedSale;

    for (const payment of layaway.payments || []) {
      if (!isConfirmedPayment(payment)) continue;
      const linkedMovement = payment.cashMovementId ? movementById.get(payment.cashMovementId) : null;
      if (payment.cashMovementId) paymentMovementIds.add(payment.cashMovementId);
      const belongsToSession = !cashSessionId
        || paymentSessionId(payment) === cashSessionId
        || movementSessionId(linkedMovement) === cashSessionId;
      const paymentDate = linkedMovement?.fecha || payment.date || payment.createdAt || layaway.createdAt;
      if (!belongsToSession || !dateInRange(paymentDate, range)) continue;

      const key = `${layaway.id}:${payment.id || payment.paymentId || payment.idempotencyKey || paymentDate}:${payment.amount}`;
      if (paymentKeys.has(key)) continue;
      paymentKeys.add(key);
      const paymentAmount = amount(payment.amount);
      paymentsCollected = paymentsCollected.plus(paymentAmount);
      if (isPending) pendingAdvances = pendingAdvances.plus(paymentAmount);
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
    const belongsToSession = !cashSessionId || movementSessionId(movement) === cashSessionId;
    if (!belongsToSession || !dateInRange(movement.fecha || movement.createdAt, range)) continue;
    if (isLayawayRefundMovement(movement)) refunds = refunds.plus(movementAmount(movement));
    if (isLayawayPaymentMovement(movement) && !paymentMovementIds.has(movement.id)) {
      paymentsCollected = paymentsCollected.plus(movementAmount(movement));
      const movementLayaway = layawayById.get(movement.layawayId || movement.referenceId);
      if (movementLayaway && ['active', 'ready'].includes(String(movementLayaway.status || '').toLowerCase()) && !saleByLayaway.has(movementLayaway.id)) {
        pendingAdvances = pendingAdvances.plus(movementAmount(movement));
      }
    }
  }

  return {
    layawayPaymentsCollected: number(paymentsCollected),
    layawayPendingAdvances: number(pendingAdvances),
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
  const sessionMovements = cashMovements.filter((movement) => !sessionId || movementSessionId(movement) === sessionId);
  const sessionSales = sales.filter((sale) => dateInRange(sale.timestamp, period) && (!sale.cash_session_id || sale.cash_session_id === sessionId));
  let directCashSales = amount(0);
  let customerCreditCollections = amount(0);
  let manualEntries = amount(0);
  let positiveAdjustments = amount(0);
  let exits = amount(0);
  let negativeAdjustments = amount(0);

  for (const sale of sessionSales) {
    if (isFinanciallyClosedSale(sale) && sale.isLayawayConversion !== true && isCashSale(sale)) directCashSales = directCashSales.plus(sale.total || sale.paymentData?.amount || 0);
  }
  for (const movement of sessionMovements) {
    const type = String(movement.tipo || movement.type || '').toLowerCase();
    if (isCustomerCollection(movement)) customerCreditCollections = customerCreditCollections.plus(movementAmount(movement));
    else if (type === 'entrada' && !isLayawayPaymentMovement(movement)) manualEntries = manualEntries.plus(movementAmount(movement));
    else if (type === 'ajuste_entrada') positiveAdjustments = positiveAdjustments.plus(movementAmount(movement));
    else if (type === 'salida') exits = exits.plus(movementAmount(movement));
    else if (type === 'ajuste_salida') negativeAdjustments = negativeAdjustments.plus(movementAmount(movement));
  }

  const theoreticalCash = amount(cashSession.monto_inicial)
    .plus(directCashSales).plus(customerCreditCollections).plus(layaway.layawayPaymentsCollected)
    .plus(manualEntries).plus(positiveAdjustments).minus(exits).minus(negativeAdjustments);
  const recognizedSales = sessionSales.reduce((total, sale) => (
    isFinanciallyClosedSale(sale) ? total.plus(sale.total || 0) : total
  ), amount(0));
  const knownCash = amount(cashSession.monto_inicial).plus(directCashSales).plus(customerCreditCollections)
    .plus(layaway.layawayPaymentsCollected).plus(manualEntries).plus(positiveAdjustments).minus(exits).minus(negativeAdjustments);
  // Caja conserva el agregado de entradas; compararlo contra el desglose permite
  // detectar historial incompleto sin convertir la diferencia en una venta.
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
    unclassifiedDifference: number(recordedCash.minus(knownCash))
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
  const paymentLinks = new Map();
  for (const layaway of layaways) for (const payment of layaway.payments || []) {
    if (payment.cashMovementId) paymentLinks.set(payment.cashMovementId, { layawayId: layaway.id, paymentId: payment.id || null });
  }
  return {
    completedWithoutSale: layaways.filter((layaway) => layaway.status === 'completed' && !saleGroups.has(layaway.id)).map((layaway) => layaway.id),
    duplicateConversions: Array.from(saleGroups.entries()).filter(([, group]) => group.length > 1).map(([layawayId, group]) => ({ layawayId, saleIds: group.map((sale) => sale.id) })),
    confirmedPaymentsWithoutCashMovement: layaways.flatMap((layaway) => (layaway.payments || []).filter((payment) => isConfirmedPayment(payment) && !payment.cashMovementId).map((payment) => ({ layawayId: layaway.id, paymentId: payment.id || null }))),
    cashMovementsWithoutPayment: cashMovements.filter((movement) => isLayawayPaymentMovement(movement) && !paymentLinks.has(movement.id)).map((movement) => movement.id),
    conversionsWithoutLayaway: sales.filter((sale) => sale.isLayawayConversion === true && sale.originalLayawayId && !layawayIds.has(sale.originalLayawayId)).map((sale) => sale.id)
  };
};

export { isLayawayPaymentMovement, isLayawayRefundMovement };
