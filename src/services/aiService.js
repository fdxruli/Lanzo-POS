/**
 * AI Service - Servicio de comunicación con APIs de LLM
 * 
 * Proporciona una interfaz unificada para conectar con proveedores de IA
 * (OpenAI-compatible y Google Gemini) directamente desde el frontend.
 * 
 * NOTA: Solo para uso en desarrollo/Pruebas de Concepto.
 * Para producción, usar un backend proxy que oculte la API Key.
 */

import Logger from './Logger';

// ============================================================
// 1. CONFIGURACIÓN Y CONSTANTES
// ============================================================

// Modelos por defecto según el proveedor
const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  google: 'gemini-2.5-flash',
  anthropic: 'claude-3-5-sonnet-20241022',
  local: 'llama3.2'
};

const DEFAULT_CONFIG = {
  temperature: 0.2,
  maxTokens: 2048,
  timeoutMs: 60000
};

const API_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  local: 'http://localhost:11434/v1/chat/completions', // Ollama
  google: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
};

// ============================================================
// 2. MANEJO DE ERRORES ESPECÍFICOS
// ============================================================

/**
 * Error personalizado para fallos de API de IA
 */
export class AIApiError extends Error {
  constructor(message, statusCode, originalError = null) {
    super(message);
    this.name = 'AIApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
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
    return new AIApiError(defaultMessage, response.status, errorBody);
  }

  static fromNetwork(error) {
    if (error.name === 'AbortError') {
      return new AIApiError('La solicitud tardó demasiado. Por favor intenta con un análisis más pequeño.', 408, error);
    }
    if (error.message?.includes('Failed to fetch')) {
      return new AIApiError('No se pudo conectar con el servicio de IA. Verifica tu conexión a internet.', 0, error);
    }
    return new AIApiError(`Error de red: ${error.message}`, 0, error);
  }
}

// ============================================================
// 3. SERVICIO PRINCIPAL - UTILIDADES
// ============================================================

/**
 * Obtiene la API Key desde variables de entorno
 * @returns {string} API Key
 * @throws {AIApiError} Si la API Key no está configurada
 */
const getApiKey = () => {
  const apiKey = import.meta.env.VITE_AI_API_KEY;
  
  if (!apiKey) {
    throw new AIApiError(
      'API Key no configurada. Agrega VITE_AI_API_KEY en tu archivo .env',
      401
    );
  }
  
  return apiKey;
};

// ============================================================
// 4. BUILDERS ESPECÍFICOS POR PROVEEDOR
// ============================================================

/**
 * Construye el payload para la API de OpenAI
 */
const buildOpenAIPayload = (systemPrompt, userPrompt, config) => ({
  model: config.model || DEFAULT_CONFIG.model,
  temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
  max_tokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
  messages: [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: userPrompt
    }
  ],
  stream: false
});

/**
 * Construye el payload para Google Gemini
 * Nota: Google Gemini no soporta system prompts nativamente,
 * se prependen al user prompt
 */
const buildGeminiPayload = (systemPrompt, userPrompt, config) => ({
  contents: [{
    parts: [{
      text: `${systemPrompt}\n\n${userPrompt}`
    }]
  }],
  generationConfig: {
    temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
    maxOutputTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
    topP: 0.95,
    topK: 64
  }
});

// ============================================================
// 5. PARSERS ESPECÍFICOS POR PROVEEDOR
// ============================================================

/**
 * Parsea la respuesta de la API de OpenAI
 */
const parseOpenAIResponse = (data) => {
  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new AIApiError('Respuesta de IA vacía o sin contenido', 500, data);
  }

  const choice = data.choices[0];
  
  if (!choice.message || !choice.message.content) {
    throw new AIApiError('Respuesta de IA sin contenido válido', 500, data);
  }

  return choice.message.content.trim();
};

/**
 * Parsea la respuesta de Google Gemini
 */
const parseGeminiResponse = (data) => {
  if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new AIApiError('Respuesta de Gemini vacía o sin contenido', 500, data);
  }

  const candidate = data.candidates[0];
  
  if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
    throw new AIApiError('Respuesta de Gemini sin contenido válido', 500, data);
  }

  const text = candidate.content.parts
    .map(part => part.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new AIApiError('Respuesta de Gemini sin texto', 500, data);
  }

  return text;
};

// ============================================================
// 6. EJECUTORES DE REQUESTS ESPECÍFICOS
// ============================================================

/**
 * Ejecuta una solicitud estándar OpenAI-compatible con timeout
 */
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

    const data = await response.json();
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof AIApiError) {
      throw error;
    }
    
    throw AIApiError.fromNetwork(error);
  }
};

/**
 * Ejecuta una solicitud a Google Gemini con timeout
 * Google Gemini usa la API Key en la URL, no en headers
 */
const executeGeminiRequest = async (url, payload, apiKey, timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const urlWithKey = `${url}?key=${apiKey}`;
    
    const response = await fetch(urlWithKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
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

    const data = await response.json();
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof AIApiError) {
      throw error;
    }
    
    throw AIApiError.fromNetwork(error);
  }
};

// ============================================================
// 7. FUNCIÓN PRINCIPAL
// ============================================================

/**
 * Función principal para analizar con IA
 * 
 * @param {string} systemPrompt - Instrucciones del sistema (rol, formato, reglas)
 * @param {string} userPrompt - Datos/contexto específico del análisis
 * @param {Object} config - Configuración opcional
 * @param {string} config.model - Modelo a usar (default: gpt-4o-mini)
 * @param {number} config.temperature - Temperatura 0-2 (default: 0.2)
 * @param {number} config.maxTokens - Máximo de tokens (default: 2048)
 * @param {number} config.timeoutMs - Timeout en ms (default: 60000)
 * @param {string} config.provider - Proveedor: 'openai', 'google', 'local' (default: openai)
 * 
 * @returns {Promise<string>} Respuesta de la IA en texto plano
 * 
 * @throws {AIApiError} Error específico de la API con código de estado
 * 
 * @example
 * const response = await analyzeWithAI(
 *   'Eres un analista financiero...',
 *   'Datos: revenue=$1000, ventas=50...',
 *   { model: 'gemini-2.5-flash-lite', temperature: 0.2, provider: 'google' }
 * );
 */
export const analyzeWithAI = async (systemPrompt, userPrompt, config = {}) => {
  // Validar inputs
  if (!systemPrompt || typeof systemPrompt !== 'string') {
    throw new AIApiError('systemPrompt es requerido y debe ser un string', 400);
  }
  
  if (!userPrompt || typeof userPrompt !== 'string') {
    throw new AIApiError('userPrompt es requerido y debe ser un string', 400);
  }

  // Obtener API Key
  const apiKey = getApiKey();

  // Determinar proveedor
  const provider = config.provider || import.meta.env.VITE_AI_PROVIDER || 'openai';

  // Obtener modelo por defecto según el proveedor
  const defaultModelForProvider = getDefaultModelForProvider(provider);

  // Merge de configuración - priorizar: config > env > default por proveedor
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    model: config.model || import.meta.env.VITE_AI_MODEL || defaultModelForProvider
  };

  Logger.info('[AI Service] Enviando solicitud a IA:', {
    model: mergedConfig.model,
    provider,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length
  });

  // Ejecutar según el proveedor
  let data;
  let content;

  if (provider === 'google') {
    // Google Gemini
    if (!API_ENDPOINTS.google) {
      throw new AIApiError('Proveedor "google" no configurado', 400);
    }

    const endpoint = API_ENDPOINTS.google.replace('{model}', mergedConfig.model);
    const payload = buildGeminiPayload(systemPrompt, userPrompt, mergedConfig);
    
    data = await executeGeminiRequest(endpoint, payload, apiKey, mergedConfig.timeoutMs);
    content = parseGeminiResponse(data);
  } else {
    // OpenAI-compatible (OpenAI, Ollama, etc)
    const endpoint = API_ENDPOINTS[provider];
    
    if (!endpoint) {
      throw new AIApiError(`Proveedor "${provider}" no soportado`, 400);
    }

    const payload = buildOpenAIPayload(systemPrompt, userPrompt, mergedConfig);
    data = await executeOpenAIRequest(endpoint, payload, apiKey, mergedConfig.timeoutMs);
    content = parseOpenAIResponse(data);
  }

  Logger.info('[AI Service] Respuesta recibida:', {
    model: mergedConfig.model,
    provider,
    contentLength: content.length
  });

  return content;
};

// ============================================================
// 8. UTILIDADES PARA DEBUG Y TESTING
// ============================================================

/**
 * Verifica si la API Key es válida (sin hacer solicitud real)
 * @returns {boolean}
 */
export const hasApiKey = () => {
  return !!import.meta.env.VITE_AI_API_KEY;
};

/**
 * Obtiene información del proveedor configurado
 * @returns {{ configured: boolean, provider: string, hasKey: boolean, model: string }}
 */
export const getAIConfigStatus = () => {
  const hasKey = hasApiKey();
  const provider = import.meta.env.VITE_AI_PROVIDER || 'openai';
  const envModel = import.meta.env.VITE_AI_MODEL;

  return {
    configured: hasKey,
    provider,
    hasKey,
    model: envModel || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai
  };
};

/**
 * Obtiene el modelo por defecto para un proveedor
 * @param {string} provider - Nombre del proveedor
 * @returns {string} Modelo por defecto
 */
export const getDefaultModelForProvider = (provider) => {
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai;
};

/**
 * Valida la conexión con la API de IA
 * @param {Object} options - Opciones de validación
 * @param {string} options.provider - Proveedor a validar (default: el configurado en .env)
 * @param {number} options.timeoutMs - Timeout para la validación
 * @returns {Promise<{ valid: boolean, error?: string, provider: string, model: string }>}
 */
export const validateAIConnection = async (options = {}) => {
  const {
    provider = import.meta.env.VITE_AI_PROVIDER || 'openai',
    timeoutMs = 10000
  } = options;

  try {
    const apiKey = getApiKey();
    const model = getDefaultModelForProvider(provider);

    // Hacer una solicitud mínima de prueba
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

    // Verificar que la respuesta contenga "OK"
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
      model: getDefaultModelForProvider(provider),
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