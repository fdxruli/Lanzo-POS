import type { AnalysisOptions } from './contract.ts';

export const PROVIDER_TIMEOUT_MS = 55_000;
export const MAX_PROVIDER_BODY_BYTES = 512 * 1024;

export type ProviderStyle = 'responses' | 'chat-completions';

export type ProviderConfig = {
  url: string;
  model: string;
  apiKey: string;
  style: ProviderStyle;
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
    return { url: rawUrl, model, apiKey, style: classifyProviderUrl(rawUrl) };
  } catch (error) {
    if (error instanceof ProviderError) return error;
    return new ProviderError('AI_PROVIDER_ERROR', 'La configuración del proveedor de IA no es válida.', 500);
  }
}

function buildRequestBody(config: ProviderConfig, systemPrompt: string, userPrompt: string, options: AnalysisOptions) {
  if (config.style === 'responses') {
    return {
      model: config.model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
      ],
      temperature: options.temperature,
      max_output_tokens: options.maxTokens,
      stream: false
    };
  }

  return {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: false
  };
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
        Authorization: `Bearer ${config.apiKey}`
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
