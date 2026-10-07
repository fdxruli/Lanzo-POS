// src/store/slices/license/licenseRealtimeActions.js

import Logger from '../../../services/Logger';
import { showMessageModal } from '../../../services/utils';
import { getStableDeviceId } from '../../../services/supabase';
import {
  getConnectionStatus,
  startLicenseListener,
  stopLicenseListener
} from '../../../services/licenseRealtime';

import {
  REALTIME_FORCE_VALIDATE_AFTER_OFFLINE_MS,
  REALTIME_RECOVERY_MIN_INTERVAL_MS
} from './licenseConstants';

import {
  isRealtimeEnabledForLicense
} from './licenseGuards';

const waitForRealtimeCleanup = () => new Promise((resolve) => setTimeout(resolve, 200));

let lastRealtimeRecoveryAt = 0;
let lastRealtimeLongValidationAt = 0;

const normalizeRealtimeReason = (reason = 'manual') => String(reason || 'manual')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '_') || 'manual';

const getOfflineDurationMs = (metadata = {}) => {
  const value = Number(metadata.offlineDurationMs ?? metadata.timeAwayMs ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

export const createLicenseRealtimeActions = ({
  set,
  get,
  hasStaffValidationContext
}) => ({
  startRealtimeSecurity: async () => {
    const state = get();

    if (state._isInitializingSecurity) {
      Logger.log('[Realtime] Ya hay inicializaciÃ³n en progreso');
      return state.realtimeSubscription;
    }

    if (!state.licenseDetails?.license_key) {
      Logger.warn('[Realtime] No hay licencia para monitorear');
      return null;
    }

 ¶»§q«^