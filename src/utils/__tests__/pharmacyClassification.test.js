import { describe, expect, it } from 'vitest';
import {
  getPharmacyClassification, hasChangedConfirmedClassification,
  isSpecialPharmacyProduct, pharmacyLegacyIndicators
} from '../pharmacyClassification';

const pharmacy = (fraction, antibiotic = false) => ({
  metadata: { pharmacy: { version: 1, kind: 'medicine', fraction, status: 'confirmed', antibiotic } }
});

describe('farmacia etapa 1 - clasificación legal y compatibilidad', () => {
  it.each(['I', 'II', 'III'])('fracción %s solo se registra fuera del checkout genérico', (fraction) => {
    const product = pharmacy(fraction);
    expect(isSpecialPharmacyProduct(product)).toBe(true);
    expect(pharmacyLegacyIndicators(product)).toEqual({
      prescriptionType: 'controlled', requiresPrescription: true
    });
  });
  it('fracción IV antibiótico tiene receta, sin inferir otra fracción', () => {
    const product = pharmacy('IV', true);
    expect(isSpecialPharmacyProduct(product)).toBe(false);
    expect(pharmacyLegacyIndicators(product)).toEqual({
      prescriptionType: 'antibiotic', requiresPrescription: true
    });
  });
  it('fracción IV no antibiótico no se confunde con controlado', () => {
    expect(pharmacyLegacyIndicators(pharmacy('IV'))).toEqual({
      prescriptionType: undefined, requiresPrescription: true
    });
  });
  it.each(['V', 'VI'])('fracción %s sin receta es explícita', (fraction) => {
    expect(pharmacyLegacyIndicators(pharmacy(fraction))).toEqual({
      prescriptionType: 'otc', requiresPrescription: false
    });
  });
  it('histórico no se convierte implícitamente en venta libre ni en fracción II', () => {
    const legacy = { prescriptionType: 'controlled', requiresPrescription: false };
    expect(getPharmacyClassification(legacy)).toMatchObject({ fraction: '', status: 'pending' });
    expect(pharmacyLegacyIndicators(legacy).requiresPrescription).toBe(true);
  });
  it('reclasiﬁcación o eliminación del marcador confirmado se detecta', () => {
    const old = pharmacy('II');
    expect(hasChangedConfirmedClassification(old, { metadata: {} })).toBe(true);
    expect(hasChangedConfirmedClassification(old, pharmacy('VI'))).toBe(true);
    expect(hasChangedConfirmedClassification(old, pharmacy('II'))).toBe(false);
  });
  it('producto no medicinal no se clasifica como medicamento', () => {
    expect(pharmacyLegacyIndicators({ metadata: { pharmacy: {
      kind: 'other', fraction: null, status: 'confirmed', antibiotic: false
    } } })).toEqual({ prescriptionType: 'otc', requiresPrescription: false });
  });
});
