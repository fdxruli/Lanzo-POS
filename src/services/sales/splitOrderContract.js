import Big from 'big.js';
import { Money } from '../../utils/moneyMath';
import { orderTotals } from './orderTotals';

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

const discountObjectOf = (source) => (
  source && typeof source === 'object' && !Array.isArray(source) ? source : null
);

const lineDiscountSourceOf = (item = {}) => {
  const objectDiscount = discountObjectOf(item.discount);
  if (objectDiscount) {
    const inheritedMetadata = {
      reason: item.discountReason ?? item.discount_reason,
      appliedAt: item.discountAppliedAt ?? item.discount_applied_at,
      applied_at: item.discount_applied_at ?? item.discountAppliedAt,
      appliedByRole: item.discountAppliedByRole ?? item.discount_applied_by_role,
      applied_by_role: item.discount_applied_by_role ?? item.discountAppliedByRole,
      appliedByStaffUserId: item.discountAppliedByStaffUserId ?? item.discount_applied_by_staff_user_id,
      applied_by_staff_user_id: item.discount_applied_by_staff_user_id ?? item.discountAppliedByStaffUserId,
      appliedByDeviceId: item.discountAppliedByDeviceId ?? item.discount_applied_by_device_id,
      applied_by_device_id: item.discount_applied_by_device_id ?? item.discountAppliedByDeviceId
    };
    return {
      ...inheritedMetadata,
      ...objectDiscount,
      reason: objectDiscount.reason ?? inheritedMetadata.reason,
      appliedAt: objectDiscount.appliedAt ?? objectDiscount.applied_at ?? inheritedMetadata.appliedAt,
      applied_at: objectDiscount.applied_at ?? objectDiscount.appliedAt ?? inheritedMetadata.applied_at,
      appliedByRole: objectDiscount.appliedByRole ?? objectDiscount.applied_by_role ?? inheritedMetadata.appliedByRole,
      applied_by_role: objectDiscount.applied_by_role ?? objectDiscount.appliedByRole ?? inheritedMetadata.applied_by_role,
      appliedByStaffUserId: objectDiscount.appliedByStaffUserId ?? objectDiscount.applied_by_staff_user_id ?? inheritedMetadata.appliedByStaffUserId,
      applied_by_staff_user_id: objectDiscount.applied_by_staff_user_id ?? objectDiscount.appliedByStaffUserId ?? inheritedMetadata.applied_by_staff_user_id,
      appliedByDeviceId: objectDiscount.appliedByDeviceId ?? objectDiscount.applied_by_device_id ?? inheritedMetadata.appliedByDeviceId,
      applied_by_device_id: objectDiscount.applied_by_device_id ?? objectDiscount.appliedByDeviceId ?? inheritedMetadata.applied_by_device_id
    };
  }

  const value = item.discountAmount ?? item.discount_amount ?? item.discount;
  if (value === undefined || value === null || value === '') return null;

  return {
    type: 'amount',
    value,
    amount: value,
    reason: item.discountReason ?? item.discount_reason,
    appliedAt: item.discountAppliedAt ?? item.discount_applied_at,
    applied_at: item.discount_applied_at ?? item.discountAppliedAt,
    appliedByRole: item.discountAppliedByRole ?? item.discount_applied_by_role,
    applied_by_role: item.discount_applied_by_role ?? item.discountAppliedByRole,
    appliedByStaffUserId: item.discountAppliedByStaffUserId ?? item.discount_applied_by_staff_user_id,
    applied_by_staff_user_id: item.discount_applied_by_staff_user_id ?? item.discountAppliedByStaffUserId,
    appliedByDeviceId: item.discountAppliedByDeviceId ?? item.discount_applied_by_device_id,
    applied_by_device_id: item.discount_applied_by_device_id ?? item.discountAppliedByDeviceId
  };
};

const addDiscountAliases = (discount) => {
  if (!discount) return null;
  return {
    ...discount,
    applied_at: discount.appliedAt ?? discount.applied_at,
    applied_by_role: discount.appliedByRole ?? discount.applied_by_role,
    applied_by_staff_user_id: discount.appliedByStaffUserId ?? discount.applied_by_staff_user_id,
    applied_by_device_id: discount.appliedByDeviceId ?? discount.applied_by_device_id
  };
};

const allocateCentsByWeights = (amountCents, rawWeights = []) => {
  const allocations = rawWeights.map(() => 0);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) return null;
  if (amountCents === 0) return allocations;

  let weights;
  try {
    weights = rawWeights.map((weight) => new Big(weight ?? 0));
  } catch {
    return null;
  }

  if (weights.some((weight) => weight.lt(0))) return null;
  const totalWeight = weights.reduce((sum, weight) => sum.plus(weight), new Big(0));
  if (totalWeight.lte(0)) return allocations;

  const shares = weights.map((weight, index) => {
    const exactShare = new Big(amountCents).times(weight).div(totalWeight);
    const floorCents = Number(exactShare.round(0, Big.roundDown).toString());
    return {
      index,
      floorCents,
      remainder: exactShare.minus(floorCents)
    };
  });

  shares.forEach(({ index, floorCents }) => {
    allocations[index] = floorCents;
  });

  let remainingCents = amountCents - allocations.reduce((sum, cents) => sum + cents, 0);
  const largestRemainders = [...shares].sort((left, right) => (
    right.remainder.cmp(left.remainder) || left.index - right.index
  ));

  for (let index = 0; remainingCents > 0 && largestRemainders.length > 0; index += 1) {
    allocations[largestRemainders[index % largestRemainders.length].index] += 1;
    remainingCents -= 1;
  }

  return remainingCents === 0 ? allocations : null;
};

const allocateCentsByWeightsWithinCaps = (amountCents, weights, rawCaps) => {
  const allocations = allocateCentsByWeights(amountCents, weights);
  if (!allocations || !Array.isArray(rawCaps) || rawCaps.length !== allocations.length) return null;

  const caps = rawCaps.map((cap) => Math.max(0, Number(cap) || 0));
  if (caps.some((cap) => !Number.isSafeInteger(cap))) return null;

  let overflow = 0;
  allocations.forEach((amount, index) => {
    if (amount > caps[index]) {
      overflow += amount - caps[index];
      allocations[index] = caps[index];
    }
  });

  const capacityOrder = weights
    .map((weight, index) => ({ weight: new Big(weight ?? 0), index }))
    .sort((left, right) => right.weight.cmp(left.weight) || left.index - right.index);

  while (overflow > 0) {
    let moved = false;
    for (const { index } of capacityOrder) {
      if (allocations[index] >= caps[index]) continue;
      allocations[index] += 1;
      overflow -= 1;
      moved = true;
      if (overflow === 0) break;
    }
    if (!moved) return null;
  }

  return allocations;
};

const buildAllocatedDiscount = ({ source, normalized, amountCents, scope }) => {
  if (!normalized || amountCents <= 0) return null;

  const amount = Money.toNumber(Money.fromCents(amountCents));
  const type = normalized.type || source?.type || 'amount';
  return addDiscountAliases({
    ...(discountObjectOf(source) || {}),
    ...normalized,
    type,
    value: type === 'percent' ? normalized.value : amount,
    amount,
    scope,
    reason: normalized.reason || source?.reason || '',
    appliedAt: normalized.appliedAt || normalized.applied_at || source?.appliedAt || source?.applied_at,
    appliedByRole: normalized.appliedByRole || normalized.applied_by_role || source?.appliedByRole || source?.applied_by_role,
    appliedByStaffUserId: normalized.appliedByStaffUserId || normalized.applied_by_staff_user_id || source?.appliedByStaffUserId || source?.applied_by_staff_user_id,
    appliedByDeviceId: normalized.appliedByDeviceId || normalized.applied_by_device_id || source?.appliedByDeviceId || source?.applied_by_device_id
  });
};

/**
 * Calculate net amounts for item-based restaurant tickets using the same
 * canonical discount rules as the POS. Line discounts follow their actual
 * quantities; sale discounts follow each ticket's post-line-discount value.
 * Every discount cent is assigned deterministically before rounding is tested.
 */
export const calculateByItemsTicketFinancials = ({
  items = [],
  saleDiscount = null,
  tickets = [],
  parentTotal
} = {}) => {
  const sourceItems = Array.isArray(items) ? items : [];
  const ticketInputs = Array.isArray(tickets) ? tickets : [];
  const normalizedSaleDiscount = saleDiscount
    || sourceItems.saleDiscount
    || null;
  const discountNormalizedItems = sourceItems.map((item) => {
    const discount = lineDiscountSourceOf(item);
    return discount ? { ...item, discount } : item;
  });
  const parentTotals = orderTotals({ items: discountNormalizedItems, saleDiscount: normalizedSaleDiscount });
  const parentTotalCents = roundSplitAmountToCents(parentTotal ?? parentTotals.total);
  const ticketLineQuantities = ticketInputs.map(() => sourceItems.map(() => new Big(0)));

  for (let ticketIndex = 0; ticketIndex < ticketInputs.length; ticketIndex += 1) {
    const lines = Array.isArray(ticketInputs[ticketIndex]?.lines) ? ticketInputs[ticketIndex].lines : [];
    for (const line of lines) {
      const lineIndex = Number(line?.lineIndex);
      const rawQuantity = line?.quantity;
      if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= sourceItems.length) {
        return { valid: false, parentTotalCents, parentTotals, tickets: [], roundingPlan: null };
      }
      let quantity;
      try {
        quantity = new Big(rawQuantity ?? 0);
      } catch {
        return { valid: false, parentTotalCents, parentTotals, tickets: [], roundingPlan: null };
      }
      if (quantity.lt(0)) {
        return { valid: false, parentTotalCents, parentTotals, tickets: [], roundingPlan: null };
      }
      ticketLineQuantities[ticketIndex][lineIndex] = ticketLineQuantities[ticketIndex][lineIndex].plus(quantity);
    }
  }

  const lineGrossCentsByLine = sourceItems.map((item, lineIndex) => (
    ticketLineQuantities.map((ticketLines) => roundSplitAmountToCents(
      Money.multiply(item?.price ?? 0, ticketLines[lineIndex].toString())
    ))
  ));
  const lineDiscountSharesByLine = sourceItems.map((item, lineIndex) => {
    const discountCents = roundSplitAmountToCents(parentTotals.items[lineIndex]?.discountAmount || 0);
    const quantities = ticketLineQuantities.map((ticketLines) => ticketLines[lineIndex]);
    return allocateCentsByWeightsWithinCaps(discountCents, quantities, lineGrossCentsByLine[lineIndex]);
  });
  if (lineDiscountSharesByLine.some((shares) => shares === null)) {
    return { valid: false, parentTotalCents, parentTotals, tickets: [], roundingPlan: null };
  }

  const ticketFinancials = ticketInputs.map((ticket, ticketIndex) => {
    const lines = [];
    let grossSubtotalCents = 0;
    let lineDiscountCents = 0;

    sourceItems.forEach((item, lineIndex) => {
      const quantity = ticketLineQuantities[ticketIndex][lineIndex];
      if (quantity.lte(0)) return;

      const grossCents = roundSplitAmountToCents(
        Money.multiply(item?.price ?? 0, quantity.toString())
      );
      const discountCents = lineDiscountSharesByLine[lineIndex][ticketIndex] || 0;
      const normalizedLine = parentTotals.items[lineIndex];
      const discount = buildAllocatedDiscount({
        source: lineDiscountSourceOf(item),
        normalized: normalizedLine?.discount,
        amountCents: discountCents,
        scope: 'line'
      });

      grossSubtotalCents += grossCents;
      lineDiscountCents += discountCents;
      lines.push({
        lineIndex,
        quantity: Number(quantity.toString()),
        grossSubtotalCents: grossCents,
        discountCents,
        lineTotalCents: grossCents - discountCents,
        discount
      });
    });

    return {
      label: ticket?.label,
      lines,
      grossSubtotalCents,
      lineDiscountCents,
      subtotalAfterLineDiscountsCents: grossSubtotalCents - lineDiscountCents
    };
  });

  const saleDiscountCents = roundSplitAmountToCents(parentTotals.saleDiscountAmount || 0);
  const saleDiscountShares = allocateCentsByWeightsWithinCaps(
    saleDiscountCents,
    ticketFinancials.map((ticket) => Math.max(ticket.subtotalAfterLineDiscountsCents, 0)),
    ticketFinancials.map((ticket) => Math.max(ticket.subtotalAfterLineDiscountsCents, 0))
  );
  if (saleDiscountShares === null) {
    return { valid: false, parentTotalCents, parentTotals, tickets: [], roundingPlan: null };
  }

  const normalizedParentSaleDiscount = parentTotals.saleDiscount;
  const rawParentSaleDiscount = normalizedSaleDiscount && discountObjectOf(normalizedSaleDiscount)
    ? normalizedSaleDiscount
    : null;
  ticketFinancials.forEach((ticket, index) => {
    ticket.saleDiscountCents = saleDiscountShares[index] || 0;
    ticket.discountTotalCents = ticket.lineDiscountCents + ticket.saleDiscountCents;
    ticket.baseCents = ticket.subtotalAfterLineDiscountsCents - ticket.saleDiscountCents;
    ticket.saleDiscount = buildAllocatedDiscount({
      source: rawParentSaleDiscount,
      normalized: normalizedParentSaleDiscount,
      amountCents: ticket.saleDiscountCents,
      scope: 'sale'
    });
  });

  const baseCentsByTicket = ticketFinancials.map((ticket) => ticket.baseCents);
  const eligibleTicketIndices = baseCentsByTicket
    .map((baseCents, index) => (baseCents > 0 ? index : null))
    .filter((index) => index !== null);
  const roundingPlan = buildByItemsRoundingAdjustments(
    parentTotalCents,
    baseCentsByTicket,
    eligibleTicketIndices
  );

  ticketFinancials.forEach((ticket, index) => {
    ticket.roundingAdjustmentCents = roundingPlan.adjustments[index] || 0;
    ticket.totalCents = ticket.baseCents + ticket.roundingAdjustmentCents;
  });

  return {
    valid: roundingPlan.valid,
    parentTotalCents,
    parentTotals,
    tickets: ticketFinancials,
    roundingPlan
  };
};

export const splitRequiresCashSessionCompatibility = (tickets = []) => (
  (Array.isArray(tickets) ? tickets : []).some((ticket) => {
    const method = String(ticket?.paymentData?.paymentMethod || ticket?.paymentData?.method || '')
      .trim()
      .toLowerCase();
    return ['efectivo', 'cash', 'fiado', 'credit', 'crédito', 'credito'].includes(method);
  })
);
