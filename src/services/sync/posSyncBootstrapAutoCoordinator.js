import { useAppStore } from '../../store/useAppStore';
import Logger from '../Logger';
import '../customers/customerSyncHandler';
import '../products/productSyncHandler.js';
import '../cash/cashSyncHandler.js';
import '../customerCredit/customerCreditSyncHandler.js';
import '../salesCloud/salesCloudSyncHandler.js';
import '../restaurant/restaurantOrdersSyncHandler.js';
import {
  startPosCloudBootstrap,
  stopPosCloudBootstrap
} from './posSyncBootstrapCoordinator';
import { getLicenseKeyFromDetails, isCloudPosSyncEnabled } from './syncConstants';

let unsubscribe = null;
let lastSignature = null;

const buildSignature = (state) => {
  const details = state?.licenseDetails || {};
  const licenseKey = getLicenseKeyFromDetails(details) || 'no-license';
  const planCode = details?.plan_code || details?.details?.plan_code || 'no-plan';
  const realtimeTopic = details?.realtime_topic || details?.details?.realtime_topic || 'no-topic';
  const enabled = isCloudPosSyncEnabled(details) ? 'enabled' : 'disabled';
  const role = state?.currentDeviceRole || details?.device_role || details?.details?.device_role || 'no-role';
  const staffUserId = state?.currentStaffUser?.id || details?.staff_user?.id || details?.details?.staff_user?.id || 'admin';
  return `${state?.appStatus || 'unknown'}|${licenseKey}|${planCode}|${realtimeTopic}|${enabled}|${role}|${staffUserId}`;
};

const reconcilePosSync = (state, reason = 'state_change') => {
  const details = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(details);
  const shouldStart = state?.appStatus === 'ready' && licenseKey && isCloudPosSyncEnabled(details);

  if (!shouldStart) {
    stopPosCloudBootstrap({ preserveSync: false }).catch((error) => {
      Logger.warn('[PosBootstrap] Auto coordinator stop fallo:', error);
    });
    return;
  }

  startPosCloudBootstrap({ licenseDetails: details, licenseKey, reason }).catch((error) => {
    Logger.warn('[PosBootstrap] Auto coordinator start fallo sin bloquear la app:', error);
  });
};

export const startPosSyncAutoBootstrap = () => {
  if (unsubscribe) return;

  const initialState = useAppStore.getState();
  lastSignature = buildSignature(initialState);
  reconcilePosSync(initialState, 'initial_bootstrap');

  unsubscribe = useAppStore.subscribe((state) => {
    const signature = buildSignature(state);
    if (signature === lastSignature) return;

    lastSignature = signature;
    reconcilePosSync(state, 'store_update');
  });

  Logger.log('[PosBootstrap] Auto coordinator registrado. Realtime/pull siguen activos; snapshots quedan bajo demanda.');
};

export const stopPosSyncAutoBootstrap = () => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  lastSignature = null;
  stopPosCloudBootstrap({ preserveSync: false }).catch((error) => {
    Logger.warn('[PosBootstrap] Auto coordinator cleanup fallo:', error);
  });
};

export default startPosSyncAutoBootstrap;
