// src/store/slices/license/licenseSyncActions.js

import Logger from '../../../services/Logger';

import {
  getLicenseSyncIntervalMs
} from './licenseGuards';

import {
  getLicenseSyncMode
} from './licenseGuards';

let licenseSyncTimer = null;
let licenseSyncOnlineListener = null;
let isLicenseSyncCheckRunning = false;

const LAST_VALIDATION_STORAGE_KEY = 'Lanzo_last_validation_persistent';

const CRITICAL_SYNC_REASONS = [
  'realtime_event',
  'realtime_reconnected',
  'realtime_recover',
  'license_changed',
  'plan_changed',
  'device_changed',
  'staff_changed',
  'permission_changed',
  'staff_invalidated',
  'force',
  'activation',
  'staff_login',
  'renewal'
];

const isCriticalSyncReason = (reason = '') => {
  const normalized = String(reason || '').toLowerCase();
  return CRITICAL_SYNC_REASONS.some((item) => normalized.includes(item));
};

const readLastValidationMs = () => {
  try {
    const localValue = Number(localStorage.getItem(LAST_VALIDATION_STORAGE_KEY) || 0);
    const sessionValue = Number(sessionStorage.getItem('Lanzo_last_validation') || 0);
    const candidate = Math.max(localValue || 0, sessionValue || 0);
    return Number.isFinite(candidate) ? candidate : 0;
  } catch {
    return 0;
  }
};

const markLastValidation = () => {
  const now = Date.now().toString();
  try {
    localStorage.setItem(LAST_VALIDATION_STORAGE_KEY, now);
    sessionStorage.setItem('Lanzo_last_validation', now);
  } catch {
    // Best effort.
  }
};

const shouldSkipRemoteSyncByPlan = ({ licenseDetails, mode, reason }) => {
  if (isCriticalSyncReason(reason)) return false;

  const intervalMs = getLicenseSyncIntervalMs(licenseDetails, mode);
  const lastValidationMs = readLastValidationMs();

  return lastValidationMs > 0 && Date.now() - lastValidationMs < intervalMs;
};

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

    if (shouldSkipRemoteSyncByPlan({
      licenseDetails: state.licenseDetails,
      mode: state.licenseSyncMode,
      reason
    })) {
      Logger.log(`[LicenseSync] Revalidación remota omitida por TTL de plan (${reason}).`);
      return true;
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
        forceRemote: isCriticalSyncReason(reason),
        refreshProfile: false,
        transactionMode: false,
        allowLocalOnly: true
      });

      markLastValidation();

      if (get().appStatus === 'staff_login_required') {
        return false;
      }

      await get().refreshLicenseSyncMode(reason);

      if (isValid) {
        get().clearServerStatus?.();
      }

      return isValid;
    } catch (error) {
      Logger.warn('[LicenseSync] Falló la revalidación híbrida:', error);
      return false;
    } finally {
      isLicenseSyncCheckRunning = false;
      set({ _isLicenseSyncChecking: false });
    }
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

    licenseSyncOnlineListener = () => {
      Logger.log('[LicenseSync] Red recuperada. Evaluando revalidación.');
      get().runLicenseSyncCheck('online');
      get().recoverRealtimeSecurity?.('online');
    };

    window.addEventListener('online', licenseSyncOnlineListener);

    if (nextMode === 'hybrid_realtime') {
      const channel = await get().startRealtimeSecurity();

      if (!channel) {
        set({ licenseSyncMode: 'hybrid_polling' });
        restartLicenseSyncTimer(get, 'hybrid_polling');
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
        set({ licenseSyncMode: 'hybrid_polling' });
        restartLicenseSyncTimer(get, 'hybrid_polling');
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
