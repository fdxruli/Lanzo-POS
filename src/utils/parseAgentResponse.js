/**
 * parseAgentResponse
 *
 * Normaliza respuestas estructuradas del agente.
 * El proveedor puede devolver JSON puro, JSON dentro de ```json```,
 * o texto Markdown. Si no se puede parsear, devolvemos fallback Markdown.
 */

const VALID_SEVERITIES = new Set(['success', 'info', 'warning', 'danger']);
const VALID_ACTION_TYPES = new Set(['navigate', 'review', 'draft', 'checklist', 'manual']);
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);

const clampNumber = (value, min = 0, max = 1, fallback = 0.7) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};

const asArray = (value) => Array.isArray(value) ? value : [];

const normalizeSeverity = (value, fallback = 'info') => {
  const normalized = asString(value, fallback).toLowerCase();
  return VALID_SEVERITIES.has(normalized) ? normalized : fallback;
};

const normalizePriority = (value, fallback = 'medium') => {
  const normalized = asString(value, fallback).toLowerCase();
  return VALID_PRIORITIES.has(normalized) ? normalized : fallback;
};

const normalizeActionType = (value, fallback = 'manual') => {
  const normalized = asString(value, fallback).toLowerCase();
  return VALID_ACTION_TYPES.has(normalized) ? normalized : fallback;
};

const stripCodeFence = (rawText) => {
  const text = asString(rawText);
  if (!text) return '';

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  return text.trim();
};

const extractJsonCandidate = (rawText) => {
  const stripped = stripCodeFence(rawText);
  if (!stripped) return '';

  if (stripped.startsWith('{') && stripped.endsWith('}')) return stripped;

  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return stripped.slice(firstBrace, lastBrace + 1);
  }

  return stripped;
};

const normalizeFinding = (item, index) => ({
  id: asString(item?.id, `finding-${index + 1}`),
  title: asString(item?.title, `Hallazgo ${index + 1}`),
  summary: asString(item?.summary || item?.description, ''),
  severity: normalizeSeverity(item?.severity, 'info'),
  metric: asString(item?.metric, ''),
  evidence: asArray(item?.evidence).map(entry => asString(entry)).filter(Boolean).slice(0, 5),
  toolId: asString(item?.toolId, '')
});

const normalizeAction = (item, index) => ({
  id: asString(item?.id, `action-${index + 1}`),
  label: asString(item?.label || item?.title, `Acción ${index + 1}`),
  description: asString(item?.description || item?.summary, ''),
  priority: normalizePriority(item?.priority, 'medium'),
  type: normalizeActionType(item?.type, 'manual'),
  route: asString(item?.route, ''),
  reason: asString(item?.reason, ''),
  expectedImpact: asString(item?.expectedImpact, ''),
  confirmationRequired: Boolean(item?.confirmationRequired)
});

const normalizeOpportunity = (item, index) => ({
  id: asString(item?.id, `opportunity-${index + 1}`),
  title: asString(item?.title, `Oportunidad ${index + 1}`),
  description: asString(item?.description || item?.summary, ''),
  impact: asString(item?.impact, ''),
  effort: asString(item?.effort, ''),
  firstStep: asString(item?.firstStep, '')
});

const normalizeAgentResponse = (payload) => {
  const findings = asArray(payload?.findings).map(normalizeFinding).filter(item => item.title || item.summary);
  const actions = asArray(payload?.actions).map(normalizeAction).filter(item => item.label || item.description);
  const opportunities = asArray(payload?.opportunities).map(normalizeOpportunity).filter(item => item.title || item.description);
  const questionsToAskUser = asArray(payload?.questionsToAskUser)
    .map(question => asString(question))
    .filter(Boolean)
    .slice(0, 5);

  return {
    isStructured: true,
    formatVersion: asString(payload?.formatVersion, '1.0'),
    executiveSummary: asString(payload?.executiveSummary || payload?.summary, 'Análisis generado con datos del negocio.'),
    severity: normalizeSeverity(payload?.severity, 'info'),
    confidence: clampNumber(payload?.confidence, 0, 1, 0.7),
    findings,
    actions,
    opportunities,
    questionsToAskUser,
    toolReferences: asArray(payload?.toolReferences).map(reference => asString(reference)).filter(Boolean),
    raw: payload
  };
};

export const parseAgentResponse = (rawResponse) => {
  const rawText = asString(rawResponse);

  if (!rawText) {
    return {
      isStructured: false,
      markdown: '',
      error: 'Respuesta vacía del proveedor de IA'
    };
  }

  try {
    const candidate = extractJsonCandidate(rawText);
    const parsed = JSON.parse(candidate);
    return normalizeAgentResponse(parsed);
  } catch (error) {
    return {
      isStructured: false,
      markdown: rawText,
      error: error.message
    };
  }
};

export default parseAgentResponse;
