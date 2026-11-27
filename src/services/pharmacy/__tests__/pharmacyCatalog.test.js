import { describe, expect, it } from 'vitest';
import { normalizePharmacyComposition } from '../pharmacyComposition';
import {
  formatPharmacyCommercialPresentation,
  isPharmacyMeasureCompatibleWithBase,
  normalizePharmacyCommercialPresentation,
  normalizePharmacyMeasureUnit
} from '../pharmacyCatalog';

describe('pharmacy catalog vocabulary', () => {
  it('normalizes explicit symbol aliases without converting measured quantities', () => {
    expect(normalizePharmacyMeasureUnit('Mg')).toBe('mg');
    expect(normalizePharmacyMeasureUnit('mcg')).toBe('µg');
    expect(normalizePharmacyMeasureUnit('μg')).toBe('µg');
    expect(normalizePharmacyMeasureUnit('mL')).toBe('mL');
    expect(normalizePharmacyMeasureUnit('g')).toBe('g');
    expect(normalizePharmacyMeasureUnit('1 mg/mL')).toBe('');

    expect(normalizePharmacyComposition({ version: 1, activeIngredients: [{
      activeIngredientId: 'ai-1', name: 'Principio', amount: '0.125', unit: 'MG', basisAmount: '5', basisUnit: 'mL'
    }] })).toMatchObject({ activeIngredients: [{ amount: 0.125, unit: 'mg', basisAmount: 5, basisUnit: 'mL' }] });
  });

  it('requires an explicit base and keeps percentage dimensions paired with their basis', () => {
    expect(normalizePharmacyComposition({ version: 1, activeIngredients: [{
      activeIngredientId: 'ai-1', name: 'Principio', amount: 500, unit: 'mg', basisAmount: 1, basisUnit: ''
    }] })).toBeNull();
    expect(isPharmacyMeasureCompatibleWithBase('% m/m', 'g')).toBe(true);
    expect(isPharmacyMeasureCompatibleWithBase('% m/m', 'mL')).toBe(false);
    expect(isPharmacyMeasureCompatibleWithBase('% m/v', 'mL')).toBe(true);
  });

  it('normalizes and formats a decimal commercial presentation as a separate description', () => {
    const normalized = normalizePharmacyCommercialPresentation({
      version: 1, packageType: 'bottle', contentAmount: '120.5', contentUnit: 'mL'
    });
    expect(normalized).toEqual({ version: 1, packageType: 'bottle', contentAmount: 120.5, contentUnit: 'mL' });
    expect(formatPharmacyCommercialPresentation(normalized)).toBe('Frasco con 120.5 mL');
    expect(formatPharmacyCommercialPresentation({
      version: 1, packageType: 'box', contentAmount: 1, contentUnit: 'tableta'
    })).toBe('Caja con 1 tableta');
    expect(normalizePharmacyCommercialPresentation({
      version: 1, packageType: 'other', contentAmount: 10, contentUnit: 'tableta'
    })).toBeNull();
  });
});
