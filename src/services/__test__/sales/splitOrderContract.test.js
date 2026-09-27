import { describe, expect, it } from 'vitest';
import {
  buildByItemsRoundingAdjustments,
  normalizeRestaurantSplitIntent,
  RESTAURANT_SPLIT_INTENTS,
  calculateByItemsTicketFinancials,
  roundSplitAmountToCents,
  splitHasCashPayment,
  splitRequiresCashSessionCompatibility
} from '../../sales/splitOrderContract';

describe('restaurant split contract', () => {
  it('accepts the explicit by-items strategy', () => {
    expect(normalizeRestaurantSplitIntent({ splitIntent: 'by_items' })).toMatchObject({
      intent: RESTAURANT_SPLIT_INTENTS.BY_ITEMS,
      status: 'ready',
      code: null,
      source: 'splitIntent'
    });
  });

  it('maps the legacy manual mode to by_items', () => {
    expect(normalizeRestaurantSplitIntent({ mode: 'manual' })).toMatchObject({
      intent: RESTAURANT_SPLIT_INTENTS.BY_ITEMS,
      status: 'ready',
      source: 'legacy_mode'
    });
  });

  it('keeps legacy equal readable as a deferred equal-payment intent', () => {
    expect(normalizeRestaurantSplitIntent({ mode: 'equal' })).toMatchObject({
      intent: RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT,
      status: 'deferred',
      code: 'SPLIT_INTENT_NOT_SUPPORTED',
      source: 'legacy_mode'
    });
  });

  it('defines equal_payment without allowing it to execute', () => {
    expect(normalizeRestaurantSplitIntent({ splitIntent: 'equal_payment' })).toMatchObject({
      intent: RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT,
      status: 'deferred',
      code: 'SPLIT_INTENT_NOT_SUPPORTED'
    });
  });

  it('rejects conflicting explicit and legacy strategies', () => {
    expect(normalizeRestaurantSplitIntent({ splitIntent: 'by_items', mode: 'equal' })).toMatchObject({
      intent: null,
      status: 'invalid',
      code: 'SPLIT_INTENT_CONFLICT'
    });
  });

  it('rejects unknown or missing strategies', () => {
    expect(normalizeRestaurantSplitIntent({ splitIntent: 'mystery' }).code).toBe('SPLIT_INTENT_INVALID');
    expect(normalizeRestaurantSplitIntent({}).code).toBe('SPLIT_INTENT_REQUIRED');
  });

  it('uses cloud-compatible half-up rounding for split line amounts', () => {
    expect(roundSplitAmountToCents('2.505')).toBe(251);
    expect(roundSplitAmountToCents('2.504')).toBe(250);
  });

  it('allows only one cent per eligible ticket to reconcile item totals', () => {
    expect(buildByItemsRoundingAdjustments(10001, [5000, 5000], [0, 1])).toMatchObject({
      valid: true,
      adjustments: [1, 0],
      differenceCents: 1,
      remainingCents: 0
    });

    expect(buildByItemsRoundingAdjustments(10002, [5000, 5000], [0, 1])).toMatchObject({
      valid: true,
      adjustments: [1, 1],
      differenceCents: 2,
      remainingCents: 0
    });
  });

  it('rejects a large commercial difference when one ticket would have to absorb it', () => {
    expect(buildByItemsRoundingAdjustments(60000, [50000, 10000], [0, 1])).toMatchObject({
      valid: true,
      adjustments: [0, 0],
      differenceCents: 0
    });
    expect(buildByItemsRoundingAdjustments(40000, [50000, 10000], [0, 1])).toMatchObject({
      valid: false,
      differenceCents: -20000,
      remainingCents: -19998
    });
  });

  it('does not turn a credit-only split into an automatic cash opening', () => {
    expect(splitHasCashPayment([
      { paymentData: { paymentMethod: 'fiado' } },
      { paymentData: { paymentMethod: 'credit' } }
    ])).toBe(false);
    expect(splitHasCashPayment([{ paymentData: { paymentMethod: 'efectivo' } }])).toBe(true);
    expect(splitHasCashPayment([{ paymentData: { method: 'cash' } }])).toBe(true);
    expect(splitRequiresCashSessionCompatibility([
      { paymentData: { paymentMethod: 'fiado' } }
    ])).toBe(true);
    expect(splitRequiresCashSessionCompatibility([
      { paymentData: { paymentMethod: 'efectivo' } },
      { paymentData: { paymentMethod: 'fiado' } }
    ])).toBe(true);
    expect(splitRequiresCashSessionCompatibility([
      { paymentData: { paymentMethod: 'tarjeta' } }
    ])).toBe(false);
  });

  it('keeps a $100 line price and applies its $10 line discount before rounding', () => {
    const result = calculateByItemsTicketFinancials({
      items: [{ id: 'p1', quantity: 1, price: 100, discount: { type: 'amount', value: 10, reason: 'Promoción' } }],
      tickets: [{ label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }] }],
      parentTotal: 90
    });

    expect(result.valid).toBe(true);
    expect(result.tickets[0]).toMatchObject({ grossSubtotalCents: 10000, lineDiscountCents: 1000, baseCents: 9000, totalCents: 9000 });
    expect(result.tickets[0].lines[0].discount).toMatchObject({ type: 'amount', value: 10, amount: 10, reason: 'Promoción', scope: 'line' });
  });

  it('normalizes legacy discount_amount aliases and retains their audit fields', () => {
    const result = calculateByItemsTicketFinancials({
      items: [{
        id: 'p1', quantity: 1, price: 100, discount_amount: 10,
        discount_reason: 'Ajuste autorizado', discount_applied_by_role: 'staff',
        discount_applied_by_staff_user_id: 'staff-1', discount_applied_by_device_id: 'device-1'
      }],
      tickets: [{ label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }] }],
      parentTotal: 90
    });

    expect(result.valid).toBe(true);
    expect(result.tickets[0].lines[0].discount).toMatchObject({
      amount: 10,
      reason: 'Ajuste autorizado',
      appliedByRole: 'staff',
      applied_by_role: 'staff',
      appliedByStaffUserId: 'staff-1',
      applied_by_staff_user_id: 'staff-1',
      appliedByDeviceId: 'device-1',
      applied_by_device_id: 'device-1'
    });
  });

  it('splits a quantity-two line discount proportionally without changing the price', () => {
    const result = calculateByItemsTicketFinancials({
      items: [{ id: 'p1', quantity: 2, price: 100, discount: { type: 'amount', value: 20, reason: 'Promoción' } }],
      tickets: [
        { label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }] },
        { label: 'T2', lines: [{ lineIndex: 0, quantity: 1 }] }
      ],
      parentTotal: 180
    });

    expect(result.valid).toBe(true);
    expect(result.tickets.map((ticket) => ticket.lines[0].discountCents)).toEqual([1000, 1000]);
    expect(result.tickets.map((ticket) => ticket.lines[0].lineTotalCents)).toEqual([9000, 9000]);
  });

  it('allocates fractional line discounts by actual quantity and deterministically distributes cents', () => {
    const fractional = calculateByItemsTicketFinancials({
      items: [{ id: 'p1', quantity: 1.5, price: 100, discount: { type: 'amount', value: 20, reason: 'Promoción' } }],
      tickets: [
        { label: 'T1', lines: [{ lineIndex: 0, quantity: 0.5 }] },
        { label: 'T2', lines: [{ lineIndex: 0, quantity: 1 }] }
      ],
      parentTotal: 130
    });
    expect(fractional.valid).toBe(true);
    expect(fractional.tickets.map((ticket) => ticket.lines[0].discountCents)).toEqual([667, 1333]);
    expect(fractional.tickets.reduce((sum, ticket) => sum + ticket.lineDiscountCents, 0)).toBe(2000);

    const oneCentRemainder = calculateByItemsTicketFinancials({
      items: [{ id: 'p1', quantity: 3, price: 100, discount: { type: 'amount', value: 10.01, reason: 'Promoción' } }],
      tickets: [1, 2, 3].map((lineIndex) => ({ label: `T${lineIndex}`, lines: [{ lineIndex: 0, quantity: 1 }] })),
      parentTotal: 289.99
    });
    expect(oneCentRemainder.valid).toBe(true);
    expect(oneCentRemainder.tickets.map((ticket) => ticket.lines[0].discountCents)).toEqual([334, 334, 333]);
    expect(oneCentRemainder.tickets.reduce((sum, ticket) => sum + ticket.lineDiscountCents, 0)).toBe(1001);
  });

  it('distributes a general sale discount proportionally after line discounts', () => {
    const result = calculateByItemsTicketFinancials({
      items: [{ id: 'p1', quantity: 1, price: 100 }, { id: 'p2', quantity: 1, price: 200 }],
      saleDiscount: { type: 'amount', value: 30, amount: 30, reason: 'Promoción de cuenta', applied_by_role: 'owner' },
      tickets: [
        { label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }] },
        { label: 'T2', lines: [{ lineIndex: 1, quantity: 1 }] }
      ],
      parentTotal: 270
    });

    expect(result.valid).toBe(true);
    expect(result.tickets.map((ticket) => ticket.saleDiscountCents)).toEqual([1000, 2000]);
    expect(result.tickets.map((ticket) => ticket.baseCents)).toEqual([9000, 18000]);
    expect(result.tickets[0].saleDiscount).toMatchObject({ type: 'amount', value: 10, amount: 10, reason: 'Promoción de cuenta', scope: 'sale', appliedByRole: 'owner', applied_by_role: 'owner' });
  });

  it('distributes a general discount remainder and combines line and sale discounts exactly', () => {
    const remainder = calculateByItemsTicketFinancials({
      items: [{ id: 'p1', quantity: 3, price: 100 }],
      saleDiscount: { type: 'amount', value: 10.01, reason: 'Promoción de cuenta' },
      tickets: [1, 2, 3].map((lineIndex) => ({ label: `T${lineIndex}`, lines: [{ lineIndex: 0, quantity: 1 }] })),
      parentTotal: 289.99
    });
    expect(remainder.valid).toBe(true);
    expect(remainder.tickets.map((ticket) => ticket.saleDiscountCents)).toEqual([334, 334, 333]);

    const combined = calculateByItemsTicketFinancials({
      items: [
        { id: 'p1', quantity: 1, price: 100, discount: { type: 'amount', value: 10, reason: 'Descuento de línea' } },
        { id: 'p2', quantity: 1, price: 200, discount: { type: 'amount', value: 20, reason: 'Descuento de línea' } }
      ],
      saleDiscount: { type: 'amount', value: 27, reason: 'Descuento general' },
      tickets: [
        { label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }] },
        { label: 'T2', lines: [{ lineIndex: 1, quantity: 1 }] }
      ],
      parentTotal: 243
    });
    expect(combined.valid).toBe(true);
    expect(combined.tickets.map((ticket) => ticket.discountTotalCents)).toEqual([1900, 3800]);
    expect(combined.tickets.reduce((sum, ticket) => sum + ticket.discountTotalCents, 0)).toBe(5700);
    expect(combined.tickets.reduce((sum, ticket) => sum + ticket.totalCents, 0)).toBe(24300);
  });

  it('rejects a real commercial mismatch instead of misclassifying it as rounding', () => {
    const result = calculateByItemsTicketFinancials({
      items: [{ id: 'p1', quantity: 1, price: 100, discount: { type: 'amount', value: 10, reason: 'Promoción' } }],
      tickets: [{ label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }] }],
      parentTotal: 80
    });
    expect(result.valid).toBe(false);
    expect(result.roundingPlan.differenceCents).toBe(-1000);
  });
});
