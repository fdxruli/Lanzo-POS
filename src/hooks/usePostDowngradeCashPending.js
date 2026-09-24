import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  isCloudCashSyncEnabled
} from '../services/sync/syncConstants';
import { postDowngradeCashReconciliation } from '../services/cash/postDowngradeCashReconciliation';

const OWNER_ONLY_CODE = 'POST_DOWNGRADE_CASH_OWNER_REQUIRED';

const emptySnapshot = () => ({
  scopeKey: null,
  takeoverCompletedScopeKey: null,
  status: 'idle',
  pendingCount: null,
  cashSessions: [],
  isPostDowngrade: false,
  downgradedAt: null,
  error: null,
  online: true
});

let snapshot = emptySnapshot();
let inFlight = null;
let activeScopeKey = null;
let requestGeneration = 0;
let takeoverCompletedScopeKey = null;
let runtimeOnline = true;
const listeners = new Set();

const emit = (next) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => snapshot;

const resetRuntime = () => {
  requestGeneration += 1;
  activeScopeKey = null;
  inFlight = null;
  takeoverCompletedScopeKey = null;
  emit(emptySnapshot());
};

const activateScope = (scopeKey) => {
  if (activeScopeKey === scopeKey) return;

  activeScopeKey = scopeKey;
  requestGeneration += 1;
  inFlight = null;

  if (takeoverCompletedScopeKey && takeoverCompletedScopeKey !== scopeKey) {
    takeoverCompletedScopeKey = null;
  }

  emit({
    ...emptySnapshot(),
    scopeKey,
    takeoverCompletedScopeKey
  });
};

const normalizePlanCode = (licenseDetails = {}) => String(
  licenseDetails?.plan_code ||
  licenseDetails?.plan ||
  licenseDetails?.subscription_plan ||
  ''
).trim().toLowerCase();

const isConfirmedLanzoLocal = (licenseDetails = {}, licenseStatus = '') => {
  const planCode = normalizePlanCode(licenseDetails);
  const status = String(licenseDetails?.status || licenseStatus || '').trim().toLowerCase();
  return planCode === 'free_trial' && status === 'active';
};

const isOwnerRequired = (resultOrError) => (
  resultOrError?.internalCode === OWNER_ONLY_CODE ||
  resultOrError?.bridgeCode === OWNER_ONLY_CODE ||
  resultOrError?.code === OWNER_ONLY_CODE
);

const loadPending = async ({
  scopeKey,
  licenseKey,
  online,
  force = false
}) => {
  if (!scopeKey || !licenseKey) {
    if (
      activeScopeKey !== null ||
      snapshot.scopeKey !== null ||
      inFlight !== null ||
      takeoverCompletedScopeKey !== null
    ) resetRuntime();
    return snapshot;
  }

  activateScope(scopeKey);
  runtimeOnline = online;
  const sameScope = snapshot.scopeKey === scopeKey;

  if (!online) {
    if (sameScope && snapshot.pendingCount !== null) {
      emit({
        ...snapshot,
        status: 'offline_known',
        online: false,
        error: null
      });
    } else {
      emit({
        ...emptySnapshot(),
        scopeKey,
        status: 'unknown',
        online: false,
        takeoverCompletedScopeKey: takeoverCompletedScopeKey === scopeKey ? scopeKey : null
      });
    }
    return snapshot;
  }

  if (!force && sameScope && ['loading', 'success'].includes(snapshot.status)) {
    return snapshot;
  }

  if (inFlight?.scopeKey === scopeKey) return inFlight.promise;

  const previous = sameScope ? snapshot : emptySnapshot();
  const requestId = ++requestGeneration;
  const isCurrentRequest = () => (
    requestId === requestGeneration &&
    activeScopeKey === scopeKey
  );

  emit({
    ...previous,
    scopeKey,
    status: 'loading',
    error: null,
    online: true,
    takeoverCompletedScopeKey: takeoverCompletedScopeKey === scopeKey ? scopeKey : null
  });

  const promise = (async () => {
    try {
      const result = await postDowngradeCashReconciliation.list({ licenseKey });

      if (!isCurrentRequest()) return snapshot;

      if (result?.success === false) {
        if (isOwnerRequired(result)) {
          takeoverCompletedScopeKey = null;
          emit({
            ...emptySnapshot(),
            scopeKey,
            status: 'hidden',
            online: runtimeOnline
          });
          return snapshot;
        }

        if (!runtimeOnline) {
          emit({
            ...previous,
            scopeKey,
            status: previous.pendingCount === null ? 'unknown' : 'offline_known',
            online: false,
            error: null,
            takeoverCompletedScopeKey: takeoverCompletedScopeKey === scopeKey ? scopeKey : null
          });
          return snapshot;
        }

        emit({
          ...previous,
          scopeKey,
          status: 'error',
          online: true,
          error: result?.message || 'No se pudieron consultar las cajas pendientes del plan anterior.',
          takeoverCompletedScopeKey: takeoverCompletedScopeKey === scopeKey ? scopeKey : null
        });
        return snapshot;
      }

      const hasCashSessions = Array.isArray(result?.cashSessions);
      const cashSessions = hasCashSessions ? result.cashSessions : [];
      const rawPendingCount = result?.pendingCount;
      const hasPendingCount = rawPendingCount !== null
        && rawPendingCount !== undefined
        && !(typeof rawPendingCount === 'string' && rawPendingCount.trim() === '');
      const parsedPendingCount = hasPendingCount ? Number(rawPendingCount) : Number.NaN;

      if (!hasCashSessions && (!Number.isInteger(parsedPendingCount) || parsedPendingCount < 0)) {
        emit({
          ...previous,
          scopeKey,
          status: runtimeOnline ? 'error' : 'unknown',
          online: runtimeOnline,
          error: runtimeOnline
            ? 'No se pudo verificar cuántas cajas del plan anterior siguen pendientes.'
            : null,
          takeoverCompletedScopeKey: takeoverCompletedScopeKey === scopeKey ? scopeKey : null
        });
        return snapshot;
      }

      const pendingCount = Number.isInteger(parsedPendingCount) && parsedPendingCount >= 0
        ? parsedPendingCount
        : cashSessions.length;
      const isOnlineNow = runtimeOnline;

      emit({
        scopeKey,
        status: isOnlineNow ? 'success' : 'offline_known',
        pendingCount,
        cashSessions,
        isPostDowngrade: Boolean(result?.downgradedAt || result?.previousPlanCode),
        downgradedAt: result?.downgradedAt || null,
        error: null,
        online: isOnlineNow,
        takeoverCompletedScopeKey: takeoverCompletedScopeKey === scopeKey ? scopeKey : null
      });
      return snapshot;
    } catch (error) {
      if (!isCurrentRequest()) return snapshot;

      if (isOwnerRequired(error)) {
        takeoverCompletedScopeKey = null;
        emit({
          ...emptySnapshot(),
          scopeKey,
          status: 'hidden',
          online: runtimeOnline
        });
        return snapshot;
      }

      if (!runtimeOnline) {
        emit({
          ...previous,
          scopeKey,
          status: previous.pendingCount === null ? 'unknown' : 'offline_known',
          online: false,
          error: null,
          takeoverCompletedScopeKey: takeoverCompletedScopeKey === scopeKey ? scopeKey : null
        });
        return snapshot;
      }

      emit({
        ...previous,
        scopeKey,
        status: 'error',
        online: true,
        error: error?.message || 'No se pudieron consultar las cajas pendientes del plan anterior.',
        takeoverCompletedScopeKey: takeoverCompletedScopeKey === scopeKey ? scopeKey : null
      });
      return snapshot;
    } finally {
      if (inFlight?.requestId === requestId) inFlight = null;
    }
  })();

  inFlight = { scopeKey, requestId, promise };
  return promise;
};

export const getPostDowngradeCashPendingScopeKey = (licenseKey, adminUser) => {
  const tenantKey = String(licenseKey || '').trim();
  const adminId = String(adminUser?.id || '').trim();
  const username = String(adminUser?.username || '').trim().toLowerCase();
  const actorKey = adminId ? `id:${adminId}` : username ? `username:${username}` : null;

  return tenantKey && actorKey ? JSON.stringify([tenantKey, actorKey]) : null;
};

export const markFreeDeviceTakeoverCompleted = (scopeKey) => {
  if (!scopeKey) return false;

  takeoverCompletedScopeKey = String(scopeKey);
  emit({
    ...snapshot,
    takeoverCompletedScopeKey
  });
  return true;
};

export const resetPostDowngradeCashPendingRuntime = () => {
  resetRuntime();
};

export default function usePostDowngradeCashPending() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentAdminUser = useAppStore((state) => state.currentAdminUser);
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const cloudCashEnabled = isCloudCashSyncEnabled(licenseDetails);
  const [online, setOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  ));
  const runtimeSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const ownerAuthenticated = Boolean(
    currentDeviceRole === 'admin' &&
    currentAdminUser?.is_owner === true
  );
  const eligible = Boolean(
    licenseKey &&
    ownerAuthenticated &&
    isConfirmedLanzoLocal(licenseDetails, licenseStatus) &&
    !cloudCashEnabled
  );
  const scopeKey = useMemo(() => (
    eligible
      ? getPostDowngradeCashPendingScopeKey(licenseKey, currentAdminUser)
      : null
  ), [currentAdminUser?.id, currentAdminUser?.username, eligible, licenseKey]);
  const scopedEligible = eligible && Boolean(scopeKey);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!scopedEligible || !scopeKey) {
      if (
        activeScopeKey !== null ||
        runtimeSnapshot.scopeKey !== null ||
        inFlight !== null ||
        takeoverCompletedScopeKey !== null
      ) resetRuntime();
      return;
    }

    void loadPending({
      scopeKey,
      licenseKey,
      online,
      force: false
    });
  }, [licenseKey, online, runtimeSnapshot.scopeKey, scopeKey, scopedEligible]);

  const refresh = useCallback(() => {
    if (!scopedEligible || !scopeKey) return Promise.resolve(emptySnapshot());
    return loadPending({
      scopeKey,
      licenseKey,
      online,
      force: true
    });
  }, [licenseKey, online, scopeKey, scopedEligible]);

  const scopedSnapshot = runtimeSnapshot.scopeKey === scopeKey
    ? runtimeSnapshot
    : {
      ...emptySnapshot(),
      scopeKey,
      status: scopedEligible ? (online ? 'loading' : 'unknown') : 'idle',
      online,
      takeoverCompletedScopeKey: null
    };

  return {
    ...scopedSnapshot,
    scopeKey,
    eligible: scopedEligible,
    takeoverCompleted: Boolean(
      scopeKey &&
      runtimeSnapshot.takeoverCompletedScopeKey === scopeKey
    ),
    online,
    refresh
  };
}
