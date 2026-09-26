import {
  buildSalesProfitabilityDownloadFilename,
  buildSalesProfitabilityDownloadReport,
  sanitizeSalesProfitabilityDownloadReport
} from './salesProfitabilityDownloadReport';
import {
  getTenantStorageItem,
  getTenantStorageState,
  removeTenantStorageItem,
  setTenantStorageItem
} from '../tenant/tenantScopedStorage';

export const SALES_PROFITABILITY_HISTORY_STORAGE_KEY = 'commercial-ai-sales-profitability-history-v1';
export const SALES_PROFITABILITY_HISTORY_MAX_ENTRIES = 50;
export const SALES_PROFITABILITY_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const SALES_PROFITABILITY_HISTORY_MAX_BYTES = 2 * 1024 * 1024;

const HISTORY_SCHEMA_VERSION = 1;
const VALID_RESPONSE_STATUSES = new Set(['completed', 'incomplete', 'insufficient_data', 'out_of_scope']);
const VALID_EXECUTION_MODES = new Set(['automatic', 'cache', 'ai']);
const VALID_USAGE_STATUSES = new Set(['yes', 'no', 'unknown']);
const VALID_USAGE_REASONS = new Set([
  'edge_generation_completed',
  'no_provider_path',
  'explicit_cache_hit',
  'provider_or_response_not_confirmed',
  'quota_not_confirmed'
]);

const MODE_LABELS = Object.freeze({
  automatic: 'Análisis automático',
  cache: 'Caché',
  ai: 'IA'
});

const USAGE_LABELS = Object.freeze({
  yes: 'Sí',
  no: 'No',
  unknown: 'No confirmado'
});

const USAGE_EXPLANATIONS = Object.freeze({
  edge_generation_completed: 'La Edge Function devolvió una generación exitosa y confirmó la finalización del uso.',
  no_provider_path: 'La consulta se resolvió sin entrar a la ruta del proveedor ni a la reserva de cuota.',
  explicit_cache_hit: 'El resultado incluyó una señal explícita de cache hit; no se registró un nuevo uso.',
  provider_or_response_not_confirmed: 'No hay una señal fiable para confirmar si esta consulta consumió cuota.',
  quota_not_confirmed: 'La respuesta no incluyó confirmación suficiente del estado de cuota.'
});

let entrySequence = 0;

const asRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value
  : {};

const parseTimestamp = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const createLocalEntryId = (timestamp) => {
  entrySequence = (entrySequence + 1) % 1_000_000;
  return `${timestamp}-${entrySequence}`;
};

const hasNarrative = (narrative) => (
  narrative?.status !== 'unavailable'
  && (
    (typeof narrative?.executiveSummary === 'string' && narrative.executiveSummary.trim().length > 0)
    || (typeof narrative?.explanation === 'string' && narrative.explanation.trim().length > 0)
    || (Array.isArray(narrative?.recommendations) && narrative.recommendations.length > 0)
  )
);

const hasExplicitCacheHit = (result) => (
  result?.cacheHit === true
  || result?.cache?.hit === true
);

export const classifySalesProfitabilityExecution = (result = {}) => {
  const explicitCacheHit = hasExplicitCacheHit(result);
  const providerCalled = result.providerCalled === true;
  const mode = explicitCacheHit && !providerCalled
    ? 'cache'
    : providerCalled && hasNarrative(result.response?.aiNarrative)
      ? 'ai'
      : 'automatic';

  let usageStatus = 'unknown';
  let usageReason = 'quota_not_confirmed';
  if (explicitCacheHit && !providerCalled) {
    usageStatus = 'no';
    usageReason = 'explicit_cache_hit';
  } else if (result.quotaOutcome === 'consumed') {
    usageStatus = 'yes';
    usageReason = 'edge_generation_completed';
  } else if (result.quotaOutcome === 'not_consumed') {
    usageStatus = 'no';
    usageReason = 'no_provider_path';
  } else if (providerCalled || result.quotaOutcome === 'not_confirmed') {
    usageReason = 'provider_or_response_not_confirmed';
  }

  return { mode, usageStatus, usageReason };
};

export const buildSalesProfitabilityHistoryScopeKey = async ({
  tenantOpaqueId,
  actorKey,
  sessionId,
  licenseKey
} = {}) => {
  const parts = [tenantOpaqueId, actorKey, sessionId, licenseKey].map((value) => (
    typeof value === 'string' ? value.trim() : ''
  ));
  if (parts.some((part) => !part)) return null;

  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || typeof TextEncoder === 'undefined') return null;

  try {
    const input = new TextEncoder().encode(JSON.stringify(parts));
    const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', input));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
};

const safeEntry = (value) => {
  const source = asRecord(value);
  const queriedAtDate = parseTimestamp(source.queriedAt);
  if (!queriedAtDate) return null;

  const report = sanitizeSalesProfitabilityDownloadReport(source.report);
  if (!report || !VALID_RESPONSE_STATUSES.has(report.result.status)) return null;

  const execution = asRecord(source.execution);
  const quota = asRecord(source.quota);
  const mode = VALID_EXECUTION_MODES.has(execution.mode) ? execution.mode : 'automatic';
  const usageStatus = VALID_USAGE_STATUSES.has(quota.status) ? quota.status : 'unknown';
  const usageReason = VALID_USAGE_REASONS.has(quota.reason)
    ? quota.reason
    : 'quota_not_confirmed';
  const timestamp = queriedAtDate.getTime();
  const rawId = typeof source.id === 'string' && /^\d{10,13}-\d{1,6}$/.test(source.id)
    ? source.id
    : createLocalEntryId(timestamp);

  return {
    id: rawId,
    queriedAt: queriedAtDate.toISOString(),
    timezone: report.request.period.timezone || 'America/Mexico_City',
    execution: { mode },
    quota: { status: usageStatus, reason: usageReason },
    report
  };
};

export const buildSalesProfitabilityHistoryEntry = ({
  result,
  requestContext = {},
  queriedAt = new Date()
} = {}) => {
  const response = asRecord(result?.response);
  if (!VALID_RESPONSE_STATUSES.has(response.status)) return null;

  const queriedAtDate = parseTimestamp(queriedAt);
  if (!queriedAtDate) return null;
  const report = buildSalesProfitabilityDownloadReport(result, requestContext, {
    generatedAt: queriedAtDate
  });
  if (!report) return null;

  const execution = classifySalesProfitabilityExecution(result);
  return safeEntry({
    id: createLocalEntryId(queriedAtDate.getTime()),
    queriedAt: queriedAtDate.toISOString(),
    execution: { mode: execution.mode },
    quota: { status: execution.usageStatus, reason: execution.usageReason },
    report
  });
};

const tenantStorage = Object.freeze({
  isReady: () => {
    const state = getTenantStorageState();
    return state.ready === true && state.writesSuspended !== true;
  },
  getItem: getTenantStorageItem,
  setItem: setTenantStorageItem,
  removeItem: removeTenantStorageItem
});

const serializedBytes = (value) => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return value.length * 2;
};

const serializeEnvelope = (scopeKey, entries) => JSON.stringify({
  schemaVersion: HISTORY_SCHEMA_VERSION,
  scopeKey,
  entries
});

const writeEnvelope = (scopeKey, entries, storage) => {
  let retained = entries.slice(0, SALES_PROFITABILITY_HISTORY_MAX_ENTRIES);
  let serialized = serializeEnvelope(scopeKey, retained);
  while (
    retained.length > 1
    && serializedBytes(serialized) > SALES_PROFITABILITY_HISTORY_MAX_BYTES
  ) {
    retained = retained.slice(0, -1);
    serialized = serializeEnvelope(scopeKey, retained);
  }
  if (serializedBytes(serialized) > SALES_PROFITABILITY_HISTORY_MAX_BYTES) {
    return { entries: retained, saved: false, issue: 'entry_too_large' };
  }

  try {
    storage.setItem(SALES_PROFITABILITY_HISTORY_STORAGE_KEY, serialized);
    const saved = storage.getItem(SALES_PROFITABILITY_HISTORY_STORAGE_KEY) === serialized;
    return {
      entries: retained,
      saved,
      issue: saved ? null : 'storage_unavailable'
    };
  } catch {
    return { entries: retained, saved: false, issue: 'storage_unavailable' };
  }
};

export const loadSalesProfitabilityHistory = ({
  scopeKey,
  now = Date.now(),
  storage = tenantStorage
} = {}) => {
  if (!scopeKey || storage.isReady?.() === false) {
    return { entries: [], issue: 'context_unavailable' };
  }

  let raw;
  try {
    raw = storage.getItem(SALES_PROFITABILITY_HISTORY_STORAGE_KEY);
  } catch {
    return { entries: [], issue: 'storage_unavailable' };
  }
  if (raw === null || raw === undefined || raw === '') return { entries: [], issue: null };

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    try { storage.removeItem(SALES_PROFITABILITY_HISTORY_STORAGE_KEY); } catch { /* keep screen usable */ }
    return { entries: [], issue: 'history_recovered' };
  }

  if (
    !envelope
    || envelope.schemaVersion !== HISTORY_SCHEMA_VERSION
    || envelope.scopeKey !== scopeKey
    || !Array.isArray(envelope.entries)
  ) {
    try { storage.removeItem(SALES_PROFITABILITY_HISTORY_STORAGE_KEY); } catch { /* keep screen usable */ }
    return { entries: [], issue: null };
  }

  const nowMs = Number(now instanceof Date ? now.getTime() : now);
  const entries = envelope.entries
    .map(safeEntry)
    .filter((entry) => entry && nowMs - Date.parse(entry.queriedAt) <= SALES_PROFITABILITY_HISTORY_RETENTION_MS)
    .sort((left, right) => Date.parse(right.queriedAt) - Date.parse(left.queriedAt))
    .slice(0, SALES_PROFITABILITY_HISTORY_MAX_ENTRIES);
  const unchanged = JSON.stringify(entries) === JSON.stringify(envelope.entries);
  if (!unchanged) {
    const write = writeEnvelope(scopeKey, entries, storage);
    return {
      entries: write.entries,
      issue: write.issue || null
    };
  }
  return { entries, issue: null };
};

export const saveSalesProfitabilityHistoryEntry = ({
  scopeKey,
  entry,
  now = Date.now(),
  storage = tenantStorage
} = {}) => {
  const safe = safeEntry(entry);
  if (!safe) return { entries: [], saved: false, issue: 'invalid_entry' };
  if (!scopeKey || storage.isReady?.() === false) {
    return { entries: [safe], saved: false, issue: 'context_unavailable' };
  }

  const existing = loadSalesProfitabilityHistory({ scopeKey, now, storage });
  const entries = [safe, ...existing.entries.filter((item) => item.id !== safe.id)]
    .sort((left, right) => Date.parse(right.queriedAt) - Date.parse(left.queriedAt))
    .slice(0, SALES_PROFITABILITY_HISTORY_MAX_ENTRIES);
  const write = writeEnvelope(scopeKey, entries, storage);
  return {
    entries: write.entries,
    saved: write.saved,
    issue: write.issue || existing.issue || null
  };
};

export const deleteSalesProfitabilityHistoryEntry = ({
  scopeKey,
  id,
  storage = tenantStorage
} = {}) => {
  const existing = loadSalesProfitabilityHistory({ scopeKey, storage });
  const entries = existing.entries.filter((entry) => entry.id !== id);
  if (entries.length === existing.entries.length) return { entries, saved: true, issue: existing.issue };
  const write = writeEnvelope(scopeKey, entries, storage);
  return { entries: write.entries, saved: write.saved, issue: write.issue || existing.issue || null };
};

export const clearSalesProfitabilityHistory = ({
  storage = tenantStorage
} = {}) => {
  if (storage.isReady?.() === false) return { saved: false, issue: 'context_unavailable' };
  try {
    storage.removeItem(SALES_PROFITABILITY_HISTORY_STORAGE_KEY);
    const saved = storage.getItem(SALES_PROFITABILITY_HISTORY_STORAGE_KEY) === null;
    return { saved, issue: saved ? null : 'storage_unavailable' };
  } catch {
    return { saved: false, issue: 'storage_unavailable' };
  }
};

export const buildSalesProfitabilityHistoryDownloadPayload = (entry) => {
  const safe = safeEntry(entry);
  if (!safe) return null;
  const report = sanitizeSalesProfitabilityDownloadReport(safe.report);
  if (!report) return null;
  return {
    schemaVersion: 'sales-profitability-history-entry-v1',
    consultedAt: safe.queriedAt,
    timezone: safe.timezone,
    executionMode: MODE_LABELS[safe.execution.mode],
    quotaConsumption: {
      status: USAGE_LABELS[safe.quota.status],
      explanation: USAGE_EXPLANATIONS[safe.quota.reason]
    },
    report
  };
};

export const downloadSalesProfitabilityHistoryEntry = (entry, options = {}) => {
  const payload = buildSalesProfitabilityHistoryDownloadPayload(entry);
  if (!payload) return null;

  const documentRef = options.documentRef ?? globalThis.document;
  const urlApi = options.urlApi ?? globalThis.URL;
  const BlobCtor = options.BlobCtor ?? globalThis.Blob;
  if (!documentRef?.createElement || !documentRef?.body || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL || !BlobCtor) {
    throw new Error('DOWNLOAD_API_UNAVAILABLE');
  }

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const filename = buildSalesProfitabilityDownloadFilename(now).replace('.json', '-historial.json');
  const blob = new BlobCtor([JSON.stringify(payload, null, 2) + '\n'], {
    type: 'application/json;charset=utf-8'
  });
  const objectUrl = urlApi.createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  documentRef.body.appendChild(link);

  try {
    link.click();
  } finally {
    link.remove();
    urlApi.revokeObjectURL(objectUrl);
  }
  return { payload, filename };
};

export const salesProfitabilityHistoryLabels = Object.freeze({
  executionMode: MODE_LABELS,
  usageStatus: USAGE_LABELS,
  usageExplanation: USAGE_EXPLANATIONS
});
