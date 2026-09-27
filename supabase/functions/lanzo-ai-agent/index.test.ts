import { createHandler } from './index.ts';
import {
  MAX_BODY_BYTES,
  MAX_USER_PROMPT_CHARS,
  validatePayload,
  type AuthPayload
} from './contract.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} expected ${String(expected)}, received ${String(actual)}`);
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

const auth: AuthPayload = {
  licenseKey: 'synthetic-license',
  deviceFingerprint: 'synthetic-device',
  deviceSecurityToken: 'synthetic-device-token',
  staffSessionToken: null
};

const baseEnv: Record<string, string> = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
  AI_API_KEY: 'synthetic-ai-key',
  AI_API_URL: 'https://provider.test/v1/chat/completions',
  AI_MODEL: 'synthetic-model'
};

type Call = { name: string; args: Record<string, unknown> };

function fakeClient(responder: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown | null }> | { data: unknown; error: unknown | null }) {
  const calls: Call[] = [];
  const client = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return await responder(name, args);
    }
  };
  return client;
}

function successBegin(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    usage_id: 'usage-synthetic-1',
    limit: 15,
    used: 1,
    remaining: 14,
    plan_code: 'pro-synthetic',
    plan_name: 'Pro sintético',
    ...overrides
  };
}

function successComplete() {
  return { success: true, usage_id: 'usage-synthetic-1', status: 'completed' };
}

function request(body: unknown, options: { method?: string; contentType?: string } = {}) {
  const method = options.method || 'POST';
  const headers = options.contentType === undefined
    ? { 'content-type': 'application/json' }
    : { 'content-type': options.contentType };
  return new Request('https://edge.test/lanzo-ai-agent', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body)
  });
}

function rawRequest(body: string) {
  return new Request('https://edge.test/lanzo-ai-agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });
}

function makeHandler(
  client: ReturnType<typeof fakeClient>,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    providerTimeoutMs?: number;
  } = {}
) {
  const values = { ...baseEnv, ...(options.env || {}) };
  return createHandler({
    env: (name) => values[name],
    createClient: (_url, _key, clientOptions) => {
      assertEquals(clientOptions.auth.persistSession, false, 'persistSession');
      assertEquals(clientOptions.auth.autoRefreshToken, false, 'autoRefreshToken');
      return client;
    },
    fetchImpl: options.fetchImpl,
    providerTimeoutMs: options.providerTimeoutMs,
    requestId: () => 'request-synthetic-1',
    now: () => 1000
  });
}

function chatResponse(
  content = 'respuesta sintética',
  usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
  finishReason = 'stop'
) {
  return new Response(JSON.stringify({
    id: 'provider-request-synthetic',
    model: 'reported-synthetic-model',
    choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'provider-request-synthetic' }
  });
}

function responsesResponse(content = 'respuesta responses sintética', status = 'completed', incompleteReason?: string) {
  return new Response(JSON.stringify({
    id: 'responses-request-synthetic',
    model: 'reported-responses-model',
    status,
    ...(incompleteReason ? { incomplete_details: { reason: incompleteReason } } : {}),
    output_text: content,
    usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function structuredCommercialResponse() {
  return JSON.stringify({
    version: 1,
    agentKey: 'salesProfitability',
    status: 'completed',
    executiveSummary: 'El margen requiere revisión.',
    explanation: 'Explicación basada en cálculos determinísticos.',
    facts: [],
    calculations: [],
    assumptions: [],
    scenarios: [],
    recommendations: [{
      title: 'Revisar mezcla',
      explanation: 'Validar productos de bajo margen.',
      expectedImpact: 'Por determinar.',
      effort: 'medium',
      evidence: ['ventas válidas'],
      requiresConfirmation: true
    }],
    limitations: [],
    confidence: 'medium',
    source: 'cloud',
    coverage: { complete: true },
    citations: [],
    actionDrafts: []
  });
}

function structuredCommercialRequest(overrides: Record<string, unknown> = {}) {
  return {
    auth,
    agentKey: 'salesProfitability',
    intent: 'explain_change',
    question: 'Explica el cambio de mi margen',
    requestKey: 'request-structured-1',
    period: { from: '2026-09-01', to: '2026-09-07', previousFrom: '2026-08-25', previousTo: '2026-08-31', timezone: 'America/Mexico_City' },
    scenario: {},
    context: {
      agentKey: 'salesProfitability',
      scope: 'current_authenticated_tenant',
      period: { from: '2026-09-01', to: '2026-09-07', label: 'Periodo actual' },
      source: 'cloud',
      sales: {
        summary: { netSales: 100, units: 2, salesCount: 1, averageTicket: 100, discounts: 0, unitCosts: 40, profit: 60, margin: 0.6, costCoverage: 1, missingCostProducts: 0, excludedSales: 0, ecommerceDuplicates: 0 },
        products: [{ name: 'Producto A', quantity: 2, netSales: 100, unitCost: 20, profit: 60, margin: 0.6, averagePrice: 50, costKnown: true }],
        channels: [{ channel: 'Físico', netSales: 100, orders: 1, units: 2, averageTicket: 100, share: 1 }],
        comparison: null,
        evidenceKeys: [
          'profitability.margin',
          'profitability.profit',
          'comparison.deltaMargin',
          'products.risks',
          'scenarios.values'
        ],
        coverage: { validSales: 1, complete: true },
        calculations: [],
        assumptions: [],
        scenarios: []
      }
    },
    options: { temperature: 0.2, maxTokens: 2048 },
    ...overrides
  };
}

function structuredCommercialRequestWithProduct(product: Record<string, unknown>) {
  const payload = structuredCommercialRequest();
  payload.context = {
    ...payload.context,
    sales: {
      ...payload.context.sales,
      products: [product as unknown as typeof payload.context.sales.products[number]]
    }
  };
  return payload;
}

function structuredCommercialRequestWithScenarioOutput(
  outputScenario: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) {
  const rawPayload = structuredCommercialRequest({
    intent: 'combo_opportunity',
    question: '¿Qué combos puedo formar?',
    period: {
      from: '2026-09-01',
      to: '2026-09-07',
      previousFrom: null,
      previousTo: null,
      timezone: 'America/Mexico_City'
    },
    scenario: {},
    ...overrides
  });
  const payload = rawPayload as unknown as Record<string, unknown>;
  const context = rawPayload.context as unknown as Record<string, unknown>;
  const sales = rawPayload.context.sales as unknown as Record<string, unknown>;
  payload.context = {
    ...context,
    sales: {
      ...sales,
      scenarios: [outputScenario]
    }
  };
  return payload;
}

function analysisClient(beginData: Record<string, unknown> = successBegin(), completeData: Record<string, unknown> = successComplete()) {
  return fakeClient(async (name) => {
    if (name === 'get_ai_agent_usage_unlimited') return { data: { success: true, limit: 15, used: 0, remaining: 15, ai_agents: true }, error: null };
    if (name === 'begin_ai_agent_analysis') return { data: beginData, error: null };
    if (name === 'complete_ai_agent_analysis') return { data: completeData, error: null };
    return { data: null, error: { code: 'unexpected-rpc' } };
  });
}

Deno.test('OPTIONS devuelve CORS', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client)(request(null, { method: 'OPTIONS' }));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assertEquals(response.headers.get('access-control-allow-headers'), 'authorization, x-client-info, apikey, content-type');
});

Deno.test('GET es rechazado', async () => {
  const response = await makeHandler(fakeClient(async () => ({ data: null, error: null })))(request(null, { method: 'GET' }));
  const body = await json(response);
  assertEquals(response.status, 405);
  assertEquals(body.success, false);
  assertEquals(body.code, 'INVALID_REQUEST');
  assertEquals(body.providerCalled, false);
  assertEquals(body.quotaOutcome, 'not_consumed');
});

Deno.test('content-type incorrecto es rechazado', async () => {
  const response = await makeHandler(fakeClient(async () => ({ data: null, error: null })))(request({ auth }, { contentType: 'text/plain' }));
  assertEquals(response.status, 400);
});

Deno.test('JSON inválido es rechazado', async () => {
  const response = await makeHandler(fakeClient(async () => ({ data: null, error: null })))(rawRequest('{invalid'));
  const body = await json(response);
  assertEquals(response.status, 400);
  assertEquals(body.code, 'INVALID_REQUEST');
});

Deno.test('body excesivo es rechazado', async () => {
  const body = `{"auth":{},"userPrompt":"${'x'.repeat(MAX_BODY_BYTES)}"}`;
  const response = await makeHandler(fakeClient(async () => ({ data: null, error: null })))(rawRequest(body));
  assertEquals(response.status, 413);
});

Deno.test('auth ausente devuelve AUTH_PAYLOAD_REQUIRED', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client)(request({ systemPrompt: 's', userPrompt: 'u' }));
  const body = await json(response);
  assertEquals(response.status, 401);
  assertEquals(body.code, 'AUTH_PAYLOAD_REQUIRED');
  assertEquals(client.calls.length, 0);
});

Deno.test('auth incompleta no llama RPC', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client)(request({ auth: { ...auth, deviceSecurityToken: '' }, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 401);
  assertEquals(client.calls.length, 0);
});

Deno.test('usage funciona sin variables del proveedor', async () => {
  const client = fakeClient(async (name) => (
    name === 'get_ai_agent_usage'
      ? { data: { success: true, limit: 15, used: 1, remaining: 14, ai_agents: true }, error: null }
      : { data: null, error: { code: 'unexpected-rpc' } }
  ));
  const handler = makeHandler(client, { env: { AI_API_KEY: undefined, OPENAI_API_KEY: undefined, AI_API_URL: undefined, AI_MODEL: undefined } });
  const response = await handler(request({ action: 'usage', auth }));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body.remaining, 14);
  assertEquals(client.calls.length, 1);
  assertEquals(client.calls[0].name, 'get_ai_agent_usage');
});

Deno.test('usage propaga staffSessionToken y no llama proveedor ni reserva cuota', async () => {
  const staffAuth = { ...auth, staffSessionToken: 'synthetic-staff-session' };
  const client = fakeClient(async () => ({ data: { success: true, limit: 15, used: 0, remaining: 15 }, error: null }));
  let providerCalls = 0;
  const response = await makeHandler(client, {
    fetchImpl: async () => {
      providerCalls += 1;
      return chatResponse();
    }
  })(request({ action: 'usage', auth: staffAuth }));
  assertEquals(response.status, 200);
  assertEquals(client.calls[0].args.p_staff_session_token, 'synthetic-staff-session');
  assertEquals(client.calls[0].name, 'get_ai_agent_usage');
  assertEquals(client.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 0);
  assertEquals(client.calls.filter((call) => call.name === 'complete_ai_agent_analysis').length, 0);
  assertEquals(providerCalls, 0);
});

Deno.test('usage conserva código RPC de error y estado 429', async () => {
  const client = fakeClient(async () => ({ data: { success: false, code: 'AI_RATE_LIMITED', limit: 15, used: 15, remaining: 0 }, error: null }));
  const response = await makeHandler(client)(request({ action: 'usage', auth }));
  const body = await json(response);
  assertEquals(response.status, 429);
  assertEquals(body.code, 'AI_RATE_LIMITED');
  assertEquals(body.remaining, 0);
});

Deno.test('prompt ausente es rechazado', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client)(request({ auth, systemPrompt: 'solo sistema' }));
  assertEquals(response.status, 400);
  assertEquals(client.calls.length, 0);
});

Deno.test('prompt excesivo devuelve PROMPT_TOO_LARGE', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client)(request({ auth, systemPrompt: 's', userPrompt: 'x'.repeat(MAX_USER_PROMPT_CHARS + 1) }));
  const body = await json(response);
  assertEquals(response.status, 413);
  assertEquals(body.code, 'PROMPT_TOO_LARGE');
  assertEquals(client.calls.length, 0);
});

Deno.test('agentType inválido es rechazado', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client)(request({ auth, agentType: 'arbitrary-agent', systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 400);
  assertEquals(client.calls.length, 0);
});

Deno.test('opciones inválidas son rechazadas', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client)(request({ auth, systemPrompt: 's', userPrompt: 'u', options: { temperature: 3 } }));
  assertEquals(response.status, 400);
  assertEquals(client.calls.length, 0);
});

Deno.test('analysis sin AI_API_KEY no reserva uso', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client, { env: { AI_API_KEY: undefined, OPENAI_API_KEY: undefined } })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  const body = await json(response);
  assertEquals(response.status, 500);
  assertEquals(body.code, 'AI_KEY_MISSING');
  assertEquals(client.calls.length, 0);
});

Deno.test('analysis sin AI_API_URL no reserva uso', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client, { env: { AI_API_URL: undefined } })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 500);
  assertEquals((await json(response)).code, 'AI_PROVIDER_ERROR');
  assertEquals(client.calls.length, 0);
});

Deno.test('analysis sin AI_MODEL no reserva uso', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client, { env: { AI_MODEL: undefined } })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 500);
  assertEquals((await json(response)).code, 'AI_PROVIDER_ERROR');
  assertEquals(client.calls.length, 0);
});

Deno.test('endpoint desconocido no reserva ni llama proveedor', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  let fetchCalls = 0;
  const response = await makeHandler(client, {
    env: { AI_API_URL: 'https://provider.test/v1/generate' },
    fetchImpl: async () => { fetchCalls += 1; return chatResponse(); }
  })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 500);
  assertEquals((await json(response)).code, 'AI_PROVIDER_ERROR');
  assertEquals(client.calls.length, 0);
  assertEquals(fetchCalls, 0);
});

Deno.test('request con nombre arbitrario de RPC es rechazado', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const response = await makeHandler(client)(request({ auth, rpcName: 'get_anything', systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 400);
  assertEquals(client.calls.length, 0);
});

Deno.test('begin rechazado impide llamar al proveedor', async () => {
  const client = fakeClient(async (name) => (
    name === 'begin_ai_agent_analysis'
      ? { data: { success: false, code: 'DEVICE_NOT_ALLOWED' }, error: null }
      : { data: null, error: null }
  ));
  let fetchCalls = 0;
  const response = await makeHandler(client, { fetchImpl: async () => { fetchCalls += 1; return chatResponse(); } })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 403);
  assertEquals((await json(response)).code, 'DEVICE_NOT_ALLOWED');
  assertEquals(fetchCalls, 0);
  assertEquals(client.calls.length, 1);
});

Deno.test('ai_agents requerido antes del proveedor', async () => {
  const client = fakeClient(async (name) => (
    name === 'begin_ai_agent_analysis'
      ? { data: { success: false, code: 'AI_AGENT_PERMISSION_REQUIRED' }, error: null }
      : { data: null, error: null }
  ));
  let fetchCalls = 0;
  const response = await makeHandler(client, {
    fetchImpl: async () => { fetchCalls += 1; return chatResponse(); }
  })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 403);
  assertEquals((await json(response)).code, 'AI_AGENT_PERMISSION_REQUIRED');
  assertEquals(fetchCalls, 0);
  assertEquals(client.calls.length, 1);
});

Deno.test('límite alcanzado devuelve 429 antes del proveedor', async () => {
  const client = fakeClient(async () => ({ data: { success: false, code: 'AI_AGENT_LIMIT_REACHED', limit: 15, used: 15, remaining: 0 }, error: null }));
  let fetchCalls = 0;
  const response = await makeHandler(client, { fetchImpl: async () => { fetchCalls += 1; return chatResponse(); } })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 429);
  assertEquals(fetchCalls, 0);
  assertEquals((await json(response)).remaining, 0);
});

Deno.test('agentType ausente se reserva como unknown', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, { fetchImpl: async () => chatResponse() })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 200);
  assertEquals(client.calls[0].args.p_agent_type, 'unknown');
});

Deno.test('staff token se propaga a begin', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, { fetchImpl: async () => chatResponse() })(request({ auth: { ...auth, staffSessionToken: 'synthetic-staff-session' }, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 200);
  assertEquals(client.calls[0].args.p_staff_session_token, 'synthetic-staff-session');
});

Deno.test('provider chat success devuelve contenido y usageStatus', async () => {
  const client = analysisClient();
  let providerBody: Record<string, unknown> | null = null;
  const response = await makeHandler(client, {
    env: { AI_MODEL: 'deepseek-v4-flash' },
    fetchImpl: async (_url, init) => {
      providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return chatResponse();
    }
  })(request({ auth, agentType: 'financialAnalyst', systemPrompt: 's', userPrompt: 'u', options: { temperature: 0.2, maxTokens: 2048 } }));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body.content, 'respuesta sintética');
  assertEquals((body.usageStatus as Record<string, unknown>).remaining, 14);
  assertEquals(client.calls[1].name, 'complete_ai_agent_analysis');
  assertEquals(client.calls[1].args.p_success, true);
  assert(providerBody !== null, 'El proveedor debe recibir un body');
  const capturedProviderBody = providerBody as Record<string, unknown>;
  assertEquals(capturedProviderBody.temperature, 0.2);
  assertEquals(capturedProviderBody.max_tokens, 2048, 'el límite no comercial conserva su valor');
  assertEquals(capturedProviderBody.response_format, undefined, 'JSON mode es exclusivo de narrativa comercial');
  assertEquals(capturedProviderBody.thinking, undefined, 'thinking disabled es exclusivo de narrativa comercial');
  const metadata = client.calls[1].args.p_metadata as Record<string, unknown>;
  assertEquals(metadata.provider, 'openai-compatible');
  assertEquals(metadata.protocol, 'chat-completions');
  assertEquals(metadata.model, 'deepseek-v4-flash');
  assertEquals(metadata.finish_reason, 'stop');
});


Deno.test('Moonshot Kimi K2.6 omite temperature y admite thinking', async () => {
  const client = analysisClient();
  let providerBody: Record<string, unknown> | null = null;
  const response = await makeHandler(client, {
    env: {
      AI_PROVIDER: 'moonshot',
      AI_API_URL: 'https://api.moonshot.ai/v1/chat/completions',
      AI_MODEL: 'kimi-k2.6',
      AI_THINKING_MODE: 'disabled',
      AI_REASONING_EFFORT: undefined
    },
    fetchImpl: async (_url, init) => {
      providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return chatResponse();
    }
  })(request({ auth, systemPrompt: 's', userPrompt: 'u', options: { temperature: 0.2, maxTokens: 2048 } }));
  assertEquals(response.status, 200);
  assert(providerBody !== null, 'Moonshot debe recibir un body');
  const capturedK2Body = providerBody as Record<string, unknown>;
  assertEquals(capturedK2Body.model, 'kimi-k2.6');
  assertEquals((capturedK2Body.thinking as Record<string, unknown>)?.type, 'disabled');
  assert(!Object.prototype.hasOwnProperty.call(capturedK2Body, 'temperature'), 'Moonshot no debe recibir temperature');
  assertEquals(capturedK2Body.response_format, undefined, 'Moonshot no recibe JSON mode de DeepSeek');
});

Deno.test('Moonshot Kimi K3 usa reasoning_effort y omite temperature', async () => {
  const client = analysisClient();
  let providerBody: Record<string, unknown> | null = null;
  const response = await makeHandler(client, {
    env: {
      AI_PROVIDER: 'moonshot',
      AI_API_URL: 'https://api.moonshot.ai/v1/chat/completions',
      AI_MODEL: 'kimi-k3',
      AI_THINKING_MODE: undefined,
      AI_REASONING_EFFORT: 'low'
    },
    fetchImpl: async (_url, init) => {
      providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return chatResponse();
    }
  })(request({ auth, systemPrompt: 's', userPrompt: 'u', options: { temperature: 0.2, maxTokens: 2048 } }));
  assertEquals(response.status, 200);
  assert(providerBody !== null, 'Moonshot debe recibir un body');
  const capturedK3Body = providerBody as Record<string, unknown>;
  assertEquals(capturedK3Body.model, 'kimi-k3');
  assertEquals(capturedK3Body.reasoning_effort, 'low');
  assertEquals(capturedK3Body.thinking, undefined);
  assertEquals(capturedK3Body.response_format, undefined);
  assert(!Object.prototype.hasOwnProperty.call(capturedK3Body, 'temperature'), 'Moonshot no debe recibir temperature');
});

Deno.test('provider Responses-style success devuelve contenido', async () => {
  const client = analysisClient();
  const handler = makeHandler(client, {
    env: { AI_API_URL: 'https://provider.test/v1/responses' },
    fetchImpl: async () => responsesResponse()
  });
  const response = await handler(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body.content, 'respuesta responses sintética');
  assertEquals(client.calls[1].args.p_prompt_tokens, 4);
  assertEquals(client.calls[1].args.p_completion_tokens, 6);
  assertEquals((client.calls[1].args.p_metadata as Record<string, unknown>).finish_reason, 'completed');
});

Deno.test('Responses API informa max_output_tokens como narrativa truncada y no consume uso', async () => {
  const client = analysisClient(successBegin(), { success: true, usage_id: 'usage-synthetic-1', status: 'failed' });
  const response = await makeHandler(client, {
    env: { AI_MODEL: 'deepseek-v4-flash', AI_API_URL: 'https://provider.test/v1/responses' },
    fetchImpl: async () => responsesResponse(structuredCommercialResponse(), 'incomplete', 'max_output_tokens')
  })(request(structuredCommercialRequest()));
  const body = await json(response);
  const normalized = JSON.parse(body.rawResultContent as string);
  const completion = client.calls.find((call) => call.name === 'complete_ai_agent_analysis');
  const metadata = completion?.args.p_metadata as Record<string, unknown>;

  assertEquals(response.status, 200);
  assertEquals(body.providerCalled, true);
  assertEquals(body.quotaOutcome, 'not_consumed');
  assertEquals(normalized.aiNarrative.diagnosticCode, 'AI_NARRATIVE_TRUNCATED');
  assertEquals(completion?.args.p_success, false);
  assertEquals(metadata.finish_reason, 'max_output_tokens');
});

Deno.test('AI_API_KEY tiene precedencia sobre OPENAI_API_KEY fallback', async () => {
  const client = analysisClient();
  let authorization = '';
  const response = await makeHandler(client, {
    env: { AI_API_KEY: 'primary-synthetic-key', OPENAI_API_KEY: 'fallback-synthetic-key' },
    fetchImpl: async (_url, init) => {
      authorization = String(init?.headers && new Headers(init.headers).get('authorization'));
      return chatResponse();
    }
  })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 200);
  assertEquals(authorization, 'Bearer primary-synthetic-key');
});

Deno.test('OPENAI_API_KEY se usa sólo como fallback', async () => {
  const client = analysisClient();
  let authorization = '';
  const response = await makeHandler(client, {
    env: { AI_API_KEY: undefined, OPENAI_API_KEY: 'fallback-synthetic-key' },
    fetchImpl: async (_url, init) => {
      authorization = String(init?.headers && new Headers(init.headers).get('authorization'));
      return chatResponse();
    }
  })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 200);
  assertEquals(authorization, 'Bearer fallback-synthetic-key');
});

Deno.test('provider no recibe auth, usage_id ni secretos Supabase', async () => {
  const client = analysisClient();
  let providerBody = '';
  const response = await makeHandler(client, {
    fetchImpl: async (_url, init) => {
      providerBody = String(init?.body);
      return chatResponse();
    }
  })(request({ auth, systemPrompt: 'private-system', userPrompt: 'private-user' }));
  assertEquals(response.status, 200);
  assert(!providerBody.includes(auth.licenseKey), 'licenseKey no debe ir al proveedor');
  assert(!providerBody.includes(auth.deviceFingerprint), 'deviceFingerprint no debe ir al proveedor');
  assert(!providerBody.includes(auth.deviceSecurityToken), 'deviceSecurityToken no debe ir al proveedor');
  assert(!providerBody.includes('usage-synthetic-1'), 'usage_id no debe ir al proveedor');
  assert(!providerBody.includes('synthetic-service-role-key'), 'service role no debe ir al proveedor');
});

Deno.test('provider failure finaliza uso como failed una sola vez', async () => {
  const client = analysisClient(successBegin(), { success: true, usage_id: 'usage-synthetic-1', status: 'failed' });
  const response = await makeHandler(client, {
    fetchImpl: async () => new Response('provider failure body', { status: 500 })
  })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  const body = await json(response);
  assertEquals(response.status, 502);
  assertEquals(body.code, 'AI_REQUEST_FAILED');
  assertEquals(body.providerCalled, true);
  assertEquals(body.quotaOutcome, 'not_consumed');
  assertEquals(client.calls.length, 2);
  assertEquals(client.calls[1].args.p_success, false);
  assertEquals((client.calls[1].args.p_error_message as string).includes('provider failure body'), false);
});

Deno.test('timeout finaliza uso como failed y devuelve 504', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, {
    providerTimeoutMs: 1,
    fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })
  })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 504);
  assertEquals((await json(response)).code, 'AI_REQUEST_FAILED');
  assertEquals(client.calls.length, 2);
  assertEquals(client.calls[1].args.p_success, false);
});

Deno.test('JSON inválido del proveedor finaliza uso como failed', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, { fetchImpl: async () => new Response('<html>bad</html>', { status: 200 }) })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 502);
  assertEquals((await json(response)).code, 'AI_REQUEST_FAILED');
  assertEquals(client.calls[1].args.p_success, false);
});

Deno.test('contenido vacío del proveedor finaliza uso como failed', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, { fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }) })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 502);
  assertEquals((await json(response)).code, 'AI_EMPTY_RESPONSE');
  assertEquals(client.calls[1].args.p_success, false);
});

Deno.test('token counts se normalizan y se finaliza exactamente una vez', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, {
    fetchImpl: async () => chatResponse('ok', { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24 })
  })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 200);
  assertEquals(client.calls.filter((call) => call.name === 'complete_ai_agent_analysis').length, 1);
  assertEquals(client.calls[1].args.p_prompt_tokens, 11);
  assertEquals(client.calls[1].args.p_completion_tokens, 13);
  assertEquals(client.calls[1].args.p_total_tokens, 24);
});

Deno.test('complete fallido no reintenta y devuelve error controlado', async () => {
  const client = analysisClient(successBegin(), { success: false, code: 'USAGE_NOT_FOUND' });
  let fetchCalls = 0;
  const response = await makeHandler(client, { fetchImpl: async () => { fetchCalls += 1; return chatResponse(); } })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 500);
  const body = await json(response);
  assertEquals(body.code, 'USAGE_RESERVATION_ERROR');
  assertEquals(body.providerCalled, true);
  assertEquals(body.quotaOutcome, 'not_confirmed');
  assertEquals(fetchCalls, 1);
  assertEquals(client.calls.filter((call) => call.name === 'complete_ai_agent_analysis').length, 1);
});

Deno.test('RPC fijas reciben sólo nombres permitidos', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, { fetchImpl: async () => chatResponse() })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 200);
  assert(client.calls.every((call) => ['begin_ai_agent_analysis', 'complete_ai_agent_analysis', 'get_ai_agent_usage_unlimited'].includes(call.name)), 'RPC arbitraria detectada');
});

Deno.test('respuesta de error no filtra prompts ni secretos', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, { fetchImpl: async () => new Response('secret-provider-body', { status: 500 }) })(request({ auth, systemPrompt: 'secret-system-prompt', userPrompt: 'secret-user-prompt' }));
  const body = JSON.stringify(await json(response));
  assert(!body.includes('secret-system-prompt'), 'systemPrompt filtrado');
  assert(!body.includes('secret-user-prompt'), 'userPrompt filtrado');
  assert(!body.includes('synthetic-ai-key'), 'API key filtrada');
  assert(!body.includes('secret-provider-body'), 'body del proveedor filtrado');
});

Deno.test('ventas y rentabilidad acepta sólo contexto estructurado y completa cuota una vez', async () => {
  const client = analysisClient();
  let providerBody: Record<string, unknown> | null = null;
  const response = await makeHandler(client, {
    env: { AI_MODEL: 'deepseek-v4-flash' },
    fetchImpl: async (_url, init) => {
      providerBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return chatResponse(structuredCommercialResponse());
    }
  })(request(structuredCommercialRequest()));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.providerCalled, true);
  assertEquals(body.quotaOutcome, 'consumed');
  assertEquals(body.agentKey, 'salesProfitability');
  assertEquals(client.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 1);
  assertEquals(client.calls.filter((call) => call.name === 'complete_ai_agent_analysis').length, 1);
  assert(providerBody !== null, 'provider body missing');
  const capturedCommercialBody = providerBody as Record<string, unknown>;
  assert(Array.isArray(capturedCommercialBody.messages), 'server prompt missing');
  assertEquals(capturedCommercialBody.max_tokens, 2048, 'margen comercial configurado en servidor');
  assertEquals(JSON.stringify(capturedCommercialBody.response_format), JSON.stringify({ type: 'json_object' }));
  assertEquals(JSON.stringify(capturedCommercialBody.thinking), JSON.stringify({ type: 'disabled' }));
  const userMessage = (capturedCommercialBody.messages as Array<Record<string, unknown>>)[1];
  const sentPrompt = JSON.parse(String(userMessage.content)) as Record<string, unknown>;
  const sentSales = (sentPrompt.deterministicEvidence as Record<string, unknown>).sales as Record<string, unknown>;
  assertEquals(sentSales.netSales, undefined, 'no repetir métricas planas del resumen');
  assertEquals(sentSales.evidenceKeys, undefined, 'no repetir las claves de evidencia permitidas');
  assert(Array.isArray(sentPrompt.allowedEvidenceKeys), 'las claves de evidencia permitidas siguen disponibles');
  assert(sentSales.summary !== undefined, 'el resumen determinístico debe conservarse');
  assert(!Object.prototype.hasOwnProperty.call(structuredCommercialRequest(), 'systemPrompt'), 'arbitrary prompt accepted by fixture');
});

Deno.test('JSON mode DeepSeek no cambia Kimi, otros modelos compatibles ni Responses', async () => {
  const cases = [
    { label: 'Kimi chat completions', env: { AI_PROVIDER: 'moonshot', AI_API_URL: 'https://api.moonshot.ai/v1/chat/completions', AI_MODEL: 'kimi-k3' }, expected: false },
    { label: 'modelo compatible distinto', env: { AI_MODEL: 'deepseek-v4-flash-lite' }, expected: false },
    { label: 'DeepSeek Responses API', env: { AI_MODEL: 'deepseek-v4-flash', AI_API_URL: 'https://provider.test/v1/responses' }, expected: false }
  ];
  for (const sample of cases) {
    const client = analysisClient();
    let providerBody: Record<string, unknown> | null = null;
    const response = await makeHandler(client, {
      env: sample.env,
      fetchImpl: async (_url, init) => {
        providerBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return sample.env.AI_API_URL?.endsWith('/responses')
          ? responsesResponse(structuredCommercialResponse())
          : chatResponse(structuredCommercialResponse());
      }
    })(request(structuredCommercialRequest()));
    assertEquals(response.status, 200, sample.label);
    assert(providerBody !== null, `${sample.label}: provider body missing`);
    assertEquals(
      Object.prototype.hasOwnProperty.call(providerBody, 'response_format'),
      sample.expected,
      sample.label
    );
    assertEquals(Object.prototype.hasOwnProperty.call(providerBody, 'thinking'), false, `${sample.label}: thinking no debe filtrarse`);
  }
});

Deno.test('sales_growth envía un prompt breve, acotado y explícito para una narrativa compacta', async () => {
  const payload = structuredCommercialRequest({
    intent: 'sales_growth',
    question: '¿Cómo puedo aumentar mis ventas?'
  }) as unknown as Record<string, unknown>;
  const context = payload.context as Record<string, unknown>;
  const sales = context.sales as Record<string, unknown>;
  const products = Array.from({ length: 8 }, (_, index) => ({
    name: `Producto ${index}`,
    currentSales: 900 + index,
    previousSales: 400,
    salesDelta: index * 50,
    salesDeltaPercent: index / 8,
    currentUnits: 10,
    previousUnits: 5,
    unitsDelta: 5,
    currentShare: 0.3,
    previousShare: 0.2,
    salesShareDelta: 0.1,
    currentMargin: index % 2 === 0 ? 0.4 : null,
    previousMargin: index % 2 === 0 ? 0.3 : null,
    currentProfit: index % 2 === 0 ? 360 : null,
    previousProfit: index % 2 === 0 ? 120 : null,
    costKnown: index % 2 === 0,
    costStatus: index % 2 === 0 ? 'known' : 'missing',
    direction: 'growing',
    signals: ['growing', 'high_sales_share', 'healthy_margin'],
    opportunityReason: 'Evidencia sintética compactable.'
  }));
  const declining = Array.from({ length: 8 }, (_, index) => ({
    ...products[index],
    name: `Declive ${index}`,
    salesDelta: -(index + 1) * 40,
    direction: 'declining',
    signals: ['declining']
  }));
  const channels = Array.from({ length: 5 }, (_, index) => ({
    channel: `Canal ${index}`,
    currentShare: 0.4,
    previousShare: 0.3,
    deltaShare: 0.1,
    currentSales: 500 + index,
    previousSales: 250,
    salesDelta: index * 100
  }));
  sales.comparison = {
    previousNetSales: 2000,
    previousUnits: 40,
    previousTicket: 125,
    previousUnitsPerTicket: 2.5,
    previousSalesCount: 16,
    deltaNetSales: 400,
    deltaNetSalesPercent: 0.2,
    deltaUnits: 8,
    deltaTicket: 25,
    deltaTicketPercent: 0.2,
    deltaUnitsPerTicket: 0.5,
    deltaSalesCount: 0,
    productChanges: [...products, ...declining].map(({ opportunityReason: _ignored, ...product }) => product),
    productMixChanges: [],
    channelMixChanges: channels
  };
  sales.growthSignals = {
    currentNetSales: 2400,
    deltaNetSales: 400,
    productsGrowing: products,
    productsDeclining: declining,
    productOpportunities: products,
    channelChanges: channels,
    comparisonAvailable: true
  };
  sales.products = products.map((product) => ({
    name: product.name,
    quantity: product.currentUnits,
    netSales: product.currentSales,
    unitCost: product.costKnown ? 20 : null,
    profit: product.costKnown ? product.currentProfit : null,
    margin: product.costKnown ? product.currentMargin : null,
    averagePrice: 50,
    costKnown: product.costKnown,
    costStatus: product.costKnown ? 'definitive' : 'incomplete'
  }));
  sales.channels = channels.map((channel) => ({ channel: channel.channel, netSales: channel.currentSales, orders: 10, units: 20 }));
  sales.evidenceKeys = [
    'profitability.margin', 'comparison.deltaNetSales', 'comparison.deltaNetSalesPercent',
    'comparison.deltaSalesCount', 'comparison.deltaUnits', 'comparison.deltaTicket',
    'comparison.deltaTicketPercent', 'comparison.deltaUnitsPerTicket', 'comparison.productChanges',
    'comparison.channelMixChanges', 'growthSignals.productOpportunities', 'summary.unitsPerTicket',
    'scenarios.values'
  ];
  sales.calculations = [{ label: 'No incluir', value: 1, formattedValue: '1', formula: '1', source: 'fixture', period: {} }];
  sales.assumptions = ['No incluir'];
  sales.scenarios = [];
  sales.coverage = { validSales: 16, complete: true, comparisonDataAvailable: true, growthDataComplete: true };
  const validation = validatePayload(payload);
  assert(validation.ok, `fixture comercial debe validar: ${JSON.stringify(validation)}`);

  let providerBody: Record<string, unknown> | null = null;
  const response = await makeHandler(analysisClient(), {
    env: { AI_MODEL: 'deepseek-v4-flash' },
    fetchImpl: async (_url, init) => {
      providerBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return chatResponse(structuredCommercialResponse());
    }
  })(request(payload));
  assertEquals(response.status, 200);
  assert(providerBody !== null, 'provider body missing');
  const body = providerBody as Record<string, unknown>;
  const messages = body.messages as Array<Record<string, unknown>>;
  const systemPrompt = String(messages[0].content);
  const userMessage = String(messages[1].content);
  const prompt = JSON.parse(userMessage) as Record<string, unknown>;
  const evidence = prompt.deterministicEvidence as Record<string, unknown>;
  const compactSales = evidence.sales as Record<string, unknown>;
  const growth = compactSales.growthSignals as Record<string, unknown>;
  const allowedKeys = prompt.allowedEvidenceKeys as unknown[];
  const opportunities = growth.productOpportunities as Array<Record<string, unknown>>;

  assertEquals(body.max_tokens, 2048);
  assertEquals(JSON.stringify(body.response_format), JSON.stringify({ type: 'json_object' }));
  assertEquals(JSON.stringify(body.thinking), JSON.stringify({ type: 'disabled' }));
  assert(systemPrompt.includes('exclusivamente el objeto JSON solicitado'), 'prompt sólo permite JSON');
  assert(systemPrompt.includes('no repitas los datos de entrada'), 'prompt evita repetir entrada');
  assert(systemPrompt.includes('no reproduzcas la evidencia completa'), 'prompt evita reescribir evidencia');
  assert(systemPrompt.includes('máximo 2 frases y 300 caracteres'), 'prompt limita el resumen');
  assert(systemPrompt.includes('máximo 2 recomendaciones'), 'prompt limita recomendaciones');
  assert(systemPrompt.includes('no recalcules cifras'), 'prompt prohíbe recalcular');
  assert(systemPrompt.includes('ni inventes datos, causalidad'), 'prompt prohíbe inventar datos o causalidad');
  assert(systemPrompt.toLowerCase().includes('no añadas campos'), 'prompt prohíbe campos adicionales');
  assertEquals(Object.prototype.hasOwnProperty.call(prompt, 'scenario'), false);
  assertEquals(Object.prototype.hasOwnProperty.call(prompt, 'agentKey'), false);
  assertEquals(Object.prototype.hasOwnProperty.call(compactSales, 'netSales'), false);
  assertEquals(Object.prototype.hasOwnProperty.call(compactSales, 'evidenceKeys'), false);
  assertEquals(Object.prototype.hasOwnProperty.call(compactSales, 'calculations'), false);
  assertEquals(Object.prototype.hasOwnProperty.call(compactSales, 'assumptions'), false);
  assertEquals(Object.prototype.hasOwnProperty.call(compactSales, 'scenarios'), false);
  assertEquals((compactSales.products as unknown[]).length, 0);
  assertEquals((compactSales.channels as unknown[]).length, 0);
  assertEquals(Object.prototype.hasOwnProperty.call(compactSales.comparison, 'productChanges'), false);
  assertEquals(Object.prototype.hasOwnProperty.call(compactSales.comparison, 'channelMixChanges'), false);
  assertEquals(opportunities.length, 3);
  assertEquals(opportunities[0].name, 'Producto 7');
  assertEquals(Object.prototype.hasOwnProperty.call(opportunities[0], 'currentMargin'), false);
  assertEquals((growth.productsDeclining as unknown[]).length, 3);
  assertEquals((growth.channelChanges as unknown[]).length, 2);
  assert(allowedKeys.length <= 12, 'claves permitidas acotadas');
  assert(userMessage.length < 3500, `prompt de usuario inesperadamente grande: ${userMessage.length} caracteres`);

  for (const intent of ['ticket_growth', 'product_opportunity', 'sales_trend']) {
    let intentProviderBody: Record<string, unknown> | null = null;
    const intentResponse = await makeHandler(analysisClient(), {
      env: { AI_MODEL: 'deepseek-v4-flash' },
      fetchImpl: async (_url, init) => {
        intentProviderBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return chatResponse(structuredCommercialResponse());
      }
    })(request(structuredCommercialRequest({ intent })));
    assertEquals(intentResponse.status, 200, `${intent}: valid Edge request`);
    assert(intentProviderBody !== null, `${intent}: provider request exists`);
    const intentMessages = (intentProviderBody as Record<string, unknown>).messages as Array<Record<string, unknown>>;
    const intentSystemPrompt = String(intentMessages[0].content).toLowerCase();
    assert(intentSystemPrompt.includes('máximo 2 frases y 300 caracteres'), `${intent}: brief summary prompt`);
    assert(intentSystemPrompt.includes('máximo 2 recomendaciones'), `${intent}: max-two recommendations prompt`);
  }
});

Deno.test('la narrativa comercial normalizada respeta los límites compactos del contrato', async () => {
  const response = JSON.parse(structuredCommercialResponse()) as Record<string, unknown>;
  response.executiveSummary = 'S'.repeat(350);
  response.explanation = 'E'.repeat(850);
  response.extraProviderField = 'drop this field';
  response.recommendations = Array.from({ length: 4 }, (_, index) => ({
    title: `Title ${index} ${'T'.repeat(100)}`,
    explanation: `Reason ${index} ${'R'.repeat(300)}`,
    expectedImpact: `Impact ${index} ${'I'.repeat(220)}`,
    priority: 'medium',
    evidenceKeys: ['profitability.margin', 'profitability.profit', 'comparison.deltaMargin', 'products.risks'],
    requiresConfirmation: true
  }));
  const client = analysisClient();
  const responseFromEdge = await makeHandler(client, {
    env: { AI_MODEL: 'deepseek-v4-flash' },
    fetchImpl: async () => chatResponse(JSON.stringify(response))
  })(request(structuredCommercialRequest({ intent: 'sales_growth', question: '¿Cómo puedo aumentar mis ventas?' })));
  const body = await json(responseFromEdge);
  const content = JSON.parse(String(body.content)) as Record<string, unknown>;
  const recommendations = content.recommendations as Array<Record<string, unknown>>;
  assertEquals(responseFromEdge.status, 200);
  assertEquals(body.quotaOutcome, 'consumed');
  assert((content.executiveSummary as string).length <= 300, 'resumen queda dentro del máximo');
  assert((content.explanation as string).length <= 800, 'explicación queda dentro del máximo');
  assertEquals(recommendations.length, 2, 'no más de dos recomendaciones');
  assertEquals(Object.prototype.hasOwnProperty.call(content, 'extraProviderField'), false, 'se descartan campos añadidos');
  for (const recommendation of recommendations) {
    assert((recommendation.title as string).length <= 80, 'título acotado');
    assert((recommendation.explanation as string).length <= 240, 'explicación de recomendación acotada');
    assert((recommendation.expectedImpact as string).length <= 180, 'impacto acotado');
    assert((recommendation.evidenceKeys as unknown[]).length <= 3, 'evidenceKeys acotadas');
    assertEquals(recommendation.requiresConfirmation, true);
  }
});

Deno.test('respuesta comercial completa en el techo de tokens se acepta y consume una cuota', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, {
    env: { AI_MODEL: 'deepseek-v4-flash' },
    fetchImpl: async () => chatResponse(
      structuredCommercialResponse(),
      { prompt_tokens: 4669, completion_tokens: 2048, total_tokens: 6717 },
      'stop'
    )
  })(request(structuredCommercialRequest({ intent: 'sales_growth', question: '¿Cómo puedo aumentar mis ventas?' })));
  const body = await json(response);
  const complete = client.calls.find((call) => call.name === 'complete_ai_agent_analysis');
  assertEquals(response.status, 200);
  assertEquals(body.providerCalled, true);
  assertEquals(body.quotaOutcome, 'consumed');
  assertEquals((complete?.args as Record<string, unknown>).p_success, true);
});

Deno.test('razonamiento del proveedor no se conserva; sólo se registra el conteo agregado', async () => {
  const client = analysisClient();
  const reasoningSecret = 'synthetic-private-reasoning-must-not-persist';
  const response = await makeHandler(client, {
    env: { AI_MODEL: 'deepseek-v4-flash' },
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'provider-reasoning-fixture',
      model: 'deepseek-v4-flash',
      choices: [{
        message: { role: 'assistant', content: structuredCommercialResponse(), reasoning_content: reasoningSecret },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 32,
        completion_tokens: 64,
        total_tokens: 96,
        completion_tokens_details: { reasoning_tokens: 0 }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  })(request(structuredCommercialRequest()));
  const bodyText = await response.text();
  const complete = client.calls.find((call) => call.name === 'complete_ai_agent_analysis');
  const args = complete?.args as Record<string, unknown>;
  const metadata = args.p_metadata as Record<string, unknown>;
  assertEquals(response.status, 200);
  assert(!bodyText.includes(reasoningSecret), 'texto de razonamiento no se devuelve al cliente');
  assertEquals(metadata.reasoning_tokens, 0);
  assert(!JSON.stringify(metadata).includes(reasoningSecret), 'texto de razonamiento no se guarda en metadatos');
  assert(!JSON.stringify(args).includes(reasoningSecret), 'texto de razonamiento no se guarda en argumentos RPC');
});

Deno.test('ventas y rentabilidad rechaza prompts arbitrarios en la solicitud estructurada', async () => {
  const client = analysisClient();
  const response = await makeHandler(client)(request(structuredCommercialRequest({ systemPrompt: 'prompt no permitido' })));
  assertEquals(response.status, 400);
  assertEquals((await json(response)).code, 'INVALID_REQUEST');
  assertEquals(client.calls.length, 0);
});

Deno.test('contrato comercial acepta costos de producto estrictos y rechaza valores no permitidos sin llamadas', async () => {
  const product = {
    name: 'Producto A',
    quantity: 2,
    netSales: 100,
    unitCost: 20,
    profit: 60,
    margin: 0.6,
    averagePrice: 50,
    costKnown: true,
    costStatus: 'definitive',
    costSource: 'inventory_movement',
    riskType: 'margin',
    riskReason: 'Margen estable'
  };
  let providerCalls = 0;
  const validClient = analysisClient();
  const validResponse = await makeHandler(validClient, {
    fetchImpl: async () => {
      providerCalls += 1;
      return chatResponse(structuredCommercialResponse());
    }
  })(request(structuredCommercialRequestWithProduct(product)));
  assertEquals(validResponse.status, 200);
  assertEquals(validClient.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 1);

  const legacyClient = analysisClient();
  const legacyResponse = await makeHandler(legacyClient, {
    fetchImpl: async () => {
      providerCalls += 1;
      return chatResponse(structuredCommercialResponse());
    }
  })(request(structuredCommercialRequest()));
  assertEquals(legacyResponse.status, 200);
  assertEquals(legacyClient.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 1);

  const invalidProducts = [
    { ...product, unexpected: true },
    { ...product, costStatus: 'unknown' },
    { ...product, costSource: 'internal' },
    { ...product, costStatus: 'd'.repeat(49) },
    { ...product, costSource: 'm'.repeat(65) },
    { ...product, costStatus: ['definitive'] },
    { ...product, costSource: { source: 'missing' } }
  ];

  for (const invalidProduct of invalidProducts) {
    const client = analysisClient();
    const response = await makeHandler(client, {
      fetchImpl: async () => {
        providerCalls += 1;
        return chatResponse(structuredCommercialResponse());
      }
    })(request(structuredCommercialRequestWithProduct(invalidProduct)));
    assertEquals(response.status, 400);
    const body = await json(response);
    assertEquals(body.code, 'INVALID_REQUEST');
    assertEquals(body.providerCalled, false);
    assertEquals(body.quotaOutcome, 'not_consumed');
    assertEquals(client.calls.length, 0);
  }

  assertEquals(providerCalls, 2);
});

Deno.test('respuesta comercial parcialmente inválida se normaliza y conserva cálculos determinísticos', async () => {
  const client = analysisClient();
  const malformed = JSON.stringify({
    version: 1,
    agentKey: 'salesProfitability',
    status: 'completed',
    executiveSummary: 'El negocio requiere revisión.',
    explanation: 'Respuesta narrativa del proveedor.',
    facts: {},
    calculations: { ventas: 100 },
    assumptions: 'una cadena',
    scenarios: {},
    recommendations: [{ title: 'Revisar', explanation: 'Confirmar datos.', expectedImpact: 'Por determinar.', effort: 'medium', evidence: [], requiresConfirmation: false }],
    limitations: {},
    confidence: 'medium',
    source: 'cloud',
    coverage: {},
    citations: {},
    actionDrafts: []
  });
  const response = await makeHandler(client, { fetchImpl: async () => chatResponse(malformed) })(request(structuredCommercialRequest()));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assert(typeof body.rawResultContent === 'string', 'Debe devolver contenido normalizado');
  const normalized = JSON.parse(body.rawResultContent as string);
  assertEquals(normalized.aiNarrative.status, 'available');
  assertEquals(normalized.aiNarrative.diagnosticCode, 'AI_NARRATIVE_PARTIAL_CONTENT');
  assertEquals(normalized.aiNarrative.executiveSummary, 'El negocio requiere revisión.');
  assert(Array.isArray(normalized.calculations), 'calculations debe ser arreglo');
  assert(Array.isArray(normalized.assumptions), 'assumptions debe ser arreglo');
  assert(Array.isArray(normalized.scenarios), 'scenarios debe ser arreglo');
  assertEquals(normalized.actionDrafts.length, 0);
  const completions = client.calls.filter((call) => call.name === 'complete_ai_agent_analysis');
  assertEquals(completions.length, 1);
  assertEquals(completions[0].args.p_success, true);
});

Deno.test('narrativa inválida o vacía queda unavailable, conserva métricas y consume una sola finalización', async () => {
  const cases = [
    { label: 'cuerpo narrativo vacío', content: '', code: 'AI_NARRATIVE_EMPTY' },
    { label: 'texto no JSON', content: 'No puedo responder en JSON.', code: 'AI_NARRATIVE_INVALID_JSON' },
    { label: 'prosa alrededor de un fragmento JSON', content: 'Respuesta: {"executiveSummary":"Narrativa parcial"}', code: 'AI_NARRATIVE_INVALID_JSON' },
    { label: 'objeto JSON vacío', content: '{}', code: 'AI_NARRATIVE_MISSING_CONTENT' },
    { label: 'campos narrativos faltantes', content: JSON.stringify({ confidence: 'high', recommendations: [] }), code: 'AI_NARRATIVE_MISSING_CONTENT' },
    { label: 'respuesta JSON truncada por límite', content: structuredCommercialResponse(), finishReason: 'length', code: 'AI_NARRATIVE_TRUNCATED' },
    { label: 'respuesta JSON con límite de tokens', content: structuredCommercialResponse(), finishReason: 'max_tokens', code: 'AI_NARRATIVE_TRUNCATED' },
    { label: 'respuesta filtrada por el proveedor', content: structuredCommercialResponse(), finishReason: 'content_filter', code: 'AI_NARRATIVE_PROVIDER_ERROR' }
  ];

  for (const sample of cases) {
    const client = analysisClient(successBegin(), { success: true, usage_id: 'usage-synthetic-1', status: 'failed' });
    let providerCalls = 0;
    const response = await makeHandler(client, {
      fetchImpl: async () => {
        providerCalls += 1;
        return chatResponse(sample.content, undefined, sample.finishReason || 'stop');
      }
    })(request(structuredCommercialRequest()));
    const body = await json(response);
    const normalized = JSON.parse(body.rawResultContent as string);
    const beginCalls = client.calls.filter((call) => call.name === 'begin_ai_agent_analysis');
    const completionCalls = client.calls.filter((call) => call.name === 'complete_ai_agent_analysis');

    assertEquals(response.status, 200, sample.label);
    assertEquals(body.success, true, sample.label);
    assertEquals(body.providerCalled, true, sample.label);
    assertEquals(body.quotaOutcome, 'not_consumed', sample.label);
    assertEquals(normalized.aiNarrative.status, 'unavailable', sample.label);
    assertEquals(normalized.aiNarrative.diagnosticCode, sample.code, sample.label);
    assertEquals(normalized.aiNarrative.executiveSummary, null, sample.label);
    assertEquals(normalized.aiNarrative.explanation, null, sample.label);
    assertEquals(normalized.aiNarrative.recommendations.length, 0, sample.label);
    assert(Array.isArray(normalized.calculations), `${sample.label}: cálculos determinísticos preservados`);
    assertEquals(normalized.facts[0].label, 'Producto A', `${sample.label}: facts vienen del contexto deterministic`);
    if (sample.content) {
      assert(!JSON.stringify(body).includes(sample.content), `${sample.label}: no se devuelve texto crudo del proveedor`);
    }
    assertEquals(providerCalls, 1, `${sample.label}: no hay reintento oculto`);
    assertEquals(beginCalls.length, 1, `${sample.label}: una reserva`);
    assertEquals(completionCalls.length, 1, `${sample.label}: una finalización`);
    assertEquals(completionCalls[0].args.p_success, false, `${sample.label}: narrativa inválida no consume`);
    assertEquals(completionCalls[0].args.p_prompt_tokens, 3, `${sample.label}: prompt tokens persistidos`);
    assertEquals(completionCalls[0].args.p_completion_tokens, 5, `${sample.label}: completion tokens persistidos`);
    assertEquals(completionCalls[0].args.p_total_tokens, 8, `${sample.label}: total tokens persistidos`);
    const metadata = completionCalls[0].args.p_metadata as Record<string, unknown>;
    assertEquals(metadata.request_id, 'provider-request-synthetic', `${sample.label}: provider request id persistido`);
    assertEquals(metadata.finish_reason, sample.finishReason || 'stop', `${sample.label}: finish reason persistido`);
    assertEquals(metadata.narrative_status, 'unavailable', `${sample.label}: narrative status persistido`);
    assertEquals(metadata.narrative_diagnostic, sample.code, `${sample.label}: diagnostic persistido`);
    assertEquals(client.calls.filter((call) => call.name === 'get_ai_agent_usage_unlimited').length, 2, `${sample.label}: uso refrescado tras fallo`);
    assertEquals((body.usageStatus as Record<string, unknown>).used, 0, `${sample.label}: snapshot autoritativo devuelto`);
  }
});

Deno.test('completion ambiguo después de narrativa inválida conserva fallback y no confirma cuota', async () => {
  const client = analysisClient(successBegin(), { success: true, usage_id: 'usage-synthetic-1', status: 'completed' });
  let providerCalls = 0;
  const response = await makeHandler(client, {
    fetchImpl: async () => {
      providerCalls += 1;
      return chatResponse('no es json');
    }
  })(request(structuredCommercialRequest()));
  const body = await json(response);
  const normalized = JSON.parse(body.rawResultContent as string);
  assertEquals(response.status, 200);
  assertEquals(normalized.aiNarrative.status, 'unavailable');
  assertEquals(body.providerCalled, true);
  assertEquals(body.quotaOutcome, 'not_confirmed');
  assertEquals(body.usageStatus, null);
  assertEquals(providerCalls, 1);
  assertEquals(client.calls.filter((call) => call.name === 'complete_ai_agent_analysis').length, 1);
  assertEquals(client.calls.filter((call) => call.name === 'get_ai_agent_usage_unlimited').length, 1);
});

Deno.test('tras fallar la narrativa se devuelve el contador autoritativo posterior a complete', async () => {
  let usageLookupCount = 0;
  const client = fakeClient(async (name) => {
    if (name === 'get_ai_agent_usage_unlimited') {
      usageLookupCount += 1;
      return {
        data: usageLookupCount === 1
          ? { success: true, limit: 15, used: 7, remaining: 8, ai_agents: true }
          : { success: true, limit: 15, used: 6, remaining: 9, ai_agents: true },
        error: null
      };
    }
    if (name === 'begin_ai_agent_analysis') return { data: successBegin({ used: 7, remaining: 8 }), error: null };
    if (name === 'complete_ai_agent_analysis') return { data: { success: true, usage_id: 'usage-synthetic-1', status: 'failed' }, error: null };
    return { data: null, error: { code: 'unexpected-rpc' } };
  });
  const response = await makeHandler(client, {
    fetchImpl: async () => chatResponse('not json')
  })(request(structuredCommercialRequest()));
  const body = await json(response);

  assertEquals(response.status, 200);
  assertEquals(usageLookupCount, 2);
  assertEquals((body.usageStatus as Record<string, unknown>).used, 6);
  assertEquals((body.usageStatus as Record<string, unknown>).remaining, 9);
  assertEquals(body.quotaOutcome, 'not_consumed');
});


Deno.test('ventas y rentabilidad acepta profitability_summary como intención propia', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, {
    fetchImpl: async () => chatResponse(JSON.stringify({
      executiveSummary: 'El periodo genera utilidad con los costos registrados.',
      explanation: 'La conclusión se limita a la evidencia recibida.',
      recommendations: [{
        title: 'Revisar el margen',
        explanation: 'Confirmar si el margen actual cumple el objetivo del negocio.',
        expectedImpact: 'Mantener decisiones basadas en el resultado del periodo.',
        priority: 'medium',
        evidenceKeys: ['profitability.margin'],
        requiresConfirmation: true
      }],
      confidence: 'high'
    }))
  })(request(structuredCommercialRequest({
    intent: 'profitability_summary',
    question: '¿Mi negocio es rentable?',
    period: {
      from: '2026-09-01',
      to: '2026-09-07',
      previousFrom: null,
      previousTo: null,
      timezone: 'America/Mexico_City'
    }
  })));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.intent, 'profitability_summary');
  const normalized = JSON.parse(body.rawResultContent as string);
  assertEquals(normalized.executiveSummary, 'El periodo genera utilidad con los costos registrados.');
  assertEquals(normalized.aiNarrative.status, 'available');
  assertEquals(normalized.aiNarrative.diagnosticCode, undefined);
  assertEquals(normalized.recommendations.length, 1);
  assertEquals(normalized.recommendations[0].priority, 'medium');
  assertEquals(normalized.recommendations[0].evidenceKeys[0], 'profitability.margin');
  assertEquals(normalized.actionDrafts.length, 0);
});

Deno.test('la capa narrativa no puede sustituir cálculos determinísticos recibidos', async () => {
  const client = analysisClient();
  const requestPayload = structuredCommercialRequest();
  const context = requestPayload.context as Record<string, unknown>;
  const sales = context.sales as Record<string, unknown>;
  sales.calculations = [{
    label: 'Margen actual',
    value: 0.6,
    formattedValue: '60%',
    formula: 'utilidad / ventas',
    source: 'sales_history',
    period: { from: '2026-09-01', to: '2026-09-07' }
  }];

  const response = await makeHandler(client, {
    fetchImpl: async () => chatResponse(JSON.stringify({
      executiveSummary: 'Resumen narrativo.',
      explanation: 'Explicación narrativa.',
      calculations: [{
        label: 'Cálculo inventado',
        value: 999,
        formattedValue: '999',
        formula: 'inventada',
        source: 'provider',
        period: {}
      }],
      facts: [{ label: 'Producto inventado' }],
      recommendations: [],
      confidence: 'medium'
    }))
  })(request(requestPayload));
  const body = await json(response);
  const normalized = JSON.parse(body.rawResultContent as string);
  assertEquals(response.status, 200);
  assertEquals(normalized.executiveSummary, 'Resumen narrativo.');
  assertEquals(normalized.calculations.length, 1);
  assertEquals(normalized.calculations[0].label, 'Margen actual');
  assertEquals(normalized.facts[0].label, 'Producto A');
});


Deno.test('recomendación genérica sin evidenceKey permitido se descarta', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, {
    fetchImpl: async () => chatResponse(JSON.stringify({
      executiveSummary: 'Resumen narrativo.',
      explanation: 'Explicación breve.',
      recommendations: [{
        title: 'Cambiar todo',
        explanation: 'Recomendación genérica sin respaldo.',
        expectedImpact: 'Mejorar resultados.',
        priority: 'high',
        evidenceKeys: ['evidence.invented'],
        requiresConfirmation: true
      }],
      confidence: 'medium'
    }))
  })(request(structuredCommercialRequest()));
  const body = await json(response);
  const normalized = JSON.parse(body.rawResultContent as string);
  assertEquals(response.status, 200);
  assertEquals(normalized.recommendations.length, 0);
  assertEquals(normalized.executiveSummary, 'Resumen narrativo.');
});

Deno.test('escenario con volumen negativo es rechazado server-side', async () => {
  const client = analysisClient();
  const response = await makeHandler(client)(request(structuredCommercialRequest({ scenario: { historicalVolume: -1 } })));
  assertEquals(response.status, 400);
  assertEquals(client.calls.length, 0);
});

Deno.test('contrato comercial acepta combos con scenario vacío y sin periodo anterior', async () => {
  const client = analysisClient();
  let providerCalls = 0;
  const response = await makeHandler(client, {
    fetchImpl: async () => {
      providerCalls += 1;
      return chatResponse(structuredCommercialResponse());
    }
  })(request(structuredCommercialRequest({
    intent: 'combo_opportunity',
    question: '¿Qué combos puedo formar?',
    period: {
      from: '2026-09-01',
      to: '2026-09-07',
      previousFrom: null,
      previousTo: null,
      timezone: 'America/Mexico_City'
    },
    scenario: {}
  })));

  assertEquals(response.status, 200);
  assertEquals(providerCalls, 1);
  assertEquals(client.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 1);
});

Deno.test('contrato comercial acepta contexto realista de combo con metadatos tipados', async () => {
  const combo = {
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
    profit: 60,
    margin: 0.4,
    evidenceLevel: 'medium',
    confidence: 'medium',
    opportunity: 'Evaluar presentar Producto A y Producto B juntos.',
    isPrediction: false,
    note: 'Correlación histórica; no implica causalidad.'
  };
  let providerCalls = 0;
  const client = analysisClient();
  const response = await makeHandler(client, {
    fetchImpl: async () => {
      providerCalls += 1;
      return chatResponse(structuredCommercialResponse());
    }
  })(request(structuredCommercialRequestWithScenarioOutput(combo)));

  assertEquals(response.status, 200);
  assertEquals(providerCalls, 1);
  assertEquals(client.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 1);
});

Deno.test('combo sin costo completo y evidencia baja sigue siendo contrato válido', async () => {
  const combo = {
    products: ['Producto A', 'Producto B'],
    tickets: 2,
    frequency: 0.08,
    ticketPercentage: 0.08,
    historicalJointSales: 180,
    averageJointSale: 90,
    costCoverage: 0.5,
    costStatus: 'incomplete',
    comboPrice: 90,
    evidenceLevel: 'low',
    confidence: 'low',
    opportunity: 'Hay evidencia limitada para evaluar el combo.',
    isPrediction: false,
    note: 'Faltan costos completos en parte de los tickets.'
  };
  const client = analysisClient();
  const response = await makeHandler(client, {
    fetchImpl: async () => chatResponse(structuredCommercialResponse())
  })(request(structuredCommercialRequestWithScenarioOutput(combo)));

  assertEquals(response.status, 200);
  assertEquals(client.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 1);
});

Deno.test('combo rechaza claves o enums desconocidos antes de cuota y proveedor', async () => {
  const baseCombo = {
    products: ['Producto A', 'Producto B'],
    tickets: 4,
    frequency: 0.4,
    ticketPercentage: 0.4,
    costCoverage: 1,
    costStatus: 'complete',
    confidence: 'medium',
    evidenceLevel: 'medium',
    opportunity: 'Evaluar combo.',
    isPrediction: false,
    note: 'Evidencia histórica.'
  };

  for (const invalidCombo of [
    { ...baseCombo, unexpectedInternalKey: true },
    { ...baseCombo, costStatus: 'definitive' },
    { ...baseCombo, confidence: 'unknown' }
  ]) {
    const client = analysisClient();
    let providerCalls = 0;
    const response = await makeHandler(client, {
      fetchImpl: async () => {
        providerCalls += 1;
        return chatResponse(structuredCommercialResponse());
      }
    })(request(structuredCommercialRequestWithScenarioOutput(invalidCombo)));

    assertEquals(response.status, 400);
    assertEquals((await json(response)).code, 'INVALID_REQUEST');
    assertEquals(client.calls.length, 0);
    assertEquals(providerCalls, 0);
  }
});

Deno.test('escenarios de precio y promoción conservan compatibilidad con la allowlist tipada', async () => {
  const outputScenario = {
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

  for (const overrides of [
    {
      intent: 'price_simulation',
      question: '¿Qué pasa si aumento el precio?',
      scenario: { productName: 'Producto A', newPrice: 55, historicalVolume: 2 }
    },
    {
      intent: 'promotion_opportunity',
      question: '¿Qué promoción puedo simular?',
      scenario: { productName: 'Producto A', discountPercent: 10, historicalVolume: 2 }
    }
  ]) {
    const client = analysisClient();
    const response = await makeHandler(client, {
      fetchImpl: async () => chatResponse(structuredCommercialResponse())
    })(request(structuredCommercialRequestWithScenarioOutput(outputScenario, overrides)));

    assertEquals(response.status, 200);
    assertEquals(client.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 1);
  }
});

Deno.test('contrato comercial no acepta strings numéricos ni escenarios stale de otra intención', async () => {
  const cases = [
    { scenario: { newPrice: '120' } },
    { intent: 'combo_opportunity', question: '¿Qué combos puedo formar?', scenario: { productName: 'Producto A', newPrice: 120 } },
    { intent: 'profitability_summary', question: '¿Mi negocio es rentable?', scenario: { historicalVolume: 0 } },
    { intent: 'promotion_opportunity', question: '¿Qué promoción puedo simular?', scenario: { promotionalPrice: 80, discountPercent: 20 } }
  ];

  for (const overrides of cases) {
    const client = analysisClient();
    const response = await makeHandler(client)(request(structuredCommercialRequest(overrides)));
    assertEquals(response.status, 400);
    assertEquals((await json(response)).code, 'INVALID_REQUEST');
    assertEquals(client.calls.length, 0);
  }
});

Deno.test('los intentos de crecimiento aceptan un periodo anterior comparable', async () => {
  for (const entry of [
    { intent: 'sales_growth', question: '¿Cómo crecieron mis ventas?' },
    { intent: 'ticket_growth', question: '¿Cómo puedo aumentar mi ticket promedio?' },
    { intent: 'product_opportunity', question: '¿Qué productos puedo impulsar?' },
    { intent: 'sales_trend', question: '¿Cuál es la tendencia de mis ventas?' }
  ]) {
    const client = analysisClient();
    const response = await makeHandler(client, {
      fetchImpl: async () => chatResponse(structuredCommercialResponse())
    })(request(structuredCommercialRequest({ ...entry, requestKey: `growth-period-${entry.intent}` })));

    assertEquals(response.status, 200, entry.intent);
    assertEquals(client.calls.filter((call) => call.name === 'begin_ai_agent_analysis').length, 1, entry.intent);
  }
});

Deno.test('un periodo anterior sigue rechazado para intentos que no comparan periodos', async () => {
  const client = analysisClient();
  const response = await makeHandler(client)(request(structuredCommercialRequest({
    intent: 'combo_opportunity',
    question: '¿Qué combos puedo formar?',
    period: {
      from: '2026-09-01',
      to: '2026-09-07',
      previousFrom: '2026-08-25',
      previousTo: '2026-08-31',
      timezone: 'America/Mexico_City'
    }
  })));
  assertEquals(response.status, 400);
  assertEquals(client.calls.length, 0);
});
