import { describe, expect, it } from 'vitest';
import { resolveCommercialIntent } from '../commercialQuestionRouter';

describe('commercial question router: Lía sales growth', () => {
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
