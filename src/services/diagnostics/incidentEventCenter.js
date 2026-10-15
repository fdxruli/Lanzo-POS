import {
  classifyIncident,
  getSafeIncidentMetadata,
  INCIDENT_CATEGORY
} from './incidentDiagnostics';

const DEDUPLICATION_WINDOW_MS = 30_000;
const MAX_RECENT_EVENTS = 100;
const listeners = new Set();
const recentEvents = new Map();
let sequence = 0;
let notices = [];

const VISIBLE_ASYNC_CATEGORIES = new Set([
  INCIDENT_CATEGORY.INDEXEDDB,
  INCIDENT_CATEGORY.AUTHORIZATION_SESSION,
  INCIDENT_CATEGORY.SYNCHRONIZATION
]);

const notify = () => {
  const snapshot = [...notices];
  listeners.forEach((listener) => listener(snapshot));
};

const createOpaqueId = () => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // The in-memory sequence below is sufficient when randomUUID is unavailable.
  }

  sequence += 1;
  return 'local-' + Date.now().toString(36) + '-' + sequence.toString(36);
};

export const getAsyncIncidentNotices = () => notices;

export const subscribeAsyncIncidentNotices = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const dismissAsyncIncidentNotice = (correlationId) => {
  const next = notices.filter((notice) => notice.correlationId !== correlationId);
  if (next.length === notices.length) return;
  notices = next;
  notify();
};

/**
 * Accepts only relevant global async failures. The original error and event
 * are discarded after classification; no stack, message, URL, or payload is
 * retained in this in-memory presentation queue.
 */
export const captureAsyncIncidentNotice = (
  error,
  { source = 'unhandledrejection', pathname, online, now = Date.now() } = {}
) => {
  if (!['window.error', 'unhandledrejection'].includes(source)) return null;

  const incident = classifyIncident(error);
  const isCritical = incident.severity === 'critical_blocker';
  if (!isCritical && !VISIBLE_ASYNC_CATEGORIES.has(incident.category)) return null;

  const metadata = getSafeIncidentMetadata({
    ...incident,
    recoveryStatus: isCritical ? 'blocked' : 'action_required'
  }, { pathname, section: 'unknown', online, now: new Date(now) });
  const deduplicationKey = [
    metadata.category,
    metadata.code,
    metadata.section
  ].join('|');
  const lastSeenAt = recentEvents.get(deduplicationKey);
  if (lastSeenAt !== undefined && now - lastSeenAt < DEDUPLICATION_WINDOW_MS) return null;
  recentEvents.set(deduplicationKey, now);
  for (const [key, timestamp] of recentEvents) {
    if (now - timestamp >= DEDUPLICATION_WINDOW_MS) recentEvents.delete(key);
  }
  while (recentEvents.size > MAX_RECENT_EVENTS) {
    recentEvents.delete(recentEvents.keys().next().value);
  }

  const notice = Object.freeze({
    correlationId: createOpaqueId(),
    metadata,
    source,
    critical: isCritical
  });
  notices = [notice];
  notify();
  return notice;
};

export const resetAsyncIncidentNoticesForTests = () => {
  notices = [];
  recentEvents.clear();
  sequence = 0;
  notify();
};
