import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_AGENT_KEYS,
  COMMERCIAL_AGENT_INTENTS,
  FEATURE_NOT_READY,
  parseCommercialAgentResponse,
  resolveCommercialAgentRequest,
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
});
