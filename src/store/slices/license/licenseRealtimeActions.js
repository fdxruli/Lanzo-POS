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
      Logger.log('[Realtime] Ya hay inicialización en progreso');
      return state.realtimeSubscription;
    }

    if (!state.licenseDetails?.license_key) {
      Logger.warn('[Realtime] No hay licencia para monitorear');
      return null;
    }

    if (!isRealtimeEnabledForLicense(state.licenseDetails)) {
      Logger.log('[Realtime] Desactivado por configuración o plan. Usando modo híbrido.');
      await get().stopRealtimeSecurity();
      return null;
    }

    const realtimeTopic = state.licenseDetails.realtime_topic;

    if (!realtimeTopic) {
      Logger.warn('[Realtime] No hay topico privado para monitorear');
      return null;
    }

    const deviceFingerprint = await getStableDeviceId();

    if (!deviceFingerprint) {
      Logger.warn('[Realtime] No hay fingerprint del dispositivo');
      return null;
    }

    set({ _isInitializingSecurity: true });

    try {
      if (state.realtimeSubscription) {
        await get().stopRealtimeSecurity();
        await waitForRealtimeCleanup();
      }

      const channel = startLicenseListener(
        state.licenseDetails.license_key,
        deviceFingerprint,
        realtimeTopic,
        {
          onLicenseChanged: async (_newLicenseData) => {
            Logger.log('[Realtime] Cambio en licencia detectado');
            await get().runLicenseSyncCheck('realtime_event');
          },

          onDeviceChanged: async (event) => {
            if (event.status === 'banned' || event.status === 'deleted') {
              Logger.warn('[Realtime] Dispositivo revocado');

              const validation = {
                reason: event.status === 'banned' ? 'DEVICE_BANNED' : 'DEVICE_RELEASED'
              };

              if (await hasStaffValidationContext(get(), state.licenseDetails)) {
                await get()._requireStaffLogin(state.licenseDetails, validation);
                return;
              }

              showMessageModal(
                'ACCESO REVOCADO: Tu dispositivo ha sido desactivado remotamente.',
                async () => {
                  try {
                    await get().logout();
                  } catch (e) {
                    console.error(e);
                  } finally {
                    window.location.reload();
                  }
                },
                {
                  type: 'error',
                  confirmButtonText: 'Entendido, salir',
                  showCancel: false,
                  isDismissible: false
                }
              );
            }
          },

          onInitialSubscribed: () => {
            get().clearServerStatus?.();
            Logger.log('[Realtime] Canal conectado inicialmente; sin validación remota forzada.');
          },

          onPermanentFailure: async (message, metadata = {}) => {
            get().reportServerFailure(message, {
              health: 'down',
              reason: metadata.reason || 'realtime_permanent_failure'
            });

            if (metadata.permanent === true) {
              await get().switchLicenseSyncToPollingFallback?.('realtime_permanent_failure');
            }
          },

          onConnectionRestored: async (metadata = {}) => {
            get().clearServerStatus?.();

            if (metadata.wasLongDisconnect) {
              const now = Date.now();
              const recentlyValidatedLongOffline =
                now - lastRealtimeLongValidationAt < REALTIME_RECOVERY_MIN_INTERVAL_MS;

              if (recentlyValidatedLongOffline) {
                Logger.log('[Realtime] Reconexión larga; validación omitida por cooldown.');
                return;
              }

              lastRealtimeRecoveryAt = now;
              lastRealtimeLongValidationAt = now;

              Logger.log('[Realtime] Reconexión larga; se fuerza validación.');
              await get().runLicenseSyncCheck('realtime_reconnected_long');
              return;
            }

            Logger.log('[Realtime] Reconexión corta; se respeta TTL.');
            await get().runLicenseSyncCheck('realtime_resubscribed_short');
          }
        }
      );

      if (!channel) {
        Logger.warn('[Realtime] No se pudo crear canal. Se mantiene sincronización híbrida.');
        set({ realtimeSubscription: null });
        return null;
      }

      set({ realtimeSubscription: channel });
      Logger.log('[Realtime] Seguridad iniciada');

      return channel;
    } catch (error) {
      Logger.error('[Realtime] Error inicializando seguridad:', error);
      set({ realtimeSubscription: null });
      return null;
    } finally {
      set({ _isInitializingSecurity: false });
    }
  },

  recoverRealtimeSecurity: async (reason = 'manual', metadata = {}) => {
    const state = get();
    const safeReason = normalizeRealtimeReason(reason);
    const offlineDurationMs = getOfflineDurationMs(metadata);
    const wasLongOffline = offlineDurationMs >= REALTIME_FORCE_VALIDATE_AFTER_OFFLINE_MS;

    if (state._isRecoveringRealtime) {
      Logger.log(`[Realtime] Recuperación ya en curso; se omite ${safeReason}.`);
      return state.realtimeSubscription;
    }

    if (!state.licenseDetails?.license_key) {
      return null;
    }

    if (!isRealtimeEnabledForLicense(state.licenseDetails)) {
      await get().stopRealtimeSecurity();
      return null;
    }

    if (!navigator.onLine) {
      Logger.warn(`[Realtime] No se recupera canal (${safeReason}): sin conexión.`);
      return null;
    }

    const connectionStatus = getConnectionStatus();
    const now = Date.now();
    const hasActiveChannel = Boolean(state.realtimeSubscription && connectionStatus.isActive);
    const recentlyRecovered = now - lastRealtimeRecoveryAt < REALTIME_RECOVERY_MIN_INTERVAL_MS;

    const recentlyValidatedLongOffline =
      now - lastRealtimeLongValidationAt < REALTIME_RECOVERY_MIN_INTERVAL_MS;

    if (connectionStatus.isReconnecting || connectionStatus.isConnecting || state._isInitializingSecurity) {
      if (wasLongOffline) {
        if (recentlyValidatedLongOffline) {
          Logger.log(
            `[Realtime] Canal reconectando tras pausa larga; validación omitida por cooldown (${safeReason}).`
          );
          return state.realtimeSubscription;
        }

        lastRealtimeRecoveryAt = now;
        lastRealtimeLongValidationAt = now;

        Logger.log('[Realtime] Canal reconectando tras pausa larga; se fuerza validación.');
        await get().runLicenseSyncCheck('realtime_reconnected_long');
      } else {
        Logger.log(`[Realtime] Canal reconectando; se evita recuperación duplicada (${safeReason}).`);
      }

      return state.realtimeSubscription;
    }

    if (hasActiveChannel) {
      if (wasLongOffline) {
        if (recentlyValidatedLongOffline) {
          Logger.log(
            `[Realtime] Canal activo tras pausa larga; validación omitida por cooldown (${safeReason}).`
          );
          return state.realtimeSubscription;
        }

        lastRealtimeRecoveryAt = now;
        lastRealtimeLongValidationAt = now;

        Logger.log('[Realtime] Canal activo tras pausa larga; se fuerza validación.');
        await get().runLicenseSyncCheck('realtime_reconnected_long');
        return state.realtimeSubscription;
      }

      if (recentlyRecovered) {
        Logger.log(`[Realtime] Canal activo; probe omitido por cooldown (${safeReason}).`);
        return state.realtimeSubscription;
      }

      lastRealtimeRecoveryAt = now;

      Logger.log('[Realtime] Canal activo; probe no crítico.');
      await get().runLicenseSyncCheck(`realtime_probe_${safeReason}`);
      return state.realtimeSubscription;
    }

    if (recentlyRecovered && !wasLongOffline) {
      Logger.log(`[Realtime] Canal caído; recuperación omitida por cooldown (${safeReason}).`);
      return state.realtimeSubscription;
    }

    set({ _isRecoveringRealtime: true });

    try {

      lastRealtimeRecoveryAt = now;
      if (wasLongOffline) {
        lastRealtimeLongValidationAt = now;
      }
      Logger.log('[Realtime] Canal caído; recuperando y validando.');

      await get().stopRealtimeSecurity();
      await waitForRealtimeCleanup();

      const channel = await get().startRealtimeSecurity();
      const validationReason = wasLongOffline
        ? 'realtime_reconnected_long'
        : `realtime_recover_${safeReason}`;

      await get().runLicenseSyncCheck(validationReason);

      if (!channel) {
        await get().switchLicenseSyncToPollingFallback?.('realtime_recover_failed');
      }

      return channel;
    } catch (error) {
      Logger.warn('[Realtime] Falló recuperación del canal:', error);
      return null;
    } finally {
      set({ _isRecoveringRealtime: false });
    }
  },

  stopRealtimeSecurity: async () => {
    const { realtimeSubscription, _securityCleanupScheduled } = get();

    if (!realtimeSubscription || _securityCleanupScheduled) return;

    set({ _securityCleanupScheduled: true });

    try {
      await stopLicenseListener(realtimeSubscription);
      Logger.log('[Realtime] Seguridad detenida');
    } catch (err) {
      Logger.warn('[Realtime] Error deteniendo listener:', err);
    } finally {
      set({
        realtimeSubscription: null,
        _securityCleanupScheduled: false
      });
    }
  }
});