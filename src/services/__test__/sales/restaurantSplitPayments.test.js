import { describe, expect, it } from 'vitest';
import {
  buildRestaurantSplitPaymentPlan,
  calculateEqualPaymentCents,
  validateCustomPaymentCents
} from '../../sales/restaurantSplitPayments';

describe('restaurant monetary split payments', () => {
  it('distributes equal amounts in integer cents and assigns remainder cents deterministically', () => {
    expect(calculateEqualPaymentCents(10001, 3)).toMatchObject({
      valid: true,
      amountsCents: [3334, 3334, 3333]
    });
    expect(calculateEqualPaymentCents(2, 3)).toMatchObject({ valid: false, code: 'SPLIT_EQUAL_AMOUNT_TOO_SMALL' });
  });

  it('requires custom amounts to be positive and sum to the exact account total', () => {
    expect(validateCustomPaymentCents(10000, [3750, 6250])).toMatchObject({ valid: true, pendingCents: 0 });
    expect(validateCustomPaymentCents(10000, [3000, 6000])).toMatchObject({ valid: false, code: 'SPLIT_CUSTOM_INCOMPLETE' });
    expect(validateCustomPaymentCents(10000, [7000, 4000])).toMatchObject({ valid: false, code: 'SPLIT_CUSTOM_EXCEEDS_TOTAL' });
    expect(validateCustomPaymentCents(10000, [10000, 0])).toMatchObject({ valid: false, code: 'SPLIT_CUSTOM_AMOUNT_REQUIRED' });
  });

  it('aggregates cash, card and transfer into per-payer tender rows without changing the original total', () => {
    const equal = calculateEqualPaymentCents(10001, 3);
    const plan = buildRestaurantSplitPaymentPlan({
      splitIntent: 'equal_payment',
      totalCents: 10001,
      tickets: [
        { label: 'T1', amountCents: equal.amountsCents[0], paymentData: { paymentMethod: 'efectivo', amountPaid: '40.00' } },
        { label: 'T2', amountCents: equal.amountsCents[1], paymentData: { paymentMethod: 'tarjeta_debito', amountPaid: '33.34' } },
        { label: 'T3', amountCents: equal.amountsCents[2], paymentData: { paymentMethod: 'spei', amountPaid: '33.33' } }
      ]
    });

    expect(plan).toMatchObject({
      valid: true,
      amountPaidCents: 10001,
      cashAppliedCents: 3334,
      changeCents: 666,
      paymentMethod: 'mixed'
    });
    expect(plan.payments).toEqual([
      expect.objectContaining({ method: 'cash', amount: '33.34', received_amount: '40', change_amount: '6.66', metadata: { splitPayerId: 'T1', source: 'restaurant_split' } }),
      expect.objectContaining({ method: 'card', amount: '33.34', received_amount: '33.34', change_amount: '0', metadata: { splitPayerId: 'T2', source: 'restaurant_split' } }),
      expect.objectContaining({ method: 'transfer', amount: '33.33', received_amount: '33.33', change_amount: '0', metadata: { splitPayerId: 'T3', source: 'restaurant_split' } })
    ]);
    expect(plan.payers.map((payer) => payer.label)).toEqual(['T1', 'T2', 'T3']);
  });

  it('keeps a partial cash Fiado abono and its change separate from the credit balance', () => {
    const plan = buildRestaurantSplitPaymentPlan({
      splitIntent: 'custom_payment',
      totalCents: 12000,
      tickets: [
        { label: 'T1', amountCents: 7000, paymentData: { paymentMethod: 'fiado', amountPaid: '10', receivedAmount: '12', initialPaymentMethod: 'efectivo', customerId: 'customer-1' } },
        { label: 'T2', amountCents: 5000, paymentData: { paymentMethod: 'tarjeta', amountPaid: '50' } }
      ]
    });

    expect(plan).toMatchObject({
      valid: true,
      paymentMethod: 'fiado',
      amountPaid: '60',
      balanceDue: '60',
      cashApplied: '10',
      changeAmount: '2',
      customerId: 'customer-1'
    });
    expect(plan.payments).toEqual([
      expect.objectContaining({ method: 'cash', amount: '10', received_amount: '12', change_amount: '2', metadata: { splitPayerId: 'T1', source: 'restaurant_split' } }),
      expect.objectContaining({ method: 'card', amount: '50', received_amount: '50', change_amount: '0', metadata: { splitPayerId: 'T2', source: 'restaurant_split' } })
    ]);
  });

  it('does not count a card or transfer Fiado abono as physical cash and rejects multiple credit payers', () => {
    const cardInitialPlan = buildRestaurantSplitPaymentPlan({
      splitIntent: 'custom_payment',
      totalCents: 10000,
      tickets: [
        { label: 'T1', amountCents: 6000, paymentData: { paymentMethod: 'credit', amountPaid: '20', initialPaymentMethod: 'transfer', customerId: 'customer-1' } },
        { label: 'T2', amountCents: 4000, paymentData: { paymentMethod: 'card', amountPaid: '40' } }
      ]
    });
    expect(cardInitialPlan.valid).toBe(true);
    expect(cardInitialPlan.cashApplied).toBe('0');
    expect(cardInitialPlan.payments[0].method).toBe('transfer');

    const twoCreditPayers = buildRestaurantSplitPaymentPlan({
      splitIntent: 'custom_payment',
      totalCents: 10000,
      tickets: [
        { label: 'T1', amountCents: 5000, paymentData: { paymentMethod: 'credit', amountPaid: '0', customerId: 'customer-1' } },
        { label: 'T2', amountCents: 5000, paymentData: { paymentMethod: 'credit', amountPaid: '0', customerId: 'customer-2' } }
      ]
    });
    expect(twoCreditPayers).toMatchObject({ valid: false, code: 'SPLIT_MULTIPLE_CREDIT_PAGERS_UNSUPPORTED' });
  });
});
