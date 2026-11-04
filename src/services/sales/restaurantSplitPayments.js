import { Money } from '../../utils/moneyMath';
import {
  normalizeRestaurantSplitPaymentMethod,
  toLegacyRestaurantSplitPaymentMethod
} from './paymentMethodContract';
import { RESTAURANT_SPLIT_INTENTS } from './splitOrderContract';

export const MIN_RESTAURANT_SPLIT_PAYERS = 2;
export const MAX_RESTAURANT_SPLIT_PAYERS = 8;

const centsToAmount = (cents) => Money.toExactString(Money.fromCents(cents));
const parseAmountCents = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const input = String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return null;
  try {
    const cents = Money.toCents(input);
    return Number.isInteger(cents) && cents >= 0 ? cents : null;
  } catch {
    return null;
  }
};

export const calculateEqualPaymentCents = (totalCents, payerCount) => {
  if (!Number.isInteger(totalCents) || totalCents <= 0
    || !Number.isInteger(payerCount)
    || payerCount < MIN_RESTAURANT_SPLIT_PAYERS
    || payerCount > MAX_RESTAURANT_SPLIT_PAYERS) {
    return { valid: false, code: 'SPLIT_EQUAL_INPUT_INVALID', amountsCents: [] };
  }

  const base = Math.floor(totalCents / payerCount);
  const extraCents = totalCents % payerCount;
  const amountsCents = Array.from({ length: payerCount }, (_, index) => base + (index < extraCents ? 1 : 0));
  if (amountsCents.some((amount) => amount <= 0)) {
    return { valid: false, code: 'SPLIT_EQUAL_AMOUNT_TOO_SMALL', amountsCents };
  }
  return { valid: true, code: null, amountsCents };
};

export const validateCustomPaymentCents = (totalCents, amountsCents) => {
  if (!Number.isInteger(totalCents) || totalCents <= 0
    || !Array.isArray(amountsCents)
    || amountsCents.length < MIN_RESTAURANT_SPLIT_PAYERS
    || amountsCents.length > MAX_RESTAURANT_SPLIT_PAYERS
    || !amountsCents.every((amount) => Number.isInteger(amount) && amount >= 0)) {
    return { valid: false, code: 'SPLIT_CUSTOM_INPUT_INVALID', distributedCents: 0, pendingCents: totalCents };
  }
  if (amountsCents.some((amount) => amount <= 0)) {
    return { valid: false, code: 'SPLIT_CUSTOM_AMOUNT_REQUIRED', distributedCents: amountsCents.reduce((sum, amount) => sum + amount, 0), pendingCents: null };
  }

  const distributedCents = amountsCents.reduce((sum, amount) => sum + amount, 0);
  const pendingCents = totalCents - distributedCents;
  if (pendingCents < 0) return { valid: false, code: 'SPLIT_CUSTOM_EXCEEDS_TOTAL', distributedCents, pendingCents };
  if (pendingCents > 0) return { valid: false, code: 'SPLIT_CUSTOM_INCOMPLETE', distributedCents, pendingCents };
  return { valid: true, code: null, distributedCents, pendingCents: 0 };
};

const normalizeGuestLabel = (value) => String(value ?? '').trim();
const cleanReference = (value) => {
  const reference = typeof value === 'string' ? value.trim() : '';
  return reference ? reference.slice(0, 100) : null;
};

const makePaymentRow = ({ label, method, amountCents, receivedCents, changeCents, reference = null }) => ({
  method,
  amount: centsToAmount(amountCents),
  received_amount: centsToAmount(receivedCents),
  change_amount: centsToAmount(changeCents),
  reference: cleanReference(reference),
  metadata: { splitPayerId: label, source: 'restaurant_split' }
});

/** Validate and aggregate per-payer tender without ever changing product prices. */
export const buildRestaurantSplitPaymentPlan = ({ splitIntent, totalCents, tickets = [] } = {}) => {
  if (![RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT, RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT].includes(splitIntent)) {
    return { valid: false, code: 'SPLIT_PAYMENT_INTENT_INVALID' };
  }
  if (!Array.isArray(tickets)
    || tickets.length < MIN_RESTAURANT_SPLIT_PAYERS
    || tickets.length > MAX_RESTAURANT_SPLIT_PAYERS) {
    return { valid: false, code: 'SPLIT_PAYMENT_PAYER_COUNT_INVALID' };
  }
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    return { valid: false, code: 'SPLIT_PAYMENT_TOTAL_INVALID' };
  }

  const labels = tickets.map((ticket) => normalizeGuestLabel(ticket?.label));
  if (labels.some((label) => !/^T[1-8]$/.test(label)) || new Set(labels).size !== labels.length) {
    return { valid: false, code: 'SPLIT_PAYMENT_PAYER_INVALID' };
  }

  const amountsCents = tickets.map((ticket) => ticket?.amountCents);
  if (!amountsCents.every((amount) => Number.isInteger(amount) && amount > 0)) {
    return { valid: false, code: 'SPLIT_PAYMENT_AMOUNT_INVALID' };
  }
  if (splitIntent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT) {
    const equal = calculateEqualPaymentCents(totalCents, tickets.length);
    if (!equal.valid || amountsCents.some((amount, index) => amount !== equal.amountsCents[index])) {
      return { valid: false, code: 'SPLIT_EQUAL_DISTRIBUTION_INVALID' };
    }
  } else {
    const custom = validateCustomPaymentCents(totalCents, amountsCents);
    if (!custom.valid) return { valid: false, code: custom.code };
  }

  const creditTickets = tickets.filter((ticket) => (
    normalizeRestaurantSplitPaymentMethod(ticket?.paymentData?.paymentMethod) === 'credit'
  ));
  if (creditTickets.length > 1) {
    return { valid: false, code: 'SPLIT_MULTIPLE_CREDIT_PAGERS_UNSUPPORTED' };
  }

  const payments = [];
  const payers = [];
  let cashAppliedCents = 0;
  let amountPaidCents = 0;
  let changeCents = 0;
  let balanceDueCents = 0;
  let customerId = null;

  for (let index = 0; index < tickets.length; index += 1) {
    const ticket = tickets[index];
    const label = labels[index];
    const dueCents = amountsCents[index];
    const paymentData = ticket?.paymentData || {};
    const method = normalizeRestaurantSplitPaymentMethod(paymentData.paymentMethod);
    if (!['cash', 'card', 'transfer', 'credit'].includes(method)) {
      return { valid: false, code: 'SPLIT_PAYMENT_METHOD_INVALID', label };
    }

    const defaultPaid = method === 'credit' ? '0' : centsToAmount(dueCents);
    const rawPaidCents = parseAmountCents(paymentData.amountPaid ?? defaultPaid);
    if (rawPaidCents === null) return { valid: false, code: 'SPLIT_PAYMENT_AMOUNT_INVALID', label };
    let payerBalanceCents = 0;
    let payerPaidCents = 0;
    let payerInitialMethod = null;

    if (method === 'cash') {
      const receivedCents = parseAmountCents(paymentData.receivedAmount ?? paymentData.amountPaid ?? centsToAmount(dueCents));
      if (receivedCents === null || receivedCents < dueCents) {
        return { valid: false, code: 'SPLIT_CASH_AMOUNT_SHORT', label };
      }
      const payerChangeCents = receivedCents - dueCents;
      payments.push(makePaymentRow({ label, method, amountCents: dueCents, receivedCents, changeCents: payerChangeCents, reference: paymentData.paymentReference }));
      cashAppliedCents += dueCents;
      payerPaidCents = dueCents;
      changeCents += payerChangeCents;
    } else if (method === 'card' || method === 'transfer') {
      if (rawPaidCents !== dueCents) return { valid: false, code: 'SPLIT_NONCASH_AMOUNT_MISMATCH', label };
      payments.push(makePaymentRow({ label, method, amountCents: dueCents, receivedCents: dueCents, changeCents: 0, reference: paymentData.paymentReference }));
      payerPaidCents = dueCents;
    } else {
      const selectedCustomerId = typeof paymentData.customerId === 'string' ? paymentData.customerId.trim() : '';
      if (!selectedCustomerId) return { valid: false, code: 'SPLIT_CREDIT_CUSTOMER_REQUIRED', label };
      if (rawPaidCents > dueCents) return { valid: false, code: 'SPLIT_CREDIT_INITIAL_EXCEEDS_TOTAL', label };
      payerBalanceCents = dueCents - rawPaidCents;
      if (payerBalanceCents <= 0) return { valid: false, code: 'SPLIT_CREDIT_BALANCE_REQUIRED', label };
      const initialMethod = normalizeRestaurantSplitPaymentMethod(paymentData.initialPaymentMethod || 'cash');
      if (!['cash', 'card', 'transfer'].includes(initialMethod)) {
        return { valid: false, code: 'SPLIT_CREDIT_INITIAL_METHOD_INVALID', label };
      }
      payerInitialMethod = initialMethod;
      if (rawPaidCents > 0) {
        const receivedCents = initialMethod === 'cash'
          ? parseAmountCents(paymentData.receivedAmount ?? paymentData.amountPaid)
          : rawPaidCents;
        if (receivedCents === null || receivedCents < rawPaidCents
          || (initialMethod !== 'cash' && receivedCents !== rawPaidCents)) {
          return { valid: false, code: 'SPLIT_CREDIT_INITIAL_TENDER_INVALID', label };
        }
        const payerChangeCents = initialMethod === 'cash' ? receivedCents - rawPaidCents : 0;
        payments.push(makePaymentRow({
          label,
          method: initialMethod,
          amountCents: rawPaidCents,
          receivedCents,
          changeCents: payerChangeCents,
          reference: paymentData.paymentReference
        }));
        if (initialMethod === 'cash') cashAppliedCents += rawPaidCents;
        changeCents += payerChangeCents;
      }
      customerId = selectedCustomerId;
      balanceDueCents += payerBalanceCents;
      payerPaidCents = rawPaidCents;
    }

    amountPaidCents += payerPaidCents;
    payers.push({
      label,
      amount: centsToAmount(dueCents),
      method,
      customerId: method === 'credit' ? customerId : null,
      initialPaymentMethod: payerInitialMethod,
      initialAmountPaid: method === 'credit' ? centsToAmount(payerPaidCents) : null
    });
  }

  if (amountPaidCents + balanceDueCents !== totalCents) {
    return { valid: false, code: 'SPLIT_PAYMENT_TOTAL_MISMATCH' };
  }

  const tenderMethods = new Set(payments.map((payment) => payment.method));
  const paymentMethod = balanceDueCents > 0
    ? 'fiado'
    : (tenderMethods.size > 1 ? 'mixed' : toLegacyRestaurantSplitPaymentMethod([...tenderMethods][0]));

  return {
    valid: true,
    code: null,
    splitIntent,
    totalCents,
    payments,
    payers,
    payerCount: tickets.length,
    paymentMethod,
    customerId,
    amountPaid: centsToAmount(amountPaidCents),
    amountPaidCents,
    balanceDue: centsToAmount(balanceDueCents),
    balanceDueCents,
    cashApplied: centsToAmount(cashAppliedCents),
    cashAppliedCents,
    changeAmount: centsToAmount(changeCents),
    changeCents
  };
};

export const restaurantSplitPaymentInternals = Object.freeze({ parseAmountCents, centsToAmount });
