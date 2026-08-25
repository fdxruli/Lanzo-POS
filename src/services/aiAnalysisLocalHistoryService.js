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
  const resultContent = normalizeContent(record.resultContent);
  const resultFormat = VALID_RESULT_FORMATS.has(record.resultFormat)
    ? record.resultFormat
    : inferResultFormat(resultContent);

  return {
    id: normalizeText(record.id, generateLocalAnalysisId()),
    tenantOpaqueId: normalizeText(record.tenantOpaqueId, tenantOpaqueId || ''),
    agentType: normalizeText(record.agentType, 'unknown'),
    agentName: normalizeText(record.agentName, 'Agente IA'),
    dateRange: normalizeText(record.dateRange, ''),
    dateRangeLabel: normalizeText(record.dateRangeLabel, record.dateRange || 'Rango no disponible'),
    generatedAt,
    generatedAtLabel: normalizeText(record.generatedAtLabel, formatGeneratedAtLabel(generatedAt)),
    resultContent,
    resultSummary: clampSummary(record.resultSummary || buildResultSummary(resultContent)),
    resultFormat,
    businessTypes: safeArray(record.businessTypes)
      .map(type => normalizeText(type))
      .filter(Boolean),
    toolRunSummary: normalizeToolRunSummary(record.toolRunSummary),
    status: record.status === 'archived' ? 'archived' : 'saved',
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
  businessTypes,
  toolRunSummary
}) {
  try {
    const { context, database } = await openTenantHistory();
    const generatedAt = new Date().toISOString();
    const normalizedContent = normalizeContent(resultContent);
    const record = normalizeHistoryRecord({
      id: generateLocalAnalysisId(),
      tenantOpaqueId: context.opaqueId,
      agentType,
      agentName,
      dateRange,
      dateRangeLabel,
      generatedAt,
      generatedAtLabel: formatGeneratedAtLabel(generatedAt),
      resultContent: normalizedContent,
      resultSummary: buildResultSummary(normalizedContent),
      resultFormat: inferResultFormat(normalizedContent),
      businessTypes,
      toolRunSummary: normalizeToolRunSummary(toolRunSummary),
      status: 'saved',
      archivedAt: null,
      createdAt: generatedAt,
      updatedAt: generatedAt
    }, context.opaqueId);

    assertTenantHistoryContextIsCurrent(context);
    await database.table(AI_HISTORY_STORE).put(record);
    assertTenantHistoryContextIsCurrent(context);
    return record;
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo guardar el análisis local:', error);
    throw error;
  }
}

export async function getLocalAIAnalysisHistory({
  agentType,
  includeArchived = false,
  limit = DEFAULT_HISTORY_LIMIT
} = {}) {
  try {
    const { context, database } = await openTenantHistory();
    const normalizedLimit = Math.max(Number(limit) || DEFAULT_HISTORY_LIMIT, 1);
    const records = await database.table(AI_HISTORY_STORE)
      .orderBy('generatedAt')
      .reverse()
      .toArray();
    assertTenantHistoryContextIsCurrent(context);

    return records
      .map(record => normalizeHistoryRecord(record, context.opaqueId))
      .filter(record => record.tenantOpaqueId === context.opaqueId)
      .filter(record => includeArchived || record.status !== 'archived')
      .filter(record => !agentType || record.agentType === agentType)
      .slice(0, normalizedLimit);
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo leer el historial local:', error);
    throw error;
  }
}

export async function getLocalAIAnalysisDetail(id) {
  try {
    if (!id) return null;
    const { context, database } = await openTenantHistory();
    const record = await database.table(AI_HISTORY_STORE).get(id);
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
    const { context, database } = await openTenantHistory();
    const existingRecord = await database.table(AI_HISTORY_STORE).get(id);
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
    await database.table(AI_HISTORY_STORE).put(archivedRecord);
    assertTenantHistoryContextIsCurrent(context);
    return archivedRecord;
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo archivar el análisis local:', error);
    throw error;
  }
}

export async function deleteLocalAIAnalysis(id) {
  try {
    if (!id) return { success: false };
    const { context, database } = await openTenantHistory();
    assertTenantHistoryContextIsCurrent(context);
    await database.table(AI_HISTORY_STORE).delete(id);
    assertTenantHistoryContextIsCurrent(context);
    return { success: true };
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
