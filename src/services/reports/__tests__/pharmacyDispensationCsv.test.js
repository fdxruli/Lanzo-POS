/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildPharmacyReport, generatePharmacyReport } from '../../dataTransfer';
import { parseCsvDocument } from '../../backup/portableDataTransfer';

describe('CSV auxiliar — serialización real', () => {
  it('neutraliza fórmulas y escapa Unicode, comas, comillas y saltos de línea', () => {
    const sale = {
      id: 'sal-rx', folio: 'F-123', timestamp: '2026-11-11T10:00:00Z', status: 'closed',
      items: [{
        id: 'p-rx', name: '=HYPERLINK("https://bad.invalid"), Ácido\nlínea 2',
        quantity: 1, requiresPrescription: true, sustancia: 'Ácido, "clavulánico"'
      }],
      prescriptionDetails: { doctorName: 'Dra. Ñ', licenseNumber: '123', notes: '+SUM(1,2)\nNota' }
    };
    const content = generatePharmacyReport([sale], { generatedAt: '2026-11-11T12:00:00Z' });
    const parsed = parseCsvDocument(content);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveLength(parsed[1].length);
    expect(parsed[1][5]).toBe('\'=HYPERLINK("https://bad.invalid"), Ácido\nlínea 2');
    expect(parsed[1][6]).toBe('Ácido, "clavulánico"');
    expect(parsed[1][12]).toBe("'+SUM(1,2)\nNota");
  });

  it('reporta recuento cero sin inventar filas y mantiene encabezados', () => {
    const output = buildPharmacyReport([]);
    expect(output.count).toBe(0);
    expect(parseCsvDocument(output.csv)).toHaveLength(1);
  });
});
