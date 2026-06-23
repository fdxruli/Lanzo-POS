// src/store/slices/license/licenseRealtimeActions.js

import Logger from '../../../services/Logger';
import { showMessageModal } from '../../../services/utils';
import { getStableDeviceId } from '../../../services/supabase';
import { startLicenseListener, stopLicenseListener } from '../../../services/licenseRealtime';

import {
  isRealtimeEnabledForLicense
} from './licenseGuards';

const waitForRealtimeCleanup = () => new Promise((resolve) => setTimeout(resolve, 200));

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

          onPermanentFailure: (message) => {
            get().reportServerFailure(message, {
              health: 'down',
              reason: 'realtime_permanent_failure'
            });
          },

          onConnectionRestored: () => {
            get().clearServerStatus?.();
            get().runLicenseSyncCheck('realtime_reconnected');
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

  recoverRealtimeSecurity: async (reason = 'manual') => {
    const state = get();

    if (state._isRecoveringRealtime) {
      Logger.log(`[Realtime] Recuperación ya en curso; se omite ${reason}.`);
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
      Logger.warn(`[Realtime] No se recupera canal (${reason}): sin conexión.`);
      return null;
    }

    set({ _isRecoveringRealtime: true });

    try {
      Logger.log(`[Realtime] Recuperando canal privado (${reason}).`);

      await get().stopRealtimeSecurity();
      await waitForRealtimeCleanup();

      const channel = await get().startRealtimeSecurity();

      // La PWA móvil puede perder eventos mientras estuvo pausada. Al recuperar el
      // WebSocket forzamos una revalidación inmediata para no depender del polling.
      await get().runLicenseSyncCheck(`realtime_recover_${reason}`);

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
