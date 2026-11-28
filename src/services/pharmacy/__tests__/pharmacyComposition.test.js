import { describe, expect, it } from 'vitest';
import {
  formatCompositionActiveSubstance,
  formatCompositionConcentration,
  normalizeActiveIngredientEquivalenceKey,
  normalizeActiveIngredientIdentityKey,
  normalizePharmacyComposition
} from '../pharmacyComposition';

describe('pharmacy composition', () => {
  it('normalizes case, edge and repeated whitespace, accents, and canonical Unicode forms', () => {
    const variants = [
      'Paracetamol',
      'paracetamol',
      'PARACETAMOL',
      '  Paracetamol  ',
      'Paracetamól',
      'Paracetamo\u0301l'
    ];
    expect(new Set(variants.map(normalizeActiveIngredientEquivalenceKey))).toEqual(new Set(['paracetamol']));
    expect(normalizeActiveIngredientEquivalenceKey('  PARACETAMOL   500  ')).toBe('paracetamol 500');
    expect(normalizeActiveIngredientEquivalenceKey('Paracetamol XR')).not.toBe('paracetamol');
    expect(normalizeActiveIngredientIdentityKey('  PARACETAMÓL   ')).toBe('paracetamól');
    expect(normalizeActiveIngredientIdentityKey('Paracetamol')).not.toBe('paracetamól');
  });

  it('preserves decimal amounts, units and concentration bases in the canonical v1 shape', () => {
    const composition = normalizePharmacyComposition({
      version: 1,
      activeIngredients: [{
        activeIngredientId: 'ai-a', name: 'Paracetamol', amount: '125.5', unit: 'mg',
        basisAmount: '2', basisUnit: 'tabletas'
      }]
    });

    expect(composition).toEqual({ version: 1, activeIngredients: [{
      activeIngredientId: 'ai-a', name: 'Paracetamol', amount: 125.5, unit: 'mg',
      basisAmount: 2, basisUnit: 'tabletas'
    }] });
    expect(formatCompositionActiveSubstance(composition)).toBe('Paracetamol');
    expect(formatCompositionConcentration(composition)).toBe('125.5 mg por 2 tabletas');
  });

  it('rejects zero, invalid and duplicate active ingredient rows', () => {
    const row = { activeIngredientId: 'ai-a', name: 'Paracetamol', amount: 500,
      unit: 'mg', basisAmount: 1, basisUnit: 'tableta' };
    expect(normalizePharmacyComposition({ version: 1, activeIngredients: [{ ...row, amount: 0 }] })).toBeNull();
    expect(normalizePharmacyComposition({ version: 1, activeIngredients: [row, row] })).toBeNull();
  });
});
