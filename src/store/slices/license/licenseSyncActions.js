// src/store/slices/license/licenseSyncActions.js

import Logger from '../../../services/Logger';

import {
  getLicenseSyncIntervalMs,
  getLicenseSyncMode,
  isCriticalLicenseValidationReason
} from './licenseGuards';

import {
  markLastLicenseValidationAttempt,
  shouldSkipRemoteValidationAfterFailure,
  shouldSkipRemoteValidationForPlan
} from './licenseValidationTimestamps';

let licenseSyncTimer = null;
let licenseSyncOnlineListener = null;
let licenseSyncOfflineListener = null;
let licenseSyncLastOfflineAt = 0;
let isLicenseSyncCheckRunning = false;

const LAST_OFFLINE_STORAGE_KEY = 'lanzo_last_offline';

const readStoredTimestamp = (key) => {
  try {
    const rawValue = sessionStorage.getItem(key);
    const parsedValue = rawValue ? parseInt(rawValue, 10) : 0;
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
  } catch {
    return 0;
  }
};

const writeStoredTimestamp = (key, value) => {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // Best effort persistence.
  }
};

const removeStoredTimestamp = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Best effort cleanup.
  }
};

const getElapsedSince = (timestamp, now = Date.now()) => (
  timestamp > 0 ? Math.max(0, now - timestamp) : 0
);

const restartLicenseSyncTimer = (get, mode) => {
  if (licenseSyncTimer) {
    clearInterval(licenseSyncTimer);
    licenseSyncTimer = null;
  }

  const intervalMs = getLicenseSyncIntervalMs(get().licenseDetails, mode);

  licenseSyncTimer = setInterval(() => {
    get().runLicenseSyncCheck(mode === 'hybrid_realtime' ? 'realtime_safety_interval' : 'interval');
  }, intervalMs);

  Logger.log(`[LicenseSync] Intervalo activo cada ${Math.round(intervalMs / 1000)}s (${mode}).`);
};

export const createLicenseSyncActions = ({
  set,
  get
}) => ({
  runLicenseSyncCheck: async (reason = 'manual') => {
    const state = get();

    if (
      state.appStatus === 'loading' ||
      state.appStatus === 'unauthenticated' ||
      state.appStatus === 'staff_login_required' ||
      state._isInitializing ||
      !state.licenseDetails?.license_key
    ) {
      return false;
    }

    if (!navigator.onLine) {
      Logger.warn(`[LicenseSync] Omitiendo revalidación (${reason}): sin conexión.`);
      return false;
    }

    const syncMode = state.licenseSyncMode || getLicenseSyncMode(state.licenseDetails);

    if (shouldSkipRemoteValidationForPlan({
      licenseDetails: state.licenseDetails,
      mode: syncMode,
      reason
    })) {
      Logger.log(`[LicenseSync] Revalidación remota omitida por TTL exitoso de plan (${reason}).`);
      return true;
    }

    if (shouldSkipRemoteValidationAfterFailure({
      licenseDetails: state.licenseDetails,
      reason
    })) {
      Logger.log(`[LicenseSync] Revalidación remota omitida por cooldown corto (${reason}).`);
      return false;
    }

    if (isLicenseSyncCheckRunning) {
      Logger.log(`[LicenseSync] Revalidación ya en curso; se omite ${reason}.`);
      return false;
    }

    isLicenseSyncCheckRunning = true;
    set({ _isLicenseSyncChecking: true });

    try {
      Logger.log(`[LicenseSync] Revalidando licencia (${reason}).`);

      const isValid = await state.verifySessionIntegrity({
        reason,
        forceRemote: isCriticalLicenseValidationReason(reason),
        refreshProfile: false,
        transactionMode: false,
        allowLocalOnly: true
      });

      if (get().appStatus === 'staff_login_required') {
        return false;
      }

      await get().refreshLicenseSyncMode(reason);

      if (isValid) {
        get().clearServerStatus?.();
      }

      return isValid;
    } catch (error) {
      markLastLicenseValidationAttempt(state.licenseDetails.license_key);
      Logger.warn('[LicenseSync] Falló la revalidación híbrida:', error);
      return false;
    } finally {
      isLicenseSyncCheckRunning = false;
      set({ _isLicenseSyncChecking: false });
    }
  },

  switchLicenseSyncToPollingFallback: async (reason = 'realtime_failure') => {
    const state = get();

    if (!state.licenseDetails?.license_key || !state.licenseSyncActive) {
      return;
    }

    set({
      licenseSyncMode: 'hybrid_polling',
      realtimeSubscription: null
    });

    restartLicenseSyncTimer(get, 'hybrid_polling');

    const intervalMs = getLicenseSyncIntervalMs(state.licenseDetails, 'hybrid_polling');
    Logger.warn(`[LicenseSync] Fallback polling activo cada ${Math.round(intervalMs / 60000)}min (${reason}).`);
  },

  startLicenseSync: async () => {
    const state = get();
    const licenseKey = state.licenseDetails?.license_key;
    const nextMode = getLicenseSyncMode(state.licenseDetails);

    if (!licenseKey) {
      Logger.warn('[LicenseSync] No hay licencia para sincronizar.');
      return;
    }

    if (state.licenseSyncActive && state.licenseSyncLicenseKey === licenseKey) {
      await get().refreshLicenseSyncMode('start_existing');
      return;
    }

    if (state.licenseSyncActive) {
      await get().stopLicenseSync();
    }

    set({
      licenseSyncActive: true,
      licenseSyncMode: nextMode,
      licenseSyncLicenseKey: licenseKey
    });

    if (nextMode !== 'hybrid_realtime') {
      get().clearServerStatus?.();
    }

    restartLicenseSyncTimer(get, nextMode);

    licenseSyncOfflineListener = () => {
      licenseSyncLastOfflineAt = Date.now();
      writeStoredTimestamp(LAST_OFFLINE_STORAGE_KEY, licenseSyncLastOfflineAt);
      Logger.log('[LicenseSync] Red perdida. Se medirá duración offline para el próximo online.');
    };

    licenseSyncOnlineListener = () => {
      const now = Date.now();
      const storedOfflineAt = readStoredTimestamp(LAST_OFFLINE_STORAGE_KEY);
      const offlineStartedAt = licenseSyncLastOfflineAt || storedOfflineAt;
      const offlineDurationMs = getElapsedSince(offlineStartedAt, now);
      const currentState = get();
      const currentMode = currentState.licenseSyncMode || getLicenseSyncMode(currentState.licenseDetails);

      licenseSyncLastOfflineAt = 0;
      removeStoredTimestamp(LAST_OFFLINE_STORAGE_KEY);

      Logger.log('[LicenseSync] Red recuperada. Evaluando revalidación.');

      if (currentMode === 'hybrid_realtime') {
        get().recoverRealtimeSecurity?.('online', {
          source: 'license_sync_online',
          offlineDurationMs
        });
        return;
      }

      get().runLicenseSyncCheck('online');
    };

    window.addEventListener('offline', licenseSyncOfflineListener);
    window.addEventListener('online', licenseSyncOnlineListener);

    if (nextMode === 'hybrid_realtime') {
      const channel = await get().startRealtimeSecurity();

      if (!channel) {
        await get().switchLicenseSyncToPollingFallback('realtime_start_failed');
      }
    } else {
      await get().stopRealtimeSecurity();
      Logger.log('[LicenseSync] Modo híbrido activo sin Realtime.');
    }

    get().runLicenseSyncCheck('start');
  },

  refreshLicenseSyncMode: async (reason = 'manual') => {
    const state = get();

    if (!state.licenseSyncActive || !state.licenseDetails?.license_key) {
      return;
    }

    const nextMode = getLicenseSyncMode(state.licenseDetails);

    if (state.licenseSyncMode === nextMode) {
      return;
    }

    set({ licenseSyncMode: nextMode });
    restartLicenseSyncTimer(get, nextMode);

    Logger.log(`[LicenseSync] Modo actualizado a ${nextMode} (${reason}).`);

    if (nextMode === 'hybrid_realtime') {
      const channel = await get().startRealtimeSecurity();

      if (!channel) {
        await get().switchLicenseSyncToPollingFallback('realtime_refresh_failed');
      }
    } else {
      await get().stopRealtimeSecurity();
    }
  },

  stopLicenseSync: async () => {
    if (licenseSyncTimer) {
      clearInterval(licenseSyncTimer);
      licenseSyncTimer = null;
    }

    if (licenseSyncOnlineListener) {
      window.removeEventListener('online', licenseSyncOnlineListener);
      licenseSyncOnlineListener = null;
    }

    if (licenseSyncOfflineListener) {
      window.removeEventListener('offline', licenseSyncOfflineListener);
      licenseSyncOfflineListener = null;
    }

    licenseSyncLastOfflineAt = 0;

    await get().stopRealtimeSecurity();

    isLicenseSyncCheckRunning = false;

    set({
      licenseSyncActive: false,
      licenseSyncMode: 'idle',
      licenseSyncLicenseKey: null,
      _isLicenseSyncChecking: false
    });
  }
});