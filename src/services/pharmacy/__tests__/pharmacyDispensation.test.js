import { describe, expect, it, vi } from 'vitest';
import {
  pharmacyPrescriptionRequirement,
  validatePharmacyLine,
  attachPharmacyDispensations,
  validateLocalPharmacyDispensations
} from '../pharmacyDispensation';

const antibiotic = {
  id: 'med-1',
  metadata: { pharmacy: { kind: 'medicine', fraction: 'IV', status: 'confirmed', antibiotic: true } },
  requiresPrescription: true
};
const rx = (overrides = {}) => ({
  reference: 'RX-001',
  prescriberName: 'Profesional Ejemplo',
  prescriberLicense: '12345678',
  prescriberAddress: 'Domicilio institucional de ejemplo',
  issuedOn: '2026-11-01',
  treatmentUntil: '2026-12-31',
  prescribedQuantity: 20,
  stampDeclared: true,
  retentionDeclared: false,
  ...overrides
});
const line = (quantity, overrides = {}) => ({
  id: 'med-1',
  name: 'Producto de prueba',
  quantity,
  pharmacyDispensationV1: rx(),
  ...overrides
});
const sale = (id, quantity, overrides = {}) => ({
  id, status: 'closed', items: [line(quantity, overrides)]
});
const salesTable = (history) => ({ toArray: vi.fn().mockResolvedValue(history) });
describe('Etapa 3: receta y saldo transaccional Local', () => {
  it('clasifica antibiótico independientemente de su fracción', () => {
    expect(pharmacyPrescriptionRequirement(antibiotic)).toMatchObject({ required: true, antibiotic: true, forbidden: false });
    const fV = { metadata: { pharmacy: { kind: 'medicine', fraction: 'V', status: 'confirmed', antibiotic: true } } };
    expect(pharmacyPrescriptionRequirement(fV).required).toBe(true);
    const fII = { metadata: { pharmacy: { kind: 'medicine', fraction: 'II', status: 'confirmed', antibiotic: false } } };
    expect(pharmacyPrescriptionRequirement(fII).forbidden).toBe(true);
  });
  it('no agrega formulario a productos comunes', () => {
    const ordinary = { id: 'bread', metadata: { pharmacy: { kind: 'other' } } };
    const actual = attachPharmacyDispensations([{ id: 'bread', quantity: 1 }], new Map([['bread', ordinary]]), null, { hasLabFields: true });
    expect(actual[0].pharmacyDispensationV1).toBeUndefined();
  });
  it('vincula receta a su índice original de línea y valida declaración', () => {
    const cart = [{ id: 'regular', quantity: 1 }, { id: 'med-1', quantity: 5 }];
    const products = new Map([['regular', { id: 'regular' }], ['med-1', antibiotic]]);
    const result = attachPharmacyDispensations(cart, products, { lines: { 1: rx() } }, { hasLabFields: true });
    expect(result[0].pharmacyDispensationV1).toBeUndefined();
    expect(result[1].pharmacyDispensationV1).toMatchObject({ version: 1, reference: 'RX-001' });
    expect(() => attachPharmacyDispensations(cart, products, { lines: { 0: rx() } }, { hasLabFields: true }))
      .toThrow('PHARMACY_PRESCRIPTION_REQUIRED');
  });
  it('rechaza medicamento sin sellado declarado', () => {
    expect(() => validatePharmacyLine(rx({ stampDeclared: false }), 8, { antibiotic: true }))
      .toThrow('PHARMACY_PRESCRIPTION_STAMP_REQUIRED');
  });
  it('permite 8 y luego 7; rechaza 6 y admite 5 restantes', async () => {
    await expect(validateLocalPharmacyDispensations(
      { ...sale('sale-a', 8) }, salesTable([])
    )).resolves.toBeUndefined();
    await expect(validateLocalPharmacyDispensations(
      { ...sale('sale-b', 7) }, salesTable([sale('sale-a', 8)])
    )).resolves.toBeUndefined();
    await expect(validateLocalPharmacyDispensations(
      sale('sale-c', 6), salesTable([sale('sale-a', 8), sale('sale-b', 7)])
    )).rejects.toThrow('PHARMACY_PRESCRIPTION_BALANCE_EXCEEDED');
    await expect(validateLocalPharmacyDispensations(
      sale('sale-c', 5, { pharmacyDispensationV1: rx({ retentionDeclared: true }) }),
      salesTable([sale('sale-a', 8), sale('sale-b', 7)])
    )).resolves.toBeUndefined();
  });
  it('no cuenta dos veces un reintento de una venta previamente confirmada', async () => {
    await expect(validateLocalPharmacyDispensations(
      sale('sale-a', 8), salesTable([sale('sale-a', 8)])
    )).resolves.toBeUndefined();
  });
  it('no permite reutilizar una receta retenida', async () => {
    await expect(validateLocalPharmacyDispensations(
      sale('sale-next', 1), salesTable([sale('sale-final', 20, { pharmacyDispensationV1: rx({ retentionDeclared: true }) })])
    )).rejects.toThrow('PHARMACY_PRESCRIPTION_ALREADY_RETAINED');
  });
  it('rechaza discrepancias de cantidad prescrita con historial', async () => {
    await expect(validateLocalPharmacyDispensations(
      sale('sale-b', 5, { pharmacyDispensationV1: rx({ prescribedQuantity: 30 }) }),
      salesTable([sale('sale-a', 8)])
    )).rejects.toThrow('PHARMACY_PRESCRIPTION_QUANTITY_CONFLICT');
  });
});
