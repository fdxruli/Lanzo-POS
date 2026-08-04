export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_SYSTEM_PROMPT_CHARS = 32_000;
export const MAX_USER_PROMPT_CHARS = 96_000;
export const MAX_TOTAL_PROMPT_CHARS = 128_000;

export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_MAX_TOKENS = 2048;
export const MAX_MAX_TOKENS = 4096;

export const AGENT_TYPES = [
  'inventoryAuditor',
  'financialAnalyst',
  'customerStrategist',
  'unknown'
] as const;

export type AgentType = typeof AGENT_TYPES[number];

export type AuthPayload = {
  licenseKey: string;
  deviceFingerprint: string;
  deviceSecurityToken: string;
  staffSessionToken: string | null;
};

export type AnalysisOptions = {
  temperature: number;
  maxTokens: number;
};

export type UsageRequest = {
  kind: 'usage';
  auth: AuthPayload;
};

export type AnalysisRequest = {
  kind: 'analysis';
  auth: AuthPayload;
  agentType: AgentType;
  systemPrompt: string;
  userPrompt: string;
  options: AnalysisOptions;
};

export type ValidatedRequest = UsageRequest | AnalysisRequest;

export type ValidationFailure = {
  ok: false;
  code: 'AUTH_PAYLOAD_REQUIRED' | 'PROMPT_TOO_LARGE' | 'INVALID_REQUEST';
  message: string;
  status: number;
};

export type ValidationResult =
  | { ok: true; request: ValidatedRequest }
  | ValidationFailure;

const FORBIDDEN_KEYS = new Set([
  'AI_API_KEY',
  'AI_API_URL',
  'AI_MODEL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'rpc',
  'rpcName',
  'rpc_name',
  'providerUrl',
  'provider_url',
  'providerHeaders',
  'provider_headers',
  'deployment'
]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const cleanString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const hasForbiddenKey = (value: unknown, depth = 0): boolean => {
  if (depth > 2 || !isRecord(value)) return false;

  return Object.entries(value).some(([key, child]) => (
    FORBIDDEN_KEYS.has(key) || hasForbiddenKey(child, depth + 1)
  ));
};

function invalid(message: string): ValidationFailure {
  return { ok: false, code: 'INVALID_REQUEST', message, status: 400 };
}

function validateAuth(value: unknown): AuthPayload | ValidationFailure {
  if (!isRecord(value)) {
    return {
      ok: false,
      code: 'AUTH_PAYLOAD_REQUIRED',
      message: 'Falta el contexto seguro de licencia y dispositivo.',
      status: 401
    };
  }

  const licenseKey = cleanString(value.licenseKey);
  const deviceFingerprint = cleanString(value.deviceFingerprint);
  const deviceSecurityToken = cleanString(value.deviceSecurityToken);
  const staffValue = value.staffSessionToken;
  const staffSessionToken = staffValue === null ? null : cleanString(staffValue);

  if (!licenseKey || !deviceFingerprint || !deviceSecurityToken) {
    return {
      ok: false,
      code: 'AUTH_PAYLOAD_REQUIRED',
      message: 'Falta el contexto seguro de licencia y dispositivo.',
      status: 401
    };
  }

  if (licenseKey.length > 1024 || deviceFingerprint.length > 1024 || deviceSecurityToken.length > 4096) {
    return invalid('El contexto de autenticación no es válido.');
  }

  if (staffValue !== null && typeof staffValue !== 'string') {
    return invalid('El token de sesión staff no es válido.');
  }

  if (staffSessionToken && staffSessionToken.length > 4096) {
    return invalid('El token de sesión staff no es válido.');
  }

  return {
    licenseKey,
    deviceFingerprint,
    deviceSecurityToken,
    staffSessionToken: staffSessionToken || null
  };
}

function validateOptions(value: unknown): AnalysisOptions | ValidationFailure {
  if (value === undefined) {
    return { temperature: DEFAULT_TEMPERATURE, maxTokens: DEFAULT_MAX_TOKENS };
  }

  if (!isRecord(value)) return invalid('Las opciones del análisis no son válidas.');

  const temperature = value.temperature === undefined ? DEFAULT_TEMPERATURE : value.temperature;
  const maxTokens = value.maxTokens === undefined ? DEFAULT_MAX_TOKENS : value.maxTokens;

  if (
    typeof temperature !== 'number' ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    return invalid('La temperatura del análisis no es válida.');
  }

  if (
    typeof maxTokens !== 'number' ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > MAX_MAX_TOKENS
  ) {
    return invalid('El límite de tokens del análisis no es válido.');
  }

  return { temperature, maxTokens };
}

export function validatePayload(value: unknown): ValidationResult {
  if (!isRecord(value)) return invalid('El cuerpo JSON debe ser un objeto.');
  if (hasForbiddenKey(value)) return invalid('La solicitud contiene campos no permitidos.');

  const authResult = validateAuth(value.auth);
  if (!('licenseKey' in authResult)) return authResult;

  if (value.action !== undefined && value.action !== 'usage') {
    return invalid('La operación solicitada no es válida.');
  }

  if (value.action === 'usage') {
    return { ok: true, request: { kind: 'usage', auth: authResult } };
  }

  const systemPrompt = typeof value.systemPrompt === 'string' ? value.systemPrompt : '';
  const userPrompt = typeof value.userPrompt === 'string' ? value.userPrompt : '';

  if (!systemPrompt.trim() || !userPrompt.trim()) {
    return invalid('Los prompts del análisis son requeridos.');
  }

  if (
    systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS ||
    userPrompt.length > MAX_USER_PROMPT_CHARS ||
    systemPrompt.length + userPrompt.length > MAX_TOTAL_PROMPT_CHARS
  ) {
    return {
      ok: false,
      code: 'PROMPT_TOO_LARGE',
      message: 'El análisis contiene demasiados datos. Reduce el rango.',
      status: 413
    };
  }

  const agentTypeValue = value.agentType === undefined ? 'unknown' : value.agentType;
  if (typeof agentTypeValue !== 'string' || !AGENT_TYPES.includes(agentTypeValue as AgentType)) {
    return invalid('El tipo de agente no es válido.');
  }

  const options = validateOptions(value.options);
  if (!('temperature' in options)) return options;

  return {
    ok: true,
    request: {
      kind: 'analysis',
      auth: authResult,
      agentType: agentTypeValue as AgentType,
      systemPrompt,
      userPrompt,
      options
    }
  };
}

export function isJsonContentType(contentType: string | null): boolean {
  return Boolean(contentType && /^application\/json(?:\s*;|$)/iu.test(contentType));
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function cleanText(value: unknown): string {
  return cleanString(value);
}
