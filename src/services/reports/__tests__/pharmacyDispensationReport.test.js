import { describe, expect, it } from 'vitest';
import { buildPharmacyDispensationRows as build } from '../pharmacyDispensationReport';

const item = overrides => ({
  id: 'med-1', name: 'Amoxicilina', quantity: 2, activeSubstance: 'AMOXICILINA',
  prescriptionType: 'antibiotic', requiresPrescription: true, ...overrides
});
const sale = overrides => ({
  id: 'sal-1', folio: 'F-000024', timestamp: '2026-11-11T10:05:06Z', status: 'closed',
  items: [item()],
  prescriptionDetails: { doctorName: 'Dra. Ana', licenseNumber: '123456', notes: 'RX 33' },
  ...overrides
});
const report = sales => build(sales, { generatedAt: '2026-11-11T12:00:00Z' });

describe('reporte auxiliar de dispensaciones, snapshots históricos', () => {
  it('una venta cerrada con receta genera una sola línea con folio y contexto local', () => {
    const result = report([sale()]);
    expect(result.count).toBe(1);
    expect(result.issueRows).toBe(0);
    expect(result.activeRows).toBe(1);
    expect(result.rows[0].slice(0, 13)).toEqual([
      '2026-11-11', '10:05:06', 'F-000024', 'sal-1', 'med-1', 'Amoxicilina',
      'AMOXICILINA', 2, 'antibiotic', 'SI', 'Dra. Ana', '123456', 'RX 33'
    ]);
    expect(result.rows[0][19]).toBe('2026-11-11T10:05:06.000Z');
    expect(result.origin).toMatch(/IndexedDB local/);
  });

  it('detecta antibiótico aun con requiresPrescription=false y marca contradicción', () => {
    const result = report([sale({ items: [item({ requiresPrescription: false })] })]);
    expect(result.count).toBe(1);
    expect(result.rows[0][9]).toBe('NO');
    expect(result.rows[0][16]).toMatch(/Antibiótico marcado/);
  });

  it('incluye línea identificable solo por requiresPrescription=true', () => {
    const result = report([sale({ items: [item({ prescriptionType: undefined })] })]);
    expect(result.count).toBe(1);
    expect(result.rows[0][8]).toBe('');
  });

  it('no descarta registros sin datos de receta y señala médico y cédula', () => {
    const result = report([sale({ prescriptionDetails: null })]);
    expect(result.count).toBe(1);
    expect(result.rows[0][10]).toBe('');
    expect(result.rows[0][16]).toMatch(/Nombre del médico ausente/);
    expect(result.rows[0][16]).toMatch(/Cédula profesional ausente/);
  });

  it('señala cédula ausente aunque haya médico; ignora relleno N/A', () => {
    const result = report([sale({ prescriptionDetails: { doctorName: 'Dra. Ana', licenseNumber: 'N/A' } })]);
    expect(result.rows[0][10]).toBe('Dra. Ana');
    expect(result.rows[0][11]).toBe('');
    expect(result.rows[0][16]).toMatch(/Cédula profesional ausente/);
  });

  it('recupera sustancia del nombre heredado sin usar catálogo vigente', () => {
    const result = report([sale({ items: [item({ activeSubstance: undefined, sustancia: 'Penicilina' })] })]);
    expect(result.rows[0][6]).toBe('Penicilina');
  });

  it('sustancia ausente queda vacía e incidencia explícita', () => {
    const result = report([sale({ items: [item({ activeSubstance: undefined, sustancia: undefined })] })]);
    expect(result.rows[0][6]).toBe('');
    expect(result.rows[0][16]).toMatch(/Sustancia activa no preservada/);
  });

  it('usa ID estable sin fabricar folio cuando folio operativo falta', () => {
    const result = report([sale({ folio: undefined })]);
    expect(result.rows[0][2]).toBe('sal-1');
    expect(result.rows[0][16]).toMatch(/Folio operativo ausente/);
  });

  it('snapshot real de processSaleCore: venta closed sin fulfillmentStatus sigue siendo venta', () => {
    const persisted = sale({ status: 'closed', fulfillmentStatus: undefined });
    const result = report([persisted]);
    expect(result.rows[0][13]).toBe('CERRADA');
    expect(result.rows[0][14]).toBe('REGISTRO DE VENTA');
    expect(result.activeRows).toBe(1);
  });

  it('snapshot status cancelled sin fulfillmentStatus está anulado, nunca vigente', () => {
    const result = report([sale({ status: 'cancelled', fulfillmentStatus: undefined })]);
    expect(result.rows[0][13]).toBe('ANULADA');
    expect(result.rows[0][14]).toBe('NO VIGENTE');
    expect(result.activeRows).toBe(0);
    expect(result.issueRows).toBe(1);
  });

  it('status requires_review sin fulfillmentStatus es pendiente, no venta confirmada', () => {
    const result = report([sale({ status: 'requires_review', fulfillmentStatus: undefined })]);
    expect(result.rows[0][13]).toBe('requires_review');
    expect(result.rows[0][14]).toBe('PENDIENTE DE REVISIÓN');
    expect(result.activeRows).toBe(0);
  });

  it('marca cancelación Cloud aunque el estado de venta no haya cambiado', () => {
    const result = report([sale({ cancelledAt: '2026-11-11T11:00:00Z' })]);
    expect(result.rows[0][13]).toBe('ANULADA');
    expect(result.rows[0][14]).toBe('NO VIGENTE');
    expect(result.activeRows).toBe(0);
    expect(result.issueRows).toBe(1);
  });

  it('no interpreta orden abierta o requires_review como venta dispensada', () => {
    const result = report([sale({ status: 'open' }), sale({ id: 'sal-2', status: 'requires_review' })]);
    expect(result.count).toBe(2);
    expect(result.activeRows).toBe(0);
    expect(result.issueRows).toBe(2);
    expect(result.rows.every(row => row[14] === 'PENDIENTE DE REVISIÓN')).toBe(true);
  });

  it('receta a nivel de venta sin clasificación atribuible deja fila explícita no asignada', () => {
    const result = report([sale({ items: [item({ prescriptionType: undefined, requiresPrescription: undefined })] })]);
    expect(result.count).toBe(1);
    expect(result.rows[0][5]).toBe('');
    expect(result.rows[0][7]).toBe('');
    expect(result.rows[0][16]).toMatch(/sin línea de medicamento atribuible/);
  });

  it('un registro sin indicadores ni receta no se inventa; no hay falsa garantía de exhaustividad', () => {
    const result = report([sale({ items: [item({ prescriptionType: undefined, requiresPrescription: undefined })], prescriptionDetails: null })]);
    expect(result.count).toBe(0);
  });

  it('no atribuye receta al producto OTC cuando otra línea sí es identificable', () => {
    const result = report([sale({ items: [
      item({ name: 'Antibiótico', id: 'a' }),
      item({ name: 'Paracetamol', id: 'b', prescriptionType: 'otc', requiresPrescription: false })
    ] })]);
    expect(result.count).toBe(1);
    expect(result.rows[0][5]).toBe('Antibiótico');
  });

  it('metadatos indican periodo y número de incidencias reales', () => {
    const result = report([sale(), sale({ id: 'sal-2', folio: null, timestamp: '2026-11-10T09:00:00Z' })]);
    expect(result.count).toBe(2);
    expect(result.issueRows).toBe(1);
    expect(result.rows[0].slice(-6)).toEqual([
      '2026-11-11T12:00:00.000Z',
      '2026-11-10T09:00:00.000Z', '2026-11-11T10:05:06.000Z',
      result.origin, 2, 1
    ]);
  });
});
