import { describe, expect, it } from 'vitest';
import { assertValidRecipeReferences } from '../ingredientConfiguration';

const ingredient = (id, unit = 'kg') => ({
  id, name: id, productType: 'ingredient', trackStock: true, isActive: true, unit
});

describe('recipe persistence integrity', () => {
  it('allows zero-stock ingredients and valid fractional units', () => {
    expect(assertValidRecipeReferences(
      [{ ingredientId: 'chicken', quantity: 0.15, unit: 'kg' }, { ingredientId: 'bread', quantity: 2, unit: 'pza' }],
      [{ ...ingredient('chicken'), stock: 0 }, ingredient('bread', 'pza')]
    )).toBe(true);
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'wrong'])('rejects invalid quantity %s', (quantity) => {
    expect(() => assertValidRecipeReferences(
      [{ ingredientId: 'chicken', quantity, unit: 'kg' }], [ingredient('chicken')]
    )).toThrow();
  });
  it('rejects missing, duplicate, inactive, foreign and mismatched-unit ingredients', () => {
    const item = { ingredientId: 'chicken', quantity: 1, unit: 'kg' };
    expect(() => assertValidRecipeReferences([item], [])).toThrow();
    expect(() => assertValidRecipeReferences([item, item], [ingredient('chicken')])).toThrow();
    expect(() => assertValidRecipeReferences([item], [{ ...ingredient('chicken'), isActive: false }])).toThrow();
    expect(() => assertValidRecipeReferences([item], [{ ...ingredient('chicken'), licenseId: 'other' }], { licenseId: 'current' })).toThrow();
    expect(() =¶»§q«^