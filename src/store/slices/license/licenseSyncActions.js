// src/store/slices/license/licenseSyncActions.js

import Logger from '../../../services/Logger';

import {
  LICENSE_SYNC_INTERVAL_MS
} from './licenseConstants';

import {
  getLicenseSyncMode
} from './licenseGuards';

let licenseSyncTimer = null;
let licenseSyncOnlineListener = null;
let isLicenseSyncCheckRunning = false;

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

    if (isLicenseSyncCheckRunning) {
      Logger.log(`[LicenseSync] Revalidación ya en curso; se omite ${reason}.`);
      return false;
    }

    isLicenseSyncCheckRunning = true;
    set({ _isLicenseSyncChecking: true });

    try {
      Logger.log(`[LicenseSync] Revalidando licencia (${reason}).`);

      const isValid = await state.verifySessionIntegrity();

      sessionStorage.setItem('Lanzo_last_validation', Date.now().toString());

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

    licenseSyncTimer = setInterval(() => {
      get().runLicenseSyncCheck('interval');
    }, LICENSE_SYNC_INTERVAL_MS);

    licenseSyncOnlineListener = () => {
      Logger.log('[LicenseSync] Red recuperada. Revalidando sesión.');
      get().runLicenseSyncCheck('online');
    };

    window.addEventListener('online', licenseSyncOnlineListener);

    if (nextMode === 'hybrid_realtime') {
      const channel = await get().startRealtimeSecurity();

      if (!channel) {
        set({ licenseSyncMode: 'hybrid_polling' });
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

    Logger.log(`[LicenseSync] Modo actualizado a ${nextMode} (${reason}).`);

    if (nextMode === 'hybrid_realtime') {
      const channel = await get().startRealtimeSecurity();

      if (!channel) {
        set({ licenseSyncMode: 'hybrid_polling' });
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