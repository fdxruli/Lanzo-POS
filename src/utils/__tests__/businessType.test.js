import { describe, expect, it } from 'vitest';
import { normalizeBusinessType, normalizeBusinessTypes, normalizeBusinessTypesForPersistence } from '../businessType';

describe('businessType normalization', () => {
  it('persists canonical and historical restaurant representations without losing other rubros', () => {
    expect(normalizeBusinessTypesForPersistence(['food_service'])).toEqual(['food_service']);
    expect(normalizeBusinessTypesForPersistence('{restaurante,hardware,food_service}')).toEqual(['food_service', 'hardware']);
    expect(normalizeBusinessTypesForPersistence(['farmacia', 'restaurante', 'farmacia'])).toEqual(['farmacia', 'food_service']);
    expect(normalizeBusinessTypesForPersistence(['antojitos', 'darkitchen'])).toEqual(['antojitos', 'darkitchen']);
  });

  it.each([[['unknown']], [['hardware', 'unknown']], [[42]]])('rejects unknown persistence input %j instead of using otro', (value) => {
    expect(() => normalizeBusinessTypesForPersistence(value)).toThrow('rubro');
  });
  it('normalizes food service aliases', () => {
    expect(normalizeBusinessType('food_service')).toBe('food_service');
    expect(normalizeBusinessType('restaurante')).toBe('food_service');
    expect(normalizeBusinessType('dark-kitchen')).toBe('food_service');
    expect(normalizeBusinessType('cocina')).toBe('food_service');
  });

  it('normalizes pharmacy aliases', () => {
    expect(normalizeBusinessType('farmacia')).toBe('farmacia');
    expect(normalizeBusinessType('pharmacy')).toBe('farmacia');
    expect(normalizeBusinessType('drogueria')).toBe('farmacia');
  });

  it('normalizes fruit and vegetable aliases', () => {
    expect(normalizeBusinessType('verduleria/fruteria')).toBe('verduleria/fruteria');
    expect(normalizeBusinessType('fruteria')).toBe('verduleria/fruteria');
    expect(normalizeBusinessType('verduleria')).toBe('verduleria/fruteria');
  });

  it('normalizes retail aliases and deduplicates arrays', () => {
    expect(normalizeBusinessType('tienda')).toBe('abarrotes');
    expect(normalizeBusinessType('minimarket')).toBe('abarrotes');
    expect(normalizeBusinessType('boutique')).toBe('apparel');
    expect(normalizeBusinessType('ferreteria')).toBe('hardware');
    expect(normalizeBusinessTypes(['tienda', 'abarrotes', 'farmacia'])).toEqual(['abarrotes', 'farmacia']);
  });
});

