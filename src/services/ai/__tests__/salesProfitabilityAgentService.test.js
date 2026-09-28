import { describe, expect, it, vi } from 'vitest';
import {
  createSalesProfitabilityAgentRunner,
  createSalesProfitabilityProductLoader,
  resolveBusinessTimezone
} from '../salesProfitabilityAgentService';
import { validatePayload } from '../../../../supabase/functions/lanzo-ai-agent/contract.ts';

const history = {
  source: { mode: 'cloud_final', stale: false },
  rows: [{
    id: 'internal-sale-id',
    status: 'closed',
    sourceMode: 'cloud_committed',
    sourceModeKnown: true,
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

const unavailableNarrativeResponse = JSON.stringify({
  version: 1,
  agentKey: 'salesProfitability',
  status: 'completed',
  executiveSummary: '',
  explanation: '',
  facts: [{ label: 'dato alterado por proveedor' }],
  calculations: [{
    label: 'cálculo alterado por proveedor',
    value: 999,
    formattedValue: '999',
    formula: 'inventada',
    source: 'provider',
    period: { from: '2026-09-01', to: '2026-09-07' }
  }],
  assumptions: [],
  scenarios: [],
  recommendations: [],
  limitations: [],
  confidence: 'medium',
  source: 'cloud',
  coverage: { complete: true },
  citations: [],
  actionDrafts: [],
  aiNarrative: {
    status: 'unavailable',
    diagnosticCode: 'AI_NARRATIVE_INVALID_JSON',
    executiveSummary: null,
    explanation: null,
    recommendations: []
  }
});

const repository = (historyValue = history, profitValue = profit) => ({
  getSalesFinalHistory: vi.fn(async () => historyValue),
  getSalesProfitReport: vi.fn(async () => profitValue)
});

const assortmentActor = () => ({
  status: 'granted',
  actorType: 'admin',
  actorId: 'admin-1',
  sessionId: 'session-1',
  tenant: { opaqueId: 'tenant-one', databaseName: 'tenant_db_one', generation: 1 }
});

const assortmentRepository = () => {
  const makeHistory = (saleId) => ({
    source: { mode: 'cloud_final', stale: false },
    rows: [{ id: saleId, status: 'closed', sourceMode: 'cloud_committed', sourceModeKnown: true, total: 100, itemsCount: 1, itemsQuantity: 1 }],
    total_count: 1, limit: 100, offset: 0, has_more: false
  });
  const makeProfit = (saleId, productId, productName, total) => ({
    source: { mode: 'cloud_final', stale: false },
    rows: [{ sale_id: saleId, product_id: productId, product_name: productName, quantity: 1, line_total: total, unit_cost: null, movement_cost: null, cogs: null, cost_source: 'missing', profit_status: 'incomplete' }],
    total_count: 1, limit: 100, offset: 0, has_more: false
  });
  return {
    getSalesFinalHistory: vi.fn(async ({ dateFrom }) => dateFrom === '2026-08-25T06:00:00.000Z'
      ? makeHistory('previous-sale')
      : makeHistory('current-sale')),
    getSalesProfitReport: vi.fn(async ({ dateFrom }) => dateFrom === '2026-08-25T06:00:00.000Z'
      ? makeProfit('previous-sale', 'private-old-id', 'Older Product', 80)
      : makeProfit('current-sale', 'private-current-id', 'Current Product', 100))
  };
};

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
    expect(analyze.mock.calls[0][1]).toEqual({ temperature: 0.2, maxTokens: 2048 });
    expect(result.providerCalled).toBe(true);
    expect(result.quotaOutcome).toBe('consumed');
    expect(result.usageStatus.remaining).toBe(14);
    expect(result.response.coverage.complete).toBe(true);
    expect(result.response.current.costStatus).toBe('estimated');
    expect(result.response.queryRange.current).toMatchObject({
      fromInclusiveUtc: '2026-09-01T06:00:00.000Z',
      toExclusiveUtc: '2026-09-08T06:00:00.000Z'
    });
  });

  it('preserves deterministic results and the Edge unavailable diagnostic after one consumed provider call', async () => {
    const analyze = vi.fn(async () => ({
      rawResultContent: unavailableNarrativeResponse,
      usageStatus: { used: 3, limit: 15, remaining: 12 }
    }));
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(),
      analyze,
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Mi negocio es rentable?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7, timezone: 'America/Mexico_City' },
      compare: false,
      requestKey: 'narrative-unavailable-once'
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ providerCalled: true, quotaOutcome: 'consumed', usageStatus: { used: 3, remaining: 12 } });
    expect(result.response.aiNarrative).toEqual({
      status: 'unavailable',
      diagnosticCode: 'AI_NARRATIVE_INVALID_JSON',
      directAnswer: null,
      executiveSummary: null,
      explanation: null,
      recommendations: []
    });
    expect(result.response.current).toMatchObject({ netSales: 100, costOfSale: 40, profit: 60, margin: 0.6 });
    expect(result.response.calculations).not.toContainEqual(expect.objectContaining({ label: 'cálculo alterado por proveedor' }));
    expect(result.response.facts || []).not.toContainEqual(expect.objectContaining({ label: 'dato alterado por proveedor' }));
  });

  it('preserves provider-called, not-consumed telemetry for a truncated Edge narrative', async () => {
    const fallback = JSON.parse(unavailableNarrativeResponse);
    fallback.aiNarrative.diagnosticCode = 'AI_NARRATIVE_TRUNCATED';
    const analyze = vi.fn(async () => ({
      rawResultContent: JSON.stringify(fallback),
      usageStatus: { used: 6, limit: 15, remaining: 9 },
      providerCalled: true,
      quotaOutcome: 'not_consumed'
    }));
    const runner = createSalesProfitabilityAgentRunner({ repository: repository(), analyze, assertActor: vi.fn() });
    const result = await runner({
      question: '¿Cómo puedo aumentar mis ventas?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7, timezone: 'America/Mexico_City' },
      requestKey: 'truncated-narrative-not-consumed'
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      providerCalled: true,
      quotaOutcome: 'not_consumed',
      usageStatus: { used: 6, remaining: 9 },
      response: { aiNarrative: { status: 'unavailable', diagnosticCode: 'AI_NARRATIVE_TRUNCATED' } }
    });
  });

  it('turns a successful Edge call with non-JSON narrative into safe unavailable status without losing confirmed usage', async () => {
    const rawProviderText = 'raw provider text with a secret token';
    const analyze = vi.fn(async () => ({
      rawResultContent: rawProviderText,
      usageStatus: { used: 3, limit: 15, remaining: 12 }
    }));
    const runner = createSalesProfitabilityAgentRunner({ repository: repository(), analyze, assertActor: vi.fn() });
    const result = await runner({
      question: '¿Mi negocio es rentable?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7, timezone: 'America/Mexico_City' },
      compare: false,
      requestKey: 'non-json-narrative'
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ providerCalled: true, quotaOutcome: 'consumed', usageStatus: { used: 3, remaining: 12 } });
    expect(result.response.aiNarrative).toEqual({
      status: 'unavailable',
      diagnosticCode: 'AI_NARRATIVE_INVALID_JSON',
      executiveSummary: null,
      explanation: null,
      recommendations: []
    });
    expect(result.response.current).toMatchObject({ netSales: 100, costOfSale: 40, profit: 60, margin: 0.6 });
    expect(JSON.stringify(result)).not.toContain(rawProviderText);
  });

  it('sends missing historical cost to mocked IA as null and never lets narrative restore a 100% margin', async () => {
    const zeroCostProfit = {
      ...profit,
      rows: [{
        ...profit.rows[0],
        unit_cost: 0,
        movement_cost: null,
        cogs: 0,
        gross_profit: 100,
        gross_margin_percent: 100,
        cost_source: 'sale_item_snapshot',
        profit_status: 'estimated'
      }]
    };
    const analyze = vi.fn(async (request) => {
      expect(request.context.sales.summary).toMatchObject({
        unitCosts: null,
        profit: null,
        margin: null,
        costCoverage: 0,
        missingCostProducts: 1,
        profitabilityStatus: 'undetermined'
      });
      expect(request.context.sales.products).toEqual([
        expect.objectContaining({
          name: 'Producto A',
          unitCost: null,
          profit: null,
          margin: null,
          costKnown: false,
          costStatus: 'incomplete',
          costSource: 'missing'
        })
      ]);
      return {
        rawResultContent: providerResponse,
        usageStatus: { used: 0, limit: 15, remaining: 15 }
      };
    });
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(history, zeroCostProfit),
      analyze,
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Qué productos están afectando mi rentabilidad?',
      intent: 'product_risk',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: false,
      requestKey: 'missing-cost-product-risk'
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.providerCalled).toBe(true);
    expect(result.response.current).toMatchObject({
      netSales: 100,
      costOfSale: null,
      profit: null,
      margin: null,
      costComplete: false,
      costCoverage: 0
    });
    expect(result.response.coverage).toMatchObject({
      productsMissingCost: 1,
      costCoverage: 0,
      knownCostOfSale: 0,
      costStatus: 'incomplete',
      complete: false
    });
    expect(result.response.profitability).toMatchObject({
      status: 'undetermined',
      netSales: 100,
      costOfSale: null,
      profit: null,
      margin: null
    });
    expect(result.response.current.products[0]).toMatchObject({
      unitCost: null,
      profit: null,
      margin: null,
      costKnown: false,
      costStatus: 'incomplete',
      costSource: 'missing'
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
    expect(result.response.coverage.validSales).toBe(0);
    expect(result.response.limitations.some((item) => /no hay ventas válidas/i.test(item))).toBe(true);
    expect(result.usageStatus).toBeNull();
    expect(result.providerCalled).toBe(false);
    expect(result.quotaOutcome).toBe('not_consumed');
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

    const visibleDeterministic = JSON.stringify({
      executiveSummary: result.response.executiveSummary,
      explanation: result.response.explanation,
      facts: result.response.facts,
      calculations: result.response.calculations,
      coverage: result.response.coverage,
      source: result.response.source,
      recommendations: result.response.recommendations
    });
    expect(visibleDeterministic).not.toContain('999999');
    expect(visibleDeterministic).not.toContain('Inventado');
    expect(visibleDeterministic).not.toContain('sin descuentos');
    expect(visibleDeterministic).not.toMatch(/margen\s+100%/i);
    expect(result.response.calculations.some((row) => row.label === 'Utilidad bruta')).toBe(true);
    expect(result.response.calculations.some((row) => row.label === 'Utilidad inventada')).toBe(false);
    expect(result.response.coverage.validSales).toBe(1);
    expect(result.response.source).toBe('cloud');
    expect(result.response.aiNarrative.executiveSummary).toContain('999999');
    expect(result.response.aiNarrative.executiveSummary).toContain('Inventado');
    expect(result.response.aiNarrative.executiveSummary).toContain('sin descuentos');
    expect(result.response.aiNarrative.explanation).toMatch(/margen\s+100%/i);
    expect(result.response.recommendations).toEqual(expect.any(Array));
  });

  it('preserves Phase 2 action, measurement, evidence and provider confidence', async () => {
    const recommendation = {
      title: 'Probar mayor exposición de Producto A',
      focus: { type: 'product', key: 'Producto A' },
      recommendationType: 'growth_experiment',
      explanation: 'Producto A tiene una señal de ventas actual relevante.',
      action: 'Probar una ubicación más visible durante una semana.',
      measurement: 'Comparar unidades diarias con la semana previa.',
      expectedImpact: 'Permitirá evaluar si la exposición coincide con más unidades.',
      priority: 'high',
      evidenceKeys: ['product:Producto A'],
      requiresConfirmation: true
    };
    const phase2Response = JSON.stringify({
      version: 1,
      agentKey: 'salesProfitability',
      status: 'completed',
      intent: 'sales_growth',
      executiveSummary: 'Hay una oportunidad concreta para probar con Producto A.',
      directAnswer: 'Prueba mayor visibilidad para Producto A y compara sus unidades con la semana previa.',
      explanation: 'La señal de Producto A justifica una prueba pequeña y medible.',
      facts: [],
      calculations: [],
      assumptions: [],
      scenarios: [],
      recommendations: [recommendation],
      limitations: [],
      confidence: 'high',
      source: 'cloud',
      coverage: { complete: true },
      citations: [],
      actionDrafts: [],
      opportunityCandidates: [{
        key: 'product:Producto A',
        type: 'product',
        focus: { type: 'product', key: 'Producto A' },
        recommendationType: 'growth_experiment',
        strength: 'strong',
        evidenceKeys: ['product:Producto A']
      }],
      minimumUsefulRecommendations: 1,
      aiNarrative: {
        status: 'available',
        directAnswer: 'Prueba mayor visibilidad para Producto A y compara sus unidades con la semana previa.',
        executiveSummary: 'Hay una oportunidad concreta para probar con Producto A.',
        explanation: 'La señal de Producto A justifica una prueba pequeña y medible.',
        recommendations: [recommendation],
        confidence: 'high'
      }
    });
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(),
      analyze: vi.fn(async () => ({
        rawResultContent: phase2Response,
        providerCalled: true,
        quotaOutcome: 'consumed'
      })),
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Cómo puedo aumentar mis ventas?',
      intent: 'sales_growth',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: true
    });

    expect(result.response.aiNarrative).toMatchObject({
      status: 'available',
      directAnswer: 'Prueba mayor visibilidad para Producto A y compara sus unidades con la semana previa.',
      confidence: 'high',
      recommendations: [{
        title: 'Probar mayor exposición de Producto A',
        action: 'Probar una ubicación más visible durante una semana.',
        measurement: 'Comparar unidades diarias con la semana previa.',
        evidenceKeys: ['product:Producto A'],
        requiresConfirmation: true
      }]
    });
    expect(result.quotaOutcome).toBe('consumed');
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

  it('keeps an incomplete gross-profit goal local without reserving quota', async () => {
    const missingProfit = {
      ...profit,
      rows: [{
        ...profit.rows[0], unit_cost: null, cogs: 0, gross_profit: null,
        gross_margin_percent: null, cost_source: 'missing', profit_status: 'incomplete'
      }]
    };
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(history, missingProfit), analyze, assertActor: vi.fn()
    });
    const result = await runner({
      question: 'Quiero ganar $20,000',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'profit-goal-incomplete-cost'
    });

    expect(result.response).toMatchObject({
      intent: 'goal_simulation', status: 'incomplete',
      goalSimulation: { type: 'gross_profit', ready: false, state: 'unavailable', currentValue: null }
    });
    expect(result.response.goalSimulation).not.toHaveProperty('requiredRevenue');
    expect(result).toMatchObject({ providerCalled: false, quotaOutcome: 'not_consumed', usageStatus: null });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('sends Lanzo-calculated goal evidence and ignores provider-supplied financial recalculations', async () => {
    const alteredProviderResult = JSON.stringify({
      version: 1, agentKey: 'salesProfitability', status: 'completed', intent: 'goal_simulation',
      executiveSummary: 'Narrativa suplementaria.', answer: 'Narrativa suplementaria.',
      explanation: 'La explicación usa las cifras que recibió de Lanzo.',
      facts: [], calculations: [{ label: 'Ventas requeridas', value: 999999, formattedValue: '999999', formula: 'inventada', source: 'provider', period: null }],
      assumptions: [], scenarios: [], recommendations: [], limitations: [], source: 'cloud',
      coverage: { complete: true }, citations: [], actionDrafts: []
    });
    const analyze = vi.fn(async (request) => {
      expect(request.intent).toBe('goal_simulation');
      expect(request.context.sales.goalSimulation).toMatchObject({
        type: 'revenue', targetValue: 150, currentSales: 100,
        requiredAdditionalTicketsAtCurrentTicket: 1,
        requiredAverageTicketAtCurrentTicketCount: 150
      });
      const validation = validatePayload({
        auth: { licenseKey: 'synthetic-license', deviceFingerprint: 'synthetic-device', deviceSecurityToken: 'synthetic-token', staffSessionToken: null },
        agentKey: request.agentKey, intent: request.intent, question: request.question,
        requestKey: request.requestKey, period: request.period, scenario: request.scenario,
        context: request.context, options: { temperature: 0.2, maxTokens: 2048 }
      });
      expect(validation.ok, JSON.stringify(validation)).toBe(true);
      return { rawResultContent: alteredProviderResult, providerCalled: true, quotaOutcome: 'consumed' };
    });
    const runner = createSalesProfitabilityAgentRunner({ repository: repository(), analyze, assertActor: vi.fn() });
    const result = await runner({
      question: '¿Cuánto necesito vender para facturar $150?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'revenue-goal-deterministic'
    });

    expect(result).toMatchObject({ providerCalled: true, quotaOutcome: 'consumed' });
    expect(result.response.goalSimulation).toMatchObject({ currentSales: 100, targetValue: 150, revenueGap: 50 });
    expect(result.response.calculations.find((row) => row.label === 'Ventas requeridas')).toBeUndefined();
    expect(result.response.calculations.find((row) => row.label === 'Ticket promedio requerido al conteo actual').value).toBe(150);
    expect(result.response.calculations.some((row) => row.value === 999999)).toBe(false);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('sends strategy only from deterministic candidates grounded in complete comparison evidence', async () => {
    const dateForPeriod = (dateFrom) => dateFrom === '2026-08-25T06:00:00.000Z';
    const makeDataset = (saleId, total) => ({
      history: {
        source: { mode: 'cloud_final', stale: false },
        rows: [{ id: saleId, status: 'closed', sourceMode: 'cloud_committed', sourceModeKnown: true, total, discount: null, itemsCount: 1, itemsQuantity: 2 }],
        total_count: 1, limit: 100, offset: 0, has_more: false
      },
      profit: {
        source: { mode: 'cloud_final', stale: false },
        rows: [{
          sale_id: saleId, product_id: 'private-product-id', product_name: 'Producto A', quantity: 2,
          line_total: total, unit_cost: total * 0.2, movement_cost: null, cogs: total * 0.4,
          gross_profit: total * 0.6, gross_margin_percent: 60,
          cost_source: 'sale_item_snapshot', profit_status: 'estimated'
        }],
        total_count: 1, limit: 100, offset: 0, has_more: false
      }
    });
    const currentDataset = makeDataset('current-sale-id', 100);
    const previousDataset = makeDataset('previous-sale-id', 110);
    const reports = {
      getSalesFinalHistory: vi.fn(async ({ dateFrom }) => dateForPeriod(dateFrom) ? previousDataset.history : currentDataset.history),
      getSalesProfitReport: vi.fn(async ({ dateFrom }) => dateForPeriod(dateFrom) ? previousDataset.profit : currentDataset.profit)
    };
    const catalogLoader = vi.fn(async () => ({
      source: 'local_tenant_catalog', complete: true, productsTruncated: false, categoriesTruncated: false,
      products: [{ id: 'private-product-id', name: 'Producto A', categoryId: 'private-category-id', isActive: true }],
      categories: [{ id: 'private-category-id', name: 'Bebidas', isActive: true }]
    }));
    const analyze = vi.fn(async ({ agentKey, intent, question, requestKey, period, scenario, context }) => {
      expect(['commercial_strategy', 'goal_simulation']).toContain(intent);
      expect(context.sales.strategyRequested).toBe(true);
      if (intent === 'goal_simulation') {
        expect(context.sales.goalSimulation).toMatchObject({ type: 'revenue', targetValue: 150000, revenueGap: 149900 });
      }
      expect(context.sales.strategyCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ reasonCode: 'ticket_down_sales_stable', priority: 'medium' })
      ]));
      expect(context.sales.opportunityCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ signal: ['ticket_down_sales_stable'] })
      ]));
      const serialized = JSON.stringify(context);
      expect(serialized).not.toContain('private-product-id');
      expect(serialized).not.toContain('current-sale-id');
      const validation = validatePayload({
        auth: { licenseKey: 'synthetic-license', deviceFingerprint: 'synthetic-device', deviceSecurityToken: 'synthetic-token', staffSessionToken: null },
        agentKey, intent, question, requestKey, period, scenario, context,
        options: { temperature: 0.2, maxTokens: 2048 }
      });
      expect(validation.ok, JSON.stringify(validation)).toBe(true);
      return { rawResultContent: providerResponse, providerCalled: true, quotaOutcome: 'consumed' };
    });
    const runner = createSalesProfitabilityAgentRunner({
      repository: reports, catalogLoader, analyze, assertActor: vi.fn(assortmentActor)
    });
    const result = await runner({
      question: '¿Qué debería priorizar para mejorar el negocio?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'commercial-strategy-grounded'
    });

    expect(result.response.strategyRequested).toBe(true);
    expect(result.response.strategyCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: 'ticket_down_sales_stable', priority: 'medium' })
    ]));
    expect(result).toMatchObject({ providerCalled: true, quotaOutcome: 'consumed' });
    expect(catalogLoader).toHaveBeenCalledTimes(1);
    expect(reports.getSalesFinalHistory).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenCalledTimes(1);

    const goalWithStrategy = await runner({
      question: 'Quiero facturar $150,000, ¿qué tendría que cambiar?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'goal-with-grounded-strategy'
    });
    expect(goalWithStrategy.response).toMatchObject({
      intent: 'goal_simulation', goalSimulation: { type: 'revenue', targetValue: 150000, revenueGap: 149900 },
      strategyRequested: true
    });
    expect(goalWithStrategy.response.strategyCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: 'ticket_down_sales_stable', priority: 'medium' })
    ]));
    expect(goalWithStrategy).toMatchObject({ providerCalled: true, quotaOutcome: 'consumed' });
    expect(catalogLoader).toHaveBeenCalledTimes(2);
    expect(reports.getSalesFinalHistory).toHaveBeenCalledTimes(4);
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('returns insufficient_data for combos without enough shared tickets and skips quota/provider', async () => {
    const reports = repository();
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, analyze, assertActor: vi.fn() });
    const result = await runner({
      question: '¿Qué combos puedo formar?',
      intent: 'combo_opportunity',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: true,
      scenario: { productName: 'Producto A', newPrice: '120' }
    });

    expect(result.response.status).toBe('insufficient_data');
    expect(result.response.comboOpportunities).toEqual([]);
    expect(result.response.coverage.validSales).toBe(1);
    expect(result.response.executiveSummary).toMatch(/No hay evidencia suficiente de compras conjuntas/i);
    expect(result.providerCalled).toBe(false);
    expect(result.usageStatus).toBeNull();
    expect(result.quotaOutcome).toBe('not_consumed');
    expect(analyze).not.toHaveBeenCalled();
    expect(reports.getSalesFinalHistory).toHaveBeenCalledTimes(1);
    expect(reports.getSalesProfitReport).toHaveBeenCalledTimes(1);
  });

  it('normalizes and validates the scenario before loading data or invoking Supabase', async () => {
    const reports = repository();
    const analyze = vi.fn(async () => ({ rawResultContent: providerResponse }));
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, analyze, assertActor: vi.fn() });
    await runner({
      question: '¿Qué pasa si aumento el precio?',
      intent: 'combo_opportunity',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: true,
      scenario: {
        productName: 'Producto A',
        newPrice: '80',
        historicalVolume: '0',
        discountPercent: '20',
        stalePromotionPrice: '50'
      }
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][0]).toMatchObject({
      intent: 'price_simulation',
      period: { previousFrom: null, previousTo: null },
      scenario: { productName: 'Producto A', newPrice: 80, historicalVolume: 0 }
    });
    expect(reports.getSalesFinalHistory).toHaveBeenCalledTimes(1);
    expect(reports.getSalesProfitReport).toHaveBeenCalledTimes(1);
    expect(typeof analyze.mock.calls[0][0].scenario.newPrice).toBe('number');
    expect(typeof analyze.mock.calls[0][0].scenario.historicalVolume).toBe('number');
    expect(analyze.mock.calls[0][0].scenario).not.toHaveProperty('discountPercent');
    expect(analyze.mock.calls[0][0].scenario).not.toHaveProperty('stalePromotionPrice');

    const invalidReports = repository();
    const invalidAnalyze = vi.fn();
    const invalidRunner = createSalesProfitabilityAgentRunner({
      repository: invalidReports,
      analyze: invalidAnalyze,
      assertActor: vi.fn()
    });
    await expect(invalidRunner({
      question: '¿Qué pasa si aumento el precio?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      scenario: { productName: 'Producto A', newPrice: '-1' }
    })).rejects.toMatchObject({ code: 'SCENARIO_VALUE_MUST_BE_POSITIVE' });
    expect(invalidReports.getSalesFinalHistory).not.toHaveBeenCalled();
    expect(invalidReports.getSalesProfitReport).not.toHaveBeenCalled();
    expect(invalidAnalyze).not.toHaveBeenCalled();
  });

  it('resolves identity and out-of-scope questions locally without actor, sales, Edge or provider access', async () => {
    const reports = repository();
    const assertActor = vi.fn();
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, analyze, assertActor });

    const result = await runner({
      question: '¿Cómo te llamas?',
      intent: 'combo_opportunity',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: true,
      scenario: { productName: 'Producto A', newPrice: '120' }
    });

    expect(result.response.status).toBe('local_answer');
    expect(result.response.executiveSummary).toContain('Soy Lía, la asistente de análisis comercial de Lanzo.');
    expect(result.intentResolution).toMatchObject({ kind: 'identity', topic: 'name' });
    expect(result.providerCalled).toBe(false);
    expect(result.usageStatus).toBeNull();
    expect(result.quotaOutcome).toBe('not_consumed');
    expect(assertActor).not.toHaveBeenCalled();
    expect(reports.getSalesFinalHistory).not.toHaveBeenCalled();
    expect(reports.getSalesProfitReport).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();

    for (const question of ['Hola', '¿Qué receta preparo?', '¿Cuáles son mis clientes frecuentes?', '¿Qué hay en ecommerce?']) {
      const outOfScope = await runner({
        question,
        intent: 'profitability_summary',
        period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
        compare: true,
        scenario: { productName: 'Producto A', discountPercent: '20' }
      });
      expect(outOfScope.response.status).toBe('out_of_scope');
      expect(outOfScope.providerCalled).toBe(false);
      expect(outOfScope.usageStatus).toBeNull();
      expect(outOfScope.quotaOutcome).toBe('not_consumed');
    }
    expect(assertActor).not.toHaveBeenCalled();
    expect(reports.getSalesFinalHistory).not.toHaveBeenCalled();
    expect(reports.getSalesProfitReport).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('recognizes out-of-scope and context-incomplete commercial requests before accessing data or quota', async () => {
    const reports = repository();
    const assertActor = vi.fn();
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, analyze, assertActor });

    const unsupportedCases = [
      ['Ayúdame a analizar mi competencia.', 'competition', 'competencia'],
      ['Analiza mi competencia para mejorar mi negocio.', 'competition', 'competencia']
    ];

    for (const [question, topic, copy] of unsupportedCases) {
      const result = await runner({ question, scenario: {} });
      expect(result.response.status).toBe('not_ready');
      expect(result.response.executiveSummary).toContain(copy);
      expect(result.response.executiveSummary).not.toMatch(/^Soy Lía\b/u);
      expect(result.intentResolution).toMatchObject({
        kind: 'needs_context',
        topic,
        intent: 'competitive_analysis',
        requiresData: false,
        requiresProvider: false
      });
      expect(result.providerCalled).toBe(false);
      expect(result.quotaOutcome).toBe('not_consumed');
    }

    for (const scenario of [{}, { productName: 'Producto A' }]) {
      const result = await runner({
        question: '¿Qué pasa si aumento el precio?',
        scenario
      });
      expect(result.response.status).toBe('not_ready');
      expect(result.intentResolution.kind).toBe('needs_context');
      expect(result.providerCalled).toBe(false);
      expect(result.quotaOutcome).toBe('not_consumed');
    }

    expect(assertActor).not.toHaveBeenCalled();
    expect(reports.getSalesFinalHistory).not.toHaveBeenCalled();
    expect(reports.getSalesProfitReport).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('uses complete tenant catalog and comparable sales, while sending only allowlisted assortment evidence to IA', async () => {
    const reports = assortmentRepository();
    const actor = assortmentActor();
    const assertActor = vi.fn(() => actor);
    const catalogLoader = vi.fn(async () => ({
      source: 'local_tenant_catalog',
      complete: true,
      productsTruncated: false,
      categoriesTruncated: false,
      products: [
        { id: 'private-current-id', name: 'Current Product', categoryId: 'private-category-id', isActive: true, stock: 9, cost: 12, barcode: 'secret-barcode' },
        { id: 'private-old-id', name: 'Older Product', categoryId: 'private-category-id', isActive: true, stock: 0, cost: null, barcode: 'secret-barcode-2' },
        { id: 'private-new-id', name: 'Never Sold Product', categoryId: 'private-category-id', isActive: true }
      ],
      categories: [{ id: 'private-category-id', name: 'Bebidas', isActive: true }]
    }));
    const analyze = vi.fn(async ({ context }) => {
      const serialized = JSON.stringify(context);
      expect(serialized).toContain('Bebidas');
      expect(serialized).toContain('Older Product');
      expect(serialized).not.toContain('private-current-id');
      expect(serialized).not.toContain('private-old-id');
      expect(serialized).not.toContain('private-category-id');
      expect(serialized).not.toContain('secret-barcode');
      expect(serialized).not.toMatch(/"(?:stock|cost|unitCost|unit_cost|barcode)"/u);
      return { rawResultContent: providerResponse, providerCalled: true, quotaOutcome: 'consumed' };
    });
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, catalogLoader, analyze, assertActor });
    const result = await runner({
      question: '¿Qué productos debería revisar antes de agregar nuevos?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'assortment-grounded-context'
    });

    expect(catalogLoader).toHaveBeenCalledTimes(1);
    expect(catalogLoader).toHaveBeenCalledWith(expect.objectContaining({ actor, assertActor }));
    expect(reports.getSalesFinalHistory).toHaveBeenCalledTimes(2);
    expect(reports.getSalesProfitReport).toHaveBeenCalledTimes(2);
    expect(result.response.intent).toBe('assortment_analysis');
    expect(result.response.assortment.reactivationCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Older Product', availability: 'availability_unknown', previousSales: 80, currentSales: 0 })
    ]));
    expect(result.providerCalled).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('does not call IA or consume quota when the catalogue has no usable assortment evidence', async () => {
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: assortmentRepository(),
      catalogLoader: vi.fn(async () => ({
        source: 'local_tenant_catalog', complete: true, productsTruncated: false, categoriesTruncated: false,
        products: [], categories: []
      })),
      analyze,
      assertActor: vi.fn(assortmentActor)
    });
    const result = await runner({
      question: '¿Dónde tengo oportunidades en mi surtido?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'assortment-empty-catalog'
    });

    expect(result.response.assortment.health.activeCatalogProducts).toBe(0);
    expect(result.response.status).toBe('insufficient_data');
    expect(result.providerCalled).toBe(false);
    expect(result.quotaOutcome).toBe('not_consumed');
    expect(result.usageStatus).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('aborts the catalogue analysis if the tenant generation changes during the read', async () => {
    const original = assortmentActor();
    const changed = { ...original, tenant: { ...original.tenant, generation: 2 } };
    const assertActor = vi.fn()
      .mockReturnValueOnce(original)
      .mockReturnValue(changed);
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: assortmentRepository(),
      catalogRepository: {
        getAssortmentCatalogSnapshot: vi.fn(async () => ({
          complete: true, productsTruncated: false, categoriesTruncated: false,
          products: [{ id: 'private-current-id', name: 'Producto', categoryId: 'category' }],
          categories: [{ id: 'category', name: 'Categoría' }]
        }))
      },
      analyze,
      assertActor
    });

    await expect(runner({
      question: '¿Cómo está mi surtido?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'assortment-tenant-switch'
    })).rejects.toMatchObject({ code: 'AI_AGENT_TENANT_CHANGED', statusCode: 409 });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('keeps comparison off for a profitability summary', async () => {
    const analyze = vi.fn(async () => ({ rawResultContent: providerResponse }));
    const reports = repository();
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, analyze, assertActor: vi.fn() });

    await runner({
      question: '¿Mi negocio es rentable?',
      intent: 'profitability_summary',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: true,
      requestKey: 'summary-no-comparison'
    });

    expect(reports.getSalesFinalHistory).toHaveBeenCalledTimes(1);
    expect(reports.getSalesProfitReport).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][0]).toMatchObject({
      intent: 'profitability_summary',
      period: { previousFrom: null, previousTo: null }
    });
  });

  it.each([
    ['¿Cómo puedo aumentar mis ventas?', 'sales_growth'],
    ['¿Cómo puedo aumentar mi ticket promedio?', 'ticket_growth'],
    ['¿Qué productos debería impulsar?', 'product_opportunity'],
    ['¿Mis ventas están creciendo?', 'sales_trend']
  ])('calls the provider for %s when complete deterministic evidence exists', async (question, intent) => {
    const reports = repository();
    const analyze = vi.fn(async () => ({ rawResultContent: providerResponse, usageStatus: { used: 1, limit: 15, remaining: 14 } }));
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, analyze, assertActor: vi.fn() });

    const result = await runner({
      question,
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: `growth-supported-${intent}`
    });

    expect(result.response.intent).toBe(intent);
    expect(result.response.coverage.itemsComplete).toBe(true);
    expect(result.providerCalled).toBe(true);
    expect(result.quotaOutcome).toBe('consumed');
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][0].period.previousFrom).toBe('2026-08-25');
    expect(analyze.mock.calls[0][0].context.sales).toHaveProperty('growthSignals');
  });

  it('does not call the provider or consume quota for growth without complete item evidence', async () => {
    const noDetail = { ...profit, rows: [], total_count: 0 };
    const reports = repository(history, noDetail);
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, analyze, assertActor: vi.fn() });

    const result = await runner({
      question: '¿Cómo puedo aumentar mis ventas?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'growth-without-item-evidence'
    });

    expect(result.response.intent).toBe('sales_growth');
    expect(result.response.coverage.growthDataComplete).toBe(false);
    expect(result.response.status).toBe('incomplete');
    expect(result.providerCalled).toBe(false);
    expect(result.quotaOutcome).toBe('not_consumed');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('does not narrate a trend when comparison pagination is incomplete', async () => {
    const reports = {
      getSalesFinalHistory: vi.fn(async ({ offset }) => offset > 0
        ? { source: { mode: 'cloud_final' }, rows: [], has_more: true }
        : { ...history, has_more: true }),
      getSalesProfitReport: vi.fn(async ({ offset }) => offset > 0
        ? { source: { mode: 'cloud_final' }, rows: [], has_more: true }
        : { ...profit, has_more: true })
    };
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({ repository: reports, analyze, assertActor: vi.fn() });
    const result = await runner({
      question: '¿Mis ventas están creciendo?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'trend-with-incomplete-comparison'
    });

    expect(result.response.intent).toBe('sales_trend');
    expect(result.response.coverage.comparisonItemsAvailable).toBe(false);
    expect(result.response.executiveSummary).toContain('No hay una comparación completa');
    expect(result.providerCalled).toBe(false);
    expect(result.quotaOutcome).toBe('not_consumed');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('preserves deterministic results when the provider narrative fails', async () => {
    const providerFailure = Object.assign(new Error('provider unavailable'), {
      code: 'AI_PROVIDER_ERROR',
      statusCode: 502,
      originalError: { requestId: 'request-narrative-1' }
    });
    const analyze = vi.fn(async () => { throw providerFailure; });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = createSalesProfitabilityAgentRunner({
      repository: repository(),
      analyze,
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Mi negocio es rentable?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: false,
      requestKey: 'provider-failure-preserves-deterministic'
    });

    expect(result.providerCalled).toBe(null);
    expect(result.quotaOutcome).toBe('not_confirmed');
    expect(result.response.status).toBe('completed');
    expect(result.response.current.netSales).toBe(100);
    expect(result.response.calculations.some((row) => row.label === 'Ventas netas')).toBe(true);
    expect(result.response.aiNarrative).toMatchObject({ status: 'unavailable', recommendations: [] });
    expect(result.response.limitations.join(' ')).toContain('narrativa opcional');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('treats a legacy Edge v39 INVALID_REQUEST as a confirmed pre-provider rejection', async () => {
    const rejection = Object.assign(new Error('No se pudo procesar la solicitud.'), {
      code: 'INVALID_REQUEST',
      statusCode: 400,
      originalError: { success: false, code: 'INVALID_REQUEST' }
    });
    const analyze = vi.fn(async () => { throw rejection; });
    const runner = createSalesProfitabilityAgentRunner({ repository: repository(), analyze, assertActor: vi.fn() });
    const result = await runner({
      question: '¿Cómo puedo aumentar mis ventas?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'legacy-edge-invalid-request'
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ providerCalled: false, quotaOutcome: 'not_consumed' });
    expect(result.response.status).toBe('completed');
    expect(result.response.current.netSales).toBe(100);
    expect(result.response.aiNarrative).toMatchObject({
      status: 'unavailable',
      diagnosticCode: 'AI_REQUEST_REJECTED'
    });
  });

  it.each([
    ['AI_REQUEST_FAILED', 'not_consumed'],
    ['AI_EMPTY_RESPONSE', 'not_confirmed'],
    ['AI_INVALID_RESPONSE', 'consumed'],
    ['MALFORMED_JSON', 'not_confirmed']
  ])('preserves authoritative provider and quota telemetry for %s', async (code, quotaOutcome) => {
    const providerFailure = Object.assign(new Error('narrative unavailable'), {
      code,
      statusCode: 502,
      originalError: { code, providerCalled: true, quotaOutcome }
    });
    const analyze = vi.fn(async () => { throw providerFailure; });
    const runner = createSalesProfitabilityAgentRunner({ repository: repository(), analyze, assertActor: vi.fn() });
    const result = await runner({
      question: '¿Mi negocio es rentable?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: `provider-telemetry-${code}`
    });

    expect(result.providerCalled).toBe(true);
    expect(result.quotaOutcome).toBe(quotaOutcome);
    expect(result.response.aiNarrative.status).toBe('unavailable');
    expect(result.response.current.netSales).toBe(100);
  });

  it('keeps provider and quota unknown when an unstructured failure cannot establish the Edge outcome', async () => {
    const analyze = vi.fn(async () => { throw new Error('connection interrupted'); });
    const runner = createSalesProfitabilityAgentRunner({ repository: repository(), analyze, assertActor: vi.fn() });
    const result = await runner({
      question: '¿Mi negocio es rentable?',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      requestKey: 'unknown-edge-execution'
    });

    expect(result).toMatchObject({ providerCalled: null, quotaOutcome: 'not_confirmed' });
    expect(result.response.aiNarrative).toMatchObject({
      status: 'unavailable',
      diagnosticCode: 'AI_NARRATIVE_UNAVAILABLE'
    });
    expect(result.response.current.netSales).toBe(100);
  });
});
