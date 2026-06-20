/**
 * AI Service - Servicio de comunicación con agentes de IA de Lanzo.
 *
 * Producción: usa Supabase Edge Function `lanzo-ai-agent` para proteger la API key,
 * validar licencia/dispositivo y aplicar límites por plan.
 *
 * Desarrollo: todavía conserva proveedores directos si se fuerza VITE_AI_PROVIDER a
 * google/openai/deepseek/qwen/local. No usar proveedores directos en producción.
 */

import { loadData, STORES } from './database';
import { getDeviceSecurityToken, getStableDeviceId, supabaseClient } from './supabase';

// ============================================================
// 1. CONFIGURACIÓN Y CONSTANTES
// ============================================================

const EDGE_PROVIDER = 'edge';
const EDGE_FUNCTION_NAME = import.meta.env.VITE_AI_EDGE_FUNCTION || 'lanzo-ai-agent';

const DEFAULT_MODELS = {
  edge: 'Supabase Edge',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.5-flash-lite',
  anthropic: 'claude-3-5-sonnet-20241022',
  local: 'llama3.2',
  deepseek: 'deepseek-chat',
  qwen: 'qwen-plus'
};

const DEFAULT_CONFIG = {
  temperature: 0.2,
  maxTokens: 2048,
  timeoutMs: 60000
};

const API_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  local: 'http://localhost:11434/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
};

const OPENAI_COMPATIBLE_PROVIDERS = ['openai', 'local', 'deepseek', 'qwen'];
const DIRECT_PROVIDERS = ['google', ...OPENAI_COMPATIBLE_PROVIDERS];
const SUPPORTED_PROVIDERS = [EDGE_PROVIDER, ...DIRECT_PROVIDERS];

// ============================================================
// 2. MANEJO DE ERRORES ESPECÍFICOS
// ============================================================

export class AIApiError extends Error {
  constructor(message, statusCode, originalError = null, code = null) {
    super(message);
    this.name = 'AIApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }

  static fromResponse(response, errorBody) {
    const messages = {
      401: 'API Key inválida o expirada. Verifica tu configuración.',
      403: 'Acceso denegado. La API Key no tiene permisos para este modelo.',
      429: 'Límite de tasa alcanzado. Por favor espera unos segundos e intenta nuevamente.',
      400: 'Solicitud inválida. El prompt puede estar mal formado.',
      500: 'Error interno del servidor de IA. Intenta más tarde.',
      503: 'Servicio de IA no disponible temporalmente.'
    };

    const defaultMessage = messages[response.status] || `Error de IA (${response.status}): ${errorBody?.message || 'Error desconocido'}`;
    return new AIApiError(defaultMessage, response.status, errorBody, errorBody?.code || null);
  }

  static fromNetwork(error) {
    if (error.name === 'AbortError') {
      return new AIApiError('La solicitud tardó demasiado. Por favor intenta con un análisis más pequeño.', 408, error, 'REQUEST_TIMEOUT');
    }
    if (error.message?.includes('Failed to fetch')) {
      return new AIApiError('No se pudo conectar con el servicio de IA. Verifica tu conexión a internet.', 0, error, 'NETWORK_ERROR');
    }
    return new AIApiError(`Error de red: ${error.message}`, 0, error, 'NETWORK_ERROR');
  }
}

// ============================================================
// 3. SERVICIO PRINCIPAL - UTILIDADES
// ============================================================

const resolveProvider = (provider) => {
  return provider || import.meta.env.VITE_AI_PROVIDER || EDGE_PROVIDER;
};

const getFirstConfiguredValue = (...values) => {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim();
};

const isProviderSupported = (provider) => SUPPORTED_PROVIDERS.includes(provider);

const getApiKey = (provider) => {
  const resolvedProvider = resolveProvider(provider);

  if (resolvedProvider === EDGE_PROVIDER) return 'edge-function-protected';

  const keys = {
    google: getFirstConfiguredValue(import.meta.env.VITE_GEMINI_API_KEY, import.meta.env.VITE_AI_API_KEY),
    deepseek: getFirstConfiguredValue(import.meta.env.VITE_DEEPSEEK_API_KEY, import.meta.env.VITE_AI_API_KEY),
    openai: getFirstConfiguredValue(import.meta.env.VITE_OPENAI_API_KEY, import.meta.env.VITE_AI_API_KEY),
    local: 'no-key-required',
    qwen: getFirstConfiguredValue(import.meta.env.VITE_QWEN_API_KEY, import.meta.env.VITE_AI_API_KEY),
    anthropic: getFirstConfiguredValue(import.meta.env.VITE_ANTHROPIC_API_KEY)
  };

  if (!Object.prototype.hasOwnProperty.call(keys, resolvedProvider)) {
    throw new AIApiError(`Proveedor "${resolvedProvider}" no soportado`, 400, null, 'UNSUPPORTED_PROVIDER');
  }

  const apiKey = keys[resolvedProvider];

  if (!apiKey) {
    throw new AIApiError(
      `API Key para ${resolvedProvider} no configurada en el archivo .env`,
      401,
      null,
      'AI_KEY_MISSING'
    );
  }

  return apiKey;
};

const readLocalLicense = () => {
  try {
    const stored = localStorage.getItem('lanzo_license');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.data || null;
  } catch {
    return null;
  }
};

const readSyncCacheValue = async (key) => {
  try {
    const record = await loadData(STORES.SYNC_CACHE, key);
    return record?.value || null;
  } catch {
    return null;
  }
};

const buildAIAgentAuthContext = async (config = {}) => {
  const localLicense = readLocalLicense();
  const licenseKey =
    config.licenseKey ||
    config.auth?.licenseKey ||
    localLicense?.license_key ||
    localLicense?.licenseKey ||
    localLicense?.key ||
    null;

  const deviceFingerprint =
    config.deviceFingerprint ||
    config.auth?.deviceFingerprint ||
    await getStableDeviceId();

  const deviceSecurityToken =
    config.deviceSecurityToken ||
    config.auth?.deviceSecurityToken ||
    await getDeviceSecurityToken();

  const staffSessionToken =
    config.staffSessionToken ||
    config.auth?.staffSessionToken ||
    await readSyncCacheValue('staff_session_token');

  return {
    licenseKey,
    deviceFingerprint,
    deviceSecurityToken,
    staffSessionToken: staffSessionToken || null
  };
};

const mapEdgeErrorMessage = (payload = {}) => {
  const code = payload.code || payload.reason;

  const messages = {
    AUTH_PAYLOAD_REQUIRED: 'No se pudo confirmar la licencia/dispositivo para usar IA.',
    LICENSE_NOT_FOUND: 'Licencia no encontrada. Vuelve a iniciar sesión.',
    LICENSE_NOT_ACTIVE: 'La licencia no está activa. Verifica tu plan.',
    AI_AGENTS_NOT_AVAILABLE: 'Los agentes de IA solo están disponibles en el plan Pro.',
    AI_AGENT_LIMIT_DISABLED: 'Esta licencia no tiene análisis de IA disponibles.',
    AI_AGENT_LIMIT_REACHED: `Ya alcanzaste el límite de ${payload.limit || 15} análisis de IA para esta licencia Pro.`,
    DEVICE_NOT_ALLOWED: 'Este dispositivo no está autorizado para esta licencia.',
    DEVICE_TOKEN_REQUIRED: 'Falta el token seguro del dispositivo. Vuelve a validar la licencia.',
    DEVICE_TOKEN_INVALID: 'El token de este dispositivo no es válido. Vuelve a iniciar sesión.',
    STAFF_SESSION_REQUIRED: 'Se requiere una sesión staff válida para usar agentes de IA.',
    STAFF_SESSION_INVALID: 'La sesión staff expiró o ya no es válida.',
    AI_KEY_MISSING: 'Falta configurar AI_API_KEY u OPENAI_API_KEY en Supabase Secrets.',
    AI_PROVIDER_ERROR: payload.message || 'El proveedor de IA devolvió un error.',
    PROMPT_TOO_LARGE: payload.message || 'El análisis contiene demasiados datos. Reduce el rango.',
    AI_REQUEST_FAILED: payload.message || 'No se pudo contactar al proveedor de IA.'
  };

  return messages[code] || payload.message || 'No se pudo generar el análisis de IA.';
};

const parseFunctionError = async (error) => {
  const response = error?.context || error?.response;

  if (response && typeof response.json === 'function') {
    try {
      return await response.clone().json();
    } catch {
      return null;
    }
  }

  return null;
};

// ============================================================
// 4. BUILDERS ESPECÍFICOS POR PROVEEDOR DIRECTO
// ============================================================

const buildOpenAIPayload = (systemPrompt, userPrompt, config) => ({
  model: config.model || DEFAULT_CONFIG.model,
  temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
  max_tokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ],
  stream: false
});

const buildGeminiPayload = (systemPrompt, userPrompt, config) => ({
  systemInstruction: {
    parts: [{ text: systemPrompt }]
  },
  contents: [{
    role: 'user',
    parts: [{ text: userPrompt }]
  }],
  generationConfig: {
    temperature: config.temperature ?? 0.2,
    maxOutputTokens: config.maxTokens ?? 2048
  }
});

// ============================================================
// 5. PARSERS ESPECÍFICOS POR PROVEEDOR
// ============================================================

const parseOpenAIResponse = (data) => {
  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new AIApiError('Respuesta de IA vacía o sin contenido', 500, data, 'AI_EMPTY_RESPONSE');
  }

  const choice = data.choices[0];

  if (!choice.message || !choice.message.content) {
    throw new AIApiError('Respuesta de IA sin contenido válido', 500, data, 'AI_EMPTY_RESPONSE');
  }

  return choice.message.content.trim();
};

const parseGeminiResponse = (data) => {
  if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new AIApiError('Respuesta de Gemini vacía o sin contenido', 500, data, 'AI_EMPTY_RESPONSE');
  }

  const candidate = data.candidates[0];

  if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
    throw new AIApiError('Respuesta de Gemini sin contenido válido', 500, data, 'AI_EMPTY_RESPONSE');
  }

  const text = candidate.content.parts
    .map(part => part.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new AIApiError('Respuesta de Gemini sin texto', 500, data, 'AI_EMPTY_RESPONSE');
  }

  return text;
};

// ============================================================
// 6. EJECUTORES DE REQUESTS
// ============================================================

const executeEdgeRequest = async (systemPrompt, userPrompt, config) => {
  if (!supabaseClient) {
    throw new AIApiError('Supabase no está configurado. Revisa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.', 500, null, 'SUPABASE_NOT_CONFIGURED');
  }

  const auth = await buildAIAgentAuthContext(config);

  if (!auth.licenseKey || !auth.deviceFingerprint || !auth.deviceSecurityToken) {
    throw new AIApiError(
      'Faltan datos seguros de licencia/dispositivo para usar agentes de IA. Vuelve a validar la licencia.',
      401,
      { auth },
      'AUTH_PAYLOAD_REQUIRED'
    );
  }

  const { data, error } = await supabaseClient.functions.invoke(EDGE_FUNCTION_NAME, {
    body: {
      auth,
      agentType: config.agentType || 'unknown',
      systemPrompt,
      userPrompt,
      options: {
        temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
        maxTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens
      }
    }
  });

  if (error) {
    const functionPayload = await parseFunctionError(error);
    const payload = functionPayload || { code: error.code, message: error.message };
    throw new AIApiError(
      mapEdgeErrorMessage(payload),
      error.context?.status || error.status || 500,
      payload,
      payload.code || 'EDGE_FUNCTION_ERROR'
    );
  }

  if (!data?.success) {
    throw new AIApiError(
      mapEdgeErrorMessage(data),
      data?.code === 'AI_AGENT_LIMIT_REACHED' ? 429 : 403,
      data,
      data?.code || 'EDGE_REJECTED'
    );
  }

  if (!data.content || typeof data.content !== 'string') {
    throw new AIApiError('La Edge Function no devolvió contenido de IA válido.', 502, data, 'AI_EMPTY_RESPONSE');
  }

  return data.content.trim();
};

const executeOpenAIRequest = async (url, payload, apiKey, timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { message: response.statusText };
      }
      throw AIApiError.fromResponse(response, errorBody);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof AIApiError) throw error;
    throw AIApiError.fromNetwork(error);
  }
};

const executeGeminiRequest = async (url, payload, apiKey, timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { message: response.statusText };
      }
      throw AIApiError.fromResponse(response, errorBody);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof AIApiError) throw error;
    throw AIApiError.fromNetwork(error);
  }
};

// ============================================================
// 7. FUNCIÓN PRINCIPAL
// ============================================================

export const analyzeWithAI = async (systemPrompt, userPrompt, config = {}) => {
  if (!systemPrompt || !userPrompt) throw new AIApiError('Prompts requeridos', 400, null, 'PROMPT_REQUIRED');

  const provider = resolveProvider(config.provider);

  if (provider === EDGE_PROVIDER) {
    return executeEdgeRequest(systemPrompt, userPrompt, config);
  }

  const apiKey = getApiKey(provider);
  const defaultModelForProvider = getDefaultModelForProvider(provider);

  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    model: config.model || import.meta.env.VITE_AI_MODEL || defaultModelForProvider
  };

  let data;

  if (provider === 'google') {
    const endpoint = API_ENDPOINTS.google.replace('{model}', mergedConfig.model);
    const payload = buildGeminiPayload(systemPrompt, userPrompt, mergedConfig);
    data = await executeGeminiRequest(endpoint, payload, apiKey, mergedConfig.timeoutMs);
    return parseGeminiResponse(data);
  }

  if (OPENAI_COMPATIBLE_PROVIDERS.includes(provider)) {
    const endpoint = API_ENDPOINTS[provider];
    if (!endpoint) throw new AIApiError(`Proveedor "${provider}" no soportado`, 400, null, 'UNSUPPORTED_PROVIDER');

    const payload = buildOpenAIPayload(systemPrompt, userPrompt, mergedConfig);
    data = await executeOpenAIRequest(endpoint, payload, apiKey, mergedConfig.timeoutMs);
    return parseOpenAIResponse(data);
  }

  throw new AIApiError(`Proveedor "${provider}" no soportado`, 400, null, 'UNSUPPORTED_PROVIDER');
};

// ============================================================
// 8. UTILIDADES PARA DEBUG Y TESTING
// ============================================================

export const hasApiKey = (provider = resolveProvider()) => {
  const resolvedProvider = resolveProvider(provider);

  if (resolvedProvider === EDGE_PROVIDER) {
    return Boolean(supabaseClient);
  }

  try {
    return !!getApiKey(resolvedProvider);
  } catch {
    return false;
  }
};

export const getAIConfigStatus = () => {
  const provider = resolveProvider();
  const supported = isProviderSupported(provider);
  const hasKey = provider === EDGE_PROVIDER ? Boolean(supabaseClient) : hasApiKey(provider);
  const envModel = import.meta.env.VITE_AI_MODEL;

  return {
    configured: hasKey && supported,
    provider,
    hasKey,
    supported,
    model: provider === EDGE_PROVIDER ? DEFAULT_MODELS.edge : envModel || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai,
    error: supported ? null : `Proveedor "${provider}" no soportado`
  };
};

export const getDefaultModelForProvider = (provider) => {
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
};

export const validateAIConnection = async (options = {}) => {
  const provider = resolveProvider(options.provider);
  const model =
    provider === EDGE_PROVIDER
      ? DEFAULT_MODELS.edge
      : options.model || import.meta.env.VITE_AI_MODEL || getDefaultModelForProvider(provider);

  if (provider === EDGE_PROVIDER) {
    if (!supabaseClient) {
      return {
        valid: false,
        error: 'Supabase no está configurado para invocar Edge Functions.',
        provider,
        model
      };
    }

    try {
      const auth = await buildAIAgentAuthContext(options);

      if (!auth.licenseKey || !auth.deviceFingerprint || !auth.deviceSecurityToken) {
        return {
          valid: false,
          error: 'Falta contexto seguro de licencia/dispositivo. Vuelve a validar la licencia.',
          provider,
          model
        };
      }

      return {
        valid: true,
        provider,
        model,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message || 'No se pudo validar el contexto local de IA.',
        provider,
        model,
        timestamp: new Date().toISOString()
      };
    }
  }

  const { timeoutMs = 10000 } = options;

  try {
    getApiKey(provider);

    const testResponse = await analyzeWithAI(
      'Responde ÚNICAMENTE con la palabra "OK". No agregues nada más.',
      'Test de conexión',
      {
        model,
        provider,
        temperature: 0,
        maxTokens: 10,
        timeoutMs
      }
    );

    if (testResponse.toUpperCase().includes('OK')) {
      return {
        valid: true,
        provider,
        model,
        timestamp: new Date().toISOString()
      };
    }

    return {
      valid: false,
      error: 'Respuesta inesperada de la API',
      provider,
      model
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message || 'Error de conexión',
      provider,
      model,
      timestamp: new Date().toISOString()
    };
  }
};

export default {
  analyzeWithAI,
  hasApiKey,
  getAIConfigStatus,
  getDefaultModelForProvider,
  validateAIConnection,
  AIApiError,
  DEFAULT_CONFIG
};
