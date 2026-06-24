/**
 * AI Service - Servicio de comunicación con agentes de IA de Lanzo.
 *
 * Producción: usa Supabase Edge Function `lanzo-ai-agent` para proteger la API key,
 * validar licencia/dispositivo y aplicar límites por periodo Pro.
 */

import { loadData, STORES } from './database';
import { getDeviceSecurityToken, getStableDeviceId, supabaseClient } from './supabase';

const EDGE_PROVIDER = 'edge';
const EDGE_FUNCTION_NAME = import.meta.env.VITE_AI_EDGE_FUNCTION || 'lanzo-ai-agent';
const AI_USAGE_GATE_STYLE_ID = 'lanzo-ai-usage-gate-style';

const DEFAULT_MODELS = {
  edge: 'Supabase Edge'
};

const DEFAULT_CONFIG = {
  temperature: 0.2,
  maxTokens: 2048,
  timeoutMs: 60000
};

export class AIApiError extends Error {
  constructor(message, statusCode, originalError = null, code = null) {
    super(message);
    this.name = 'AIApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

const isEdgeProvider = (provider) => (provider || import.meta.env.VITE_AI_PROVIDER || EDGE_PROVIDER) === EDGE_PROVIDER;

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

  return {
    licenseKey: config.licenseKey || config.auth?.licenseKey || localLicense?.license_key || localLicense?.licenseKey || localLicense?.key || null,
    deviceFingerprint: config.deviceFingerprint || config.auth?.deviceFingerprint || await getStableDeviceId(),
    deviceSecurityToken: config.deviceSecurityToken || config.auth?.deviceSecurityToken || await getDeviceSecurityToken(),
    staffSessionToken: config.staffSessionToken || config.auth?.staffSessionToken || await readSyncCacheValue('staff_session_token') || null
  };
};

const normalizeText = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const inferAgentType = (systemPrompt = '', userPrompt = '', requestedAgentType = '') => {
  const explicit = String(requestedAgentType || '').trim();
  if (explicit && explicit !== 'unknown') return explicit;

  const combined = normalizeText(`${systemPrompt} ${userPrompt}`);
  if (combined.includes('auditor de inventario')) return 'inventoryAuditor';
  if (combined.includes('analista financiero')) return 'financialAnalyst';
  if (combined.includes('estratega de clientes')) return 'customerStrategist';

  return explicit || 'unknown';
};

const mapEdgeErrorMessage = (payload = {}) => {
  const code = payload.code || payload.reason;
  const messages = {
    AUTH_PAYLOAD_REQUIRED: 'No se pudo confirmar la licencia/dispositivo para usar IA.',
    LICENSE_NOT_FOUND: 'Licencia no encontrada. Vuelve a iniciar sesión.',
    LICENSE_NOT_ACTIVE: 'La licencia no está activa. Verifica tu plan.',
    LICENSE_EXPIRED: 'La licencia está expirada. Renueva tu plan para usar IA.',
    AI_AGENTS_NOT_AVAILABLE: 'Los agentes de IA solo están disponibles en el plan Pro.',
    AI_AGENT_PERIOD_NOT_FOUND: 'No hay un periodo Pro vigente para usar agentes IA.',
    AI_AGENT_LIMIT_DISABLED: 'Este periodo no tiene análisis de IA disponibles.',
    AI_AGENT_LIMIT_REACHED: `Ya alcanzaste el límite de ${payload.limit || 15} análisis IA de tu periodo Pro actual.`,
    DEVICE_NOT_ALLOWED: 'Este dispositivo no está autorizado para esta licencia.',
    DEVICE_TOKEN_REQUIRED: 'Falta el token seguro del dispositivo. Vuelve a validar la licencia.',
    DEVICE_TOKEN_INVALID: 'El token de este dispositivo no es válido. Vuelve a iniciar sesión.',
    STAFF_SESSION_REQUIRED: 'Se requiere una sesión staff válida para usar agentes de IA.',
    STAFF_SESSION_INVALID: 'La sesión staff expiró o ya no es válida.',
    USAGE_LOOKUP_ERROR: payload.message || 'No se pudo consultar el uso de agentes IA.',
    USAGE_RESERVATION_ERROR: payload.message || 'No se pudo reservar el uso del agente IA.',
    AI_KEY_MISSING: 'Falta configurar AI_API_KEY u OPENAI_API_KEY en Supabase Secrets.',
    AI_PROVIDER_ERROR: payload.message || 'El proveedor de IA devolvió un error.',
    PROMPT_TOO_LARGE: payload.message || 'El análisis contiene demasiados datos. Reduce el rango.',
    AI_REQUEST_FAILED: payload.message || 'No se pudo contactar al proveedor de IA.',
    AI_EMPTY_RESPONSE: payload.message || 'El proveedor IA devolvió una respuesta vacía.'
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

const normalizeUsageStatus = (payload = {}) => {
  const limit = Math.max(Number(payload.limit ?? 0), 0);
  const used = Math.max(Number(payload.used ?? 0), 0);
  const remaining = Number.isFinite(Number(payload.remaining))
    ? Math.max(Number(payload.remaining), 0)
    : Math.max(limit - used, 0);

  return {
    ...payload,
    limit,
    used,
    remaining,
    isLimitReached: limit > 0 && remaining <= 0
  };
};

const formatUsagePeriodEnd = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
};

const buildUsageLimitMessage = (usage = {}) => {
  const limit = usage.limit || 15;
  const periodEnd = formatUsagePeriodEnd(usage.period_end || usage.periodEnd || usage.periodEndAt);
  const baseMessage = `Ya alcanzaste el límite de ${limit} análisis IA de tu periodo Pro actual.`;
  return periodEnd
    ? `${baseMessage} El botón de análisis queda bloqueado hasta el siguiente periodo (${periodEnd}) o hasta que el administrador aumente el límite.`
    : `${baseMessage} El botón de análisis queda bloqueado hasta el siguiente periodo o hasta que el administrador aumente el límite.`;
};

const ensureAIUsageGateStyle = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById(AI_USAGE_GATE_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = AI_USAGE_GATE_STYLE_ID;
  style.textContent = `
    html[data-lanzo-ai-usage-exhausted="true"] .agent-selection::after {
      content: attr(data-lanzo-ai-usage-message);
      display: block;
      margin-top: 1rem;
      padding: 0.875rem 1rem;
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 0.75rem;
      background: rgba(245, 158, 11, 0.1);
      color: #92400e;
      font-size: 0.875rem;
      font-weight: 600;
      line-height: 1.45;
      white-space: pre-wrap;
    }

    html[data-lanzo-ai-usage-exhausted="true"] .agent-card,
    html[data-lanzo-ai-usage-exhausted="true"] .analyze-button,
    html[data-lanzo-ai-usage-exhausted="true"] .selector-trigger {
      pointer-events: none !important;
      opacity: 0.55 !important;
      cursor: not-allowed !important;
      filter: grayscale(0.25);
    }
  `;
  document.head.appendChild(style);
};

const setAIUsageGateNotice = (usage = {}) => {
  if (typeof document === 'undefined') return;
  ensureAIUsageGateStyle();
  document.documentElement.setAttribute('data-lanzo-ai-usage-exhausted', 'true');
  document.documentElement.setAttribute('data-lanzo-ai-usage-message', buildUsageLimitMessage(usage));
};

const clearAIUsageGateNotice = () => {
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute('data-lanzo-ai-usage-exhausted');
  document.documentElement.removeAttribute('data-lanzo-ai-usage-message');
};

export const getAIAgentUsageStatus = async (config = {}) => {
  if (!supabaseClient) {
    throw new AIApiError('Supabase no está configurado. Revisa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.', 500, null, 'SUPABASE_NOT_CONFIGURED');
  }

  const auth = await buildAIAgentAuthContext(config);
  if (!auth.licenseKey || !auth.deviceFingerprint || !auth.deviceSecurityToken) {
    throw new AIApiError('Faltan datos seguros de licencia/dispositivo para consultar el uso de agentes IA.', 401, { auth }, 'AUTH_PAYLOAD_REQUIRED');
  }

  const { data, error } = await supabaseClient.functions.invoke(EDGE_FUNCTION_NAME, {
    body: {
      action: 'usage',
      auth
    }
  });

  if (error) {
    const functionPayload = await parseFunctionError(error);
    const payload = functionPayload || { code: error.code, message: error.message };
    throw new AIApiError(mapEdgeErrorMessage(payload), error.context?.status || error.status || 500, payload, payload.code || 'EDGE_FUNCTION_ERROR');
  }

  if (!data?.success) {
    throw new AIApiError(mapEdgeErrorMessage(data), 403, data, data?.code || 'EDGE_REJECTED');
  }

  return normalizeUsageStatus(data);
};

export const analyzeWithAI = async (systemPrompt, userPrompt, config = {}) => {
  if (!systemPrompt || !userPrompt) {
    throw new AIApiError('Prompts requeridos', 400, null, 'PROMPT_REQUIRED');
  }

  if (!isEdgeProvider(config.provider)) {
    throw new AIApiError('En producción, los agentes IA deben ejecutarse mediante Supabase Edge Function.', 400, null, 'DIRECT_AI_DISABLED');
  }

  if (!supabaseClient) {
    throw new AIApiError('Supabase no está configurado. Revisa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.', 500, null, 'SUPABASE_NOT_CONFIGURED');
  }

  const auth = await buildAIAgentAuthContext(config);
  if (!auth.licenseKey || !auth.deviceFingerprint || !auth.deviceSecurityToken) {
    throw new AIApiError('Faltan datos seguros de licencia/dispositivo para usar agentes de IA. Vuelve a validar la licencia.', 401, { auth }, 'AUTH_PAYLOAD_REQUIRED');
  }

  const { data, error } = await supabaseClient.functions.invoke(EDGE_FUNCTION_NAME, {
    body: {
      auth,
      agentType: inferAgentType(systemPrompt, userPrompt, config.agentType),
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
    if ((payload.code || payload.reason) === 'AI_AGENT_LIMIT_REACHED') {
      setAIUsageGateNotice(normalizeUsageStatus(payload));
    }
    throw new AIApiError(mapEdgeErrorMessage(payload), error.context?.status || error.status || 500, payload, payload.code || 'EDGE_FUNCTION_ERROR');
  }

  if (!data?.success) {
    if (data?.code === 'AI_AGENT_LIMIT_REACHED') {
      setAIUsageGateNotice(normalizeUsageStatus(data));
    }
    throw new AIApiError(mapEdgeErrorMessage(data), data?.code === 'AI_AGENT_LIMIT_REACHED' ? 429 : 403, data, data?.code || 'EDGE_REJECTED');
  }

  const usageStatus = normalizeUsageStatus(data.usageStatus || data);
  if (usageStatus.isLimitReached) {
    setAIUsageGateNotice(usageStatus);
  } else {
    clearAIUsageGateNotice();
  }

  if (!data.content || typeof data.content !== 'string') {
    throw new AIApiError('La Edge Function no devolvió contenido de IA válido.', 502, data, 'AI_EMPTY_RESPONSE');
  }

  return data.content.trim();
};

export const hasApiKey = (provider = EDGE_PROVIDER) => isEdgeProvider(provider) && Boolean(supabaseClient);

export const getAIConfigStatus = () => {
  const provider = EDGE_PROVIDER;
  return {
    configured: Boolean(supabaseClient),
    provider,
    hasKey: Boolean(supabaseClient),
    supported: true,
    model: DEFAULT_MODELS.edge,
    error: null
  };
};

export const getDefaultModelForProvider = () => DEFAULT_MODELS.edge;

export const validateAIConnection = async (options = {}) => {
  const provider = EDGE_PROVIDER;
  const model = DEFAULT_MODELS.edge;

  if (!supabaseClient) {
    clearAIUsageGateNotice();
    return { valid: false, error: 'Supabase no está configurado para invocar Edge Functions.', provider, model };
  }

  try {
    const auth = await buildAIAgentAuthContext(options);
    if (!auth.licenseKey || !auth.deviceFingerprint || !auth.deviceSecurityToken) {
      clearAIUsageGateNotice();
      return { valid: false, error: 'Falta contexto seguro de licencia/dispositivo. Vuelve a validar la licencia.', provider, model };
    }

    const usageStatus = await getAIAgentUsageStatus({ ...options, auth });
    if (usageStatus.isLimitReached) {
      const error = buildUsageLimitMessage(usageStatus);
      setAIUsageGateNotice(usageStatus);
      return {
        valid: false,
        error,
        provider,
        model,
        code: 'AI_AGENT_LIMIT_REACHED',
        usageStatus,
        timestamp: new Date().toISOString()
      };
    }

    clearAIUsageGateNotice();
    return { valid: true, provider, model, usageStatus, timestamp: new Date().toISOString() };
  } catch (error) {
    clearAIUsageGateNotice();
    return { valid: false, error: error.message || 'No se pudo validar el contexto local de IA.', provider, model, timestamp: new Date().toISOString() };
  }
};

export default {
  analyzeWithAI,
  getAIAgentUsageStatus,
  hasApiKey,
  getAIConfigStatus,
  getDefaultModelForProvider,
  validateAIConnection,
  AIApiError,
  DEFAULT_CONFIG
};