import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticLimitations,
  buildDiagnosticViewModel,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercentage,
  formatSeverity
} from '../diagnosticPresentation';

const period = {
  from: '2026-09-01T06:00:00.000Z',
  to: '2026-10-01T06:00:00.000Z',
  timezone: 'America/Mexico_City'
};

describe('diagnostic presentation', () => {
  it('formats money, numbers, percentages and dates with human fallbacks', () => {
    expect(formatCurrency(1250)).toBe('$1,250.00');
    expect(formatNumber(1250)).toBe('1,250');
    expect(formatPercentage(33.14)).toBe('33.1%');
    expect(formatDate('2026-09-20T06:00:00.000Z')).toBe('20 de septiembre de 2026');
    expect(formatCurrency(null)).toBe('No disponible');
    expect(formatNumber(undefined)).toBe('No disponible');
    expect(formatPercentage(Number.NaN)).toBe('No disponible');
    expect(formatCurrency({})).toBe('No disponible');
  });

  it('maps technical diagnostics to a human visual model without raw objects', () => {
    const model = buildDiagnosticViewModel({
      diagnosticType: 'inventory',
      rangeLabel: 'Últimos 30 días',
      diagnostic: {
        source: 'mixed',
        period,
        metrics: { productsWithoutStock: 1, capitalDetained: 1250 },
        coverage: { salesAnalyzed: 62, productsAnalyzed: 70, customersAnalyzed: 4, missingFields: ['cost:p-1'] },
        findings: [{
          id: 'inventory-low-stock',
          severity: 'warning',
          title: 'Stock bajo',
          description: 'Un producto necesita revisión.',
          evidence: [{ name: 'Paracetamol 500 mg', stock: 2, minStock: 10 }],
          formula: 'stock - committed_stock <= min_stock',
          actionRoute: '/productos'
        }],
        warnings: []
      },
      currency: 'MXN'
    });

    expect(model.sourceLabel).toBe('Datos mixtos: cloud + información local complementaria');
    expect(model.severityLabel).toBe('Atención');
    expect(model.actions[0]).toMatchObject({ label: 'Revisar', route: '/productos' });
    expect(model.coverage.summary).toContain('62 ventas');
    expect(model.coverage.summary).toContain('70 productos');
    expect(model.kpis.find((kpi) => kpi.key === 'capitalDetained').displayValue).toBe('$1,250.00');
    expect(model.findings[0].details).toEqual([
      { label: 'Producto', value: 'Paracetamol 500 mg' },
      { label: 'Stock actual', value: '2' },
      { label: 'Mínimo configurado', value: '10' },
      { label: 'Riesgo', value: 'Medio' }
    ]);
    expect(model.findings[0].description).not.toContain('stock - committed_stock');
    expect(model.coverage.missingFields).toEqual(['costo de producto']);
  });

  it('presents incomplete financial margins explicitly', () => {
    const model = buildDiagnosticViewModel({
      diagnosticType: 'financial',
      rangeLabel: 'Hoy',
      diagnostic: {
        source: 'cloud',
        period,
        metrics: { grossMargin: null, missingCostItems: 4, itemsSold: 70 },
        coverage: { salesAnalyzed: 62, productsAnalyzed: 0, customersAnalyzed: 0, missingFields: ['pos_sale_items.unit_cost'] },
        findings: [{
          id: 'financial-missing-costs',
          severity: 'warning',
          title: 'Costos incompletos',
          evidence: [{ missingCostItems: 4, missingCostRevenue: 500 }]
        }],
        warnings: []
      }
    });

    expect(model.kpis.find((kpi) => kpi.key === 'grossMargin').displayValue).toBe('No disponible');
    expect(model.warnings.join(' ')).toContain('4 registros no tienen todos los campos necesarios para la utilidad y el margen. No se estimaron valores.');
    expect(model.warnings.join(' ')).not.toContain('no se sustituyeron silenciosamente');
    expect(model.findings[0].details[0]).toEqual({ label: 'Venta sin costo confirmado', value: '$500.00' });
    expect(model.coverage.missingFields).toEqual(['costos unitarios']);
  });

  it('uses Spanish severity labels', () => {
    expect(formatSeverity('info')).toBe('Informativo');
    expect(formatSeverity('warning')).toBe('Atención');
    expect(formatSeverity('critical')).toBe('Crítico');
  });

  it('groups specific inventory gaps without duplicating a generic warning', () => {
    const model = buildDiagnosticViewModel({
      diagnosticType: 'inventory',
      diagnostic: {
        source: 'mixed',
        period,
        metrics: {},
        coverage: { salesAnalyzed: 4, productsAnalyzed: 2, missingFields: ['min_stock', 'cost:p-1'] },
        warnings: ['Hay campos faltantes o inválidos; no se sustituyeron silenciosamente por valores confiables.']
      },
      products: [
        { id: 'p-1', trackStock: true, stock: 3, committedStock: 0 },
        { id: 'p-2', trackStock: true, stock: 5, committedStock: 0, minStock: 2, cost: 10 }
      ]
    });

    expect(model.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'missing-min-stock',
        message: 'Stock mínimo no configurado en 1 producto. El cálculo de stock bajo no incluye ese producto.'
      }),
      expect.objectContaining({ id: 'incomplete-inventory-costs' }),
      expect.objectContaining({
        id: 'local-batch-source',
        tone: 'info',
        message: 'Fuente de lotes: datos locales de este dispositivo. Puede no incluir cambios realizados desde otros dispositivos.'
      })
    ]));
    expect(model.limitations.filter((item) => item.id === 'incomplete-inventory-records')).toHaveLength(0);
    expect(model.limitations.map((item) => item.message).join(' ')).not.toContain('no se sustituyeron silenciosamente');
  });

  it('hides limitations when counts are zero and ignores raw JSON warnings', () => {
    const limitations = buildDiagnosticLimitations({
      diagnosticType: 'inventory',
      source: 'local',
      diagnostic: {
        coverage: { missingFields: [] },
        warnings: ['{"missingFields":["min_stock"]}']
      },
      products: [{ id: 'p-1', trackStock: true, stock: 4, committedStock: 0, minStock: 2, cost: 10 }]
    });

    expect(limitations).toEqual([]);
    expect(JSON.stringify(limitations)).not.toContain('missingFields');
  });
});
