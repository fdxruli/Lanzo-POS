import Dexie from 'dexie';
import { parseAgentResponse } from '../utils/parseAgentResponse';
import { DB_NAME } from '../config/dbConfig';
import {
  getActiveTenantRuntime,
  getTenantRuntimeReadiness,
  TenantRuntimeError
} from './db/tenantRuntimeRouter';

const AI_HISTORY_STORE = 'ai_analysis_history';
const DEFAULT_HISTORY_LIMIT = 25;
const MAX_SUMMARY_LENGTH = 160;
const DEFAULT_SUMMARY = 'Análisis IA guardado.';
const VALID_RESULT_FORMATS = new Set(['structured_json', 'markdown', 'raw']);
const VALID_HISTORY_STATUSES = new Set(['saved', 'completed', 'archived', 'failed', 'incomplete', 'invalid']);
const FALLBACK_STORAGE_PREFIX = 'lanzo_ai_history_fallback_v1:';

const LEGACY_AI_HISTORY_DB_NAME = DB_NAME + '_ai_history';
const tenantHistoryDatabases = new Map();

class AIAnalysisHistoryDatabase extends Dexie {
  constructor(databaseName) {
    super(databaseName);

    this.version(1).stores({
      [AI_HISTORY_STORE]: 'id, tenantOpaqueId, agentType, generatedAt, status, [status+generatedAt], [agentType+status+generatedAt], [tenantOpaqueId+generatedAt]'
    });
  }
}

const createTenantRuntimeNotReadyError = () => new TenantRuntimeError('TENANT_RUNTIME_NOT_READY');

const captureTenantHistoryContext = () => {
  const readiness = getTenantRuntimeReadiness();
  const runtime = readiness?.ready ? readiness.runtime : null;
  const activeRuntime = getActiveTenantRuntime();

  if (
    !runtime
    || !activeRuntime
    || !runtime.opaqueId
    || !runtime.databaseName
    || !Number.isInteger(runtime.generation)
    || activeRuntime.opaqueId !== runtime.opaqueId
    || activeRuntime.databaseName !== runtime.databaseName
    || activeRuntime.generation !== runtime.generation
  ) {
    throw createTenantRuntimeNotReadyError();
  }

  const historyDatabaseName = runtime.databaseName + '_ai_history';
  if (!historyDatabaseName || historyDatabaseName === LEGACY_AI_HISTORY_DB_NAME) {
    throw new TenantRuntimeError('TENANT_HISTORY_DATABASE_INVALID');
  }

  return Object.freeze({
    opaqueId: runtime.opaqueId,
    databaseName: runtime.databaseName,
    generation: runtime.generation,
    historyDatabaseName
  });
};

const isSameTenantRuntime = (left, right) => Boolean(
  left
  && right
  && left.opaqueId === right.opaqueId
  && left.databaseName === right.databaseName
  && left.generation === right.generation
);

const assertTenantHistoryContextIsCurrent = (captured) => {
  const readiness = getTenantRuntimeReadiness();
  const current = readiness?.ready ? readiness.runtime : null;
  const activeRuntime = getActiveTenantRuntime();

  if (!isSameTenantRuntime(captured, current) || !isSameTenantRuntime(captured, activeRuntime)) {
    throw new TenantRuntimeError('TENANT_RUNTIME_STALE');
  }

  return current;
};

const getTenantHistoryDatabase = (context) => {
  let database = tenantHistoryDatabases.get(context.historyDatabaseName);
  if (!database) {
    database = new AIAnalysisHistoryDatabase(context.historyDatabaseName);
    tenantHistoryDatabases.set(context.historyDatabaseName, database);
  }
  return database;
};

const getBrowserStorage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const fallbackStorageKey = (tenantOpaqueId, analysisId) => (
  `${FALLBACK_STORAGE_PREFIX}${tenantOpaqueId}:${analysisId}`
);

const writeFallbackRecord = (record) => {
  const storage = getBrowserStorage();
  if (!storage) return false;

  try {
    storage.setItem(fallbackStorageKey(record.tenantOpaqueId, record.id), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
};

const clearFallbackRecord = (tenantOpaqueId, analysisId) => {
  const storage = getBrowserStorage();
  if (!storage) return;

  try {
    storage.removeItem(fallbackStorageKey(tenantOpaqueId, analysisId));
  } catch {
    // localStorage puede estar bloqueado; IndexedDB sigue siendo la fuente principal.
  }
};

const readFallbackRecords = (tenantOpaqueId) => {
  const storage = getBrowserStorage();
  if (!storage) return [];

  const records = [];
  const prefix = `${FALLBACK_STORAGE_PREFIX}${tenantOpaqueId}:`;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.tenantOpaqueId === tenantOpaqueId) records.push(parsed);
      } catch {
        // Ignorar sólo el fallback corrupto; no exponer su contenido.
      }
    }
  } catch {
    return [];
  }

  return records;
};

export const closeLocalAIAnalysisHistoryDatabasesForTests = () => {
  for (const database of tenantHistoryDatabases.values()) {
    database.close();
  }
  tenantHistoryDatabases.clear();
};

const openTenantHistory = async () => {
  const context = captureTenantHistoryContext();
  const database = getTenantHistoryDatabase(context);
  if (!database.isOpen()) await database.open();
  assertTenantHistoryContextIsCurrent(context);
  return { context, database };
};
const safeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeText = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
};

const normalizeContent = (value) => normalizeText(value, '');

const cloneSerializable = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
};

const normalizeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

const normalizeCoverage = (coverage = {}) => {
  if (!coverage || typeof coverage !== 'object') return null;

  const normalized = {
    complete: coverage.complete === true,
    factsTotal: normalizeNumber(coverage.factsTotal ?? coverage.facts_total),
    factsIncluded: normalizeNumber(coverage.factsIncluded ?? coverage.facts_included),
    factsOmitted: normalizeNumber(coverage.factsOmitted ?? coverage.facts_omitted),
    notes: safeArray(coverage.notes).map(note => normalizeText(note)).filter(Boolean)
  };

  return {
    ...normalized,
    ...(normalized.factsTotal === null ? {} : { factsTotal: normalized.factsTotal }),
    ...(normalized.factsIncluded === null ? {} : { factsIncluded: normalized.factsIncluded }),
    ...(normalized.factsOmitted === null ? {} : { factsOmitted: normalized.factsOmitted })
  };
};

const normalizeUsage = (usage = {}) => {
  if (!usage || typeof usage !== 'object') return null;

  const aliases = {
    promptTokens: ['promptTokens', 'prompt_tokens'],
    completionTokens: ['completionTokens', 'completion_tokens'],
    totalTokens: ['totalTokens', 'total_tokens'],
    promptCacheHitTokens: ['promptCacheHitTokens', 'prompt_cache_hit_tokens', 'input_cache_hit_tokens'],
    promptCacheMissTokens: ['promptCacheMissTokens', 'prompt_cache_miss_tokens', 'input_cache_miss_tokens'],
    reasoningTokens: ['reasoningTokens', 'reasoning_tokens']
  };
  const normalized = {};

  Object.entries(aliases).forEach(([target, keys]) => {
    const key = keys.find(candidate => usage[candidate] !== undefined && usage[candidate] !== null);
    const value = key ? normalizeNumber(usage[key]) : null;
    if (value !== null) normalized[target] = value;
  });

  return Object.keys(normalized).length > 0 ? normalized : null;
};

const normalizeProviderMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== 'object') return null;

  const allowed = [
    'provider',
    'protocol',
    'model',
    'latency_ms',
    'request_id',
    'provider_request_id',
    'provider_response_status',
    'finish_reason',
    'report_status'
  ];
  const normalized = {};
  allowed.forEach(key => {
    if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '') normalized[key] = metadata[key];
  });
  return Object.keys(normalized).length > 0 ? normalized : null;
};

const normalizeToolErrorMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== 'object') return null;

  const normalized = {};
  if (metadata.code !== undefined && metadata.code !== null) normalized.code = normalizeText(metadata.code);
  if (metadata.message !== undefined && metadata.message !== null) normalized.message = normalizeText(metadata.message);
  if (metadata.status !== undefined && metadata.status !== null) {
    const status = Number(metadata.status);
    if (Number.isFinite(status)) normalized.status = status;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
};

const normalizeErrorMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== 'object') return null;
  const allowed = ['code', 'status', 'timedOut', 'usageFinalizationFailed'];
  const normalized = {};
  allowed.forEach(key => {
    if (metadata[key] !== undefined && metadata[key] !== null) normalized[key] = metadata[key];
  });
  return Object.keys(normalized).length > 0 ? normalized : null;
};

const normalizeAgentToolRun = (agentToolRun = null) => {
  if (!agentToolRun || typeof agentToolRun !== 'object' || Array.isArray(agentToolRun)) return null;

  const results = safeArray(agentToolRun.results)
    .filter(result => result && typeof result === 'object' && !Array.isArray(result))
    .map(result => {
      const errorMetadata = normalizeToolErrorMetadata(result.errorMetadata);
      return {
        id: normalizeText(result.id, 'tool.unknown'),
        title: normalizeText(result.title, 'Herramienta IA'),
        severity: normalizeText(result.severity, 'info'),
        summary: normalizeText(result.summary),
        metrics: cloneSerializable(result.metrics, {}),
        actions: safeArray(result.actions).map(action => normalizeText(action)).filter(Boolean),
        evidence: safeArray(result.evidence).map(entry => normalizeText(entry)).filter(Boolean),
        ...(Number.isFinite(Number(result.confidence))
          ? { confidence: Math.min(1, Math.max(0, Number(result.confidence))) }
          : {}),
        ...(errorMetadata
          ? { errorMetadata }
          : {})
      };
    });

  return {
    ...(agentToolRun.agentType ? { agentType: normalizeText(agentToolRun.agentType) } : {}),
    ...(agentToolRun.executedAt ? { executedAt: normalizeText(agentToolRun.executedAt) } : {}),
    ...(Number.isFinite(Number(agentToolRun.availableToolCount))
      ? { availableToolCount: Math.max(0, Number(agentToolRun.availableToolCount)) }
      : {}),
    results
  };
};

const isStaleHistoryError = (error) => new Set([
  'TENANT_RUNTIME_STALE',
  'TENANT_RUNTIME_NOT_READY',
  'TENANT_HISTORY_DATABASE_INVALID'
]).has(error?.code);

export const formatGeneratedAtLabel = (isoDate) => {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return 'Fecha no disponible';
  }

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

const clampSummary = (text) => {
  const cleanText = normalizeText(text)
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) return DEFAULT_SUMMARY;
  if (cleanText.length <= MAX_SUMMARY_LENGTH) return cleanText;
  return `${cleanText.slice(0, MAX_SUMMARY_LENGTH - 3).trim()}...`;
};

const inferResultFormat = (resultContent) => {
  const content = normalizeContent(resultContent);
  if (!content) return 'raw';

  try {
    const parsed = parseAgentResponse(content);
    if (parsed?.isStructured) return 'structured_json';
  } catch {
    // Fallback below.
  }

  const looksLikeMarkdown = /(^|\n)\s{0,3}(#{1,6}\s|[-*]\s|\d+\.\s|>|```)/.test(content)
    || content.includes('\n');

  return looksLikeMarkdown ? 'markdown' : 'raw';
};

const buildResultSummary = (resultContent) => {
  const content = normalizeContent(resultContent);

  try {
    const parsed = parseAgentResponse(content);
    if (parsed?.isStructured && parsed.executiveSummary) {
      return clampSummary(parsed.executiveSummary);
    }

    if (!parsed?.isStructured && parsed?.markdown) {
      return clampSummary(parsed.markdown);
    }
  } catch {
    // Fallback below.
  }

  const readableText = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[{}[\]",]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return clampSummary(readableText);
};

const normalizeToolRunSummary = (toolRunSummary = {}) => {
  const availableToolCount = Number(toolRunSummary?.availableToolCount);
  const executedToolCount = Number(toolRunSummary?.executedToolCount);
  const toolIds = safeArray(toolRunSummary?.toolIds)
    .map(toolId => normalizeText(toolId))
    .filter(Boolean)
    .slice(0, 20);

  return {
    ...(Number.isFinite(availableToolCount) ? { availableToolCount } : {}),
    ...(Number.isFinite(executedToolCount) ? { executedToolCount } : {}),
    ...(toolIds.length > 0 ? { toolIds } : {})
  };
};

const generateLocalAnalysisId = () => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `ai_analysis_${Date.now()}_${randomPart}`;
};

const normalizeHistoryRecord = (record = {}, tenantOpaqueId = null) => {
  const generatedAt = normalizeText(record.generatedAt || record.createdAt, new Date().toISOString());
  const rawResultContent = normalizeContent(record.rawResultContent ?? record.resultContent);
  const resultFormat = VALID_RESULT_FORMATS.has(record.resultFormat)
    ? record.resultFormat
    : inferResultFormat(rawResultContent);
  const requestedStatus = normalizeText(record.status, 'saved');
  const status = VALID_HISTORY_STATUSES.has(requestedStatus) ? requestedStatus : 'saved';

  return {
    id: normalizeText(record.id, generateLocalAnalysisId()),
    tenantOpaqueId: normalizeText(record.tenantOpaqueId, tenantOpaqueId || ''),
    agentType: normalizeText(record.agentType, 'unknown'),
    agentName: normalizeText(record.agentName, 'Agente IA'),
    dateRange: normalizeText(record.dateRange, ''),
    dateRangeLabel: normalizeText(record.dateRangeLabel, record.dateRange || 'Rango no disponible'),
    generatedAt,
    generatedAtLabel: normalizeText(record.generatedAtLabel, formatGeneratedAtLabel(generatedAt)),
    rawResultContent,
    resultContent: rawResultContent,
    parsedResult: cloneSerializable(record.parsedResult),
    resultSummary: clampSummary(record.resultSummary || buildResultSummary(rawResultContent)),
    resultFormat,
    coverage: normalizeCoverage(record.coverage),
    usage: normalizeUsage(record.usage),
    providerMetadata: normalizeProviderMetadata(record.providerMetadata),
    errorMetadata: normalizeErrorMetadata(record.errorMetadata),
    factSnapshot: cloneSerializable(record.factSnapshot),
    agentToolRun: normalizeAgentToolRun(record.agentToolRun),
    providerStatus: normalizeText(record.providerStatus, ''),
    providerHttpStatus: Number.isFinite(Number(record.providerHttpStatus)) ? Number(record.providerHttpStatus) : null,
    parseStatus: normalizeText(record.parseStatus, ''),
    reportStatus: normalizeText(record.reportStatus, status),
    coverageStatus: normalizeText(record.coverageStatus, 'unknown'),
    businessTypes: safeArray(record.businessTypes)
      .map(type => normalizeText(type))
      .filter(Boolean),
    toolRunSummary: normalizeToolRunSummary(record.toolRunSummary),
    status,
    archivedAt: record.archivedAt || null,
    createdAt: normalizeText(record.createdAt, generatedAt),
    updatedAt: normalizeText(record.updatedAt, record.createdAt || generatedAt)
  };
};

export async function saveLocalAIAnalysis({
  agentType,
  agentName,
  dateRange,
  dateRangeLabel,
  resultContent,
  rawResultContent = resultContent,
  parsedResult = null,
  resultFormat = null,
  coverage = null,
  usage = null,
  providerMetadata = null,
  status = 'saved',
  providerStatus = null,
  providerHttpStatus = null,
  parseStatus = null,
  reportStatus = null,
  coverageStatus = null,
  errorMetadata = null,
  factSnapshot = null,
  agentToolRun = null,
  businessTypes,
  toolRunSummary
}) {
  const context = captureTenantHistoryContext();
  const generatedAt = new Date().toISOString();
  const normalizedContent = normalizeContent(rawResultContent);
  const record = normalizeHistoryRecord({
    id: generateLocalAnalysisId(),
    tenantOpaqueId: context.opaqueId,
    agentType,
    agentName,
    dateRange,
    dateRangeLabel,
    generatedAt,
    generatedAtLabel: formatGeneratedAtLabel(generatedAt),
    rawResultContent: normalizedContent,
    parsedResult,
    resultSummary: buildResultSummary(normalizedContent),
    resultFormat: resultFormat || inferResultFormat(normalizedContent),
    coverage,
    usage,
    providerMetadata,
    errorMetadata,
    providerStatus,
    providerHttpStatus,
    parseStatus,
    reportStatus,
    coverageStatus,
    factSnapshot,
    agentToolRun,
    businessTypes,
    toolRunSummary: normalizeToolRunSummary(toolRunSummary),
    status,
    archivedAt: null,
    createdAt: generatedAt,
    updatedAt: generatedAt
  }, context.opaqueId);

  try {
    const { context: openedContext, database } = await openTenantHistory();
    assertTenantHistoryContextIsCurrent(context);
    if (!isSameTenantRuntime(context, openedContext)) throw new TenantRuntimeError('TENANT_RUNTIME_STALE');
    assertTenantHistoryContextIsCurrent(context);
    await database.table(AI_HISTORY_STORE).put(record);
    assertTenantHistoryContextIsCurrent(context);
    clearFallbackRecord(context.opaqueId, record.id);
    return record;
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo guardar el análisis local:', error);

    const staleCodes = new Set(['TENANT_RUNTIME_STALE', 'TENANT_RUNTIME_NOT_READY', 'TENANT_HISTORY_DATABASE_INVALID']);
    if (!staleCodes.has(error?.code) && writeFallbackRecord(record)) {
      return { ...record, persistence: 'fallback' };
    }

    throw error;
  }
}

export async function getLocalAIAnalysisHistory({
  agentType,
  includeArchived = false,
  limit = DEFAULT_HISTORY_LIMIT
} = {}) {
  const context = captureTenantHistoryContext();
  let indexedRecords = [];

  try {
    const { context: openedContext, database } = await openTenantHistory();
    if (!isSameTenantRuntime(context, openedContext)) throw new TenantRuntimeError('TENANT_RUNTIME_STALE');
    const records = await database.table(AI_HISTORY_STORE)
      .orderBy('generatedAt')
      .reverse()
      .toArray();
    assertTenantHistoryContextIsCurrent(context);
    indexedRecords = records;
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo leer el historial local:', error);
    if (['TENANT_RUNTIME_STALE', 'TENANT_RUNTIME_NOT_READY'].includes(error?.code)) throw error;
  }

  const recordsById = new Map();
  readFallbackRecords(context.opaqueId).forEach(record => recordsById.set(record.id, record));
  indexedRecords.forEach(record => recordsById.set(record.id, record));

  const normalizedLimit = Math.max(Number(limit) || DEFAULT_HISTORY_LIMIT, 1);
  return Array.from(recordsById.values())
    .map(record => normalizeHistoryRecord(record, context.opaqueId))
    .filter(record => record.tenantOpaqueId === context.opaqueId)
    .filter(record => includeArchived || record.status !== 'archived')
    .filter(record => !agentType || record.agentType === agentType)
    .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)))
    .slice(0, normalizedLimit);
}

export async function getLocalAIAnalysisDetail(id) {
  try {
    if (!id) return null;
    const context = captureTenantHistoryContext();
    let record = null;
    try {
      const { context: openedContext, database } = await openTenantHistory();
      if (!isSameTenantRuntime(context, openedContext)) throw new TenantRuntimeError('TENANT_RUNTIME_STALE');
      record = await database.table(AI_HISTORY_STORE).get(id);
    } catch (databaseError) {
      if (['TENANT_RUNTIME_STALE', 'TENANT_RUNTIME_NOT_READY'].includes(databaseError?.code)) throw databaseError;
    }

    if (!record) record = readFallbackRecords(context.opaqueId).find(item => item.id === id) || null;
    assertTenantHistoryContextIsCurrent(context);
    if (!record || record.tenantOpaqueId !== context.opaqueId) return null;
    return normalizeHistoryRecord(record, context.opaqueId);
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo abrir el análisis local:', error);
    throw error;
  }
}

export async function archiveLocalAIAnalysis(id) {
  try {
    if (!id) return null;
    const context = captureTenantHistoryContext();
    let database = null;
    let existingRecord = null;
    let indexedRecord = false;

    try {
      const opened = await openTenantHistory();
      database = opened.database;
      if (!isSameTenantRuntime(context, opened.context)) throw new TenantRuntimeError('TENANT_RUNTIME_STALE');
      existingRecord = await database.table(AI_HISTORY_STORE).get(id);
      indexedRecord = Boolean(existingRecord);
      assertTenantHistoryContextIsCurrent(context);
    } catch (databaseError) {
      if (isStaleHistoryError(databaseError)) throw databaseError;
    }

    if (!existingRecord) {
      existingRecord = readFallbackRecords(context.opaqueId).find(item => item.id === id) || null;
    }
    assertTenantHistoryContextIsCurrent(context);
    if (!existingRecord || existingRecord.tenantOpaqueId !== context.opaqueId) return null;

    const now = new Date().toISOString();
    const archivedRecord = normalizeHistoryRecord({
      ...existingRecord,
      tenantOpaqueId: context.opaqueId,
      status: 'archived',
      archivedAt: now,
      updatedAt: now
    }, context.opaqueId);

    assertTenantHistoryContextIsCurrent(context);
    if (indexedRecord && database) {
      await database.table(AI_HISTORY_STORE).put(archivedRecord);
      assertTenantHistoryContextIsCurrent(context);
      clearFallbackRecord(context.opaqueId, id);
      return archivedRecord;
    }

    if (!writeFallbackRecord(archivedRecord)) throw new Error('AI_HISTORY_FALLBACK_UNAVAILABLE');
    assertTenantHistoryContextIsCurrent(context);
    return { ...archivedRecord, persistence: 'fallback' };
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo archivar el análisis local:', error);
    throw error;
  }
}

export async function deleteLocalAIAnalysis(id) {
  try {
    if (!id) return { success: false };
    const context = captureTenantHistoryContext();
    let databaseError = null;

    try {
      const { context: openedContext, database } = await openTenantHistory();
      if (!isSameTenantRuntime(context, openedContext)) throw new TenantRuntimeError('TENANT_RUNTIME_STALE');
      assertTenantHistoryContextIsCurrent(context);
      await database.table(AI_HISTORY_STORE).delete(id);
      assertTenantHistoryContextIsCurrent(context);
      clearFallbackRecord(context.opaqueId, id);
      return { success: true };
    } catch (error) {
      if (isStaleHistoryError(error)) throw error;
      databaseError = error;
    }

    const fallbackRecord = readFallbackRecords(context.opaqueId).find(item => item.id === id);
    assertTenantHistoryContextIsCurrent(context);
    if (!fallbackRecord || fallbackRecord.tenantOpaqueId !== context.opaqueId) throw databaseError;

    clearFallbackRecord(context.opaqueId, id);
    assertTenantHistoryContextIsCurrent(context);
    return { success: true, persistence: 'fallback' };
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo eliminar el análisis local:', error);
    throw error;
  }
}

export default {
  saveLocalAIAnalysis,
  getLocalAIAnalysisHistory,
  getLocalAIAnalysisDetail,
  archiveLocalAIAnalysis,
  deleteLocalAIAnalysis
};
