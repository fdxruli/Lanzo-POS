import { classifyParsedAgentResponse, parseAgentResponse } from './parseAgentResponse';
import {
  getActionTypeLabel,
  getCollectionLabel,
  getCoverageOrderLabel,
  getCoverageReasonLabel,
  getPriorityLabel,
  getProviderModelLabel,
  getResponseTimeLabel,
  getRouteLabel,
  getSeverityLabel,
  getToolReferenceLabel,
  humanizeAIReportText,
  humanizeAIReportValue,
  translateAIReportCode
} from './aiReportLabels';
import { formatCurrencyMXN } from './formatCurrencyMXN';

export const NO_DATA_LABEL = 'No disponible en este análisis';
export const EMPTY_COLLECTION_LABEL = 'No se encontraron registros en este período.';

const STATUS_LABELS = {
  completed: 'Completado',
  complete: 'Completado',
  incomplete: 'Incompleto',
  invalid: 'Inválido',
  failed: 'Fallido',
  archived: 'Archivado',
  saved: 'Legacy / guardado'
};

const SEVERITY_LABELS = {
  success: 'Correcto',
  info: 'Informativo',
  warning: 'Alerta',
  danger: 'Crítico'
};

const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasOwn = (value, key) => isObject(value) && Object.prototype.hasOwnProperty.call(value, key);

const firstPresent = (value, keys = []) => {
  for (const key of keys) {
    if (hasOwn(value, key) && value[key] !== undefined && value[key] !== null && value[key] !== '') {
      return { found: true, key, value: value[key] };
    }
  }
  return { found: false, key: null, value: null };
};

const formatLabel = (value = '') => String(value)
  .replace(/[_-]+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^./, letter => letter.toUpperCase());

const formatValue = value => {
  if (value === null || value === undefined || value === '') return NO_DATA_LABEL;
  if (typeof value === 'string') return value.trim() || NO_DATA_LABEL;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toTextList = value => {
  if (Array.isArray(value)) {
    return value
      .map(entry => humanizeAIReportValue(entry, ''))
      .filter(entry => entry !== NO_DATA_LABEL);
  }

  if (value === null || value === undefined || value === '') return [];
  return [humanizeAIReportValue(value, '')].filter(Boolean);
};

const getRawResultContent = result => {
  if (typeof result === 'string') return result;
  if (!isObject(result)) return '';
  const content = result.rawResultContent ?? result.resultContent ?? result.content;
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  return formatValue(content) === NO_DATA_LABEL ? '' : formatValue(content);
};

const getProviderMetadata = result => {
  if (!isObject(result)) return {};
  if (isObject(result.providerMetadata)) return result.providerMetadata;
  if (isObject(result.metadata)) return result.metadata;
  return {};
};

const getStoredParsedResult = result => {
  if (!isObject(result)) return null;

  let candidate = result.parsedResult;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!isObject(candidate)) return null;
    if (candidate.isStructured === true) return candidate;
    if (!isObject(candidate.parsedResult)) return null;
    candidate = candidate.parsedResult;
  }

  return null;
};

const getParsedResult = result => {
  const rawResultContent = getRawResultContent(result);
  const providerMetadata = getProviderMetadata(result);
  const finishReason = providerMetadata.finish_reason || (isObject(result) ? result.finishReason : null);
  const storedParsedResult = getStoredParsedResult(result);

  if (storedParsedResult) {
    return {
      ...storedParsedResult,
      rawResultContent: storedParsedResult.rawResultContent || rawResultContent
    };
  }

  try {
    return parseAgentResponse(rawResultContent, { finishReason });
  } catch {
    return {
      isStructured: false,
      markdown: rawResultContent,
      rawResultContent,
      resultFormat: 'raw',
      status: 'invalid',
      isComplete: false,
      incompleteReason: 'UNPARSEABLE_RESPONSE'
    };
  }
};

const getSourceObject = parsed => {
  if (isObject(parsed?.raw)) return parsed.raw;
  if (isObject(parsed?.parsedResult)) return parsed.parsedResult;
  return {};
};

const getFieldFromSources = (sources, keys) => {
  for (const source of sources) {
    const field = firstPresent(source, keys);
    if (field.found) return field;
  }
  return { found: false, key: null, value: null };
};

const normalizeMetricEntries = (value, fallbackLabel = 'Métrica') => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      if (isObject(entry)) {
        const label = firstPresent(entry, ['label', 'name', 'title', 'key', 'nombre', 'titulo']).value;
        const metricValue = firstPresent(entry, ['value', 'metric', 'amount', 'valor', 'métrica', 'metrica']).value;
        if (label !== undefined && metricValue !== undefined) return [{ label: humanizeAIReportText(String(label)), value: humanizeAIReportValue(metricValue, NO_DATA_LABEL) }];
        return Object.entries(entry).map(([key, nestedValue]) => ({
          label: `${fallbackLabel} / ${translateAIReportCode(key)}`,
          value: humanizeAIReportValue(nestedValue, NO_DATA_LABEL)
        }));
      }
      return [{ label: `${fallbackLabel} ${index + 1}`, value: humanizeAIReportValue(entry, NO_DATA_LABEL) }];
    });
  }

  if (isObject(value)) {
    return Object.entries(value).map(([key, nestedValue]) => ({
      label: translateAIReportCode(key),
      value: humanizeAIReportValue(nestedValue, NO_DATA_LABEL)
    }));
  }

  return value === null || value === undefined || value === ''
    ? []
    : [{ label: fallbackLabel, value: humanizeAIReportValue(value, NO_DATA_LABEL) }];
};

const getValueAtPath = (source, path = []) => {
  let current = source;
  for (const key of path) {
    if (current === null || current === undefined) return { found: false, value: null };
    if (Array.isArray(current) && key === 'length') {
      current = current.length;
      continue;
    }
    if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, key)) return { found: false, value: null };
    current = current[key];
  }
  return current === undefined || current === null ? { found: false, value: null } : { found: true, value: current };
};

const firstValueAtPaths = (source, paths = []) => {
  for (const path of paths) {
    const field = getValueAtPath(source, path);
    if (field.found) return field;
  }
  return { found: false, value: null };
};

const formatMetricNumber = value => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(numeric)
    : formatValue(value);
};

const formatMetricCurrency = value => {
  return formatCurrencyMXN(value, formatValue(value));
};

const getDeterministicMetrics = result => {
  const factSnapshot = isObject(result?.factSnapshot) ? result.factSnapshot : null;
  if (!factSnapshot) return [];

  const definitions = [
    {
      label: 'Productos agotados',
      paths: [['menuStats', 'outOfStockCount'], ['inventoryAlerts', 'outOfStockProducts', 'total']],
      arrayPaths: [['localDetails', 'inventoryAlerts', 'outOfStockProducts', 'length']],
      format: formatMetricNumber
    },
    {
      label: 'Productos con bajo stock',
      paths: [['inventoryAlerts', 'lowStockProducts', 'total']],
      arrayPaths: [['localDetails', 'inventoryAlerts', 'lowStockProducts', 'length']],
      format: formatMetricNumber
    },
    {
      label: 'Candidatos a stock muerto',
      paths: [['inventoryAlerts', 'potentialDeadStock', 'total']],
      arrayPaths: [['localDetails', 'inventoryAlerts', 'potentialDeadStock', 'length']],
      format: formatMetricNumber
    },
    {
      label: 'Capital inmovilizado',
      paths: [['inventoryAlerts', 'deadStockTotalTiedCapital']],
      format: formatMetricCurrency
    },
    {
      label: 'Mermas registradas',
      paths: [['wasteStats', 'wasteTransactions']],
      format: formatMetricNumber
    }
  ];

  return definitions.flatMap(definition => {
    const field = firstValueAtPaths(factSnapshot, [...definition.paths, ...(definition.arrayPaths || [])]);
    return field.found
      ? [{ label: definition.label, value: definition.format(field.value), origin: 'local' }]
      : [];
  });
};

const getCoverage = (result, source) => {
  const candidates = [
    isObject(result) ? result.coverage : null,
    source.coverage,
    isObject(result?.factSnapshot) ? result.factSnapshot.coverage : null
  ];
  return candidates.find(isObject) || null;
};

const getCoverageField = (coverage, keys) => firstPresent(coverage, keys);

const collectCoverageDetails = (value, path = [], details = [], seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return details;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectCoverageDetails(entry, [...path, String(index + 1)], details, seen));
    return details;
  }

  const total = firstPresent(value, ['total', 'factsTotal', 'facts_total']);
  const included = firstPresent(value, ['included', 'factsIncluded', 'facts_included']);
  const omitted = firstPresent(value, ['omitted', 'factsOmitted', 'facts_omitted']);
  const sort = firstPresent(value, ['sort', 'order', 'ordering', 'orden']);
  const reason = firstPresent(value, ['reason', 'omissionReason', 'omittedReason', 'motivo', 'motivoOmisión', 'motivo_omision']);
  const isEmptyCollection = total.found && Number(total.value) === 0;
  const hasOmittedData = omitted.found && Number(omitted.value) > 0;

  if (total.found || included.found || omitted.found || sort.found || reason.found) {
    details.push({
      label: path.length > 0 ? getCollectionLabel(path) : 'Cobertura general',
      total: total.found ? formatValue(total.value) : NO_DATA_LABEL,
      included: included.found ? formatValue(included.value) : NO_DATA_LABEL,
      omitted: omitted.found ? formatValue(omitted.value) : NO_DATA_LABEL,
      order: sort.found ? getCoverageOrderLabel(sort.value) : NO_DATA_LABEL,
      orderCode: sort.found ? formatValue(sort.value) : null,
      reason: isEmptyCollection ? EMPTY_COLLECTION_LABEL : hasOmittedData && reason.found ? getCoverageReasonLabel(reason.value) : NO_DATA_LABEL,
      reasonCode: reason.found ? formatValue(reason.value) : null,
      empty: isEmptyCollection
    });
  }

  Object.entries(value).forEach(([key, nestedValue]) => {
    if (nestedValue && typeof nestedValue === 'object') {
      collectCoverageDetails(nestedValue, [...path, key], details, seen);
    }
  });

  return details;
};

const getStatus = (result, parsed) => {
  const explicit = isObject(result) ? result.status : null;
  const providerMetadata = getProviderMetadata(result);
  const providerStatus = isObject(result)
    ? result.providerHttpStatus ?? result.httpStatus ?? providerMetadata.provider_response_status ?? result.errorMetadata?.status ?? 200
    : 200;
  const classification = classifyParsedAgentResponse({
    parsedResult: parsed,
    providerStatus,
    providerError: explicit === 'failed' || Boolean(result?.transportError || result?.timedOut),
    recordStatus: explicit
  });

  return STATUS_LABELS[classification.reportStatus] ? classification.reportStatus : 'invalid';
};

const getStatusLabel = (status, coverageStatus) => {
  if (status === 'incomplete' && coverageStatus === 'partial') return 'Completado con cobertura parcial';
  return STATUS_LABELS[status] || formatLabel(status) || NO_DATA_LABEL;
};

const getSeverity = source => {
  const field = getFieldFromSources([source], ['severity', 'nivel', 'riesgo', 'status', 'estado']);
  const value = field.found ? String(field.value).toLowerCase() : '';
  return SEVERITY_LABELS[value] ? value : null;
};

const getDateLabel = value => {
  if (!value) return NO_DATA_LABEL;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  try {
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return date.toLocaleString('es-MX');
  }
};

const getConfidence = source => {
  const field = getFieldFromSources([source], ['confidence', 'confianza']);
  const numeric = Number(field.value);
  return field.found && Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
};

const getListField = (source, keys) => {
  const field = firstPresent(source, keys);
  return {
    present: field.found,
    items: field.found ? toTextList(field.value) : []
  };
};

const getFactValue = (result, paths = []) => {
  const factSnapshot = isObject(result?.factSnapshot) ? result.factSnapshot : null;
  if (!factSnapshot) return { found: false, value: null };
  return firstValueAtPaths(factSnapshot, paths);
};

const buildLocalEvidence = result => {
  const outOfStock = getFactValue(result, [['menuStats', 'outOfStockCount'], ['inventoryAlerts', 'outOfStockProducts', 'total']]);
  const lowStock = getFactValue(result, [['inventoryAlerts', 'lowStockProducts', 'total']]);
  const deadStock = getFactValue(result, [['inventoryAlerts', 'potentialDeadStock', 'total']]);
  const tiedCapital = getFactValue(result, [['inventoryAlerts', 'deadStockTotalTiedCapital']]);
  const waste = getFactValue(result, [['wasteStats', 'wasteTransactions']]);
  const evidence = [];

  if (outOfStock.found && lowStock.found) {
    evidence.push(`Se encontraron ${formatMetricNumber(outOfStock.value)} productos agotados y ${formatMetricNumber(lowStock.value)} productos por debajo de su nivel mínimo.`);
  } else if (outOfStock.found) {
    evidence.push(`Se encontraron ${formatMetricNumber(outOfStock.value)} productos agotados.`);
  } else if (lowStock.found) {
    evidence.push(`Se encontraron ${formatMetricNumber(lowStock.value)} productos por debajo de su nivel mínimo.`);
  }

  if (deadStock.found && tiedCapital.found) {
    evidence.push(`Se identificaron ${formatMetricNumber(deadStock.value)} posibles productos con stock muerto, con ${formatMetricCurrency(tiedCapital.value)} de capital inmovilizado.`);
  } else if (deadStock.found) {
    evidence.push(`Se identificaron ${formatMetricNumber(deadStock.value)} posibles productos con stock muerto.`);
  } else if (tiedCapital.found) {
    evidence.push(`Se estimó ${formatMetricCurrency(tiedCapital.value)} de capital inmovilizado.`);
  }

  if (waste.found) {
    evidence.push(Number(waste.value) === 0
      ? 'No se registraron movimientos de merma en el período analizado.'
      : `Se registraron ${formatMetricNumber(waste.value)} movimientos de merma en el período analizado.`);
  }

  return evidence;
};

const buildEvidence = (source, findings, result) => {
  const evidenceField = firstPresent(source, ['evidence', 'evidences', 'evidencia', 'evidencias']);
  const entries = evidenceField.found ? toTextList(evidenceField.value) : [];
  const seen = new Set(entries);

  buildLocalEvidence(result).forEach(entry => {
    if (!seen.has(entry)) {
      entries.unshift(entry);
      seen.add(entry);
    }
  });

  findings.forEach(finding => {
    (finding.evidence || []).forEach(entry => {
      const readableEntry = humanizeAIReportText(entry);
      const text = /(?:[A-Za-z][A-Za-z0-9]*)\.[A-Za-z]|(?:[A-Za-z][A-Za-z0-9]*=)/.test(entry) || readableEntry.includes(':')
        ? readableEntry
        : `${humanizeAIReportText(finding.title)}: ${readableEntry}`;
      if (!seen.has(text)) {
        entries.push(text);
        seen.add(text);
      }
    });
  });

  return {
    present: evidenceField.found || findings.some(finding => finding.evidence?.length > 0),
    items: entries.map(entry => humanizeAIReportText(entry))
  };
};

const normalizeFindings = (parsed, source) => {
  const field = firstPresent(source, ['findings', 'hallazgos', 'insights', 'diagnostics', 'diagnosticos', 'diagnósticos', 'issues', 'alertas']);
  const items = field.found && Array.isArray(field.value) && field.value.length === 0 ? [] : field.found ? parsed.findings : [];
  return {
    present: field.found,
    items: items.map(finding => ({
      ...finding,
      title: humanizeAIReportText(finding.title, 'Hallazgo'),
      summary: humanizeAIReportText(finding.summary),
      metric: humanizeAIReportText(finding.metric),
      evidence: (finding.evidence || []).map(entry => humanizeAIReportText(entry)),
      toolLabel: finding.toolId ? getToolReferenceLabel(finding.toolId) : ''
    }))
  };
};

const normalizeActions = (parsed, source) => {
  const field = getListField(source, ['actions', 'acciones', 'recommendedActions', 'recommended_actions', 'recommendations', 'recomendaciones', 'nextSteps', 'next_steps']);
  return {
    present: field.present,
    items: field.present ? parsed.actions.map(action => ({
      ...action,
      label: humanizeAIReportText(action.label, 'Acción'),
      description: humanizeAIReportText(action.description),
      reason: humanizeAIReportText(action.reason),
      expectedImpact: humanizeAIReportText(action.expectedImpact),
      actionTypeLabel: getActionTypeLabel(action.type),
      priorityLabel: getPriorityLabel(action.priority),
      routeLabel: action.route ? getRouteLabel(action.route) : ''
    })) : []
  };
};

const normalizeOpportunities = (parsed, source) => {
  const field = getListField(source, ['opportunities', 'oportunidades', 'growthOpportunities', 'growth_opportunities']);
  return {
    present: field.present,
    items: field.present ? parsed.opportunities.map(opportunity => ({
      ...opportunity,
      title: humanizeAIReportText(opportunity.title, 'Oportunidad'),
      description: humanizeAIReportText(opportunity.description),
      firstStep: humanizeAIReportText(opportunity.firstStep),
      impactLabel: getPriorityLabel(opportunity.impact),
      effortLabel: getPriorityLabel(opportunity.effort)
    })) : []
  };
};

const getUsageEntries = (result, source, metadata) => {
  const usageField = isObject(result) && isObject(result.usage)
    ? { found: true, value: result.usage }
    : firstPresent(source, ['usage', 'tokenUsage', 'token_usage']);
  const usage = isObject(usageField.value) ? usageField.value : {};
  const definitions = [
    ['Entrada', ['promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens']],
    ['Salida', ['completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens']],
    ['Tokens utilizados', ['totalTokens', 'total_tokens']]
  ];
  const entries = definitions.flatMap(([label, keys]) => {
    const field = firstPresent(usage, keys);
    return field.found ? [{ label, value: formatValue(field.value) }] : [];
  });

  const latency = firstPresent(metadata, ['latency_ms', 'latencyMs', 'latency']);

  const modelLabel = getProviderModelLabel(metadata);
  if (modelLabel) entries.push({ label: 'Modelo utilizado', value: modelLabel });
  if (latency.found) entries.push({ label: 'Tiempo de respuesta', value: getResponseTimeLabel(latency.value) });

  return {
    present: usageField.found || entries.length > 0,
    entries
  };
};

export const buildAIReportViewModel = result => {
  const parsed = getParsedResult(result);
  const rawResultContent = getRawResultContent(result);
  const source = getSourceObject(parsed);
  const metadata = getProviderMetadata(result);
  const status = getStatus(result, parsed);
  const classification = classifyParsedAgentResponse({
    parsedResult: parsed,
    providerStatus: isObject(result) ? result.providerHttpStatus ?? result.httpStatus ?? metadata.provider_response_status ?? result.errorMetadata?.status ?? 200 : 200,
    providerError: Boolean(result?.status === 'failed' || result?.transportError || result?.timedOut),
    recordStatus: isObject(result) ? result.status : null
  });
  const titleField = getFieldFromSources([source, isObject(result) ? result : {}], ['title', 'analysisTitle', 'reportTitle', 'nombreAnalisis', 'nombre_analisis', 'name', 'agentName', 'agentType', 'agent_type', 'analysisType', 'reportType']);
  const summaryField = getFieldFromSources([source], ['executiveSummary', 'executive_summary', 'summary', 'resumen', 'resumenEjecutivo', 'resumen_ejecutivo']);
  const resultSummary = isObject(result) ? result.resultSummary : null;
  const summary = summaryField.found
    ? humanizeAIReportValue(summaryField.value, NO_DATA_LABEL)
    : (typeof resultSummary === 'string' && resultSummary.trim()
      ? humanizeAIReportText(resultSummary)
      : parsed.isStructured
        ? 'No se generó un resumen adicional para este análisis.'
        : humanizeAIReportText(parsed.markdown || rawResultContent, NO_DATA_LABEL));
  const findings = normalizeFindings(parsed, source);
  const actions = normalizeActions(parsed, source);
  const opportunities = normalizeOpportunities(parsed, source);
  const coverage = getCoverage(result, source);
  const coverageDetails = [
    ...collectCoverageDetails(coverage),
    ...collectCoverageDetails(isObject(result?.factSnapshot) ? result.factSnapshot : null)
  ].filter((detail, index, details) => details.findIndex(candidate => candidate.label === detail.label) === index);
  const coverageReason = getCoverageField(coverage, ['reason', 'omissionReason', 'omittedReason', 'motivo', 'motivoOmisión', 'motivo_omision']);
  const coverageOrder = getCoverageField(coverage, ['sort', 'order', 'ordering', 'orden']);
  const detailWithReason = coverageDetails.find(detail => detail.reason !== NO_DATA_LABEL && !detail.empty);
  const detailWithOrder = coverageDetails.find(detail => detail.order !== NO_DATA_LABEL && !detail.empty);
  const metricsField = getFieldFromSources([source], ['metrics', 'metricas', 'métricas', 'keyMetrics', 'importantMetrics', 'metricasClave', 'métricasClave']);
  const aiMetrics = metricsField.found
    ? normalizeMetricEntries(metricsField.value).map(metric => ({ ...metric, origin: 'ai' }))
    : [];
  const findingMetrics = findings.items
    .filter(finding => finding.metric)
    .map(finding => ({ label: finding.title, value: finding.metric, origin: 'ai' }));
  const localMetrics = getDeterministicMetrics(result);
  const allMetrics = [...localMetrics, ...aiMetrics, ...findingMetrics.filter(item => !aiMetrics.some(metric => metric.label === item.label))];

  return {
    result,
    parsed,
    source,
    rawResultContent,
    title: titleField.found ? humanizeAIReportText(String(titleField.value), 'Reporte de análisis IA') : 'Reporte de análisis IA',
    titlePresent: titleField.found,
    date: getDateLabel(isObject(result) ? result.generatedAt || result.createdAt : null),
    status,
    statusLabel: getStatusLabel(status, classification.coverageStatus),
    providerStatus: classification.providerStatus,
    providerHttpStatus: classification.providerHttpStatus,
    parseStatus: classification.parseStatus,
    reportStatus: classification.reportStatus,
    coverageStatus: classification.coverageStatus,
    severity: getSeverity(source, parsed),
    severityLabel: getSeverityLabel(getSeverity(source, parsed)),
    summary,
    metrics: allMetrics,
    localMetrics,
    findings,
    actions,
    opportunities,
    questions: (() => {
      const questions = getListField(source, ['questionsToAskUser', 'questions_to_ask_user', 'questions', 'preguntas', 'preguntasAlUsuario']);
      return { ...questions, items: questions.items.map(question => humanizeAIReportText(question)) };
    })(),
    evidence: buildEvidence(source, findings.items, result),
    confidence: getConfidence(source),
    coverage: coverage
      ? {
        present: true,
        complete: getCoverageField(coverage, ['complete']).found ? Boolean(getCoverageField(coverage, ['complete']).value) : null,
        total: getCoverageField(coverage, ['factsTotal', 'facts_total', 'total']),
        included: getCoverageField(coverage, ['factsIncluded', 'facts_included', 'included']),
        omitted: getCoverageField(coverage, ['factsOmitted', 'facts_omitted', 'omitted']),
        notes: toTextList(getCoverageField(coverage, ['notes', 'notas']).value),
        omissionReason: coverageReason.found
          ? { ...coverageReason, value: getCoverageReasonLabel(coverageReason.value) }
          : detailWithReason
            ? { found: true, value: detailWithReason.reason, code: detailWithReason.reasonCode }
            : coverageReason,
        order: coverageOrder.found
          ? { ...coverageOrder, value: getCoverageOrderLabel(coverageOrder.value) }
          : detailWithOrder
            ? { found: true, value: detailWithOrder.order, code: detailWithOrder.orderCode }
            : coverageOrder
      }
      : { present: false, complete: null, total: { found: false }, included: { found: false }, omitted: { found: false }, notes: [], omissionReason: { found: false }, order: { found: false } },
    coverageDetails,
    usage: getUsageEntries(result, source, metadata),
    metadata,
    errorMetadata: isObject(result) ? result.errorMetadata || null : null,
    finishReason: firstPresent(metadata, ['finish_reason', 'finishReason']).value || (isObject(result) ? result.finishReason : null),
    toolReferences: (Array.isArray(parsed.toolReferences) ? parsed.toolReferences : []).map(reference => getToolReferenceLabel(reference))
  };
};

const SENSITIVE_KEY = /(?:api[_-]?key|secret|password|authorization|auth[_-]?(?:token|key)|access[_-]?token|refresh[_-]?token|id[_-]?token|device[_-]?security[_-]?token|license[_-]?key|private[_-]?key|cookie|headers?|credential|bearer|^auth$)/i;
const USAGE_TOKEN_KEY = /^(?:prompt|completion|input|output|total|reasoning|cache|input_cache|prompt_cache).*tokens?$/i;

const isSensitiveKey = key => {
  const normalizedKey = String(key || '');
  if (SENSITIVE_KEY.test(normalizedKey)) return true;
  return /token/i.test(normalizedKey) && !USAGE_TOKEN_KEY.test(normalizedKey);
};

const sanitizeEmbeddedSecrets = value => String(value)
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted authorization]')
  .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{12,}/g, '[redacted api key]')
  .replace(/(["']?(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[redacted]');

export const sanitizeForAIReportExport = (value, key = '', seen = new WeakSet()) => {
  if (isSensitiveKey(key)) return undefined;
  if (typeof value === 'string') return sanitizeEmbeddedSecrets(value);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const sanitizedArray = value.map(entry => sanitizeForAIReportExport(entry, '', seen));
    seen.delete(value);
    return sanitizedArray;
  }

  const sanitizedObject = Object.entries(value).reduce((output, [entryKey, entryValue]) => {
    const sanitized = sanitizeForAIReportExport(entryValue, entryKey, seen);
    if (sanitized !== undefined) output[entryKey] = sanitized;
    return output;
  }, {});
  seen.delete(value);
  return sanitizedObject;
};

export const buildTechnicalAIReport = result => {
  const source = isObject(result) ? result : { rawResultContent: String(result || '') };
  const parsed = getParsedResult(result);
  const metadata = getProviderMetadata(result);
  const classification = classifyParsedAgentResponse({
    parsedResult: parsed,
    providerStatus: isObject(result) ? result.providerHttpStatus ?? result.httpStatus ?? metadata.provider_response_status ?? result.errorMetadata?.status ?? 200 : 200,
    providerError: Boolean(result?.status === 'failed' || result?.transportError || result?.timedOut),
    recordStatus: isObject(result) ? result.status : null
  });
  const technicalRecord = { ...source };

  if (!Object.prototype.hasOwnProperty.call(technicalRecord, 'rawResultContent')) technicalRecord.rawResultContent = getRawResultContent(result);
  if (!Object.prototype.hasOwnProperty.call(technicalRecord, 'resultContent')) technicalRecord.resultContent = technicalRecord.rawResultContent;
  if (!Object.prototype.hasOwnProperty.call(technicalRecord, 'parsedResult')) technicalRecord.parsedResult = parsed;
  technicalRecord.providerStatus = classification.providerStatus;
  technicalRecord.providerHttpStatus = classification.providerHttpStatus;
  technicalRecord.parseStatus = classification.parseStatus;
  technicalRecord.reportStatus = classification.reportStatus;
  technicalRecord.coverageStatus = classification.coverageStatus;

  return sanitizeForAIReportExport(technicalRecord);
};

export const serializeTechnicalAIReport = result => {
  const technicalRecord = buildTechnicalAIReport(result);
  return JSON.stringify(technicalRecord, null, 2);
};

const markdownList = (items, emptyLabel) => {
  if (!items || items.length === 0) return `_${emptyLabel}_`;
  return items.map(item => `- ${typeof item === 'string' ? humanizeAIReportText(item) : humanizeAIReportValue(item, NO_DATA_LABEL)}`).join('\n');
};

const markdownValue = field => (field?.found ? formatValue(field.value) : NO_DATA_LABEL);

export const serializeAIReportMarkdown = result => {
  const model = buildAIReportViewModel(result);
  const findings = model.findings.items;
  const findingText = findings.map(finding => {
    const lines = [`### ${finding.title || 'Hallazgo'}`, `- Severidad: ${getSeverityLabel(finding.severity)}`];
    if (finding.metric) lines.push(`- Métrica: ${finding.metric}`);
    if (finding.summary) lines.push(`- Resumen: ${finding.summary}`);
    return lines.join('\n');
  }).join('\n\n');

  const metricText = model.metrics.length > 0
    ? [
      ...(model.localMetrics.length > 0
        ? ['### Datos calculados localmente', ...model.localMetrics.map(metric => `- ${metric.label}: ${metric.value}`)]
        : []),
      ...(model.metrics.filter(metric => metric.origin !== 'local').length > 0
        ? ['### Interpretación de IA', ...model.metrics.filter(metric => metric.origin !== 'local').map(metric => `- ${metric.label}: ${metric.value}`)]
        : [])
    ].join('\n')
    : `_${NO_DATA_LABEL}_`;
  const actionText = model.actions.items.map(action => [
    `- ${action.label || 'Acción'}`,
    ...(action.description ? [`  - Descripción: ${action.description}`] : []),
    ...(action.reason ? [`  - Motivo: ${action.reason}`] : []),
    ...(action.expectedImpact ? [`  - Impacto esperado: ${action.expectedImpact}`] : []),
    `  - Prioridad: ${action.priorityLabel || getPriorityLabel(action.priority)}`,
    `  - Tipo: ${action.actionTypeLabel || getActionTypeLabel(action.type)}`,
    ...(action.routeLabel ? [`  - Destino: ${action.routeLabel}`] : [])
  ].join('\n')).join('\n\n');
  const opportunityText = model.opportunities.items.map(opportunity => [
    `- ${opportunity.title || 'Oportunidad'}`,
    ...(opportunity.description ? [`  - Descripción: ${opportunity.description}`] : []),
    ...(opportunity.impact ? [`  - Impacto: ${opportunity.impactLabel || getPriorityLabel(opportunity.impact)}`] : []),
    ...(opportunity.effort ? [`  - Esfuerzo: ${opportunity.effortLabel || getPriorityLabel(opportunity.effort)}`] : []),
    ...(opportunity.firstStep ? [`  - Primer paso: ${opportunity.firstStep}`] : [])
  ].join('\n')).join('\n\n');
  const coveragePercentage = model.coverage.total.found && model.coverage.included.found && Number(model.coverage.total.value) > 0
    ? Math.round((Number(model.coverage.included.value) / Number(model.coverage.total.value)) * 100)
    : null;
  const coverageLines = model.coverage.present
    ? [
      `- Total: ${markdownValue(model.coverage.total)}`,
      `- Incluidos: ${markdownValue(model.coverage.included)}`,
      `- Omitidos: ${markdownValue(model.coverage.omitted)}`,
      `- Confianza del modelo: ${model.confidence === null ? NO_DATA_LABEL : `${Math.round(model.confidence * 100)}%`}`,
      `- Cobertura de datos: ${coveragePercentage === null ? NO_DATA_LABEL : `${coveragePercentage}%`}`,
      ...(model.coverage.omitted.found && Number(model.coverage.omitted.value) > 0 && model.coverage.omissionReason.found
        ? [`- Motivo: ${model.coverage.omissionReason.value}`]
        : []),
      ...(model.coverage.order.found ? [`- Priorización: ${model.coverage.order.value}`] : []),
      ...(model.coverage.omitted.found && Number(model.coverage.omitted.value) > 0 && model.coverage.total.found && model.coverage.included.found
        ? [
          '- Este análisis utiliza una muestra parcial de los datos.',
          `- ${model.coverage.included.value} de ${model.coverage.total.value} datos fueron enviados al análisis.`,
          `- ${model.coverage.omitted.value} datos permanecen disponibles localmente.`
        ]
        : []),
      ...(model.coverage.notes.length > 0 ? [`- Notas: ${model.coverage.notes.join('; ')}`] : [])
    ].join('\n')
    : `_${NO_DATA_LABEL}_`;
  const coverageDetailText = model.coverageDetails.length > 0
    ? `\n\n### Detalle por colección\n${model.coverageDetails.map(detail => detail.empty
      ? `- ${detail.label}: ${EMPTY_COLLECTION_LABEL}`
      : [
        `- ${detail.label}: total ${detail.total}; incluidos ${detail.included}; omitidos ${detail.omitted}`,
        ...(Number(detail.omitted) > 0 && detail.reason !== NO_DATA_LABEL ? [`  - Motivo: ${detail.reason}`] : []),
        ...(detail.order !== NO_DATA_LABEL ? [`  - Priorización: ${detail.order}`] : [])
      ].join('\n')).join('\n')}`
    : '';
  const usageText = model.usage.entries.length > 0
    ? model.usage.entries.map(entry => `- ${entry.label}: ${entry.value}`).join('\n')
    : `_${NO_DATA_LABEL}_`;
  const markdownContent = !model.parsed.isStructured && (model.parsed.markdown || model.rawResultContent)
    ? `\n## Contenido del análisis\n\n${humanizeAIReportText(model.parsed.markdown || model.rawResultContent)}`
    : '';

  return [
    `# ${model.title}`,
    '',
    `- Nombre del análisis: ${model.title}`,
    `- Fecha: ${model.date}`,
    `- Estado: ${model.statusLabel}`,
    '',
    '## Resumen ejecutivo',
    '',
    model.summary,
    '',
    '## Métricas',
    '',
    metricText,
    '',
    '## Hallazgos',
    '',
    findingText || '_No hay hallazgos registrados en este análisis._',
    '',
    '## Evidencias',
    '',
    markdownList(model.evidence.items, model.evidence.present ? 'No hay evidencias registradas en este análisis.' : NO_DATA_LABEL),
    '',
    '## Recomendaciones y acciones',
    '',
    actionText || (model.actions.present ? 'No hay recomendaciones registradas en este análisis.' : `_${NO_DATA_LABEL}_`),
    '',
    '## Oportunidades',
    '',
    opportunityText || (model.opportunities.present ? 'No hay oportunidades registradas en este análisis.' : `_${NO_DATA_LABEL}_`),
    '',
    '## Confianza',
    '',
    model.confidence === null ? NO_DATA_LABEL : `${Math.round(model.confidence * 100)}%`,
    '',
    '## Cobertura de datos',
    '',
    coverageLines,
    coverageDetailText,
    '',
    '## Uso del análisis',
    '',
    usageText,
    markdownContent
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
};

const slugify = value => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || 'analysis';
};

export const createAIReportFilename = (result, extension = 'md') => {
  const model = buildAIReportViewModel(result);
  const rawDate = isObject(result) ? result.generatedAt || result.createdAt : null;
  const date = rawDate && !Number.isNaN(new Date(rawDate).getTime())
    ? new Date(rawDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const agent = isObject(result) ? result.agentType : null;
  return `lanzo-ai-report-${slugify(agent || model.title)}-${date}.${extension === 'json' ? 'json' : 'md'}`;
};

export const downloadAIReport = (result, format = 'markdown') => {
  if (typeof Blob === 'undefined' || typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('La descarga no está disponible en este dispositivo.');
  }

  const isJson = format === 'json';
  const content = isJson ? serializeTechnicalAIReport(result) : serializeAIReportMarkdown(result);
  const filename = createAIReportFilename(result, isJson ? 'json' : 'md');
  const blob = new Blob([content], { type: `${isJson ? 'application/json' : 'text/markdown'};charset=utf-8` });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  link.setAttribute('aria-hidden', 'true');
  link.style.display = 'none';

  try {
    document.body?.appendChild(link);
    link.click();
    return { filename, format: isJson ? 'json' : 'markdown' };
  } finally {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }
};

export default {
  buildAIReportViewModel,
  buildTechnicalAIReport,
  createAIReportFilename,
  downloadAIReport,
  sanitizeForAIReportExport,
  serializeAIReportMarkdown,
  serializeTechnicalAIReport
};
