import { describe, expect, it, vi } from 'vitest';
import {
  createSalesProfitabilityAgentRunner,
  createSalesProfitabilityProductLoader,
  resolveBusinessTimezone
} from '../salesProfitabilityAgentService';

const history = {
  source: { mode: 'cloud_final', stale: false },
  rows: [{
    id: 'internal-sale-id',
    status: 'closed',
    total: 100,
    discount: null,
    itemsCount: 1,
    itemsQuantity: 2
  }],
  total_count: 1,
  limit: 100,
  offset: 0,
  has_more: false
};

const profit = {
  source: { mode: 'cloud_final', stale: false },
  rows: [{
    sale_id: 'internal-sale-id',
    product_id: 'private-product-id',
    product_name: 'Producto A',
    quantity: 2,
    line_total: 100,
    unit_cost: 20,
    movement_cost: null,
    cogs: 40,
    gross_profit: 60,
    gross_margin_percent: 60,
    cost_source: 'sale_item_snapshot',
    profit_status: 'estimated'
  }],
  total_count: 1,
  limit: 100,
  offset: 0,
  has_more: false
};

const providerResponse = JSON.stringify({
  version: 1,
  agentKey: 'salesProfitability',
  status: 'completed',
  executiveSummary: 'Narrativa suplementaria del proveedor.',
  explanation: 'Explicación suplementaria basada en evidencia.',
  facts: [],
  calculations: [],
  assumptions: [],
  scenarios: [],
  recommendations: [{
    title: 'Revisar el cambio',
    explanation: 'Validar el escenario antes de aplicarlo.',
    expectedImpact: 'Por determinar.',
    priority: 'medium',
    evidenceKeys: ['comparison.deltaMargin'],
    requiresConfirmation: true
  }],
  limitations: [],
  confidence: 'medium',
  source: 'cloud',
  coverage: { complete: true },
  citations: [],
  actionDrafts: []
});

const repository = (historyValue = history, profitValue = profit) => ({
  getSalesFinalHistory: vi.fn(async () => historyValue),
  getSalesProfitReport: vi.fn(async () => profitValue)
});

describe('sales profitability agent service', () => {
  it.each([
    [{ timezone: 'America/New_York', time_zone: 'America/Mexico_City' }, 'America/New_York'],
    [{ time_zone: 'America/New_York' }, 'America/New_York'],
    [{}, 'America/Mexico_City']
  ])('resolves the business timezone from the authorized company profile: %#', (companyProfile, expected) => {
    expect(resolveBusinessTimezone(companyProfile)).toBe(expected);
  });

  it('loads current and comparable history plus profit detail with exact UTC boundaries', async () => {
    const reports = repository();
    const analyze = vi.fn(async (request) => {
      expect(request.context).toBeTruthy();
      expect(JSON.stringify(request.context)).not.toContain('internal-sale-id');
      expect(JSON.stringify(request.context)).not.toContain('private-product-id');
      expect(request.context.sales.summary.discounts).toBeNull();
      expect(request.context.sales.summary.discountsKnown).toBe(false);
      return { rawResultContent: providerResponse, usageStatus: { used: 1, limit: 15, remaining: 14 } };
    });
    const runner = createSalesProfitabilityAgentRunner({
      repository: reports,
      analyze,
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Por qué cambió mi margen?',
      intent: 'explain_change',
      period: {
        from: '2026-09-01',
        to: '2026-09-07',
        days: 7,
        timezone: 'America/Mexico_City'
      },
      compare: true,
      requestKey: 'request-1'
    });

    expect(reports.getSalesFinalHistory).toHaveBeenCalledTimes(2);
    expect(reports.getSalesProfitReport).toHaveBeenCalledTimes(2);
    expect(reports.getSalesProfitReport.mock.calls[0][0]).toMatchObject({
      dateFrom: '2026-09-01T06:00:00.000Z',
      dateTo: '2026-09-08T06:00:00.000Z',
      scope: 'mine'
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.providerCalled).toBe(true);
    expect(result.usageStatus.remaining).toBe(14);
    expect(result.response.coverage.complete).toBe(true);
    expect(result.response.current.costStatus).toBe('estimated');
    expect(result.response.queryRange.current).toMatchObject({
      fromInclusiveUtc: '2026-09-01T06:00:00.000Z',
      toExclusiveUtc: '2026-09-08T06:00:00.000Z'
    });
  });

  it('deduplicates concurrent submissions with the same request key', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const analyze = vi.fn(async () => {
      await gate;
      return { rawResultContent: providerResponse };
    });
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(),
      analyze,
      assertActor: vi.fn()
    });
    const options = {
      question: 'Explica mi margen',
      intent: 'explain_change',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'same-request'
    };
    const first = runner(options);
    const second = runner(options);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(firstResult.response.executiveSummary).toBe(secondResult.response.executiveSummary);
  });

  it('does not call the provider when the period has no valid sales', async () => {
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(
        { source: { mode: 'cloud_final' }, rows: [], has_more: false },
        { source: { mode: 'cloud_final' }, rows: [], has_more: false }
      ),
      analyze,
      assertActor: vi.fn()
    });
    const result = await runner({
      question: 'Explica mi margen',
      intent: 'explain_change',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: false
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(result.response.status).toBe('insufficient_data');
    expect(result.providerCalled).toBe(false);
  });

  it('never turns four sales without item detail into $120 profit or 100% margin', async () => {
    const fourSales = {
      source: { mode: 'cloud_final', stale: false },
      rows: [1, 2, 3, 4].map((index) => ({
        id: `sale-${index}`,
        status: 'closed',
        total: 30,
        discount: null,
        itemsCount: 1,
        itemsQuantity: 1
      })),
      total_count: 4,
      has_more: false
    };
    const noDetail = {
      source: { mode: 'cloud_final', stale: false },
      rows: [],
      total_count: 0,
      has_more: false
    };
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(fourSales, noDetail),
      analyze,
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Mi negocio es rentable?',
      intent: 'profitability_summary',
      period: { from: '2026-06-24', to: '2026-09-21', days: 90, timezone: 'America/Mexico_City' },
      compare: false
    });

    expect(result.response.current.netSales).toBe(120);
    expect(result.response.current.units).toBe(4);
    expect(result.response.current.profit).toBeNull();
    expect(result.response.current.margin).toBeNull();
    expect(result.response.profitability).toMatchObject({
      status: 'undetermined',
      profit: null,
      margin: null,
      costCoverage: 0
    });
    expect(result.response.coverage).toMatchObject({
      validSales: 4,
      itemsComplete: false,
      costCoverage: 0,
      complete: false
    });
    expect(result.response.confidence).toBe('low');
    expect(result.response.executiveSummary).not.toContain('100%');
    expect(result.response.executiveSummary).not.toContain('$120.00 con margen');
    expect(analyze).not.toHaveBeenCalled();
    expect(result.providerCalled).toBe(false);
  });

  it('treats missing cost with cogs zero as unknown and skips provider for profitability', async () => {
    const missingProfit = {
      ...profit,
      rows: [{
        ...profit.rows[0],
        unit_cost: null,
        cogs: 0,
        gross_profit: 100,
        gross_margin_percent: 100,
        cost_source: 'missing',
        profit_status: 'incomplete'
      }]
    };
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(history, missingProfit),
      analyze,
      assertActor: vi.fn()
    });
    const result = await runner({
      question: '¿Mi negocio es rentable?',
      intent: 'profitability_summary',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: false
    });

    expect(result.response.current.profit).toBeNull();
    expect(result.response.current.margin).toBeNull();
    expect(result.response.coverage.complete).toBe(false);
    expect(result.response.current.knownCostOfSale).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('keeps profitability indeterminate and skips the provider when the sale source is not authoritative', async () => {
    const unknownHistory = {
      ...history,
      rows: history.rows.map((row) => ({
        ...row,
        sourceMode: 'cloud_committed',
        sourceModeKnown: false
      }))
    };
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(unknownHistory, profit),
      analyze,
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Mi negocio es rentable?',
      intent: 'profitability_summary',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7, timezone: 'America/Mexico_City' },
      compare: false
    });

    expect(result.providerCalled).toBe(false);
    expect(analyze).not.toHaveBeenCalled();
    expect(result.usageStatus).toBeNull();
    expect(result.response.status).toBe('incomplete');
    expect(result.response.current.profit).toBeNull();
    expect(result.response.current.margin).toBeNull();
    expect(result.response.coverage).toMatchObject({
      sourceComplete: false,
      complete: false,
      sourcePolicy: { unknownSources: 1 }
    });
    expect(result.response.confidence).toBe('low');
  });

  it('preloads product options from the profit report without provider or quota path', async () => {
    const reports = repository({
      ...history,
      rows: [
        history.rows[0],
        {
          id: 'internal-sale-id-b',
          status: 'closed',
          total: 60,
          itemsCount: 1,
          itemsQuantity: 1
        }
      ],
      total_count: 2
    }, {
      ...profit,
      rows: [
        profit.rows[0],
        {
          sale_id: 'internal-sale-id-b',
          product_id: 'private-product-b',
          product_name: 'Producto B',
          quantity: 1,
          line_total: 60,
          movement_cost: 25,
          cost_source: 'inventory_movement',
          profit_status: 'definitive'
        }
      ],
      total_count: 2
    });
    const assertActor = vi.fn();
    const loader = createSalesProfitabilityProductLoader({
      repository: reports,
      assertActor
    });

    const prepared = await loader({
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 }
    });

    expect(assertActor).toHaveBeenCalledTimes(1);
    expect(reports.getSalesFinalHistory).toHaveBeenCalledTimes(1);
    expect(reports.getSalesProfitReport).toHaveBeenCalledTimes(1);
    expect(prepared.products.map((row) => row.name)).toEqual(expect.arrayContaining(['Producto A', 'Producto B']));
    expect(JSON.stringify(prepared.products)).not.toContain('internal-sale-id');
    expect(JSON.stringify(prepared.products)).not.toContain('private-product');
  });

  it('keeps all visible facts and narrative deterministic when provider conflicts', async () => {
    const conflictingProvider = JSON.stringify({
      ...JSON.parse(providerResponse),
      executiveSummary: 'Inventado: utilidad $999999 y sin descuentos.',
      explanation: 'Inventado: margen 100%.',
      facts: [{ label: 'Inventado', quantity: 999 }],
      calculations: [{
        label: 'Utilidad inventada',
        value: 999999,
        formattedValue: '$999,999',
        formula: 'inventada',
        source: 'provider',
        period: {}
      }],
      coverage: { validSales: 999 },
      source: 'local'
    });
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(),
      analyze: vi.fn(async () => ({ rawResultContent: conflictingProvider })),
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Mi negocio es rentable?',
      intent: 'profitability_summary',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: false
    });

    expect(result.response.executiveSummary).not.toContain('999999');
    expect(result.response.executiveSummary).not.toContain('sin descuentos');
    expect(result.response.explanation).not.toContain('100%');
    expect(result.response.calculations.some((row) => row.label === 'Utilidad bruta')).toBe(true);
    expect(result.response.calculations.some((row) => row.label === 'Utilidad inventada')).toBe(false);
    expect(result.response.coverage.validSales).toBe(1);
    expect(result.response.source).toBe('cloud');
    expect(result.response.aiNarrative.executiveSummary).toContain('999999');
    expect(result.response.recommendations).toEqual(expect.any(Array));
  });

  it('does not call the provider for a price simulation without a reliable cost', async () => {
    const missingProfit = {
      ...profit,
      rows: [{
        ...profit.rows[0],
        unit_cost: null,
        cogs: 0,
        cost_source: 'missing',
        profit_status: 'incomplete'
      }]
    };
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(history, missingProfit),
      analyze,
      assertActor: vi.fn()
    });
    const result = await runner({
      question: '¿Qué pasa si aumento el precio?',
      intent: 'price_simulation',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: false,
      scenario: { productName: 'Producto A', newPrice: 80 }
    });

    expect(result.response.priceSimulation).toBeNull();
    expect(result.response.status).toBe('incomplete');
    expect(analyze).not.toHaveBeenCalled();
  });
});
