import { actorRuntimeController, ACTOR_RUNTIME_STATUS } from '../auth/actorRuntimeController';
import { getCashMode } from '../cash/cashActor';
import '../cash/cashRepository';
import '../salesCloud/salesCloudCashierService';
import './financialCancellationProjection';
import { listFinancialIntentsForRecovery } from './financialIntentLedger';
import { recoverFinancialIntent } from './financialIntentRecovery';

let installed = false;
const activeRuns = new Map();
let unsubscribeActor = null;
let onlineListener = null;

const currentCloudContext = () => {
  const mode = getCashMode();
  return mode.cloudEnabled && mode.licenseKey ? mode : null;
};

export const recoverCurrentFinancialIntents = async ({ reason = 'manual', limit = 25 } = {}) => {
  const mode = currentCloudContext();
  if (!mode) return { skipped: true, reason: 'financial_cloud_unavailable' };
  const handle = actorRuntimeController.capture();
  const key = `${handle.actorKey}:${handle.sessionId}:${handle.generation}:${handle.tenant.generation}`;
  const existing = activeRuns.get(key);
  if (existing) return existing;
  const run = (async () => {
    handle.assertCurrent();
    const intents = await listFinancialIntentsForRecovery({ actorHandle: handle, limit });
    const results = [];
    // Deliberately serial: financial correctness wins over burst throughput.
    for (const intent of intents) {
      handle.assertCurrent();
      results.push(await recoverFinancialIntent({ intentId: intent.id, licenseKey: mode.licenseKey, actorHandle: handle }));
    }
    return { skipped: false, reason, key, results };
  })();
  activeRuns.set(key, run);
  try {
    return await run;
  } finally {
    if (activeRuns.get(key) === run) activeRuns.delete(key);
  }
};

export const installFinancialIntentRecoveryCoordinator = () => {
  if (installed) return () => uninstallFinancialIntentRecoveryCoordinator();
  installed = true;
  unsubscribeActor = actorRuntimeController.subscribe((state) => {
    if (state.status === ACTOR_RUNTIME_STATUS.GRANTED) {
      recoverCurrentFinancialIntents({ reason: 'actor_granted' }).catch(() => {});
    }
  });
  if (typeof window !== 'undefined') {
    onlineListener = () => recoverCurrentFinancialIntents({ reason: 'online' }).catch(() => {});
    window.addEventListener('online', onlineListener);
  }
  return () => uninstallFinancialIntentRecoveryCoordinator();
};

export const uninstallFinancialIntentRecoveryCoordinator = () => {
  unsubscribeActor?.();
  if (typeof window !== 'undefined' && onlineListener) window.removeEventListener('online', onlineListener);
  installed = false;
  unsubscribeActor = null;
  onlineListener = null;
};

export const financialIntentRecoveryCoordinatorInternals = Object.freeze({
  isInstalled: () => installed,
  getActiveRuns: () => new Map(activeRuns)
});
