import { describe, expect, it } from 'vitest';
import { inferCommercialScenarioFromQuestion, resolveCommercialIntent } from '../commercialQuestionRouter';

describe('commercial question router: Lía sales growth', () => {
  it.each([
    ['Quiero vender 100000', { intent: 'goal_simulation', scenario: { goalType: 'revenue', targetValue: 100000 } }],
    ['¿Cuánto necesito vender para facturar $100,000?', { intent: 'goal_simulation', scenario: { goalType: 'revenue', targetValue: 100000 } }],
    ['Quiero ganar $20,000', { intent: 'goal_simulation', scenario: { goalType: 'gross_profit', targetValue: 20000 } }],
    ['Quiero un ticket promedio de $250', { intent: 'goal_simulation', scenario: { goalType: 'average_ticket', targetValue: 250 } }],
    ['Quiero llegar a 30% de margen', { intent: 'goal_simulation', scenario: { goalType: 'gross_margin', targetValue: 30 } }],
    ['¿Qué precio necesito para tener margen de 30% en Producto A?', { intent: 'goal_simulation', scenario: { goalType: 'product_margin', targetValue: 30, productName: 'Producto A' } }],
    ['¿Qué pasa si mis ventas aumentan 10%?', { intent: 'what_if_analysis', scenario: { changeType: 'sales', changePercent: 10 } }],
    ['¿Qué pasa si vendo 20% menos?', { intent: 'what_if_analysis', scenario: { changeType: 'sales', changePercent: -20 } }],
    ['¿Qué pasa si vendo 20% más de Producto A?', { intent: 'what_if_analysis', scenario: { changeType: 'product', changePercent: 20, productName: 'Producto A' } }]
  ])('extracts a clear deterministic scenario from %s', (question, expected) => {
    expect(inferCommercialScenarioFromQuestion(question)).toEqual(expected);
    const resolution = resolveCommercialIntent(question);
    expect(resolution).toMatchObject({ kind: 'supported', intent: expected.intent, requiresProvider: true, requiresData: true });
  });

  it('asks for context when a goal or what-if is incomplete and does not require a provider', () => {
    expect(resolveCommercialIntent('Quiero llegar a una meta')).toMatchObject({
      kind: 'needs_context', intent: 'goal_simulation', requiresProvider: false, requiresData: false,
      missingContext: ['goalType', 'targetValue']
    });
    expect(resolveCommercialIntent('¿Qué pasa si vendo más de este producto?')).toMatchObject({
      kind: 'needs_context', intent: 'what_if_analysis', requiresProvider: false, requiresData: false,
      missingContext: expect.arrayContaining(['changePercent', 'productName'])
    });
  });

  it('does not guess ambiguous localized amounts or treat the percent as an amount', () => {
    expect(inferCommercialScenarioFromQuestion('Quiero facturar 100.000')).toMatchObject({
      intent: 'goal_simulation', scenario: { goalType: 'revenue' }
    });
    expect(inferCommercialScenarioFromQuestion('Quiero llegar a 30% de margen').scenario.targetValue).toBe(30);
    expect(inferCommercialScenarioFromQuestion('Quiero facturar 100,000.50').scenario.targetValue).toBe(100000.5);
  });

  it.each([
    ['¿Cómo puedo aumentar mis ventas?', 'sales_growth'],
    ['¿Qué pasa si mis ventas aumentan 10%?', 'what_if_analysis'],
    ['Quiero vender $100,000', 'goal_simulation'],
    ['¿Qué debería priorizar para mejorar mi negocio?', 'commercial_strategy'],
    ['¿Mi negocio es rentable?', 'profitability_summary'],
    ['¿Qué pasa si aumento el precio?', 'price_simulation']
  ])('keeps %s separate as %s', (question, intent) => {
    expect(resolveCommercialIntent(question).intent).toBe(intent);
  });

  it.each([
    '¿Cuál sería mi mejor estrategia comercial con mis datos?',
    '¿Qué debería trabajar primero?',
    '¿Dónde debería enfocar mis esfuerzos?'
  ])('routes explicit strategic-priority questions to the grounded strategy intent: %s', (question) => {
    expect(resolveCommercialIntent(question)).toMatchObject({
      kind: 'supported', intent: 'commercial_strategy', requiresData: true, requiresProvider: true
    });
  });

  it('keeps a goal plus strategy question as a deterministic goal with optional strategy evidence', () => {
    expect(inferCommercialScenarioFromQuestion('Quiero facturar $150,000, ¿qué tendría que cambiar?')).toMatchObject({
      intent: 'goal_simulation', scenario: { goalType: 'revenue', targetValue: 150000 }
    });
    expect(resolveCommercialIntent('Quiero facturar $150,000, ¿qué tendría que cambiar?').intent).toBe('goal_simulation');
  });

  it.each([
    '¿Cómo puedo aumentar mis ventas?',
    '¿Cómo puedo vender más?',
    '¿Cómo hago crecer mi negocio?',
    '¿Dónde tengo oportunidades de crecimiento?',
    'Mis ventas están bajas, ¿qué puedo revisar?',
    '¿Dónde ves oportunidades para vender más?'
  ])('routes general growth question: %s', (question) => {
    expect(resolveCommercialIntent(question)).toMatchObject({ kind: 'supported', intent: 'sales_growth' });
  });

  it.each([
    '¿Cómo puedo aumentar mi ticket promedio?',
    '¿Cómo puedo subir el ticket?',
    '¿Mi ticket promedio está creciendo?',
    '¿Cómo está mi ticket promedio?',
    '¿Qué puedo hacer para que cada venta sea mayor?'
  ])('routes ticket question: %s', (question) => {
    expect(resolveCommercialIntent(question)).toMatchObject({ kind: 'supported', intent: 'ticket_growth' });
  });

  it.each([
    '¿Qué productos debería impulsar?',
    '¿Qué productos están creciendo?',
    '¿Qué productos están perdiendo fuerza?',
    '¿Qué productos aportan más a mis ventas?',
    '¿Qué productos están funcionando mejor?',
    '¿Qué productos me conviene revisar para vender más?'
  ])('routes existing product question: %s', (question) => {
    expect(resolveCommercialIntent(question)).toMatchObject({ kind: 'supported', intent: 'product_opportunity' });
  });

  it.each([
    '¿Mis ventas están creciendo?',
    '¿Estoy vendiendo más que antes?',
    '¿Cómo han cambiado mis ventas?',
    '¿Qué tendencia tienen mis ventas?',
    '¿Mis ventas están bajando?'
  ])('routes sales trend question: %s', (question) => {
    expect(resolveCommercialIntent(question)).toMatchObject({ kind: 'supported', intent: 'sales_trend' });
  });

  it.each([
    '¿Cómo está mi surtido?',
    'Analiza mi catálogo',
    '¿Dónde tengo oportunidades en mi catálogo?',
    '¿Qué productos tengo y casi no vendo?',
    '¿Qué productos dejaron de venderse?',
    '¿Tengo productos sin movimiento?',
    '¿Qué categorías venden más?',
    '¿En qué categorías tengo más oportunidad?',
    '¿Qué productos debería revisar antes de agregar nuevos?',
    '¿Qué productos nuevos debería vender?',
    '¿Qué productos puedo incorporar?',
    '¿Qué más podría vender?',
    '¿Qué servicios puedo agregar?'
  ])('routes assortment question to supported analysis: %s', (question) => {
    expect(resolveCommercialIntent(question)).toMatchObject({
      kind: 'supported',
      intent: 'assortment_analysis',
      requiresProvider: true,
      requiresData: true
    });
  });

  it('keeps competition outside the provider-backed capabilities', () => {
    expect(resolveCommercialIntent('Ayúdame a analizar mi competencia')).toMatchObject({
      kind: 'recognized_not_supported',
      topic: 'competition',
      requiresProvider: false,
      requiresData: false
    });
  });

  it.each([
    ['¿Por qué te llamas Lía?', 'identity', 'name_meaning'],
    ['¿Mi negocio es rentable?', 'supported', 'profitability_summary'],
    ['¿Qué productos están afectando mi rentabilidad?', 'supported', 'product_risk'],
    ['¿Por qué cambió mi margen?', 'supported', 'explain_change'],
    ['¿Qué pasa si aumento el precio?', 'supported', 'price_simulation'],
    ['¿Qué combos puedo formar?', 'supported', 'combo_opportunity'],
    ['¿Qué promoción puedo simular?', 'supported', 'promotion_opportunity'],
    ['¿Cómo estuvieron mis ventas?', 'supported', 'profitability_summary']
  ])('preserves prior classification: %s', (question, kind, value) => {
    const resolved = resolveCommercialIntent(question);
    expect(resolved.kind).toBe(kind);
    expect(kind === 'identity' ? resolved.topic : resolved.intent).toBe(value);
  });
});
