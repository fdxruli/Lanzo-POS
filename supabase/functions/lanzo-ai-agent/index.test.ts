import { createHandler } from './index.ts';
import {
  MAX_BODY_BYTES,
  MAX_USER_PROMPT_CHARS,
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

function chatResponse(content = 'respuesta sintética', usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }) {
  return new Response(JSON.stringify({
    id: 'provider-request-synthetic',
    model: 'reported-synthetic-model',
    choices: [{ message: { role: 'assistant', content } }],
    usage
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'provider-request-synthetic' }
  });
}

function responsesResponse(content = 'respuesta responses sintética') {
  return new Response(JSON.stringify({
    id: 'responses-request-synthetic',
    model: 'reported-responses-model',
    output_text: content,
    usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function analysisClient(beginData: Record<string, unknown> = successBegin(), completeData: Record<string, unknown> = successComplete()) {
  return fakeClient(async (name) => {
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

Deno.test('usage propaga staffSessionToken y no llama proveedor', async () => {
  const staffAuth = { ...auth, staffSessionToken: 'synthetic-staff-session' };
  const client = fakeClient(async () => ({ data: { success: true, limit: 15, used: 0, remaining: 15 }, error: null }));
  const response = await makeHandler(client)(request({ action: 'usage', auth: staffAuth }));
  assertEquals(response.status, 200);
  assertEquals(client.calls[0].args.p_staff_session_token, 'synthetic-staff-session');
  assertEquals(client.calls[0].name, 'get_ai_agent_usage');
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
  const response = await makeHandler(client, { fetchImpl: async () => chatResponse() })(request({ auth, agentType: 'financialAnalyst', systemPrompt: 's', userPrompt: 'u', options: { temperature: 0.2, maxTokens: 2048 } }));
  const body = await json(response);
  assertEquals(response.status, 200);
  assertEquals(body.content, 'respuesta sintética');
  assertEquals((body.usageStatus as Record<string, unknown>).remaining, 14);
  assertEquals(client.calls[1].name, 'complete_ai_agent_analysis');
  assertEquals(client.calls[1].args.p_success, true);
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
  const client = analysisClient();
  const response = await makeHandler(client, {
    fetchImpl: async () => new Response('provider failure body', { status: 500 })
  })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  const body = await json(response);
  assertEquals(response.status, 502);
  assertEquals(body.code, 'AI_REQUEST_FAILED');
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
  assertEquals((await json(response)).code, 'USAGE_RESERVATION_ERROR');
  assertEquals(fetchCalls, 1);
  assertEquals(client.calls.filter((call) => call.name === 'complete_ai_agent_analysis').length, 1);
});

Deno.test('RPC fijas reciben sólo nombres permitidos', async () => {
  const client = analysisClient();
  const response = await makeHandler(client, { fetchImpl: async () => chatResponse() })(request({ auth, systemPrompt: 's', userPrompt: 'u' }));
  assertEquals(response.status, 200);
  assert(client.calls.every((call) => ['begin_ai_agent_analysis', 'complete_ai_agent_analysis'].includes(call.name)), 'RPC arbitraria detectada');
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
