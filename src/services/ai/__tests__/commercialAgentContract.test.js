import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_AGENT_KEYS,
  COMMERCIAL_AGENT_INTENTS,
  FEATURE_NOT_READY,
  createCommercialLocalResponse,
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
      'sales_growth',
      'ticket_growth',
      'product_opportunity',
      'sales_trend',
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

  it('keeps all six implemented commercial intents supported', () => {
    const expected = [
      ['¿Mi negocio es rentable?', 'profitability_summary'],
      ['¿Por qué cambió mi margen?', 'explain_change'],
      ['¿Qué productos están afectando mi rentabilidad?', 'product_risk'],
      ['¿Qué pasa si aumento el precio?', 'price_simulation'],
      ['¿Qué combos puedo formar?', 'combo_opportunity'],
      ['¿Qué promoción puedo simular?', 'promotion_opportunity']
    ];
    for (const [question, intent] of expected) {
      expect(resolveCommercialIntent(question)).toMatchObject({
        kind: 'supported',
        intent,
        confidence: 'high',
        requiresData: true,
        requiresProvider: true
      });
    }
  });

  it('answers identity questions from Lía locally and explains the acronym', () => {
    const expectedTopics = [
      ['¿Cómo te llamas?', 'name'],
      ['como te llamas', 'name'],
      ['¿Cuál es tu nombre?', 'name'],
      ['¿Quién eres?', 'identity'],
      ['quien eres', 'identity'],
      ['¿Qué eres?', 'identity'],
      ['¿Eres una IA?', 'ai'],
      ['¿Qué puedes hacer?', 'capabilities'],
      ['¿Qué sabes hacer?', 'capabilities'],
      ['¿Para qué sirves?', 'capabilities'],
      ['¿Por qué te llamas Lía?', 'name_meaning'],
      ['porque te llamas lia', 'name_meaning'],
      ['¿Por qué Lía?', 'name_meaning'],
      ['¿Qué significa Lía?', 'name_meaning'],
      ['¿Qué significa tu nombre?', 'name_meaning'],
      ['¿Qué quiere decir Lía?', 'name_meaning'],
      ['que quiere decir lia', 'name_meaning'],
      ['¿De dónde salió tu nombre?', 'name_meaning'],
      ['¿De dónde viene el nombre Lía?', 'name_meaning'],
      ['de donde salio tu nombre', 'name_meaning'],
      ['¿Por qué ese nombre?', 'name_meaning']
    ];

    for (const [question, topic] of expectedTopics) {
      expect(resolveCommercialIntent(question)).toMatchObject({
        kind: 'identity',
        topic,
        requiresData: false,
        requiresProvider: false
      });
    }

    const meaning = createCommercialLocalResponse(resolveCommercialIntent('¿Por qué te llamas Lía?'));
    expect(meaning.status).toBe('local_answer');
    expect(meaning.executiveSummary).toContain('Lanzo Inteligencia Analítica');
    expect(meaning.source).toBe('local');
    expect(validateCommercialAgentResponse(meaning).valid).toBe(true);
  });

  it('recognizes competition, assortment and growth without redirecting them to profitability', () => {
    const cases = [
      ['Ayúdame a analizar mi competencia.', 'competition'],
      ['Analiza mi competencia para mejorar mi negocio.', 'competition'],
      ['¿Qué está haciendo mejor mi competencia?', 'competition'],
      ['Ayúdame con mis competidores.', 'competition'],
      ['Quiero ver qué hace mi competencia.', 'competition'],
      ['¿Qué productos puedo incorporar a mi negocio?', 'assortment'],
      ['¿Qué productos nuevos debería vender?', 'assortment'],
      ['¿Qué productos nuevos puedo agregar a mi catálogo?', 'assortment'],
      ['¿Qué productos o servicios puedo incorporar para atraer más clientela?', 'assortment'],
      ['¿Qué productos o servicios puedo incorporar a mi negocio para atraer más clientela?', 'assortment'],
      ['Quiero meter productos nuevos.', 'assortment'],
      ['¿Qué otra cosa puedo vender?', 'assortment'],
      ['¿Qué puedo incorporar para atraer más clientela?', 'assortment'],
      ['¿Cómo puedo vender más?', 'sales_growth'],
      ['¿Cómo puedo aumentar mis ventas?', 'sales_growth'],
      ['¿Cómo hago crecer mi negocio?', 'sales_growth'],
      ['¿Dónde tengo oportunidades de crecimiento?', 'sales_growth'],
      ['¿Cómo aumento mi ticket promedio?', 'ticket_growth'],
      ['¿Cómo puedo aumentar mi ticket promedio?', 'ticket_growth'],
      ['¿Qué productos debería impulsar?', 'product_opportunity'],
      ['¿Mis ventas están creciendo?', 'sales_trend']
    ];

    for (const [question, topic] of cases) {
      const resolution = resolveCommercialIntent(question);
      if (['competition', 'assortment'].includes(topic)) {
        expect(resolution).toMatchObject({
          kind: 'recognized_not_supported',
          topic,
          confidence: 'high',
          requiresData: false,
          requiresProvider: false
        });
      } else {
        expect(resolution).toMatchObject({
          kind: 'supported',
          intent: topic,
          topic,
          confidence: 'high',
          requiresData: true,
          requiresProvider: true
        });
      }
    }
  });

  it('builds local copy for assortment and competition while preserving identity copy', () => {
    const cases = [
      ['¿Qué productos o servicios puedo incorporar a mi negocio para atraer más clientela?', 'assortment', /ampliar tu oferta|productos nuevos|productos o servicios/i],
      ['¿Qué productos nuevos debería vender?', 'assortment', /ampliar tu oferta|productos nuevos|productos o servicios/i],
      ['Ayúdame a analizar mi competencia', 'competition', /competencia|competidores/i]
    ];
    const messagesByTopic = new Map();

    for (const [question, topic, copyPattern] of cases) {
      const resolution = resolveCommercialIntent(question);
      expect(resolution).toMatchObject({ kind: 'recognized_not_supported', topic });

      const message = createCommercialLocalResponse(resolution).executiveSummary;
      expect(message).toMatch(copyPattern);
      expect(message).not.toMatch(/^Soy Lía\b/u);
      messagesByTopic.set(topic, message);
    }

    expect(messagesByTopic.size).toBe(2);
    expect(new Set(messagesByTopic.values()).size).toBe(2);

    const identity = createCommercialLocalResponse(resolveCommercialIntent('¿Cómo te llamas?'));
    const nameMeaning = createCommercialLocalResponse(resolveCommercialIntent('¿Por qué te llamas Lía?'));
    expect(identity.executiveSummary).toMatch(/^Soy Lía\b/u);
    expect(nameMeaning.executiveSummary).toContain('Lanzo Inteligencia Analítica');
  });

  it('does not let generic business words trigger profitability and asks for missing context', () => {
    for (const question of ['mi negocio', 'ventas', 'precio', 'clientes', 'quiero mejorar esto', 'quiero mejorar mi negocio']) {
      const result = resolveCommercialIntent(question);
      expect(result.kind).not.toBe('supported');
      expect(result.intent).not.toBe('profitability_summary');
    }

    expect(resolveCommercialIntent('¿Qué pasa si aumento el precio?', { scenario: {} })).toMatchObject({
      kind: 'needs_context',
      intent: 'price_simulation',
      missingContext: ['productName', 'newPrice'],
      requiresData: false,
      requiresProvider: false
    });
    expect(resolveCommercialIntent('¿Qué pasa si aumento el precio?', {
      scenario: { productName: 'Producto A', newPrice: '120' }
    }).kind).toBe('supported');
  });

  it('reserves out-of-scope for unrelated questions and builds Lía-branded local responses', () => {
    for (const question of [
      'Hola',
      '¿Qué clima hará mañana?',
      '¿Qué presidente ganó?',
      'Dame una receta de sopa',
      '¿Cuáles son mis clientes frecuentes?',
      '¿Qué pedidos hay en ecommerce?',
      '¿Quién ganó el partido?'
    ]) {
      const resolution = resolveCommercialIntent(question);
      expect(resolution.kind).toBe('out_of_scope');
      expect(resolution.requiresProvider).toBe(false);
      expect(createCommercialLocalResponse(resolution).executiveSummary).toContain('Soy Lía');
    }

    expect(resolveCommercialIntent('¿Qué hay en inventario?').kind).toBe('out_of_scope');
    expect(createOutOfScopeResponse({ reason: 'identity' }).executiveSummary).toContain('Soy Lía');
  });
});
