import { getSafeIncidentMetadata } from './incidentDiagnostics';
import { captureIncident, resetIncidentCaptureForTests } from './incidentCapture';
import { createRecoveryContextGuard } from './recoveryContext';

const listeners = new Set();
let notices = [];

const notify = () => {
  const snapshot = [...notices];
  listeners.forEach((listener) => listener(snapshot));
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

  const timestamp = new Date(now);
  const incident = captureIncident(error, {
    source,
    pathname,
    online,
    now: timestamp,
    recoveryStatus: 'action_required'
  });
  if (!incident || incident.deduplicated) return null;

  const isCritical = incident.severity === 'critical_blocker';
  if (!isCritical && ![
    'indexeddb', 'authorization_session', 'synchronization', 'connectivity',
    'supabase_rpc', 'navigation_resource', 'pwa'
  ].includes(incident.category)) return null;

  const metadata = getSafeIncidentMetadata({
    code: incident.safe_code,
    category: incident.category,
    severity: incident.severity,
    errorType: 'Error',
    recoveryStatus: isCritical ? 'blocked' : 'action_required'
  }, { pathname, section: 'unknown', online, now: timestamp });

  const notice = Object.freeze({
    correlationId: incident.correlation_id,
    metadata,
    source: incident.source,
    critical: isCritical,
    incident,
    isContextCurrent: createRecoveryContextGuard()
  });
  notices = [notice];
  notify();
  return notice;
};

export const resetAsyncIncidentNoticesForTests = () => {
  notices = [];
  resetIncidentCaptureForTests();
  notify();
};
