import { describe, expect, it } from 'vitest';
import {
  normalizeEcommerceWholesaleTiers,
  resolveEcommerceUnitPrice
} from '../ecommerceWholesalePricing';

describe('public wholesale pricing', () => {
  it('normalizes, orders and assigns stable references', () => {
    const result = normalizeEcommerceWholesaleTiers([
      { min: 12, price: 19 },
      { min: 6, price: 21 }
    ], { productRef: 'p1', replacementCost: 10 });
    expect(result.tiers.map((tier) => tier.minQuantity)).toEqual([6, 12]);
    expect(result.tiers[0].sourceTierRef).toBe('min:6');
  });

  it('rejects duplicates, invalid values and prices below cost', () => {
    const result = normalizeEcommerceWholesaleTiers([
      { min: 6, price: 9 },
      { min: 6, price: 11 },
      { min: 0, price: -1 }
    ], { replacementCost: 10 });
    expect(result.warnings).toEqual(expect.arrayContaining([
      'WHOLESALE_TIER_DUPLICATE_QUANTITY',
      'WHOLESALE_TIER_INVALID',
      'WHOLESALE_TIER_BELOW_COST'
    ]));
    expect(result.valid).toBe(false);
  });

  it('keeps standard pricing when wholesale is disabled or below minimum', () => {
    expect(resolveEcommerceUnitPrice({
      baseUnitPrice: 24,
      quantity: 12,
      wholesaleEnabled: false,
      tiers: [{ minQuantity: 6, unitPrice: 21 }]
    }).appliedUnitPrice).toBe(24);
    expect(resolveEcommerceUnitPrice({
      baseUnitPrice: 24,
      quantity: 5,
      wholesaleEnabled: true,
      tiers: [{ minQuantity: 6, unitPrice: 21 }]
    }).pricingMode).toBe('standard');
  });

  it('applies the greatest reached tier', () => {
    const result = resolveEcommerceUnitPrice({
      baseUnitPrice: 24,
      quantity: 13,
      wholesaleEnabled: true,
      tiers: [
        { sourceTierRef: 'six', minQuantity: 6, unitPrice: 21 },
        { sourceTierRef: 'twelve', minQuantity: 12, unitPrice: 19 }
      ]
    });
    expect(result).toMatchObject({
      pricingMode: 'wholesale',
      appliedUnitPrice: 19,
      wholesaleMinQuantity: 12,
      wholesaleTierRef: 'twelve'
    });
  });

  it('applies wholesale to the product base before signed variant and option adjustments', () => {
    expect(resolveEcommerceUnitPrice({
      baseUnitPrice: 100,
      quantity: 6,
      wholesaleEnabled: true,
      variantAdjustment: 20,
      optionsAdjustment: 5,
      tiers: [{ sourceTierRef: 'min:6', minQuantity: 6, unitPrice: 80 }]
    })).toMatchObject({
      pricingMode: 'wholesale',
      wholesaleBaseUnitPrice: 80,
      variantAdjustment: 20,
      optionsAdjustment: 5,
      appliedUnitPrice: 105
    });
  });

  it('allows a negative variant adjustment and clamps only the final price', () => {
    expect(resolveEcommerceUnitPrice({
      baseUnitPrice: 100,
      quantity: 6,
      wholesaleEnabled: true,
      variantAdjustment: -20,
      optionsAdjustment: 5,
      tiers: [{ minQuantity: 6, unitPrice: 80 }]
    }).appliedUnitPrice).toBe(65);
    expect(resolveEcommerceUnitPrice({
      baseUnitPrice: 10,
      quantity: 1,
      variantAdjustment: -20
    }).appliedUnitPrice).toBe(0);
  });
});
