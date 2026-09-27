import Big from 'big.js';
import { Money } from '../../utils/moneyMath';

export const RESTAURANT_SPLIT_INTENTS = Object.freeze({
  BY_ITEMS: 'by_items',
  EQUAL_PAYMENT: 'equal_payment',
  CUSTOM_PAYMENT: 'custom_payment'
});

export const MAX_SPLIT_ROUNDING_ADJUSTMENT_CENTS = 1;

const normalizeIntentCandidate = (value) => {
  const candidate = String(value ?? '').trim().toLowerCase();
  if (candidate === RESTAURANT_SPLIT_INTENTS.BY_ITEMS || candidate === 'manual') {
    return RESTAURANT_SPLIT_INTENTS.BY_ITEMS;
  }
  if (candidate === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT || candidate === 'equal') {
    return RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT;
  }
  if (candidate === RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT) {
    return RESTAURANT_SPLIT_INTENTS.CUSTOM_PAYMENT;
  }
  return null;
};

/**
 * Resolve the explicit contract while keeping legacy mode payloads readable.
 * `manual` safely maps to item allocation. Legacy `equal` is identified as a
 * payment split and remains non-executable until a single-sale payment flow is
 * available for restaurant orders.
 */
export const normalizeRestaurantSplitIntent = ({ splitIntent, mode } = {}) => {
  const hasExplicitIntent = String(splitIntent ?? '').trim() !== '';
  const hasLegacyMode = String(mode ?? '').trim() !== '';
  const explicitIntent = hasExplicitIntent ? normalizeIntentCandidate(splitIntent) : null;
  const legacyIntent = hasLegacyMode ? normalizeIntentCandidate(mode) : null;

  if (hasExplicitIntent && !explicitIntent) {
    return { intent: null, status: 'invalid', code: 'SPLIT_INTENT_INVALID' };
  }
  if (hasLegacyMode && !legacyIntent) {
    return { intent: null, status: 'invalid', code: 'SPLIT_INTENT_INVALID' };
  }
  if (explicitIntent && legacyIntent && explicitIntent !== legacyIntent) {
    return { intent: null, status: 'invalid', code: 'SPLIT_INTENT_CONFLICT' };
  }

  const intent = explicitIntent || legacyIntent;
  if (!intent) {
    return { intent: null, status: 'invalid', code: 'SPLIT_INTENT_REQUIRED' };
  }

  if (intent === RESTAURANT_SPLIT_INTENTS.BY_ITEMS) {
    return {
      intent,
      status: 'ready',
      code: null,
      source: hasExplicitIntent ? 'splitIntent' : 'legacy_mode'
    };
  }

  return {
    intent,
    status: 'deferred',
    code: 'SPLIT_INTENT_NOT_SUPPORTED',
    source: hasExplicitIntent ? 'splitIntent' : 'legacy_mode'
  };
};

/**
 * Match the cent rounding used by the cloud sale contract (PostgreSQL round
 * for positive financial amounts) without changing the global Money policy.
 */
export const roundSplitAmountToCents = (amount) => Number(
  Money.init(amount ?? 0).times(100).round(0, Big.roundHalfUp).toString()
);

/**
 * Reconcile only unavoidable cent rounding across item based tickets. Each
 * eligible ticket can absorb at most one cent, and callers must attach that
 * amount as a separate split adjustment while preserving every unit price.
 */
export const buildByItemsRoundingAdjustments = (
  parentTotalCents,
  baseCentsByTicket,
  eligibleTicketIndices = baseCentsByTicket.map((total, index) => (total > 0 ? index : null)).filter((index) => index !== null)
) => {
  const adjustments = baseCentsByTicket.map(() => 0);
  const validInputs = Number.isInteger(parentTotalCents)
    && baseCentsByTicket.every(Number.isInteger)
    && Array.isArray(eligibleTicketIndices);

  if (!validInputs) {
    return { valid: false, adjustments, differenceCents: null, remainingCents: null };
  }

  const differenceCents = parentTotalCents - baseCentsByTicket.reduce((sum, total) => sum + total, 0);
  let remainingCents = differenceCents;
  const direction = Math.sign(differenceCents);
  const uniqueEligibleIndices = [...new Set(eligibleTicketIndices)];

  for (const ticketIndex of uniqueEligibleIndices) {
    if (!Number.isInteger(ticketIndex) || ticketIndex < 0 || ticketIndex >= baseCentsByTicket.length) continue;
    if (remainingCents === 0) break;
    if (direction < 0 && baseCentsByTicket[ticketIndex] <= 0) continue;

    adjustments[ticketIndex] = direction * MAX_SPLIT_ROUNDING_ADJUSTMENT_CENTS;
    remainingCents -= adjustments[ticketIndex];
  }

  return {
    valid: remainingCents === 0,
    adjustments,
    differenceCents,
    remainingCents
  };
};

export const splitHasCashPayment = (tickets = []) => (
  (Array.isArray(tickets) ? tickets : []).some((ticket) => {
    const method = String(ticket?.paymentData?.paymentMethod || ticket?.paymentData?.method || '')
      .trim()
      .toLowerCase();
    return method === 'efectivo' || method === 'cash';
  })
);
