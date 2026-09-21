import { describe, expect, it, vi } from 'vitest';
import {
  createSalesProfitabilityAgentRunner,
  createSalesProfitabilityProductLoader
} from '../salesProfitabilityAgentService';

const history = {
  source: { mode: 'cloud_final' },
  rows: [{
    id: 'internal-sale-id',
    status: 'closed',
    total: 100,
    items: [{ name: 'Producto A', quantity: 2, unitPrice: 50, cost: 20, total: 100 }]
  }]
};

const providerResponse = JSON.stringify({
  version: 1,
  agentKey: 'salesProfitability',
  status: 'completed',
  executiveSummary: 'Resumen basado en la evidencia calculada.',
  explanation: 'La explicación usa únicamente los datos recibidos.',
  facts: [],
  calculations: [],
  assumptions: [],
  scenarios: [],
  recommendations: [{
    title: 'Revisar el producto',
    explanation: 'Validar el escenario antes de aplicarlo.',
    expectedImpact: 'Por determinar.',
    effort: 'medium',
    evidence: ['ventas válidas del periodo'],
    requiresConfirmation: true
  }],
  limitations: [],
  confidence: 'medium',
  source: 'cloud',
  coverage: { complete: true },
  citations: [],
  actionDrafts: []
});

describe('sales profitability agent service', () => {
  it('loads current and comparable history, sends aggregated context, and merges deterministic calculations', async () => {
    const getSalesFinalHistory = vi.fn(async () => history);
    const analyze = vi.fn(async (request) => {
      expect(request.context).toBeTruthy();
      expect(JSON.stringify(request.context)).not.toContain('internal-sale-id');
      return { rawResultContent: providerResponse, usageStatus: { used: 1, limit: 15, remaining: 14 } };
    });
    const runner = createSalesProfitabilityAgentRunner({
      repository: { getSalesFinalHistory },
      analyze,
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Por qué cambió mi margen?',
      intent: 'explain_change',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: true,
      requestKey: 'request-1'
    });

    expect(getSalesFinalHistory).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.providerCalled).toBe(true);
    expect(result.usageStatus.remaining).toBe(14);
    expect(result.response.calculations.some((item) => item.label === 'Utilidad bruta')).toBe(true);
  });

  it('deduplicates concurrent submissions with the same request key', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const analyze = vi.fn(async () => { await gate; return { rawResultContent: providerResponse }; });
    const runner = createSalesProfitabilityAgentRunner({
      repository: { getSalesFinalHistory: vi.fn(async () => history) },
      analyze,
      assertActor: vi.fn()
    });
    const first = runner({ question: 'Explica mi margen', intent: 'explain_change', period: { from: '2026-09-01', to: '2026-09-07', days: 7 }, requestKey: 'same-request' });
    const second = runner({ question: 'Explica mi margen', intent: 'explain_change', period: { from: '2026-09-01', to: '2026-09-07', days: 7 }, requestKey: 'same-request' });
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(firstResult.response.executiveSummary).toBe(secondResult.response.executiveSummary);
  });

  it('does not call the provider when the period has no valid sales', async () => {
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({
      repository: { getSalesFinalHistory: vi.fn(async () => ({ rows: [] })) },
      analyze,
      assertActor: vi.fn()
    });
    const result = await runner({ question: 'Explica mi margen', intent: 'explain_change', period: { from: '2026-09-01', to: '2026-09-07', days: 7 }, compare: false });
    expect(analyze).not.toHaveBeenCalled();
    expect(result.response.status).toBe('incomplete');
    expect(result.providerCalled).toBe(false);
  });

  it('preloads product options from reports without invoking the provider or quota path', async () => {
    const getSalesFinalHistory = vi.fn(async () => ({
      source: { mode: 'cloud_final' },
      rows: [
        ...history.rows,
        {
          id: 'internal-sale-id-b',
          status: 'closed',
          total: 60,
          items: [{ name: 'Producto B', quantity: 1, unitPrice: 60, cost: 25, total: 60 }]
        }
      ]
    }));
    const assertActor = vi.fn();
    const loader = createSalesProfitabilityProductLoader({
      repository: { getSalesFinalHistory },
      assertActor
    });

    const prepared = await loader({ period: { from: '2026-09-01', to: '2026-09-07', days: 7 } });

    expect(assertActor).toHaveBeenCalledTimes(1);
    expect(getSalesFinalHistory).toHaveBeenCalledTimes(1);
    expect(prepared.products.map((row) => row.name)).toEqual(expect.arrayContaining(['Producto A', 'Producto B']));
    expect(JSON.stringify(prepared.products)).not.toContain('internal-sale-id');
  });

  it('keeps deterministic fields authoritative when provider returns conflicting calculations', async () => {
    const conflictingProvider = JSON.stringify({
      ...JSON.parse(providerResponse),
      executiveSummary: 'Explicación narrativa válida.',
      facts: [{ label: 'Inventado', quantity: 999 }],
      calculations: [{
        label: 'Utilidad inventada',
        value: 999999,
        formattedValue: '$999,999',
        formula: 'inventada',
        source: 'provider',
        period: {}
      }],
      assumptions: ['inventado'],
      scenarios: [{ label: 'inventado' }],
      limitations: ['inventado'],
      coverage: { validSales: 999 },
      source: 'local'
    });
    const runner = createSalesProfitabilityAgentRunner({
      repository: { getSalesFinalHistory: vi.fn(async () => history) },
      analyze: vi.fn(async () => ({ rawResultContent: conflictingProvider })),
      assertActor: vi.fn()
    });

    const result = await runner({
      question: '¿Mi negocio es rentable?',
      intent: 'profitability_summary',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      compare: false
    });

    expect(result.response.executiveSummary).toBe('Explicación narrativa válida.');
    expect(result.response.calculations.some((row) => row.label === 'Utilidad bruta')).toBe(true);
    expect(result.response.calculations.some((row) => row.label === 'Utilidad inventada')).toBe(false);
    expect(result.response.coverage.validSales).toBe(1);
    expect(result.response.source).toBe('cloud');
  });

});
