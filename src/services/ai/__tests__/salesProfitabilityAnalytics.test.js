import { describe, expect, it } from 'vitest';
import {
  buildPeriodRange,
  buildSalesProfitabilityAnalysis,
  buildSalesProfitabilityProductOptions,
  buildPreviousPeriod,
  inferSalesProfitabilityIntent,
  isExcludedSalesSource,
  isExcludedSalesStatus,
  isOperationalSalesSource,
  normalizeValidSales
} from '../salesProfitabilityAnalytics';

const period = { from: '2026-09-01', to: '2026-09-07', days: 7, timezone: 'America/Mexico_City' };

const sale = (id, items, overrides = {}) => ({
  id,
  status: 'closed',
  total: items.reduce((sum, item) => sum + item.total, 0),
  salesChannel: 'physical',
  sourceMode: 'cloud_committed',
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

  it('centralizes operational, legacy, shadow, status and ecommerce source policy', () => {
    expect(isOperationalSalesSource('cloud_committed')).toBe(true);
    expect(isOperationalSalesSource('pos_converted')).toBe(true);
    expect(isExcludedSalesSource('shadow')).toBe(true);
    expect(isExcludedSalesSource('shadow_history')).toBe(true);
    expect(isExcludedSalesSource('legacy_imported')).toBe(true);
    expect(isExcludedSalesSource('historical_import_batch')).toBe(true);
    expect(isExcludedSalesSource('ecommerce_pending')).toBe(true);
    expect(isExcludedSalesStatus('cancelled')).toBe(true);
    expect(isExcludedSalesStatus('reverted')).toBe(true);

    const rows = [
      sale('valid-cloud', [item('Operativo', 1, 100, 40)], { sourceMode: 'cloud_committed' }),
      sale('shadow', [item('Shadow', 1, 90, 20)], { sourceMode: 'shadow' }),
      sale('shadow-history', [item('Shadow histórico', 1, 80, 20)], { sourceMode: 'shadow_history' }),
      sale('legacy', [item('Legacy', 1, 70, 20)], { sourceMode: 'legacy_imported' }),
      sale('cancelled-status', [item('Cancelada', 1, 60, 20)], { status: 'cancelled' }),
      sale('cancelled-marker', [item('Marcada', 1, 50, 20)], { cancelled_at: '2026-09-21T12:00:00Z' }),
      sale('ecommerce-pending', [item('Pendiente', 1, 40, 20)], { sourceMode: 'ecommerce_pending' }),
      sale('converted-pos', [item('Convertida', 1, 30, 10)], { sourceMode: 'pos_converted', ecommerceOrderId: 'order-1' })
    ];
    const normalized = normalizeValidSales({ rows });
    expect(normalized.rows.map((row) => row.id)).toEqual(['valid-cloud', 'converted-pos']);
    expect(normalized.sourcePolicy).toMatchObject({
      legacySources: 1,
      shadowSources: 2,
      ecommerceSources: 1,
      excludedStatuses: 1,
      cancelledMarkers: 1,
      unknownSources: 0
    });

    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows },
      intent: 'price_simulation',
      scenario: { productName: 'Legacy', newPrice: 100 }
    });
    expect(result.coverage.validSales).toBe(2);
    expect(result.coverage.excludedSales).toBe(6);
    expect(result.coverage.sourceWarnings.join(' ')).toMatch(/legacy|shadow|ecommerce/i);
    expect(result.current.products.map((product) => product.name)).toEqual(expect.arrayContaining(['Operativo', 'Convertida']));
    expect(result.current.products.map((product) => product.name)).not.toContain('Legacy');
    expect(result.priceSimulation).toBeNull();
  });

  it('keeps an unknown source only for compatibility, warns deterministically and never reports high confidence', () => {
    const unknown = sale('unknown-source', [item('Compatibilidad', 1, 100, 40)], { sourceMode: 'vendor_future_mode' });
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [unknown] },
      intent: 'profitability_summary'
    });
    expect(result.coverage.sourcePolicy.unknownSources).toBe(1);
    expect(result.coverage.sourceWarnings.join(' ')).toContain('fuente no reconocida');
    expect(result.confidence).toBe('low');
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

  it('builds business-calendar period ranges independently from the browser timezone', () => {
    const current = buildPeriodRange({
      days: 7,
      end: new Date('2026-09-08T03:00:00.000Z'),
      timezone: 'America/Mexico_City'
    });
    const previous = buildPreviousPeriod(current);
    expect(current).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-07',
      days: 7,
      timezone: 'America/Mexico_City'
    });
    expect(previous).toMatchObject({
      from: '2026-08-25',
      to: '2026-08-31',
      days: 7,
      timezone: 'America/Mexico_City'
    });
  });

  it('keeps comparable periods contiguous across a year boundary', () => {
    const current = buildPeriodRange({
      days: 7,
      end: '2027-01-03',
      timezone: 'America/New_York'
    });
    const previous = buildPreviousPeriod(current);
    expect(current).toMatchObject({ from: '2026-12-28', to: '2027-01-03' });
    expect(previous).toMatchObject({ from: '2026-12-21', to: '2026-12-27' });
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


describe('phase 3.2 intent routing and focused deterministic outputs', () => {
  const richHistory = {
    rows: [
      sale('r-1', [item('Alta utilidad', 4, 100, 40), item('Bajo margen', 6, 50, 47)], { discount: 5 }),
      sale('r-2', [item('Alta utilidad', 2, 100, 40), item('Costo alto', 2, 30, 40)], { discount: 0 }),
      sale('r-3', [item('Alta utilidad', 1, 100, 40), item('Sin costo', 1, 80, null)], { discount: 0 })
    ]
  };

  it('infers all six internal intents and gives profitability precedence over the legacy default', () => {
    expect(inferSalesProfitabilityIntent('¿Mi negocio es rentable?')).toBe('profitability_summary');
    expect(inferSalesProfitabilityIntent('¿Por qué cambió mi margen?')).toBe('explain_change');
    expect(inferSalesProfitabilityIntent('¿Qué productos están afectando mi rentabilidad?')).toBe('product_risk');
    expect(inferSalesProfitabilityIntent('¿Qué pasa si aumento el precio?')).toBe('price_simulation');
    expect(inferSalesProfitabilityIntent('¿Qué productos compro juntos para un combo?')).toBe('combo_opportunity');
    expect(inferSalesProfitabilityIntent('¿Qué promoción o descuento puedo simular?')).toBe('promotion_opportunity');
  });

  it('produces different deterministic focus for the same fixture across intents', () => {
    const previousHistory = { rows: [sale('previous', [item('Alta utilidad', 2, 100, 50)], { discount: 0 })] };
    const profitability = buildSalesProfitabilityAnalysis({ period, currentHistory: richHistory, previousHistory, intent: 'profitability_summary' });
    const margin = buildSalesProfitabilityAnalysis({ period, currentHistory: richHistory, previousHistory, intent: 'explain_change' });
    const risk = buildSalesProfitabilityAnalysis({ period, currentHistory: richHistory, previousHistory, intent: 'product_risk' });

    expect(profitability.intent).toBe('profitability_summary');
    expect(profitability.calculations.map((row) => row.label)).toContain('Cobertura de costos');
    expect(margin.calculations.map((row) => row.label)).toContain('Margen anterior');
    expect(risk.calculations.map((row) => row.label)).toContain('Productos con riesgo');
    expect(profitability.calculations.map((row) => row.label)).not.toEqual(margin.calculations.map((row) => row.label));
    expect(margin.calculations.map((row) => row.label)).not.toEqual(risk.calculations.map((row) => row.label));
  });

  it('classifies profitability only when costs are complete', () => {
    const complete = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('ok', [item('Producto A', 2, 100, 60)])] },
      intent: 'profitability_summary'
    });
    const incomplete = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('missing', [item('Producto A', 2, 100, null)])] },
      intent: 'profitability_summary'
    });
    const empty = buildSalesProfitabilityAnalysis({ period, currentHistory: { rows: [] }, intent: 'profitability_summary' });

    expect(complete.profitability.status).toBe('profitable');
    expect(complete.profitability.profit).toBe(80);
    expect(incomplete.profitability.status).toBe('undetermined');
    expect(incomplete.profitability.profit).toBeNull();
    expect(empty.profitability.status).toBe('insufficient_data');
  });

  it('classifies non-profitable periods without treating missing costs as zero', () => {
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('loss', [item('Producto A', 2, 50, 60)])] },
      intent: 'profitability_summary'
    });
    expect(result.profitability.status).toBe('not_profitable');
    expect(result.profitability.profit).toBe(-20);
  });

  it('orders product risks for negative margin and missing costs without stock claims', () => {
    const result = buildSalesProfitabilityAnalysis({ period, currentHistory: richHistory, intent: 'product_risk' });
    expect(result.productRisks.some((row) => row.riskType === 'negative_margin')).toBe(true);
    expect(result.productRisks.some((row) => row.riskType === 'missing_cost')).toBe(true);
    expect(JSON.stringify(result.productRisks)).not.toMatch(/stock|rotaci[oó]n|inventario detenido/i);
  });

  it('reports margin comparison as unavailable when the prior period has no valid sales', () => {
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('current-only', [item('A', 1, 100, 60)])] },
      previousHistory: { rows: [] },
      intent: 'explain_change'
    });
    expect(result.comparison).toBeNull();
    expect(result.limitations.join(' ')).toContain('periodo anterior comparable');
  });

  it('builds price simulation with profit delta and break-even volume and rejects unreliable cost', () => {
    const valid = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('p1', [item('A', 10, 100, 60)])] },
      intent: 'price_simulation',
      scenario: { productName: 'A', newPrice: 120 }
    });
    const missingCost = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('p2', [item('A', 10, 100, null)])] },
      intent: 'price_simulation',
      scenario: { productName: 'A', newPrice: 120 }
    });
    expect(valid.priceSimulation).toMatchObject({ product: 'A', currentPrice: 100, newPrice: 120, unitCost: 60, historicalVolume: 10 });
    expect(valid.priceSimulation.profitDelta).toBe(200);
    expect(valid.priceSimulation.breakEvenVolume).toBeCloseTo(6.6666667);
    expect(missingCost.priceSimulation).toBeNull();
    expect(missingCost.limitations.join(' ')).toContain('costo unitario');
  });

  it('requires shared tickets for combos and exposes evidence level when sufficient', () => {
    const one = sale('c1', [item('A', 1, 100, 40), item('B', 1, 50, 20)]);
    const insufficient = buildSalesProfitabilityAnalysis({ period, currentHistory: { rows: [one] }, intent: 'combo_opportunity' });
    const sufficient = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [one, { ...one, id: 'c2' }, { ...one, id: 'c3' }] },
      intent: 'combo_opportunity'
    });
    expect(insufficient.comboOpportunities).toHaveLength(0);
    expect(insufficient.limitations.join(' ')).toContain('tickets con productos compartidos');
    expect(sufficient.comboOpportunities[0]).toMatchObject({ products: ['A', 'B'], tickets: 3, evidenceLevel: 'medium' });
  });

  it('calculates combo utility from the actual quantities and costs in shared tickets', () => {
    const shared = sale('multi-unit', [
      item('A', 2, 100, 40),
      item('B', 3, 50, 20)
    ]);
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: {
        rows: [shared, { ...shared, id: 'multi-unit-2' }, { ...shared, id: 'multi-unit-3' }]
      },
      intent: 'combo_opportunity'
    });

    expect(result.comboOpportunities[0].averageJointSale).toBe(350);
    expect(result.comboOpportunities[0].cost).toBe(140);
    expect(result.comboOpportunities[0].profit).toBe(210);
    expect(result.comboOpportunities[0].margin).toBeCloseTo(0.6);
  });

  it('shows a promotion that would create negative margin without predicting demand', () => {
    const result = buildSalesProfitabilityAnalysis({
      period,
      currentHistory: { rows: [sale('promo', [item('A', 10, 100, 80)])] },
      intent: 'promotion_opportunity',
      scenario: { productName: 'A', promotionalPrice: 70 }
    });
    expect(result.promotionSimulation.promotionalMargin).toBeLessThan(0);
    expect(result.limitations.join(' ')).toContain('no deja utilidad unitaria positiva');
    expect(result.promotionSimulation.isDemandPrediction).toBe(false);
  });

  it('prepares multiple human product options before analysis without internal ids', () => {
    const options = buildSalesProfitabilityProductOptions({
      period,
      currentHistory: {
        rows: [
          sale('private-id-1', [item('Producto A', 1, 100, 50)]),
          sale('private-id-2', [item('Producto B', 2, 40, 10)])
        ]
      }
    });
    expect(options.map((row) => row.name)).toEqual(expect.arrayContaining(['Producto A', 'Producto B']));
    expect(options).toHaveLength(2);
    expect(JSON.stringify(options)).not.toContain('private-id');
    expect(options.every((row) => !Object.prototype.hasOwnProperty.call(row, 'id'))).toBe(true);
  });
});
