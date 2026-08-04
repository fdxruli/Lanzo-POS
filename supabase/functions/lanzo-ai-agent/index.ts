import {
  MAX_BODY_BYTES,
  cleanText,
  isJsonContentType,
  isRecordValue,
  validatePayload,
  type AnalysisRequest,
  type AuthPayload,
  type ValidatedRequest
} from './contract.ts';
import {
  ProviderError,
  isProviderError,
  requestProvider,
  resolveProviderConfig,
  type ProviderConfig,
  type ProviderResult
} from './provider.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SAFE_MESSAGES: Record<string, string> = {
  AUTH_PAYLOAD_REQUIRED: 'No se pudo confirmar la licencia y el dispositivo para usar IA.',
  LICENSE_NOT_FOUND: 'Licencia no encontrada.',
  LICENSE_NOT_ACTIVE: 'La licencia no está activa.',
  LICENSE_EXPIRED: 'La licencia está expirada.',
  AI_AGENTS_NOT_AVAILABLE: 'Los agentes de IA no están disponibles para este plan.',
  AI_AGENT_PERIOD_NOT_FOUND: 'No hay un periodo vigente para usar agentes IA.',
  AI_AGENT_LIMIT_DISABLED: 'Este periodo no tiene análisis de IA disponibles.',
  AI_AGENT_LIMIT_REACHED: 'Ya se alcanzó el límite de análisis de IA para esta licencia.',
  DEVICE_NOT_ALLOWED: 'Este dispositivo no está autorizado para esta licencia.',
  DEVICE_TOKEN_REQUIRED: 'Se requiere el token seguro del dispositivo.',
  DEVICE_TOKEN_INVALID: 'El token de este dispositivo no es válido.',
  STAFF_SESSION_REQUIRED: 'Se requiere una sesión staff válida para usar agentes de IA.',
  STAFF_SESSION_INVALID: 'La sesión staff expiró o ya no es válida.',
  AI_RATE_LIMITED: 'Demasiadas consultas de uso de IA. Intenta de nuevo más tarde.',
  USAGE_LOOKUP_ERROR: 'No se pudo consultar el uso de agentes IA.',
  USAGE_RESERVATION_ERROR: 'No se pudo reservar o finalizar el uso del agente IA.',
  AI_KEY_MISSING: 'Falta configurar AI_API_KEY u OPENAI_API_KEY en Supabase Secrets.',
  AI_PROVIDER_ERROR: 'La configuración del proveedor de IA no es válida.',
  PROMPT_TOO_LARGE: 'El análisis contiene demasiados datos. Reduce el rango.',
  AI_REQUEST_FAILED: 'No se pudo contactar al proveedor de IA.',
  AI_EMPTY_RESPONSE: 'El proveedor IA devolvió una respuesta vacía.',
  INVALID_REQUEST: 'No se pudo procesar la solicitud.'
};

const KNOWN_RPC_CODES = new Set([
  'LICENSE_NOT_FOUND',
  'LICENSE_NOT_ACTIVE',
  'LICENSE_EXPIRED',
  'AI_AGENTS_NOT_AVAILABLE',
  'AI_AGENT_PERIOD_NOT_FOUND',
  'AI_AGENT_LIMIT_DISABLED',
  'AI_AGENT_LIMIT_REACHED',
  'DEVICE_NOT_ALLOWED',
  'DEVICE_TOKEN_REQUIRED',
  'DEVICE_TOKEN_INVALID',
  'STAFF_SESSION_REQUIRED',
  'STAFF_SESSION_INVALID',
  'AI_RATE_LIMITED'
]);

const ALLOWED_RPC_NAMES = new Set([
  'get_ai_agent_usage',
  'begin_ai_agent_analysis',
  'complete_ai_agent_analysis'
]);

type RpcResult = {
  data: unknown;
  error: unknown | null;
};

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

type HandlerDependencies = {
  env?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  createClient?: (url: string, key: string, options: { auth: { persistSession: boolean; autoRefreshToken: boolean } }) => RpcClient;
  requestId?: () => string;
  now?: () => number;
  providerTimeoutMs?: number;
};

type ServerClientOptions = {
  auth: { persistSession: boolean; autoRefreshToken: boolean };
};

type UsageSnapshot = Record<string, unknown>;

function createRestClient(url: string, key: string, _options: ServerClientOptions): RpcClient {
  const baseUrl = url.replace(/\/+$/u, '');

  return {
    async rpc(name, args) {
      if (!ALLOWED_RPC_NAMES.has(name)) {
        return { data: null, error: { code: 'RPC_NOT_ALLOWED' } };
      }

      const response = await fetch(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(args)
      });

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        return { data: null, error: { status: response.status, code: 'SUPABASE_RPC_ERROR' } };
      }

      return { data, error: null };
    }
  };
}

function jsonResponse(status: number, body: Record<string, unknown>, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'X-Request-Id': requestId
    }
  });
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(value) ? value : fallback;
}

function publicMessage(code: string): string {
  return SAFE_MESSAGES[code] || SAFE_MESSAGES.INVALID_REQUEST;
}

function errorResponse(
  status: number,
  code: string,
  requestId: string,
  extra: Record<string, unknown> = {}
): Response {
  return jsonResponse(status, {
    success: false,
    code,
    message: publicMessage(code),
    ...extra
  }, requestId);
}

function asSnapshot(value: unknown): UsageSnapshot | null {
  if (isRecordValue(value)) return value;
  if (Array.isArray(value) && isRecordValue(value[0])) return value[0];
  return null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function usageFields(value: UsageSnapshot): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const allowed = [
    'limit',
    'used',
    'remaining',
    'plan_code',
    'plan_name',
    'ai_agents',
    'period_id',
    'period_type',
    'period_status',
    'period_start',
    'period_end'
  ];

  for (const key of allowed) {
    if (value[key] !== undefined) fields[key] = value[key];
  }

  return fields;
}

function analysisUsageStatus(value: UsageSnapshot): Record<string, unknown> {
  const fields = usageFields(value);
  if (fields.limit !== undefined) fields.limit = safeInteger(fields.limit) ?? 0;
  if (fields.used !== undefined) fields.used = safeInteger(fields.used) ?? 0;
  if (fields.remaining !== undefined) fields.remaining = safeInteger(fields.remaining) ?? 0;
  return fields;
}

function statusForRpcCode(code: string, fallback = 403): number {
  if (code === 'AI_AGENT_LIMIT_REACHED' || code === 'AI_RATE_LIMITED') return 429;
  if (code === 'AI_AGENT_PERIOD_NOT_FOUND') return 404;
  if (code === 'AUTH_PAYLOAD_REQUIRED') return 401;
  if (KNOWN_RPC_CODES.has(code)) return 403;
  return fallback;
}

function rpcFailureResponse(
  responseCode: string,
  status: number,
  requestId: string,
  data: unknown
): Response {
  const snapshot = asSnapshot(data);
  return errorResponse(status, responseCode, requestId, snapshot ? usageFields(snapshot) : {});
}

function createServerClient(
  env: (name: string) => string | undefined,
  factory: NonNullable<HandlerDependencies['createClient']>
): RpcClient | Response {
  const supabaseUrl = cleanText(env('SUPABASE_URL'));
  const serviceRoleKey = cleanText(env('SUPABASE_SERVICE_ROLE_KEY'));

  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(500, 'USAGE_LOOKUP_ERROR', 'unavailable');
  }

  return factory(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function isResponse(value: RpcClient | Response): value is Response {
  return value instanceof Response;
}

function providerFailure(error: unknown): ProviderError {
  if (isProviderError(error)) return error;
  return new ProviderError('AI_REQUEST_FAILED', 'No se pudo contactar al proveedor de IA.', 502);
}

async function completeUsage(
  client: RpcClient,
  usageId: string,
  success: boolean,
  provider: ProviderConfig,
  request: AnalysisRequest,
  startedAt: number,
  now: () => number,
  providerResult: ProviderResult | null,
  failure: ProviderError | null
): Promise<RpcResult> {
  const latency = Math.max(0, Math.trunc(now() - startedAt));
  const metadata: Record<string, unknown> = {
    agent_type: request.agentType,
    system_prompt_length: request.systemPrompt.length,
    user_prompt_length: request.userPrompt.length,
    provider: provider.style,
    model: provider.model,
    latency_ms: latency
  };

  if (providerResult?.requestId) metadata.request_id = providerResult.requestId;
  if (failure) metadata.error_code = failure.code;

  return client.rpc('complete_ai_agent_analysis', {
    p_usage_id: usageId,
    p_success: success,
    p_prompt_tokens: providerResult?.promptTokens ?? null,
    p_completion_tokens: providerResult?.completionTokens ?? null,
    p_total_tokens: providerResult?.totalTokens ?? null,
    p_error_message: failure ? failure.message.slice(0, 160) : null,
    p_metadata: metadata
  });
}

async function handleUsage(
  client: RpcClient,
  auth: AuthPayload,
  requestId: string
): Promise<Response> {
  let result: RpcResult;
  try {
    result = await client.rpc('get_ai_agent_usage', {
      p_license_key: auth.licenseKey,
      p_device_fingerprint: auth.deviceFingerprint,
      p_device_security_token: auth.deviceSecurityToken,
      p_staff_session_token: auth.staffSessionToken
    });
  } catch {
    return errorResponse(500, 'USAGE_LOOKUP_ERROR', requestId);
  }

  if (result.error) return rpcFailureResponse('USAGE_LOOKUP_ERROR', 500, requestId, null);

  const snapshot = asSnapshot(result.data);
  if (!snapshot) return errorResponse(500, 'USAGE_LOOKUP_ERROR', requestId);
  if (snapshot.success !== true) {
    const code = safeCode(snapshot.code, 'USAGE_LOOKUP_ERROR');
    return errorResponse(statusForRpcCode(code), code, requestId, usageFields(snapshot));
  }

  return jsonResponse(200, snapshot, requestId);
}

async function handleAnalysis(
  client: RpcClient,
  request: AnalysisRequest,
  provider: ProviderConfig,
  fetchImpl: typeof fetch,
  now: () => number,
  requestId: string,
  providerTimeoutMs: number | undefined
): Promise<Response> {
  let begin: RpcResult;
  try {
    begin = await client.rpc('begin_ai_agent_analysis', {
      p_license_key: request.auth.licenseKey,
      p_device_fingerprint: request.auth.deviceFingerprint,
      p_device_security_token: request.auth.deviceSecurityToken,
      p_staff_session_token: request.auth.staffSessionToken,
      p_agent_type: request.agentType,
      p_metadata: {
        agent_type: request.agentType,
        system_prompt_length: request.systemPrompt.length,
        user_prompt_length: request.userPrompt.length
      }
    });
  } catch {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId);
  }

  const beginSnapshot = asSnapshot(begin.data);
  if (begin.error || !beginSnapshot) {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId);
  }

  if (beginSnapshot.success !== true) {
    const code = safeCode(beginSnapshot.code, 'USAGE_RESERVATION_ERROR');
    return errorResponse(statusForRpcCode(code, 500), code, requestId, usageFields(beginSnapshot));
  }

  const usageId = cleanText(beginSnapshot.usage_id);
  if (!usageId) return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId);

  const startedAt = now();
  let providerResult: ProviderResult;
  try {
    providerResult = await requestProvider(
      provider,
      request.systemPrompt,
      request.userPrompt,
      request.options,
      fetchImpl,
      providerTimeoutMs
    );
  } catch (error) {
    const failure = providerFailure(error);
    let completion: RpcResult;
    try {
      completion = await completeUsage(client, usageId, false, provider, request, startedAt, now, null, failure);
    } catch {
      return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId);
    }

    if (completion.error || asSnapshot(completion.data)?.success !== true) {
      return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId);
    }

    return errorResponse(failure.status, failure.code, requestId);
  }

  let completion: RpcResult;
  try {
    completion = await completeUsage(client, usageId, true, provider, request, startedAt, now, providerResult, null);
  } catch {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId);
  }

  if (completion.error || asSnapshot(completion.data)?.success !== true) {
    return errorResponse(500, 'USAGE_RESERVATION_ERROR', requestId);
  }

  return jsonResponse(200, {
    success: true,
    content: providerResult.content,
    usageStatus: analysisUsageStatus(beginSnapshot)
  }, requestId);
}

export function createHandler(dependencies: HandlerDependencies = {}) {
  const env = dependencies.env || ((name: string) => Deno.env.get(name) || undefined);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const factory = dependencies.createClient || createRestClient;
  const requestIdFactory = dependencies.requestId || (() => crypto.randomUUID());
  const now = dependencies.now || (() => Date.now());

  return async function handler(req: Request): Promise<Response> {
    const requestId = requestIdFactory();

    if (req.method === 'OPTIONS') return jsonResponse(200, { success: true }, requestId);
    if (req.method !== 'POST') return errorResponse(405, 'INVALID_REQUEST', requestId);
    if (!isJsonContentType(req.headers.get('content-type'))) return errorResponse(400, 'INVALID_REQUEST', requestId);

    const declaredLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return errorResponse(413, 'PROMPT_TOO_LARGE', requestId);
    }

    let rawBody: ArrayBuffer;
    try {
      rawBody = await req.arrayBuffer();
    } catch {
      return errorResponse(400, 'INVALID_REQUEST', requestId);
    }

    if (rawBody.byteLength > MAX_BODY_BYTES) return errorResponse(413, 'PROMPT_TOO_LARGE', requestId);

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return errorResponse(400, 'INVALID_REQUEST', requestId);
    }

    const validation = validatePayload(payload);
    if (!validation.ok) return errorResponse(validation.status, validation.code, requestId);

    const client = createServerClient(env, factory);
    if (isResponse(client)) return errorResponse(500, 'USAGE_LOOKUP_ERROR', requestId);

    if (validation.request.kind === 'usage') {
      return handleUsage(client, validation.request.auth, requestId);
    }

    const providerConfig = resolveProviderConfig(env);
    if (providerConfig instanceof ProviderError) {
      const code = providerConfig.message.includes('clave') ? 'AI_KEY_MISSING' : providerConfig.code;
      return errorResponse(providerConfig.status, code, requestId);
    }

    return handleAnalysis(client, validation.request, providerConfig, fetchImpl, now, requestId, dependencies.providerTimeoutMs);
  };
}

if (import.meta.main) {
  Deno.serve(createHandler());
}
