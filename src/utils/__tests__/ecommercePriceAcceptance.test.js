import { describe, expect, it } from 'vitest';
import {
  buildAcceptedEcommerceOrderItems,
  getAcceptedEcommerceSubtotal,
  haveSameAcceptedEcommerceEconomics
} from '../ecommercePriceAcceptance';

const line = (overrides = {}) => ({
  product: { id: 'product-1' },
  quantity: 2,
  pricingMode: 'standard',
  baseUnitPrice: 10,
  wholesaleBaseUnitPrice: null,
  appliedUnitPrice: 10,
  wholesaleTierRef: null,
  wholesaleMinQuantity: null,
  variantAdjustment: 0,
  optionsAdjustment: 0,
  lineTotal: '20.00',
  ...overrides
});

describe('ecommercePriceAcceptance', () => {
  it('builds an exact decimal acceptance contract for each cart line', () => {
    expect(buildAcceptedEcommerceOrderItems([line()])).toEqual([{
      productId: 'product-1',
      quantity: 2,
      acceptedPricing: {
        pricingMode: 'standard',
        baseUnitPrice: '10.00',
        wholesaleBaseUnitPrice: null,
        appliedUnitPrice: '10.00',
        wholesaleTierRef: null,
        wholesaleMinQuantity: null,
        variantAdjustment: '0.00',
        optionsAdjustment: '0.00',
        lineTotal: '20.00'
      }
    }]);
  });

  it('detects price increases and decreases without using catalog revisions', () => {
    const accepted = buildAcceptedEcommerceOrderItems([line()]);
    const descriptionOnlyChange = line({ product: { id: 'product-1', description: 'Nuevo texto' } });
    const priceIncrease = line({ baseUnitPrice: 12, appliedUnitPrice: 12, lineTotal: '24.00' });
    const priceDecrease = line({ baseUnitPrice: 8, appliedUnitPrice: 8, lineTotal: '16.00' });

    expect(haveSameAcceptedEcommerceEconomics(accepted, [descriptionOnlyChange])).toBe(true);
    expect(haveSameAcceptedEcommerceEconomics(accepted, [priceIncrease])).toBe(false);
    expect(haveSameAcceptedEcommerceEconomics(accepted, [priceDecrease])).toBe(false);
  });

  it('detects cart composition and quantity changes and sums decimal line totals', () => {
    const accepted = buildAcceptedEcommerceOrderItems([
      line({ quantity: 1, appliedUnitPrice: 0.1, baseUnitPrice: 0.1, lineTotal: '0.10' }),
      line({
        product: { id: 'product-2' }, quantity: 1,
        baseUnitPrice: 0.2, appliedUnitPrice: 0.2, lineTotal: '0.20'
      })
    ]);

    expect(getAcceptedEcommerceSubtotal(accepted)).toBe('0.30');
    expect(haveSameAcceptedEcommerceEconomics(accepted, [line()])).toBe(false);
  });

  it('rejects missing, malformed, negative, and out-of-range money instead of treating it as zero', () => {
    [
      { baseUnitPrice: null },
      { baseUnitPrice: 'no es precio' },
      { baseUnitPrice: -1 },
      { baseUnitPrice: '10000000000' },
      { appliedUnitPrice: undefined },
      { appliedUnitPrice: 'NaN' },
      { lineTotal: null },
      { variantAdjustment: 'invalido' },
      { optionsAdjustment: '10000000000' }
    ].forEach((override) => {
      expect(buildAcceptedEcommerceOrderItems([line(override)])).toBeNull();
    });
    expect(getAcceptedEcommerceSubtotal(null)).toBeNull();
  });

  it('keeps legitimate zero prices and rejects inconsistent line arithmetic', () => {
    const freeLine = line({
      quantity: 1,
      baseUnitPrice: 0,
      appliedUnitPrice: 0,
      lineTotal: '0.00'
    });
    expect(buildAcceptedEcommerceOrderItems([freeLine])).toHaveLength(1);
    expect(buildAcceptedEcommerceOrderItems([line({ lineTotal: '19.99' })])).toBeNull();
  });
});
