import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import Logger from '../services/Logger';
import {
  startPosCloudBootstrap,
  stopPosCloudBootstrap
} from '../services/sync/posSyncBootstrapCoordinator';
import { getLicenseKeyFromDetails, isCloudPosSyncEnabled } from '../services/sync/syncConstants';

/**
 * Hook legacy de compatibilidad.
 * El arranque oficial de POS Sync vive en posSyncBootstrapAutoCoordinator.
 * Este hook solo delega al coordinador inteligente para evitar saltarse
 * el deferral de snapshots iniciales.
 */
export const usePosSyncBootstrap = () => {
  const appStatus = useAppStore((state) => state.appStatus);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const deviceRole = useAppStore((state) => state.currentDeviceRole);
  const staffUserId = useAppStore((state) => state.currentStaffUser?.id || null);

  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const cloudSyncEnabled = isCloudPosSyncEnabled(licenseDetails);
  const planCode = licenseDetails?.plan_code || licenseDetails?.details?.plan_code || null;
  const realtimeTopic = licenseDetails?.realtime_topic || licenseDetails?.details?.realtime_topic || null;

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      if (appStatus !== 'ready' || !licenseKey || !cloudSyncEnabled) {
        await stopPosCloudBootstrap({ preserveSync: false });
        return;
      }

      try {
        const result = await startPosCloudBootstrap({
          licenseDetails,
          licenseKey,
          reason: 'legacy_hook_app_ready'
        });

        if (!cancelled) {
          Logger.log('[PosBootstrap] Hook legacy delegado al coordinador inteligente:', result?.status || result?.reason || 'ok');
        }
      } catch (error) {
        Logger.warn('[PosBootstrap] Hook legacy fallo sin bloquear la app:', error);
      }
    };

    boot();

    return () => {
      cancelled = true;
      stopPosCloudBootstrap({ preserveSync: true }).catch((error) => {
        Logger.warn('[PosBootstrap] Limpieza hook legacy fallo:', error);
      });
    };
  }, [
    appStatus,
    licenseKey,
    cloudSyncEnabled,
    planCode,
    realtimeTopic,
    deviceRole,
    staffUserId,
    licenseDetails
  ]);
};

export default usePosSyncBootstrap;
