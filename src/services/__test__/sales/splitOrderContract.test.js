import { describe, expect, it } from 'vitest';
import {
  buildByItemsRoundingAdjustments,
  normalizeRestaurantSplitIntent,
  RESTAURANT_SPLIT_INTENTS,
  roundSplitAmountToCents,
  splitHasCashPayment
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
  });
});
