import type { AnalysisOptions } from './contract.ts';

export const PROVIDER_TIMEOUT_MS = 55_000;
export const MAX_PROVIDER_BODY_BYTES = 512 * 1024;

export type ProviderStyle = 'responses' | 'chat-completions';
export type ProviderVendor = 'openai-compatible' | 'moonshot';
export type ThinkingMode = 'enabled' | 'disabled';
export type ReasoningEffort = 'low' | 'high' | 'max';

export type ProviderConfig = {
  url: string;
  model: string;
  apiKey: string;
  style: ProviderStyle;
  vendor: ProviderVendor;
  thinkingMode: ThinkingMode | null;
  reasoningEffort: ReasoningEffort | null;
};

export type ProviderResult = {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string | null;
  requestId: string | null;
  style: ProviderStyle;
};

export type ProviderFailureCode = 'AI_PROVIDER_ERROR' | 'AI_REQUEST_FAILED' | 'AI_EMPTY_RESPONSE';

export class ProviderError extends Error {
  code: ProviderFailureCode;
  status: number;
  timedOut: boolean;

  constructor(code: ProviderFailureCode, message: string, status: number, timedOut = false) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.timedOut = timedOut;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const nonEmptyText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
};

const nonNegativeInteger = (value: unknown): number | null => (
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
);

const MOONSHOT_HOSTS = new Set(['api.moonshot.ai', 'api.moonshot.cn']);

function classifyProviderUrl(rawUrl: string): ProviderStyle {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProviderError('AI_PROVIDER_ERROR', 'La URL del proveedor de IA no es válida.', 500);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ProviderError('AI_PROVIDER_ERROR', 'La URL del proveedor de IA no es válida.', 500);
  }

  const path = parsed.pathname.toLowerCase().replace(/\/+$/u, '');
  if (path.endsWith('/responses') || path === 'responses') return 'responses';
  if (path.endsWith('/chat/completions')) return 'chat-completions';

  throw new ProviderError('AI_PROVIDER_ERROR', 'El formato del endpoint de IA no está reconocido.', 500);
}

function resolveProviderVendor(
  rawUrl: string,
  model: string,
  configuredVendor: string | undefined
): ProviderVendor {
  const configured = (configuredVendor || '').trim().toLowerCase();
  if (configured === 'moonshot' || configured === 'kimi') return 'moonshot';
  if (configured === 'openai' || configured === 'openai-compatible') return 'openai-compatible';
  if (configured && configured !== 'auto') {
    throw new ProviderError('AI_PROVIDER_ERROR', 'El proveedor de IA configurado no es válido.', 500);
  }

  let hostname = '';
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    // classifyProviderUrl ya valida la URL antes de llegar aquí.
  }

  if (MOONSHOT_HOSTS.has(hostname) || model.toLowerCase().startsWith('kimi-')) {
    return 'moonshot';
  }

  return 'openai-compatible';
}

function parseThinkingMode(value: string | undefined): ThinkingMode | null {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized !== 'enabled' && normalized !== 'disabled') {
    throw new ProviderError('AI_PROVIDER_ERROR', 'AI_THINKING_MODE debe ser enabled o disabled.', 500);
  }
  return normalized;
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | null {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized !== 'low' && normalized !== 'high' && normalized !== 'max') {
    throw new ProviderError('AI_PROVIDER_ERROR', 'AI_REASONING_EFFORT debe ser low, high o max.', 500);
  }
  return normalized;
}

function validateMoonshotConfig(
  style: ProviderStyle,
  model: string,
  thinkingMode: ThinkingMode | null,
  reasoningEffort: ReasoningEffort | null
): void {
  if (style !== 'chat-completions') {
    throw new ProviderError(
      'AI_PROVIDER_ERROR',
      'Moonshot/Kimi requiere un endpoint de chat completions.',
      500
    );
  }

  const normalizedModel = model.toLowerCase();
  if (normalizedModel === 'kimi-k3' && thinkingMode) {
    throw new ProviderError(
      'AI_PROVIDER_ERROR',
      'Kimi K3 usa AI_REASONING_EFFORT; no admite AI_THINKING_MODE.',
      500
    );
  }

  if (normalizedModel.startsWith('kimi-k2') && reasoningEffort) {
    throw new ProviderError(
      'AI_PROVIDER_ERROR',
      'Los modelos Kimi K2 usan AI_THINKING_MODE; no admiten AI_REASONING_EFFORT.',
      500
    );
  }

  if (normalizedModel.startsWith('kimi-k2.7') && thinkingMode === 'disabled') {
    throw new ProviderError(
      'AI_PROVIDER_ERROR',
      'Kimi K2.7 mantiene el razonamiento activo y no admite disabled.',
      500
    );
  }
}

export function resolveProviderConfig(env: (name: string) => string | undefined): ProviderConfig | ProviderError {
  const primaryApiKey = env('AI_API_KEY');
  const apiKey = primaryApiKey !== undefined
    ? primaryApiKey.trim()
    : (env('OPENAI_API_KEY') || '').trim();
  if (!apiKey) {
    return new ProviderError('AI_PROVIDER_ERROR', 'Falta configurar la clave del proveedor de IA.', 500);
  }

  const rawUrl = (env('AI_API_URL') || '').trim();
  if (!rawUrl) {
    return new ProviderError('AI_PROVIDER_ERROR', 'Falta configurar la URL del proveedor de IA.', 500);
  }

  const model = (env('AI_MODEL') || '').trim();
  if (!model) {
    return new ProviderError('AI_PROVIDER_ERROR', 'Falta configurar el modelo del proveedor de IA.', 500);
  }

  try {
    const style = classifyProviderUrl(rawUrl);
    const vendor = resolveProviderVendor(rawUrl, model, env('AI_PROVIDER'));

    let thinkingMode: ThinkingMode | null = null;
    let reasoningEffort: ReasoningEffort | null = null;
    if (vendor === 'moonshot') {
      thinkingMode = parseThinkingMode(env('AI_THINKING_MODE'));
      reasoningEffort = parseReasoningEffort(env('AI_REASONING_EFFORT'));
      validateMoonshotConfig(style, model, thinkingMode, reasoningEffort);
    }

    return {
      url: rawUrl,
      model,
      apiKey,
      style,
      vendor,
      thinkingMode,
      reasoningEffort
    };
  } catch (error) {
    if (error instanceof ProviderError) return error;
    return new ProviderError('AI_PROVIDER_ERROR', 'La configuración del proveedor de IA no es válida.', 500);
  }
}

function buildRequestBody(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  options: AnalysisOptions
): Record<string, unknown> {
  const requestBody: Record<string, unknown> = config.style === 'responses'
    ? {
        model: config.model,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
        ],
        max_output_tokens: options.maxTokens,
        stream: false
      }
    : {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: options.maxTokens,
        stream: false
      };

  if (config.vendor !== 'moonshot') {
    requestBody.temperature = options.temperature;
    return requestBody;
  }

  const normalizedModel = config.model.toLowerCase();
  if (normalizedModel === 'kimi-k2.6' && config.thinkingMode) {
    requestBody.thinking = { type: config.thinkingMode };
  }
  if (normalizedModel === 'kimi-k3' && config.reasoningEffort) {
    requestBody.reasoning_effort = config.reasoningEffort;
  }

  return requestBody;
}

async function readBodyWithLimit(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_BODY_BYTES) {
    throw new ProviderError('AI_PROVIDER_ERROR', 'La respuesta del proveedor es demasiado grande.', 502);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PROVIDER_BODY_BYTES) {
    throw new ProviderError('AI_PROVIDER_ERROR', 'La respuesta del proveedor es demasiado grande.', 502);
  }

  return new TextDecoder().decode(bytes);
}

function normalizeUsage(usage: unknown) {
  const record = isRecord(usage) ? usage : {};
  return {
    promptTokens: nonNegativeInteger(record.prompt_tokens ?? record.input_tokens),
    completionTokens: nonNegativeInteger(record.completion_tokens ?? record.output_tokens),
    totalTokens: nonNegativeInteger(record.total_tokens)
  };
}

function textFromContentParts(value: unknown): string {
  if (!Array.isArray(value)) return '';

  return value
    .map((part) => {
      if (!isRecord(part)) return '';
      return nonEmptyText(part.text) || '';
    })
    .join('')
    .trim();
}

function normalizeResponsePayload(payload: unknown, config: ProviderConfig, response: Response): ProviderResult {
  if (!isRecord(payload)) {
    throw new ProviderError('AI_REQUEST_FAILED', 'La respuesta del proveedor no es JSON válido.', 502);
  }

  let content = '';
  let usage: unknown;
  let model: string | null = nonEmptyText(payload.model);

  if (config.style === 'responses') {
    content = nonEmptyText(payload.output_text) || '';
    usage = payload.usage;

    if (!content && Array.isArray(payload.output)) {
      content = payload.output
        .map((item) => {
          if (!isRecord(item)) return '';
          return textFromContentParts(item.content);
        })
        .join('')
        .trim();
    }
  } else {
    usage = payload.usage;
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const firstChoice = isRecord(choices[0]) ? choices[0] : {};
    const message = isRecord(firstChoice.message) ? firstChoice.message : {};
    content = nonEmptyText(message.content) || textFromContentParts(message.content);
  }

  if (!content) {
    throw new ProviderError('AI_EMPTY_RESPONSE', 'El proveedor IA devolvió una respuesta vacía.', 502);
  }

  const normalizedUsage = normalizeUsage(usage);
  return {
    content,
    ...normalizedUsage,
    model,
    requestId: nonEmptyText(response.headers.get('x-request-id')),
    style: config.style
  };
}

export async function requestProvider(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  options: AnalysisOptions,
  fetchImpl: typeof fetch,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<ProviderResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.apiKey
      },
      body: JSON.stringify(buildRequestBody(config, systemPrompt, userPrompt, options)),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new ProviderError('AI_REQUEST_FAILED', 'El proveedor de IA rechazó la solicitud.', 502);
    }

    const body = await readBodyWithLimit(response);
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new ProviderError('AI_REQUEST_FAILED', 'La respuesta del proveedor no es JSON válido.', 502);
    }

    return normalizeResponsePayload(payload, config, response);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (timedOut || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new ProviderError('AI_REQUEST_FAILED', 'El proveedor de IA tardó demasiado.', 504, true);
    }
    throw new ProviderError('AI_REQUEST_FAILED', 'No se pudo contactar al proveedor de IA.', 502);
  } finally {
    clearTimeout(timer);
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}
