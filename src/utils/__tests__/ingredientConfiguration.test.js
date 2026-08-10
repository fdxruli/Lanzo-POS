import { describe, expect, it } from 'vitest';
import { getIngredientDefaultUnit, getRecipeIngredientId, getSaleTypeForIngredientUnit, normalizeIngredientUnit } from '../ingredientConfiguration';

describe('ingredient configuration helpers', () => {
  it('resolves default units consistently for unit and bulk ingredients', () => {
    expect(getIngredientDefaultUnit({ saleType: 'unit' })).toBe('pza');
    expect(getIngredientDefaultUnit({ saleType: 'bulk' })).toBe('kg');
    expect(getIngredientDefaultUnit({ bulkData: { purchase: { unit: 'lt' } } })).toBe('lt');
    expect(getIngredientDefaultUnit({ unit: 'gr', saleType: 'bulk' })).toBe('g');
  });

  it.each([
    ['kg', 'kg'], ['kilo', 'kg'], ['kilogramos', 'kg'],
    ['g', 'g'], ['gr', 'g'], ['gramos', 'g'],
    ['lt', 'lt'], ['litros', 'lt'], ['L', 'lt'],
    ['ml', 'ml'], ['pieza', 'pza'], ['unidad', 'pza']
  ])('normalizes legacy unit %s to %s', (value, expected) => {
    expect(normalizeIngredientUnit(value)).toBe(expected);
  });

  it.each([['pza', 'unit'], ['kg', 'bulk'], ['g', 'bulk'], ['lt', 'bulk'], ['ml', 'bulk']])('derives %s sale type as %s', (unit, saleType) => {
    expect(getSaleTypeForIngredientUnit(unit)).toBe(saleType);
  });

  it('uses ingredientId first while supporting legacy productId', () => {
    expect(getRecipeIngredientId({ ingredientId: 'new', productId: 'old' })).toBe('new');
    expect(getRecipeIngredientId({ productId: 'old' })).toBe('old');
    expect(getRecipeIngredientId({})).toBeNull();
  });
});
