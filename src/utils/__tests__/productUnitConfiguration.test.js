import { describe, expect, it } from 'vitest';
import { normalizeProductUnit, resolveProductSaleUnit } from '../productUnitConfiguration';

describe('product unit configuration', () => {
  it.each([
    ['kg', 'kg'], ['kilo', 'kg'], ['pieza', 'pza'], ['gr', 'g'],
    ['litros', 'lt'], ['metros', 'mt'], ['PULGADAS', 'in'], ['galón', 'gal']
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeProductUnit(value)).toBe(expected);
  });

  it('preserves an unknown legacy value so the form can render a temporary option', () => {
    expect(normalizeProductUnit('medida-antigua')).toBe('medida-antigua');
  });

  it('uses the sale unit contract before legacy purchase data and chooses safe fallbacks', () => {
    expect(resolveProductSaleUnit({ bulkData: { sale: { unit: 'kg' }, purchase: { unit: 'caja' } } })).toBe('kg');
    expect(resolveProductSaleUnit({ saleType: 'bulk' })).toBe('kg');
    expect(resolveProductSaleUnit({ saleType: 'unit' })).toBe('pza');
  });
});
