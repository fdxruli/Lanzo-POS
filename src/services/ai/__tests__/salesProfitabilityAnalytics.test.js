import { describe, expect, it } from 'vitest';
import {
  buildPeriodRange,
  buildSalesProfitabilityAnalysis,
  buildPreviousPeriod
} from '../salesProfitabilityAnalytics';

const period = { from: '2026-09-01', to: '2026-09-07', days: 7, timezone: 'America/Mexico_City' };

const sale = (id, items, overrides = {}) => ({
  id,
  status: 'closed',
  total: items.reduce((sum, item) => sum + item.total, 0),
  salesChannel: 'physical',
  items,
  ...overrides
});

const item = (name, quantity, unitPrice, unitCost, total = quantity * unitPrice) => ({
  name, quantity, unitPrice, cost: unitCost, total
});

describe('sales profitability deterministic analysis', () => {
  it('calculates utility, margin, ticket and excludes cancelled/reverted sales', () => {
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: {
        rows: [
          sale('s-1', [item('Producto A', 10, 100, 60)]),
          sale('s-2', [item('Producto B', 20, 10, 9)]),
          sale('cancelled', [item('Producto A', 1, 100, 60)], { status: 'cancelled' }),
          sale('reverted', [item('Producto B', 1, 10, 9)], { status: 'reverted' })
        ],
        source: { mode: 'cloud_final' }
      }
    });

    expect(result.coverage).toMatchObject({ validSales: 2, excludedSales: 2, complete: true });
    expect(result.current.netSales).toBe(1200);
    expect(result.current.units).toBe(30);
    expect(result.current.costOfSale).toBe(780);
    expect(result.current.profit).toBe(420);
    expect(result.current.margin).toBeCloseTo(0.35);
    expect(result.current.averageTicket).toBe(600);
    expect(result.calculations.find((row) => row.label === 'Margen bruto').formula).toContain('utilidad bruta');
  });

  it('does not turn a missing cost into zero and reports affected products', () => {
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('s-1', [item('Sin costo', 2, 50, null)])] }
    });

    expect(result.current.costComplete).toBe(false);
    expect(result.current.profit).toBeNull();
    expect(result.current.margin).toBeNull();
    expect(result.coverage.productsMissingCost).toBe(1);
    expect(result.limitations.join(' ')).toContain('Faltan costos unitarios');
  });

  it('deduplicates ecommerce order plus converted POS sale', () => {
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: {
        rows: [
          sale('ecom-order', [item('Producto A', 1, 100, 50)], { ecommerceOrderId: 'order-1', sourceMode: 'ecommerce_order' }),
          sale('pos-sale', [item('Producto A', 1, 100, 50)], { ecommerceOrderId: 'order-1', sourceMode: 'pos_converted' }),
          sale('physical', [item('Producto B', 1, 80, 40)])
        ]
      }
    });

    expect(result.coverage.validSales).toBe(2);
    expect(result.coverage.ecommerceDuplicatesExcluded).toBe(0);
    expect(result.current.netSales).toBe(180);
  });

  it('compares comparable periods and exposes contribution evidence', () => {
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('current', [item('Producto B', 10, 20, 18)], { discount: 10 })] },
      previousHistory: { rows: [sale('previous', [item('Producto B', 10, 20, 10)], { discount: 0 })] },
      intent: 'explain_change'
    });

    expect(result.comparison.deltaMargin).toBeLessThan(0);
    expect(result.contributors.some((item) => item.label === 'costo de venta')).toBe(true);
    expect(result.calculations.some((item) => item.label === 'Cambio de margen')).toBe(true);
  });

  it('returns an incomplete response for an empty period', () => {
    const result = buildSalesProfitabilityAnalysis({ period, currentHistory: { rows: [] } });
    expect(result.status).toBe('incomplete');
    expect(result.coverage.validSales).toBe(0);
    expect(result.limitations.join(' ')).toContain('No se proporcionó un periodo anterior');
  });

  it('simulates price and promotion without mutating history', () => {
    const history = { rows: [sale('s-1', [item('Producto A', 10, 100, 60)])] };
    const price = buildSalesProfitabilityAnalysis({ period, currentHistory: history, intent: 'price_simulation', scenario: { productName: 'Producto A', newPrice: 120 } });
    const promotion = buildSalesProfitabilityAnalysis({ period, currentHistory: history, intent: 'promotion_opportunity', scenario: { productName: 'Producto A', discountPercent: 20 } });

    expect(price.scenarios).toHaveLength(3);
    expect(price.calculations.find((row) => row.label === 'Utilidad simulada con el mismo volumen').value).toBe(600);
    expect(promotion.calculations.find((row) => row.label === 'Precio promocional').value).toBe(80);
    expect(history.rows[0].items[0].unitPrice).toBe(100);
  });

  it('requires evidence for combo recommendations', () => {
    const rows = [1, 2, 3].map((id) => sale(`s-${id}`, [item('A', 1, 100, 40), item('B', 1, 50, 20)]));
    const withEvidence = buildSalesProfitabilityAnalysis({ period, currentHistory: { rows }, intent: 'combo_opportunity' });
    const withoutEvidence = buildSalesProfitabilityAnalysis({ period, currentHistory: { rows: [rows[0]] }, intent: 'combo_opportunity' });

    expect(withEvidence.scenarios.length).toBeGreaterThan(0);
    expect(withoutEvidence.limitations).toContain('No hay datos suficientes para recomendar un combo con confianza.');
  });

  it('builds local period ranges and the immediately preceding comparable period', () => {
    const current = buildPeriodRange({ days: 7, end: new Date('2026-09-07T12:00:00') });
    const previous = buildPreviousPeriod(current);
    expect(current).toMatchObject({ from: '2026-09-01', to: '2026-09-07', days: 7 });
    expect(previous).toMatchObject({ from: '2026-08-25', to: '2026-08-31', days: 7 });
  });
  it('keeps a safe calculation array when a simulation has no eligible product', () => {
    for (const intent of ['price_simulation', 'promotion_opportunity']) {
      const result = buildSalesProfitabilityAnalysis({
        period,
        currentHistory: { rows: [] },
        intent
      });

      expect(Array.isArray(result.calculations)).toBe(true);
      expect(Array.isArray(result.scenarios)).toBe(true);
      expect(result.limitations.some((item) => item.includes('No hay productos vendidos'))).toBe(true);
    }
  });

});
