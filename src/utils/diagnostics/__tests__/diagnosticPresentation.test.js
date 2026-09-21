import { describe, expect, it } from 'vitest';
import {
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
          formula: 'stock - committed_stock <= min_stock'
        }],
        warnings: []
      },
      currency: 'MXN'
    });

    expect(model.sourceLabel).toBe('Datos mixtos: cloud + información local complementaria');
    expect(model.severityLabel).toBe('Atención');
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
    expect(model.warnings.join(' ')).toContain('Margen no completamente calculable');
    expect(model.findings[0].details[0]).toEqual({ label: 'Venta sin costo confirmado', value: '$500.00' });
    expect(model.coverage.missingFields).toEqual(['costos unitarios']);
  });

  it('uses Spanish severity labels', () => {
    expect(formatSeverity('info')).toBe('Informativo');
    expect(formatSeverity('warning')).toBe('Atención');
    expect(formatSeverity('critical')).toBe('Crítico');
  });
});

