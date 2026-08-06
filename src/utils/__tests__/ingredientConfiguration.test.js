import { describe, expect, it } from 'vitest';
import { getIngredientDefaultUnit, getRecipeIngredientId } from '../ingredientConfiguration';

describe('ingredient configuration helpers', () => {
  it('resolves default units consistently for unit and bulk ingredients', () => {
    expect(getIngredientDefaultUnit({ saleType: 'unit' })).toBe('pza');
    expect(getIngredientDefaultUnit({ saleType: 'bulk' })).toBe('kg');
    expect(getIngredientDefaultUnit({ bulkData: { purchase: { unit: 'lt' } } })).toBe('lt');
    expect(getIngredientDefaultUnit({ unit: 'gr', saleType: 'bulk' })).toBe('gr');
  });

  it('uses ingredientId first while supporting legacy productId', () => {
    expect(getRecipeIngredientId({ ingredientId: 'new', productId: 'old' })).toBe('new');
    expect(getRecipeIngredientId({ productId: 'old' })).toBe('old');
    expect(getRecipeIngredientId({})).toBeNull();
  });
});
