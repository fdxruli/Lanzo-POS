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
let takeoverCompleted = false;
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
  inFlight = null;
  emit(emptySnapshot());
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
    if (snapshot.scopeKey !== null || snapshot.status !== 'idle') resetRuntime();
    return snapshot;
  }

  const sameScope = snapshot.scopeKey === scopeKey;

  if (!online) {
    if (
      sameScope &&
      ['success', 'offline_known', 'error'].includes(snapshot.status) &&
      snapshot.pendingCount !== null
    ) {
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
        online: false
      });
    }
    return snapshot;
  }

  if (!force && sameScope && ['loading', 'success'].includes(snapshot.status)) {
    return snapshot;
  }

  if (inFlight?.scopeKey === scopeKey) return inFlight.promise;

  const previous = sameScope ? snapshot : emptySnapshot();
  emit({
    ...previous,
    scopeKey,
    status: 'loading',
    error: null,
    online: true
  });

  const promise = (async () => {
    try {
      const result = await postDowngradeCashReconciliation.list({ licenseKey });

      if (result?.success === false) {
        if (isOwnerRequired(result)) {
          emit({
            ...emptySnapshot(),
            scopeKey,
            status: 'hidden',
            online: true
          });
          return snapshot;
        }

        emit({
          ...previous,
          scopeKey,
          status: 'error',
          online: true,
          error: result?.message || 'No se pudieron consultar las cajas pendientes del plan anterior.'
        });
        return snapshot;
      }

      const cashSessions = Array.isArray(result?.cashSessions) ? result.cashSessions : [];
      const pendingCount = Number.isFinite(Number(result?.pendingCount))
        ? Number(result.pendingCount)
        : cashSessions.length;

      emit({
        scopeKey,
        status: 'success',
        pendingCount,
        cashSessions,
        isPostDowngrade: Boolean(result?.downgradedAt || result?.previousPlanCode),
        downgradedAt: result?.downgradedAt || null,
        error: null,
        online: true
      });
      return snapshot;
    } catch (error) {
      if (isOwnerRequired(error)) {
        emit({
          ...emptySnapshot(),
          scopeKey,
          status: 'hidden',
          online: true
        });
        return snapshot;
      }

      emit({
        ...previous,
        scopeKey,
        status: 'error',
        online: true,
        error: error?.message || 'No se pudieron consultar las cajas pendientes del plan anterior.'
      });
      return snapshot;
    } finally {
      if (inFlight?.scopeKey === scopeKey) inFlight = null;
    }
  })();

  inFlight = { scopeKey, promise };
  return promise;
};

export const markFreeDeviceTakeoverCompleted = () => {
  takeoverCompleted = true;
};

export const consumeFreeDeviceTakeoverCompleted = () => {
  const value = takeoverCompleted;
  takeoverCompleted = false;
  return value;
};

export const resetPostDowngradeCashPendingRuntime = () => {
  takeoverCompleted = false;
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
      ? `${licenseKey}:${currentAdminUser?.id || currentAdminUser?.username || 'owner'}`
      : null
  ), [currentAdminUser?.id, currentAdminUser?.username, eligible, licenseKey]);

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
    if (!eligible || !scopeKey) {
      if (runtimeSnapshot.scopeKey) resetRuntime();
      return;
    }

    void loadPending({
      scopeKey,
      licenseKey,
      online,
      force: false
    });
  }, [eligible, licenseKey, online, runtimeSnapshot.scopeKey, scopeKey]);

  const refresh = useCallback(() => {
    if (!eligible || !scopeKey) return Promise.resolve(emptySnapshot());
    return loadPending({
      scopeKey,
      licenseKey,
      online,
      force: true
    });
  }, [eligible, licenseKey, online, scopeKey]);

  const scopedSnapshot = runtimeSnapshot.scopeKey === scopeKey
    ? runtimeSnapshot
    : {
      ...emptySnapshot(),
      scopeKey,
      status: eligible ? (online ? 'loading' : 'unknown') : 'idle',
      online
    };

  return {
    ...scopedSnapshot,
    eligible,
    online,
    refresh
  };
}
