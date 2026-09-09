/**
 * Prompt builder para los agentes IA.
 *
 * El proveedor recibe únicamente hechos agregados y referencias compactas de
 * herramientas. Los detalles completos se mantienen en memoria/localmente y
 * se excluyen de forma explícita del prompt.
 */

const OUTPUT_SCHEMA = {
  formatVersion: '1.1',
  executiveSummary: 'string',
  severity: 'success|info|warning|danger',
  confidence: 'number 0..1',
  coverage: {
    complete: 'boolean',
    factsTotal: 'number',
    factsIncluded: 'number',
    factsOmitted: 'number',
    notes: ['string']
  },
  findings: 'array; maximum 3',
  actions: 'array; maximum 3',
  opportunities: 'array; maximum 2',
  questionsToAskUser: 'array',
  toolReferences: 'array'
};

const STRUCTURED_OUTPUT_INSTRUCTIONS = `
SALIDA OBLIGATORIA: JSON válido y únicamente JSON. La palabra JSON es
intencional: no uses Markdown, fences ni texto antes o después.

Responde con este contrato JSON exacto:
${JSON.stringify(OUTPUT_SCHEMA)}

Reglas:
- Usa exclusivamente cifras y hechos presentes en facts o toolReferences.
- No inventes métricas, nombres, porcentajes, causas ni resultados futuros.
- Marca limitaciones en coverage.notes o questionsToAskUser.
- La narrativa debe ser breve: máximo 3 findings, 3 actions y 2 opportunities.
- Cada evidencia debe ser concreta; no repitas tablas completas.
- severity debe ser success, info, warning o danger; confidence debe estar entre 0 y 1.
- Si coverage.complete es false, no presentes el análisis como completo.
`.trim();

const AGENT_PROMPTS = {
  inventoryAuditor: {
    role: 'Auditor de Inventario',
    focus: 'mermas, rotación, capital detenido, niveles de stock y riesgo operativo',
    rules: 'Prioriza impacto económico y reposición. No propongas acciones destructivas automáticas.'
  },
  financialAnalyst: {
    role: 'Analista Financiero',
    focus: 'ingresos, utilidad confirmada, margen, ticket, horarios y métodos de pago',
    rules: 'No conviertas costos faltantes en cero ni presentes proyecciones como hechos.'
  },
  customerStrategist: {
    role: 'Estratega de Clientes',
    focus: 'clientes activos, recurrencia, deuda y oportunidades de recompra',
    rules: 'Usa referencias anónimas y patrones agregados; no repitas datos personales.'
  }
};

const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const safeJsonStringify = (value, fallback = '{}') => {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
};

const removeProviderExcludedFields = (value) => {
  if (!asObject(value)) return value;

  const excludedKeys = new Set([
    'localDetails',
    'localFacts',
    'rawData',
    'agentToolRun',
    'generatedAt',
    'executedAt'
  ]);

  return Object.fromEntries(Object.entries(value).filter(([key]) => !excludedKeys.has(key)));
};

const compactToolReferences = (agentToolRun = {}) => {
  if (!Array.isArray(agentToolRun.results)) return [];

  return agentToolRun.results
    .filter(asObject)
    .map(tool => ({
      id: String(tool.id || ''),
      title: String(tool.title || ''),
      severity: String(tool.severity || 'info'),
      summary: String(tool.summary || '')
    }))
    .filter(tool => tool.id && (tool.summary || tool.title));
};

const compactDateRange = (dateRange, fallbackType = 'unspecified') => {
  const source = asObject(dateRange) ? dateRange : {};
  return {
    type: String(source.type || fallbackType),
    start: source.start || null,
    end: source.end || null
  };
};

/**
 * Produce the sole provider-facing facts object. `localDetails` and raw
 * tool results are intentionally not included here.
 */
export const buildCompactPromptPayload = (agentType, aggregatedData = {}, businessContext = {}, agentToolRun = {}) => {
  const source = asObject(aggregatedData) ? aggregatedData : {};
  const facts = { ...removeProviderExcludedFields(source) };
  delete facts.dateRange;

  return {
    schemaVersion: 'ai-facts-1.1',
    agentType,
    businessType: String(businessContext.businessType || 'No especificado'),
    dateRange: compactDateRange(source.dateRange, businessContext.dateRange || 'unspecified'),
    facts,
    toolReferences: compactToolReferences(agentToolRun)
  };
};

/**
 * Compact JSON replaces the previous human-readable bullet conversion. It is
 * deliberately minified and stable so equivalent fact payloads can reuse
 * provider prompt caching more effectively.
 */
export const formatAggregatedData = (data) => safeJsonStringify(removeProviderExcludedFields(data), '{}');

export const buildPrompt = (agentType, aggregatedData, businessContext = {}, agentToolRun = null) => {
  const config = AGENT_PROMPTS[agentType];
  if (!config) throw new Error(`Agente no reconocido: ${agentType}`);

  const embeddedToolRun = agentToolRun || (asObject(aggregatedData) ? aggregatedData.agentToolRun : null) || {};
  const payload = buildCompactPromptPayload(agentType, aggregatedData, businessContext, embeddedToolRun);
  const systemPrompt = [
    `Eres ${config.role} para un negocio local.`,
    `Analiza únicamente ${config.focus}.`,
    config.rules,
    'El análisis determinístico ya fue calculado localmente; no reconstruyas totales.',
    STRUCTURED_OUTPUT_INSTRUCTIONS
  ].join('\n');

  const userPrompt = safeJsonStringify({
    outputFormat: 'JSON',
    agentType,
    businessType: payload.businessType,
    dateRange: payload.dateRange,
    facts: payload.facts,
    toolReferences: payload.toolReferences
  });

  return {
    systemPrompt,
    userPrompt,
    role: config.role,
    agentType,
    payload,
    promptStats: {
      systemChars: systemPrompt.length,
      userChars: userPrompt.length,
      userBytes: new TextEncoder().encode(userPrompt).byteLength,
      factsOnly: true,
      containsLocalDetails: false,
      containsRawToolResults: false
    }
  };
};

export const parseMarkdownResponse = (markdown) => {
  if (!markdown) return [];

  const sections = [];
  const lines = String(markdown).split('\n');
  let currentSection = null;
  let currentItems = [];

  const flushSection = () => {
    if (currentSection) {
      sections.push({ title: currentSection, items: [...currentItems] });
      currentItems = [];
    }
  };

  const emojiHeaderRegex = /^(\s*)((?:📊|⚠️|💡|📈|💰|🎯|📋)+)\s*(.+)$/u;
  const bulletRegex = /^(\s*)[-*•]\s*(.+)$/;
  const numberedRegex = /^(\s*)\d+[.)]\s*(.+)$/;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const headerMatch = trimmed.match(emojiHeaderRegex);
    if (headerMatch) {
      flushSection();
      currentSection = headerMatch[3].replace(/:/g, '').trim();
      return;
    }

    const bulletMatch = trimmed.match(bulletRegex);
    if (bulletMatch && currentSection) {
      currentItems.push(bulletMatch[2]);
      return;
    }

    const numberedMatch = trimmed.match(numberedRegex);
    if (numberedMatch && currentSection) {
      currentItems.push(numberedMatch[2]);
      return;
    }

    if (currentSection) currentItems.push(trimmed);
  });

  flushSection();
  return sections;
};

export const validateAgentData = (agentType, data) => {
  if (!data || typeof data !== 'object') return { valid: false, reason: 'Datos no disponibles' };

  switch (agentType) {
    case 'inventoryAuditor':
      if (!data.menuStats || data.menuStats.totalProducts === 0) return { valid: false, reason: 'No hay productos registrados' };
      break;
    case 'financialAnalyst':
      if (!data.salesStats || data.salesStats.totalRevenue === 0) return { valid: false, reason: 'No hay ventas en el período seleccionado' };
      break;
    case 'customerStrategist':
      if (!data.customerBaseStats || data.customerBaseStats.activeThisPeriod === 0) return { valid: false, reason: 'No hay clientes activos en el período' };
      break;
    default:
      return { valid: false, reason: 'Agente no reconocido' };
  }

  return { valid: true };
};

export default {
  buildPrompt,
  buildCompactPromptPayload,
  parseMarkdownResponse,
  validateAgentData,
  formatAggregatedData
};
