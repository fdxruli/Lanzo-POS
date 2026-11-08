import {
  buildBusinessCashSummary,
  CASH_SESSION_AGE_THRESHOLDS_HOURS,
  getCashSessionAge,
  isOpenBusinessCashSession
} from './businessCashSummary';

const HOUR_MS = 60 * 60 * 1000;
const OPENED_AT_FIELDS = ['opened_at', 'fecha_apertura'];

const getOpenedAt = (session = {}) => OPENED_AT_FIELDS
  .map((field) => session[field])
  .find((value) => value);

const getSessionActorKey = (session = {}) => session.actor_key || session.actorKey || null;
const getSessionId = (session = {}) => session.id || session.cash_session_id || null;

/**
 * Returns null when the repository did not confirm an authoritative snapshot.
 * An empty array means the source completed successfully and found no open
 * sessions. Cloud sessions must come from the authenticated current-cash RPC;
 * Local only contributes the current actor's own cached session.
 */
export const getConfirmedOpenCashSessions = ({
  result,
  isCloudCash,
  actorKey
} = {}) => {
  if (
    !result ||
    result.success === false ||
    result.networkUnavailable ||
    result.stateKnown === false ||
    result.readOnly ||
    result.mode?.cloudEnabled !== Boolean(isCloudCash) ||
    !actorKey ||
    (result.actor?.actorKey && result.actor.actorKey !== actorKey)
  ) {
    return null;
  }

  if (isCloudCash) {
    const rawSessions = result.response?.admin_open_sessions
      ?? result.response?.adminOpenSessions;
    if (!Array.isArray(rawSessions)) return null;
    const normalizedSessions = Array.isArray(result.adminOpenSessions)
      ? result.adminOpenSessions
      : rawSessions;
    return buildBusinessCashSummary(normalizedSessions, result.cashSession).sessions;
  }

  const ownSession = result.cashSession;
  if (
    !ownSession ||
    getSessionActorKey(ownSession) !== actorKey ||
    !isOpenBusinessCashSession(ownSession)
  ) {
    return [];
  }
  return [ownSession];
};

export const getAgedOpenCashSessions = (sessions = [], now = Date.now()) => (
  sessions
    .filter(isOpenBusinessCashSession)
    .map((session) => ({
      session,
      age: getCashSessionAge(getOpenedAt(session), now)
    }))
    .filter(({ age }) => age.level === 'important' || age.level === 'review')
    .sort((left, right) => {
      const levelRank = { review: 0, important: 1 };
      const levelDifference = levelRank[left.age.level] - levelRank[right.age.level];
      if (levelDifference !== 0) return levelDifference;
      return Date.parse(getOpenedAt(left.session)) - Date.parse(getOpenedAt(right.session));
    })
);

export const getNextCashSessionAgeTransitionAt = (sessions = [], now = Date.now()) => {
  const thresholds = Object.values(CASH_SESSION_AGE_THRESHOLDS_HOURS)
    .map((hours) => hours * HOUR_MS);
  const transitions = sessions
    .filter(isOpenBusinessCashSession)
    .flatMap((session) => {
      const openedAt = Date.parse(getOpenedAt(session) || '');
      if (Number.isNaN(openedAt) || openedAt > now) return [];
      return thresholds
        .map((threshold) => openedAt + threshold)
        .filter((transitionAt) => transitionAt > now);
    });
  return transitions.length ? Math.min(...transitions) : null;
};

export const getCashSessionAttentionDomId = (sessionId) => (
  sessionId ? 'cash-session-attention-' + encodeURIComponent(String(sessionId)) : null
);

export const getCashSessionAttentionTargetId = (session = {}) => getSessionId(session);
