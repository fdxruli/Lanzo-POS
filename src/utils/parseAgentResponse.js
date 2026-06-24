/**
 * parseAgentResponse
 *
 * Normaliza respuestas estructuradas del agente.
 * El proveedor puede devolver JSON puro, JSON dentro de ```json```,
 * JSON escapado, arrays, wrappers de Edge Function o texto Markdown.
 * Si no se puede parsear, devolvemos fallback Markdown.
 */

const VALID_SEVERITIES = new Set(['success', 'info', 'warning', 'danger']);
const VALID_ACTION_TYPES = new Set(['navigate', 'review', 'draft', 'checklist', 'manual']);
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);

const SEVERITY_ALIASES = {
  ok: 'success',
  good: 'success',
  healthy: 'success',
  correcto: 'success',
  bien: 'success',
  bajo: 'success',
  low: 'success',
  notice: 'info',
  neutral: 'info',
  informacion: 'info',
  información: 'info',
  medio: 'warning',
  media: 'warning',
  alerta: 'warning',
  advertencia: 'warning',
  warning: 'warning',
  high: 'danger',
  alto: 'danger',
  alta: 'danger',
  critical: 'danger',
  critico: 'danger',
  crítico: 'danger',
  danger: 'danger',
  riesgo: 'danger'
};

const PRIORITY_ALIASES = {
  urgente: 'high',
  critica: 'high',
  crítico: 'high',
  critico: 'high',
  alta: 'high',
  alto: 'high',
  high: 'high',
  media: 'medium',
  medio: 'medium',
  medium: 'medium',
  normal: 'medium',
  baja: 'low',
  bajo: 'low',
  low: 'low'
};

const ACTION_TYPE_ALIASES = {
  navegar: 'navigate',
  navigation: 'navigate',
  revisar: 'review',
  revision: 'review',
  revisión: 'review',
  redactar: 'draft',
  borrador: 'draft',
  checklist: 'checklist',
  lista: 'checklist',
  manual: 'manual'
};

const WRAPPER_KEYS = [
  'content',
  'text',
  'texto',
  'message',
  'mensaje',
  'response',
  'respuesta',
  'result',
  'resultado',
  'output',
  'analysis',
  'analisis',
  'análisis',
  'data',
  'answer',
  'payload'
];

const STRUCTURED_KEYS = [
  'findings',
  'hallazgos',
  'insights',
  'diagnostics',
  'diagnosticos',
  'diagnósticos',
  'issues',
  'alertas',
  'actions',
  'acciones',
  'recommendedActions',
  'recommended_actions',
  'recommendations',
  'recomendaciones',
  'nextSteps',
  'next_steps',
  'opportunities',
  'oportunidades',
  'growthOpportunities',
  'growth_opportunities',
  'executiveSummary',
  'executive_summary',
  'resumenEjecutivo',
  'resumen_ejecutivo',
  'summary',
  'resumen'
];

const clampNumber = (value, min = 0, max = 1, fallback = 0.7) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const safeJsonStringify = (value, fallback = '') => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
};

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => asString(item)).filter(Boolean).join(', ');
  if (typeof value === 'object') return safeJsonStringify(value, fallback);
  return fallback;
};

const normalizeToken = (value = '') => asString(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const asArray = (value) => Array.isArray(value) ? value : [];
const asFlexibleArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
};

const firstPresent = (source, keys, fallback = undefined) => {
  if (!asObject(source)) return fallback;

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return fallback;
};

const hasStructuredKeys = (payload) => asObject(payload) && STRUCTURED_KEYS.some(key => (
  Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined && payload[key] !== null
));

const normalizeSeverity = (value, fallback = 'info') => {
  const normalized = normalizeToken(value || fallback);
  const aliased = SEVERITY_ALIASES[normalized] || normalized;
  return VALID_SEVERITIES.has(aliased) ? aliased : fallback;
};

const normalizePriority = (value, fallback = 'medium') => {
  const normalized = normalizeToken(value || fallback);
  const aliased = PRIORITY_ALIASES[normalized] || normalized;
  return VALID_PRIORITIES.has(aliased) ? aliased : fallback;
};

const normalizeActionType = (value, fallback = 'manual') => {
  const normalized = normalizeToken(value || fallback);
  const aliased = ACTION_TYPE_ALIASES[normalized] || normalized;
  return VALID_ACTION_TYPES.has(aliased) ? aliased : fallback;
};

const stripCodeFence = (rawText) => {
  const text = asString(rawText)
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();

  if (!text) return '';

  const fencedMatch = text.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  return text.replace(/^json\s*[:\n]/i, '').trim();
};

const sanitizeJsonLike = (text) => asString(text)
  .replace(/^\uFEFF/, '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/,\s*([}\]])/g, '$1')
  .trim();

const repairEscapedJsonText = (text) => {
  const value = sanitizeJsonLike(text);
  if (!value.includes('\\"') && !value.includes('\\n')) return value;

  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .trim();
};

const repairLooseJsonText = (text) => sanitizeJsonLike(text)
  .replace(/([{,]\s*)'([^'\n\r]+)'\s*:/g, '$1"$2":')
  .replace(/:\s*'([^'\n\r]*)'/g, ': "$1"')
  .trim();

const extractBalancedJson = (text, openChar, closeChar) => {
  const start = text.indexOf(openChar);
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === openChar) depth += 1;
    if (char === closeChar) depth -= 1;

    if (depth === 0) return text.slice(start, index + 1);
  }

  return '';
};

const getJsonCandidates = (rawText) => {
  const stripped = stripCodeFence(rawText);
  if (!stripped) return [];

  const candidates = new Set();
  const pushCandidate = (candidate) => {
    const value = sanitizeJsonLike(candidate);
    if (value) candidates.add(value);
  };

  pushCandidate(stripped);
  pushCandidate(repairEscapedJsonText(stripped));
  pushCandidate(repairLooseJsonText(stripped));

  const sanitized = sanitizeJsonLike(stripped);
  pushCandidate(extractBalancedJson(sanitized, '{', '}'));
  pushCandidate(extractBalancedJson(sanitized, '[', ']'));

  const escaped = repairEscapedJsonText(stripped);
  pushCandidate(extractBalancedJson(escaped, '{', '}'));
  pushCandidate(extractBalancedJson(escaped, '[', ']'));

  return Array.from(candidates).filter(Boolean);
};

const parseJsonCandidate = (candidate, depth = 0) => {
  if (!candidate || depth > 4) return null;

  const attempts = [
    candidate,
    sanitizeJsonLike(candidate),
    repairEscapedJsonText(candidate),
    repairLooseJsonText(candidate)
  ];

  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const parsed = JSON.parse(attempt);
      if (typeof parsed === 'string') return parseRawResponse(parsed, depth + 1);
      return parsed;
    } catch {
      // Try next candidate.
    }
  }

  return null;
};

function unwrapProviderPayload(payload, depth = 0) {
  if (depth > 5) return payload;

  if (Array.isArray(payload)) return payload;
  if (!asObject(payload)) return payload;
  if (hasStructuredKeys(payload)) return payload;

  for (const key of WRAPPER_KEYS) {
    const wrapped = payload[key];
    if (wrapped === null || wrapped === undefined) continue;

    if (typeof wrapped === 'string') {
      const parsed = parseRawResponse(wrapped, depth + 1);
      if (parsed) return parsed;
    }

    if (asObject(wrapped) || Array.isArray(wrapped)) {
      return unwrapProviderPayload(wrapped, depth + 1);
    }
  }

  const entries = Object.values(payload).filter(value => value !== null && value !== undefined);
  if (entries.length === 1 && (asObject(entries[0]) || Array.isArray(entries[0]) || typeof entries[0] === 'string')) {
    const onlyValue = entries[0];
    if (typeof onlyValue === 'string') {
      const parsed = parseRawResponse(onlyValue, depth + 1);
      if (parsed) return parsed;
    }
    return unwrapProviderPayload(onlyValue, depth + 1);
  }

  return payload;
}

function parseRawResponse(rawResponse, depth = 0) {
  if (depth > 5) return null;

  if (asObject(rawResponse) || Array.isArray(rawResponse)) {
    return unwrapProviderPayload(rawResponse, depth);
  }

  const rawText = asString(rawResponse);
  if (!rawText) return null;

  for (const candidate of getJsonCandidates(rawText)) {
    const parsed = parseJsonCandidate(candidate, depth + 1);
    if (parsed !== null && parsed !== undefined) {
      return unwrapProviderPayload(parsed, depth + 1);
    }
  }

  return null;
}

const inferArrayBucket = (items) => {
  const sample = items.find(asObject);
  if (!sample) return 'findings';

  const keys = new Set(Object.keys(sample));
  if (keys.has('label') || keys.has('accion') || keys.has('acción') || keys.has('route') || keys.has('expectedImpact')) return 'actions';
  if (keys.has('firstStep') || keys.has('primerPaso') || keys.has('impact') || keys.has('effort')) return 'opportunities';
  return 'findings';
};

const normalizeFinding = (item, index) => {
  if (!asObject(item)) {
    const text = asString(item);
    return {
      id: `finding-${index + 1}`,
      title: text || `Hallazgo ${index + 1}`,
      summary: text,
      severity: 'info',
      metric: '',
      evidence: [],
      toolId: ''
    };
  }

  return {
    id: asString(firstPresent(item, ['id', 'key'], `finding-${index + 1}`)),
    title: asString(firstPresent(item, ['title', 'titulo', 'título', 'name', 'hallazgo'], `Hallazgo ${index + 1}`)),
    summary: asString(firstPresent(item, ['summary', 'description', 'descripcion', 'descripción', 'detalle', 'explicacion', 'explicación'], '')),
    severity: normalizeSeverity(firstPresent(item, ['severity', 'nivel', 'riesgo', 'status', 'estado'], 'info'), 'info'),
    metric: asString(firstPresent(item, ['metric', 'metrica', 'métrica', 'value', 'valor'], '')),
    evidence: asFlexibleArray(firstPresent(item, ['evidence', 'evidencia', 'datos', 'data', 'reason', 'razon', 'razón'], []))
      .map(entry => asString(entry))
      .filter(Boolean)
      .slice(0, 5),
    toolId: asString(firstPresent(item, ['toolId', 'tool_id', 'tool', 'herramienta'], ''))
  };
};

const normalizeAction = (item, index) => {
  if (!asObject(item)) {
    const text = asString(item);
    return {
      id: `action-${index + 1}`,
      label: text || `Acción ${index + 1}`,
      description: text,
      priority: 'medium',
      type: 'manual',
      route: '',
      reason: '',
      expectedImpact: '',
      confirmationRequired: false
    };
  }

  return {
    id: asString(firstPresent(item, ['id', 'key'], `action-${index + 1}`)),
    label: asString(firstPresent(item, ['label', 'title', 'titulo', 'título', 'accion', 'acción', 'action'], `Acción ${index + 1}`)),
    description: asString(firstPresent(item, ['description', 'summary', 'descripcion', 'descripción', 'detalle'], '')),
    priority: normalizePriority(firstPresent(item, ['priority', 'prioridad', 'urgency', 'urgencia'], 'medium'), 'medium'),
    type: normalizeActionType(firstPresent(item, ['type', 'tipo', 'actionType', 'action_type'], 'manual'), 'manual'),
    route: asString(firstPresent(item, ['route', 'ruta', 'path', 'url'], '')),
    reason: asString(firstPresent(item, ['reason', 'razon', 'razón', 'why', 'porque', 'porQue'], '')),
    expectedImpact: asString(firstPresent(item, ['expectedImpact', 'expected_impact', 'impactoEsperado', 'impacto_esperado', 'impact'], '')),
    confirmationRequired: Boolean(firstPresent(item, ['confirmationRequired', 'confirmation_required', 'requiereConfirmacion', 'requiere_confirmacion'], false))
  };
};

const normalizeOpportunity = (item, index) => {
  if (!asObject(item)) {
    const text = asString(item);
    return {
      id: `opportunity-${index + 1}`,
      title: text || `Oportunidad ${index + 1}`,
      description: text,
      impact: '',
      effort: '',
      firstStep: ''
    };
  }

  return {
    id: asString(firstPresent(item, ['id', 'key'], `opportunity-${index + 1}`)),
    title: asString(firstPresent(item, ['title', 'titulo', 'título', 'name', 'oportunidad'], `Oportunidad ${index + 1}`)),
    description: asString(firstPresent(item, ['description', 'summary', 'descripcion', 'descripción', 'detalle'], '')),
    impact: normalizePriority(firstPresent(item, ['impact', 'impacto'], 'medium'), 'medium'),
    effort: normalizePriority(firstPresent(item, ['effort', 'esfuerzo'], 'medium'), 'medium'),
    firstStep: asString(firstPresent(item, ['firstStep', 'first_step', 'primerPaso', 'primer_paso', 'siguientePaso'], ''))
  };
};

const normalizeAgentResponse = (payload) => {
  const normalizedPayload = Array.isArray(payload)
    ? { [inferArrayBucket(payload)]: payload }
    : unwrapProviderPayload(payload);

  const findings = asArray(firstPresent(normalizedPayload, ['findings', 'hallazgos', 'insights', 'diagnostics', 'diagnosticos', 'diagnósticos', 'issues', 'alertas'], []))
    .map(normalizeFinding)
    .filter(item => item.title || item.summary);

  const actions = asArray(firstPresent(normalizedPayload, ['actions', 'acciones', 'recommendedActions', 'recommended_actions', 'recommendations', 'recomendaciones', 'nextSteps', 'next_steps'], []))
    .map(normalizeAction)
    .filter(item => item.label || item.description);

  const opportunities = asArray(firstPresent(normalizedPayload, ['opportunities', 'oportunidades', 'growthOpportunities', 'growth_opportunities'], []))
    .map(normalizeOpportunity)
    .filter(item => item.title || item.description);

  const questionsToAskUser = asFlexibleArray(firstPresent(normalizedPayload, ['questionsToAskUser', 'questions_to_ask_user', 'questions', 'preguntas', 'preguntasAlUsuario'], []))
    .map(question => asString(question))
    .filter(Boolean)
    .slice(0, 5);

  const hasUsefulStructuredContent = findings.length > 0 || actions.length > 0 || opportunities.length > 0;
  const fallbackSummary = hasUsefulStructuredContent
    ? 'Análisis generado con datos del negocio.'
    : 'La IA devolvió JSON válido, pero sin el esquema esperado. Se normalizó para evitar mostrar JSON crudo.';

  return {
    isStructured: true,
    formatVersion: asString(firstPresent(normalizedPayload, ['formatVersion', 'format_version', 'version'], '1.0')),
    executiveSummary: asString(firstPresent(normalizedPayload, ['executiveSummary', 'executive_summary', 'summary', 'resumen', 'resumenEjecutivo', 'resumen_ejecutivo'], fallbackSummary)),
    severity: normalizeSeverity(firstPresent(normalizedPayload, ['severity', 'nivel', 'status', 'estado'], hasUsefulStructuredContent ? 'info' : 'warning'), hasUsefulStructuredContent ? 'info' : 'warning'),
    confidence: clampNumber(firstPresent(normalizedPayload, ['confidence', 'confianza'], 0.7), 0, 1, 0.7),
    findings: hasUsefulStructuredContent ? findings : [normalizeFinding({
      title: 'Respuesta JSON sin contrato completo',
      summary: 'El proveedor respondió en formato JSON, pero no incluyó findings/actions/opportunities reconocibles. Revisa el prompt o la Edge Function si esto se repite.',
      severity: 'warning',
      evidence: ['El frontend pudo parsear el JSON, pero faltaron claves estructuradas esperadas.']
    }, 0)],
    actions,
    opportunities,
    questionsToAskUser,
    toolReferences: asFlexibleArray(firstPresent(normalizedPayload, ['toolReferences', 'tool_references', 'tools', 'herramientas'], []))
      .map(reference => asString(reference))
      .filter(Boolean),
    raw: normalizedPayload
  };
};

export const parseAgentResponse = (rawResponse) => {
  const parsedPayload = parseRawResponse(rawResponse);

  if (parsedPayload !== null && parsedPayload !== undefined) {
    return normalizeAgentResponse(parsedPayload);
  }

  const rawText = asString(rawResponse);
  if (!rawText) {
    return {
      isStructured: false,
      markdown: '',
      error: 'Respuesta vacía del proveedor de IA'
    };
  }

  return {
    isStructured: false,
    markdown: rawText,
    error: 'No se pudo interpretar la respuesta como JSON estructurado válido'
  };
};

export default parseAgentResponse;
