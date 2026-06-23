import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import Logger from '../services/Logger';
import { posSyncOrchestrator } from '../services/sync/posSyncOrchestrator';
import { getLicenseKeyFromDetails, isCloudPosSyncEnabled } from '../services/sync/syncConstants';

export const usePosSyncBootstrap = () => {
  const appStatus = useAppStore((state) => state.appStatus);
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const cloudSyncEnabled = isCloudPosSyncEnabled(licenseDetails);
  const planCode = licenseDetails?.plan_code || licenseDetails?.details?.plan_code || null;
  const realtimeTopic = licenseDetails?.realtime_topic || licenseDetails?.details?.realtime_topic || null;

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      if (appStatus !== 'ready' || !licenseKey || !cloudSyncEnabled) {
        await posSyncOrchestrator.stop({ preserveStatus: false });
        return;
      }

      try {
        const result = await posSyncOrchestrator.start({
          licenseDetails,
          reason: 'app_ready'
        });

        if (!cancelled) {
          Logger.log('[PosSync] Bootstrap completado:', result?.status || 'unknown');
        }
      } catch (error) {
        Logger.warn('[PosSync] Bootstrap fallo sin bloquear la app:', error);
      }
    };

    boot();

    return () => {
      cancelled = true;
      posSyncOrchestrator.stop({ preserveStatus: false }).catch((error) => {
        Logger.warn('[PosSync] Limpieza de bootstrap fallo:', error);
      });
    };
  }, [appStatus, licenseKey, cloudSyncEnabled, planCode, realtimeTopic, licenseDetails]);
};

export default usePosSyncBootstrap;
