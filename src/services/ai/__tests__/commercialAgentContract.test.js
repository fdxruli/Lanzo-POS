import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_AGENT_KEYS,
  COMMERCIAL_AGENT_INTENTS,
  FEATURE_NOT_READY,
  createOutOfScopeResponse,
  normalizeScenarioForIntent,
  parseCommercialAgentResponse,
  resolveCommercialIntent,
  resolveCommercialAgentRequest,
  validateCommercialAgentRequest,
  validateCommercialAgentResponse
} from '../commercialAgentContract';

const baseResponse = (overrides = {}) => ({
  version: 1,
  agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
  status: 'completed',
  answer: 'La información validada está lista para revisar.',
  facts: [],
  calculations: [],
  assumptions: [],
  limitations: [],
  recommendations: [],
  actionDrafts: [],
  source: 'mixed',
  coverage: { complete: true },
  citations: [],
  ...overrides
});

describe('commercial AI agent contract', () => {
  it('defines only the new commercial agent keys and future intents', () => {
    expect(Object.values(COMMERCIAL_AGENT_KEYS)).toEqual(['salesProfitability', 'ecommerce']);
    expect(COMMERCIAL_AGENT_INTENTS).toEqual([
      'profitability_summary',
      'explain_change',
      'product_risk',
      'price_simulation',
      'combo_opportunity',
      'promotion_opportunity',
      'store_health',
      'order_funnel',
      'catalog_health'
    ]);
  });

  it('returns FEATURE_NOT_READY without invoking a provider or inventing an answer', () => {
    const result = resolveCommercialAgentRequest({
      agentKey: COMMERCIAL_AGENT_KEYS.ECOMMERCE,
      intent: 'order_funnel',
      question: '¿Cómo está el embudo de pedidos?',
      threadId: 'thread-visible-only'
    });

    expect(result.valid).toBe(true);
    expect(result.status).toBe(FEATURE_NOT_READY);
    expect(result.response.response).toMatchObject({
      agentKey: COMMERCIAL_AGENT_KEYS.ECOMMERCE,
      status: 'not_ready',
      limitations: [FEATURE_NOT_READY],
      actionDrafts: []
    });
  });

  it('accepts completed and incomplete response contracts', () => {
    expect(validateCommercialAgentResponse(baseResponse()).valid).toBe(true);
    expect(validateCommercialAgentResponse(baseResponse({ status: 'incomplete' })).valid).toBe(true);
    expect(validateCommercialAgentResponse(baseResponse({ status: 'not_ready' })).notReady).toBe(true);
  });

  it('rejects invalid keys, malformed JSON and unauthorized action drafts', () => {
    expect(validateCommercialAgentResponse(baseResponse({ agentKey: 'inventoryAuditor' })).code).toBe('INVALID_AGENT_KEY');
    expect(parseCommercialAgentResponse('{ malformed json')).toMatchObject({ valid: false, code: 'MALFORMED_JSON' });
    expect(validateCommercialAgentResponse(baseResponse({ actionDrafts: [{ type: 'change_price' }] })).code)
      .toBe('ACTION_DRAFTS_NOT_ALLOWED');
  });

  it('rejects HTML, SQL and executable code in any response field', () => {
    expect(validateCommercialAgentResponse(baseResponse({ answer: '<strong>Venta</strong>' })).code)
      .toBe('UNSAFE_RESPONSE_CONTENT');
    expect(validateCommercialAgentResponse(baseResponse({ facts: ['SELECT * FROM sales'] })).code)
      .toBe('UNSAFE_RESPONSE_CONTENT');
    expect(validateCommercialAgentResponse(baseResponse({ answer: '```js\nalert(1)\n```' })).code)
      .toBe('UNSAFE_RESPONSE_CONTENT');
  });

  it('requires non-empty content for available AI narrative and allowlisted diagnostics when unavailable', () => {
    const availableNarrative = {
      status: 'available',
      executiveSummary: 'La narrativa se basa en los datos revisados.',
      explanation: null,
      recommendations: []
    };
    expect(validateCommercialAgentResponse(baseResponse({ aiNarrative: availableNarrative })).valid).toBe(true);
    expect(validateCommercialAgentResponse(baseResponse({
      aiNarrative: { ...availableNarrative, executiveSummary: ' ' }
    })).code).toBe('AI_NARRATIVE_CONTENT_REQUIRED');
    expect(validateCommercialAgentResponse(baseResponse({
      aiNarrative: {
        status: 'unavailable',
        diagnosticCode: 'AI_NARRATIVE_INVALID_JSON',
        executiveSummary: null,
        explanation: null,
        recommendations: []
      }
    })).valid).toBe(true);
    expect(validateCommercialAgentResponse(baseResponse({
      aiNarrative: {
        status: 'unavailable',
        diagnosticCode: 'raw-provider-text',
        executiveSummary: null,
        explanation: null,
        recommendations: []
      }
    })).code).toBe('INVALID_AI_NARRATIVE_DIAGNOSTIC');
  });

  it('normalizes only the scenario fields allowed by each intent', () => {
    expect(normalizeScenarioForIntent('price_simulation', {
      productName: ' Producto A ',
      newPrice: '120',
      historicalVolume: '0',
      promotionalPrice: '80',
      discountPercent: '20'
    })).toEqual({ productName: 'Producto A', newPrice: 120, historicalVolume: 0 });
    expect(normalizeScenarioForIntent('promotion_opportunity', {
      productName: 'Producto A',
      discountPercent: '20',
      historicalVolume: '3',
      newPrice: '120'
    })).toEqual({ productName: 'Producto A', discountPercent: 20, historicalVolume: 3 });
    expect(normalizeScenarioForIntent('combo_opportunity', {
      productName: 'Producto A',
      newPrice: '120',
      historicalVolume: '3'
    })).toEqual({});
    expect(normalizeScenarioForIntent('combo_opportunity', {
      productName: 123,
      newPrice: 'no es un precio',
      historicalVolume: '-4',
      ignoredField: true
    })).toEqual({});
    expect(normalizeScenarioForIntent('price_simulation', {
      productName: 'Producto A',
      newPrice: '   ',
      historicalVolume: '',
      ignoredField: 'stale'
    })).toEqual({ productName: 'Producto A' });
    expect(normalizeScenarioForIntent('promotion_opportunity', {
      productName: 'Producto A',
      discountPercent: '   '
    })).toEqual({ productName: 'Producto A' });
  });

  it('rejects invalid numeric scenario values without converting them to zero', () => {
    expect(() => normalizeScenarioForIntent('price_simulation', null)).toThrow('INVALID_SCENARIO');
    expect(() => normalizeScenarioForIntent('price_simulation', { newPrice: '-1' })).toThrow('SCENARIO_VALUE_MUST_BE_POSITIVE');
    expect(() => normalizeScenarioForIntent('promotion_opportunity', { discountPercent: '101' })).toThrow('SCENARIO_VALUE_OUT_OF_RANGE');
    expect(() => normalizeScenarioForIntent('promotion_opportunity', { promotionalPrice: '80', discountPercent: '20' })).toThrow('PROMOTION_SCENARIO_AMBIGUOUS');
    expect(() => normalizeScenarioForIntent('price_simulation', { newPrice: 'Infinity' })).toThrow('INVALID_SCENARIO_NUMBER');
    expect(() => normalizeScenarioForIntent('price_simulation', { historicalVolume: '-1' })).toThrow('SCENARIO_VALUE_OUT_OF_RANGE');
    expect(() => normalizeScenarioForIntent('promotion_opportunity', { promotionalPrice: '0' })).toThrow('SCENARIO_VALUE_MUST_BE_POSITIVE');
    expect(() => normalizeScenarioForIntent('price_simulation', { productName: 'P'.repeat(121) })).toThrow('INVALID_SCENARIO_PRODUCT');
    expect(validateCommercialAgentRequest({
      agentKey: COMMERCIAL_AGENT_KEYS.SALES_PROFITABILITY,
      intent: 'combo_opportunity',
      question: '¿Qué combos puedo formar?',
      period: { from: '2026-09-01', to: '2026-09-07' },
      scenario: { newPrice: '120' }
    })).toMatchObject({ valid: false, code: 'INVALID_SCENARIO_KEYS' });
  });

  it('resolves only six supported commercial intents and gives deterministic out-of-scope responses', () => {
    expect(resolveCommercialIntent('¿Mi negocio es rentable?')).toEqual({ kind: 'supported', intent: 'profitability_summary' });
    expect(resolveCommercialIntent('¿Por qué cambió mi margen?')).toEqual({ kind: 'supported', intent: 'explain_change' });
    expect(resolveCommercialIntent('¿Qué productos están afectando mi rentabilidad?')).toEqual({ kind: 'supported', intent: 'product_risk' });
    expect(resolveCommercialIntent('¿Qué pasa si aumento el precio?')).toEqual({ kind: 'supported', intent: 'price_simulation' });
    expect(resolveCommercialIntent('¿Qué combos puedo formar?')).toEqual({ kind: 'supported', intent: 'combo_opportunity' });
    expect(resolveCommercialIntent('¿Qué promoción puedo simular?')).toEqual({ kind: 'supported', intent: 'promotion_opportunity' });
    expect(resolveCommercialIntent('¿Cómo te llamas?')).toEqual({ kind: 'out_of_scope', reason: 'identity' });
    expect(resolveCommercialIntent('¿Qué hay en inventario?')).toEqual({ kind: 'out_of_scope', reason: 'module' });
    for (const question of [
      'Hola',
      '¿Qué clima hará mañana?',
      '¿Qué presidente ganó?',
      'Dame una receta de sopa',
      '¿Cuáles son mis clientes frecuentes?',
      '¿Qué pedidos hay en ecommerce?',
      '¿Qué puedes hacer?'
    ]) {
      expect(resolveCommercialIntent(question).kind).toBe('out_of_scope');
    }
    expect(createOutOfScopeResponse({ reason: 'identity' }).executiveSummary).toContain('Soy el asistente de Ventas y Rentabilidad');
  });
});
