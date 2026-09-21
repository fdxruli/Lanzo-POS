import { describe, expect, it, vi } from 'vitest';
import { createSalesProfitabilityAgentRunner } from '../salesProfitabilityAgentService';

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
});
