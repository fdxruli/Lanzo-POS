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
  stopPosCloudBootstrap,
  assertPosCloudBootstrapScopeAvailable,
  reservePosCloudBootstrapScope
} from './posSyncBootstrapCoordinator';
import { getLicenseKeyFromDetails, isCloudPosSyncEnabled } from './syncConstants';
import { installFinancialIntentRecoveryCoordinator, assertFinancialRecoveryScopeAvailable } from '../financial/financialIntentRecoveryCoordinator';

let unsubscribe = null;
let lastSignature = null;
let executionScope = null;
const canSchedule = () => !executionScope || (
  executionScope.isContextCurrent() && executionScope.getSnapshot().accepting
);

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
  if (!canSchedule()) return;
  const details = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(details);
  const shouldStart = state?.appStatus === 'ready' && licenseKey && isCloudPosSyncEnabled(details);

  if (!shouldStart) {
    return stopPosCloudBootstrap({ preserveSync: false }).catch((error) => {
      Logger.warn('[PosBootstrap] Auto coordinator stop fallo:', error);
    });
  }

  return startPosCloudBootstrap({ licenseDetails: details, licenseKey, reason,
    ...(executionScope ? { executionScope } : {}) }).catch((error) => {
    Logger.warn('[PosBootstrap] Auto coordinator start fallo sin bloquear la app:', error);
  });
};

export const startPosSyncAutoBootstrap = ({ executionScope: scope = null } = {}) => {
  if (unsubscribe) {
    if (scope && executionScope !== scope) throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
    return;
  }
  if (executionScope && scope !== executionScope && executionScope.getSnapshot().state !== 'DRAINED') throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
  if (scope) {
    assertPosCloudBootstrapScopeAvailable(scope);
    assertFinancialRecoveryScopeAvailable(scope);
    reservePosCloudBootstrapScope(scope);
  }
  executionScope = scope;
  scope?.addSource('pos_auto', () => stopPosSyncAutoBootstrap());
  const reconcile = (state, reason) => {
    if (!canSchedule()) return;
    if (scope) scope.run(`auto:${reason}`, () => reconcilePosSync(state, reason)).catch(error => {
      Logger.warn('[PosBootstrap] Scoped reconciliation stopped:', error);
    });
    else reconcilePosSync(state, reason);
  };

  // This layer is reached only after the ready application runtime activates;
  // recovery remains outside pre-license database preparation.
  if (scope) installFinancialIntentRecoveryCoordinator({ executionScope: scope });
  else installFinancialIntentRecoveryCoordinator();

  const initialState = useAppStore.getState();
  lastSignature = buildSignature(initialState);
  reconcile(initialState, 'initial_bootstrap');

  unsubscribe = useAppStore.subscribe((state) => {
    if (!canSchedule()) return;
    const signature = buildSignature(state);
    if (signature === lastSignature) return;

    lastSignature = signature;
    reconcile(state, 'store_update');
  });

  Logger.log('[PosBootstrap] Auto coordinator registrado. Realtime/pull siguen activos; snapshots quedan bajo demanda.');
};

export const stopPosSyncAutoBootstrap = () => {
  executionScope?.quiesce();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  lastSignature = null;
  const cleanup = stopPosCloudBootstrap({ preserveSync: false }).catch((error) => {
    Logger.warn('[PosBootstrap] Auto coordinator cleanup fallo:', error);
  });
  if (executionScope) return cleanup;
};

export default startPosSyncAutoBootstrap;
