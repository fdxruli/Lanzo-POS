import { describe, expect, it, vi } from 'vitest';
import { validatePayload } from '../../../../supabase/functions/lanzo-ai-agent/contract.ts';
import { createHandler } from '../../../../supabase/functions/lanzo-ai-agent/index.ts';

const auth = {
  licenseKey: 'synthetic-license',
  deviceFingerprint: 'synthetic-device',
  deviceSecurityToken: 'synthetic-device-token',
  staffSessionToken: null
};

const baseContext = (scenarios = []) => ({
  agentKey: 'salesProfitability',
  scope: 'current_authenticated_tenant',
  period: { from: '2026-09-01', to: '2026-09-07', label: 'Periodo actual' },
  source: 'cloud',
  sales: {
    summary: {
      netSales: 600,
      units: 8,
      salesCount: 10,
      averageTicket: 60,
      discounts: 0,
      discountsKnown: true,
      unitCosts: 360,
      knownCostOfSale: 360,
      profit: 240,
      margin: 0.4,
      costCoverage: 1,
      missingCostProducts: 0,
      excludedSales: 0,
      ecommerceDuplicates: 0,
      profitabilityStatus: 'profitable',
      profitabilityExplanation: 'Datos completos.'
    },
    products: [],
    channels: [],
    comparison: null,
    contributors: [],
    evidenceKeys: ['scenarios.values'],
    coverage: { validSales: 10, costCoverage: 1, complete: true },
    calculations: [],
    assumptions: [],
    limitations: [],
    scenarios
  }
});

const commercialPayload = ({ intent = 'combo_opportunity', scenario = {}, scenarios = [] } = {}) => ({
  auth,
  agentKey: 'salesProfitability',
  intent,
  question: intent === 'price_simulation'
    ? '¿Qué pasa si aumento el precio?'
    : intent === 'promotion_opportunity'
      ? '¿Qué promoción puedo simular?'
      : '¿Qué combos puedo formar?',
  requestKey: 'edge-contract-bridge',
  period: {
    from: '2026-09-01',
    to: '2026-09-07',
    previousFrom: null,
    previousTo: null,
    timezone: 'America/Mexico_City'
  },
  scenario,
  context: baseContext(scenarios),
  options: { temperature: 0.2, maxTokens: 2048 }
});

const completeCombo = {
  products: ['Producto A', 'Producto B'],
  tickets: 4,
  frequency: 0.4,
  ticketPercentage: 0.4,
  historicalJointSales: 600,
  averageJointSale: 150,
  cost: 90,
  costCoverage: 1,
  costStatus: 'complete',
  comboPrice: 150,
  discount: null,
  profit: 60,
  margin: 0.4,
  evidenceLevel: 'medium',
  confidence: 'medium',
  opportunity: 'Evaluar presentar Producto A y Producto B juntos.',
  isPrediction: false,
  note: 'Correlación histórica; no implica causalidad.'
};

describe('deployed Edge commercial contract bridge', () => {
  it('accepts the realistic combo fields emitted by the deterministic analytics', () => {
    const result = validatePayload(commercialPayload({ scenarios: [completeCombo] }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.request.kind).toBe('commercialAnalysis');
  });

  it('accepts incomplete combo cost coverage and low evidence without conflating product cost enums', () => {
    const result = validatePayload(commercialPayload({
      scenarios: [{
        ...completeCombo,
        tickets: 2,
        frequency: 0.08,
        ticketPercentage: 0.08,
        cost: null,
        costCoverage: 0.5,
        costStatus: 'incomplete',
        profit: null,
        margin: null,
        evidenceLevel: 'low',
        confidence: 'low'
      }]
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects unknown scenario keys and the product-only costStatus enum', () => {
    expect(validatePayload(commercialPayload({
      scenarios: [{ ...completeCombo, unexpectedInternalKey: true }]
    }))).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    expect(validatePayload(commercialPayload({
      scenarios: [{ ...completeCombo, costStatus: 'definitive' }]
    }))).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('keeps price and promotion output scenarios compatible', () => {
    const volumeScenario = {
      label: 'Volumen sin cambio',
      volume: 2,
      utility: 60,
      margin: 0.6,
      impactVsCurrent: 10,
      isPrediction: false,
      currentPrice: 50,
      newPrice: 55,
      note: 'Escenario ilustrativo; no es una predicción de demanda.'
    };

    expect(validatePayload(commercialPayload({
      intent: 'price_simulation',
      scenario: { productName: 'Producto A', newPrice: 55, historicalVolume: 2 },
      scenarios: [volumeScenario]
    })).ok).toBe(true);

    expect(validatePayload(commercialPayload({
      intent: 'promotion_opportunity',
      scenario: { productName: 'Producto A', discountPercent: 10, historicalVolume: 2 },
      scenarios: [volumeScenario]
    })).ok).toBe(true);
  });

  it('rejects invalid contract data before creating an RPC client or contacting the provider', async () => {
    const createClient = vi.fn();
    const fetchImpl = vi.fn();
    const handler = createHandler({
      env: (name) => ({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
        AI_API_KEY: 'synthetic-ai-key',
        AI_API_URL: 'https://provider.example/v1/chat/completions',
        AI_MODEL: 'synthetic-model'
      }[name]),
      createClient,
      fetchImpl,
      requestId: () => 'request-bridge-1'
    });

    const response = await handler(new Request('https://example.test/lanzo-ai-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commercialPayload({
        scenarios: [{ ...completeCombo, unknownKey: 'blocked' }]
      }))
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serves usage as read-only without provider calls or quota reservation RPCs', async () => {
    const calls = [];
    const rpc = vi.fn(async (name) => {
      calls.push(name);
      if (name === 'get_ai_agent_usage') {
        return {
          data: {
            success: true,
            limit: 15,
            used: 4,
            remaining: 11,
            period_end: '2026-10-01T00:00:00Z'
          },
          error: null
        };
      }
      return { data: null, error: { code: 'unexpected-rpc' } };
    });
    const fetchImpl = vi.fn();
    const handler = createHandler({
      env: (name) => ({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role'
      }[name]),
      createClient: vi.fn(() => ({ rpc })),
      fetchImpl,
      requestId: () => 'request-usage-bridge'
    });

    const response = await handler(new Request('https://example.test/lanzo-ai-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'usage', auth })
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, limit: 15, used: 4, remaining: 11 });
    expect(calls).toEqual(['get_ai_agent_usage']);
    expect(calls).not.toContain('begin_ai_agent_analysis');
    expect(calls).not.toContain('complete_ai_agent_analysis');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
