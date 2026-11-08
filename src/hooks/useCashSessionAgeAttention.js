import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  getAgedOpenCashSessions,
  getConfirmedOpenCashSessions,
  getNextCashSessionAgeTransitionAt
} from '../services/cash/cashSessionAgeAttention';

const emptySnapshot = () => ({
  scopeKey: null,
  status: 'idle',
  isCloudCash: false,
  sessions: [],
  updatedAt: null,
  evaluatedAt: Date.now()
});

let snapshot = emptySnapshot();
let requestGeneration = 0;
let inFlight = null;
let ageTimer = null;
const listeners = new Set();

const emit = (next) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

const clearAgeTimer = () => {
  if (ageTimer) clearTimeout(ageTimer);
  ageTimer = null;
};

const scheduleAgeTransition = (sessions, scopeKey) => {
  clearAgeTimer();
  const transitionAt = getNextCashSessionAgeTransitionAt(sessions, Date.now());
  if (!transitionAt) return;

  ageTimer = setTimeout(() => {
    if (snapshot.scopeKey !== scopeKey || snapshot.status !== 'success') return;
    emit({ ...snapshot, evaluatedAt: Date.now() });
    scheduleAgeTransition(sessions, scopeKey);
  }, Math.max(1, transitionAt - Date.now() + 25));
};

const setUnavailable = ({ scopeKey, isCloudCash }) => {
  if (inFlight?.scopeKey === scopeKey) {
    requestGeneration += 1;
    inFlight = null;
  }
  clearAgeTimer();
  emit({
    scopeKey,
    status: 'unavailable',
    isCloudCash,
    sessions: [],
    updatedAt: null,
    evaluatedAt: Date.now()
  });
};

const loadCashSessionAgeAttention = ({
  scopeKey,
  isCloudCash,
  actorKey,
  force = false
} = {}) => {
  if (!scopeKey || !actorKey) return Promise.resolve(null);

  if (
    !force &&
    snapshot.scopeKey === scopeKey &&
    ['loading', 'success'].includes(snapshot.status)
  ) {
    return inFlight?.scopeKey === scopeKey ? inFlight.promise : Promise.resolve(snapshot);
  }
  if (inFlight?.scopeKey === scopeKey) return inFlight.promise;

  clearAgeTimer();
  const generation = ++requestGeneration;
  emit({
    scopeKey,
    status: 'loading',
    isCloudCash,
    sessions: [],
    updatedAt: null,
    evaluatedAt: Date.now()
  });

  const isCurrent = () => (
    generation === requestGeneration &&
    snapshot.scopeKey === scopeKey
  );

  const promise = (async () => {
    try {
      const { cashRepository } = await import('../services/cash/cashRepository');
      if (!isCurrent()) return snapshot;

      const mode = cashRepository.getMode();
      if (
        mode.cloudEnabled !== Boolean(isCloudCash) ||
        mode.actor?.actorKey !== actorKey ||
        (isCloudCash && !mode.online)
      ) {
        setUnavailable({ scopeKey, isCloudCash });
        return snapshot;
      }

      const result = await cashRepository.getCurrentCashSession({ force: true });
      if (!isCurrent()) return snapshot;

      const sessions = getConfirmedOpenCashSessions({
        result,
        isCloudCash,
        actorKey
      });
      if (!Array.isArray(sessions)) {
        setUnavailable({ scopeKey, isCloudCash });
        return snapshot;
      }

      const nextSnapshot = {
        scopeKey,
        status: 'success',
        isCloudCash,
        sessions,
        updatedAt: Date.now(),
        evaluatedAt: Date.now()
      };
      emit(nextSnapshot);
      scheduleAgeTransition(sessions, scopeKey);
      return snapshot;
    } catch {
      if (isCurrent()) setUnavailable({ scopeKey, isCloudCash });
      return snapshot;
    } finally {
      if (inFlight?.generation === generation) inFlight = null;
    }
  })();

  inFlight = { scopeKey, generation, promise };
  return promise;
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      requestGeneration += 1;
      inFlight = null;
      clearAgeTimer();
      snapshot = emptySnapshot();
    }
  };
};

const getSnapshot = () => snapshot;

export default function useCashSessionAgeAttention({
  enabled = false,
  scopeKey = null,
  isCloudCash = false,
  actorKey = null
} = {}) {
  const runtimeSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled || !scopeKey || !actorKey) return undefined;

    const refresh = () => {
      void loadCashSessionAgeAttention({
        scopeKey,
        isCloudCash,
        actorKey,
        force: true
      });
    };
    void loadCashSessionAgeAttention({ scopeKey, isCloudCash, actorKey });

    const handleOnline = refresh;
    const handleOffline = () => {
      if (isCloudCash) setUnavailable({ scopeKey, isCloudCash });
      else refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('lanzo:cash-sync-updated', refresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('lanzo:cash-sync-updated', refresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [actorKey, enabled, isCloudCash, scopeKey]);

  const currentSnapshot = enabled && runtimeSnapshot.scopeKey === scopeKey
    ? runtimeSnapshot
    : emptySnapshot();
  const agedSessions = useMemo(
    () => currentSnapshot.status === 'success'
      ? getAgedOpenCashSessions(currentSnapshot.sessions, currentSnapshot.evaluatedAt)
      : [],
    [currentSnapshot.evaluatedAt, currentSnapshot.sessions, currentSnapshot.status]
  );

  return {
    ...currentSnapshot,
    agedSessions,
    pendingCount: agedSessions.length,
    reviewCount: agedSessions.filter(({ age }) => age.level === 'review').length,
    refresh: () => loadCashSessionAgeAttention({
      scopeKey,
      isCloudCash,
      actorKey,
      force: true
    })
  };
}
