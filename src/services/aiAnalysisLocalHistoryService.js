import Dexie from 'dexie';
import { parseAgentResponse } from '../utils/parseAgentResponse';
import { DB_NAME } from '../config/dbConfig';

const AI_HISTORY_DB_NAME = `${DB_NAME}_ai_history`;
const AI_HISTORY_STORE = 'ai_analysis_history';
const DEFAULT_HISTORY_LIMIT = 25;
const MAX_SUMMARY_LENGTH = 160;
const DEFAULT_SUMMARY = 'Análisis IA guardado.';
const VALID_RESULT_FORMATS = new Set(['structured_json', 'markdown', 'raw']);

class AIAnalysisHistoryDatabase extends Dexie {
  constructor() {
    super(AI_HISTORY_DB_NAME);

    this.version(1).stores({
      [AI_HISTORY_STORE]: 'id, agentType, generatedAt, status, [status+generatedAt], [agentType+status+generatedAt]'
    });
  }
}

const aiHistoryDb = new AIAnalysisHistoryDatabase();

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

const normalizeHistoryRecord = (record = {}) => {
  const generatedAt = normalizeText(record.generatedAt || record.createdAt, new Date().toISOString());
  const resultContent = normalizeContent(record.resultContent);
  const resultFormat = VALID_RESULT_FORMATS.has(record.resultFormat)
    ? record.resultFormat
    : inferResultFormat(resultContent);

  return {
    id: normalizeText(record.id, generateLocalAnalysisId()),
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

const ensureOpen = async () => {
  if (!aiHistoryDb.isOpen()) {
    await aiHistoryDb.open();
  }
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
    await ensureOpen();

    const generatedAt = new Date().toISOString();
    const normalizedContent = normalizeContent(resultContent);
    const record = normalizeHistoryRecord({
      id: generateLocalAnalysisId(),
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
    });

    await aiHistoryDb.table(AI_HISTORY_STORE).put(record);
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
    await ensureOpen();

    const normalizedLimit = Math.max(Number(limit) || DEFAULT_HISTORY_LIMIT, 1);
    const records = await aiHistoryDb.table(AI_HISTORY_STORE)
      .orderBy('generatedAt')
      .reverse()
      .toArray();

    return records
      .map(normalizeHistoryRecord)
      .filter(record => includeArchived || record.status !== 'archived')
      .filter(record => !agentType || record.agentType === agentType)
      .slice(0, normalizedLimit);
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo leer el historial local:', error);
    return [];
  }
}

export async function getLocalAIAnalysisDetail(id) {
  try {
    if (!id) return null;
    await ensureOpen();

    const record = await aiHistoryDb.table(AI_HISTORY_STORE).get(id);
    return record ? normalizeHistoryRecord(record) : null;
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo abrir el análisis local:', error);
    return null;
  }
}

export async function archiveLocalAIAnalysis(id) {
  try {
    const existingRecord = await getLocalAIAnalysisDetail(id);
    if (!existingRecord) return null;

    const now = new Date().toISOString();
    const archivedRecord = normalizeHistoryRecord({
      ...existingRecord,
      status: 'archived',
      archivedAt: now,
      updatedAt: now
    });

    await ensureOpen();
    await aiHistoryDb.table(AI_HISTORY_STORE).put(archivedRecord);
    return archivedRecord;
  } catch (error) {
    console.warn('[AI_HISTORY_LOCAL] No se pudo archivar el análisis local:', error);
    throw error;
  }
}

export async function deleteLocalAIAnalysis(id) {
  try {
    if (!id) return { success: false };
    await ensureOpen();
    await aiHistoryDb.table(AI_HISTORY_STORE).delete(id);
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
