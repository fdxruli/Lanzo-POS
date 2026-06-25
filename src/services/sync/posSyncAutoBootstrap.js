import { useAppStore } from '../../store/useAppStore';
import Logger from '../Logger';
import '../customers/customerSyncHandler';
import '../products/productSyncHandler.js';
import '../cash/cashSyncHandler.js';
import '../customerCredit/customerCreditSyncHandler.js';
import { posSyncOrchestrator } from './posSyncOrchestrator';
import { getLicenseKeyFromDetails, isCloudPosSyncEnabled } from './syncConstants';

let unsubscribe = null;
let lastSignature = null;

const buildSignature = (state) => {
  const details = state?.licenseDetails || {};
  const licenseKey = getLicenseKeyFromDetails(details) || 'no-license';
  const planCode = details?.plan_code || details?.details?.plan_code || 'no-plan';
  const realtimeTopic = details?.realtime_topic || details?.details?.realtime_topic || 'no-topic';
  const enabled = isCloudPosSyncEnabled(details) ? 'enabled' : 'disabled';
  return `${state?.appStatus || 'unknown'}|${licenseKey}|${planCode}|${realtimeTopic}|${enabled}`;
};

const reconcilePosSync = (state, reason = 'state_change') => {
  const details = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(details);
  const shouldStart = state?.appStatus === 'ready' && licenseKey && isCloudPosSyncEnabled(details);

  if (!shouldStart) {
    posSyncOrchestrator.stop({ preserveStatus: false }).catch((error) => {
      Logger.warn('[PosSync] Auto bootstrap stop fallo:', error);
    });
    return;
  }

  posSyncOrchestrator.start({ licenseDetails: details, reason }).catch((error) => {
    Logger.warn('[PosSync] Auto bootstrap start fallo sin bloquear la app:', error);
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

  Logger.log('[PosSync] Auto bootstrap Fase 0 registrado. Handlers customer/product/cash/customerCredit listos.');
};

export const stopPosSyncAutoBootstrap = () => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  lastSignature = null;
  posSyncOrchestrator.stop({ preserveStatus: false }).catch((error) => {
    Logger.warn('[PosSync] Auto bootstrap cleanup fallo:', error);
  });
};

export default startPosSyncAutoBootstrap;
