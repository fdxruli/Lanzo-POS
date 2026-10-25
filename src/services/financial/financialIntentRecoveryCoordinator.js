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
let coordinatorScope = null;
const activeRunOwners = new Map();
const canAdmit = scope => !scope || (scope.isContextCurrent() && scope.getSnapshot().accepting);

const currentCloudContext = () => {
  const mode = getCashMode();
  return mode.cloudEnabled && mode.licenseKey ? mode : null;
};

export const recoverCurrentFinancialIntents = async ({ reason = 'manual', limit = 25, executionScope = coordinatorScope } = {}) => {
  // Installed ownership cannot be bypassed by explicitly passing null.
  executionScope ||= coordinatorScope;
  if (coordinatorScope && executionScope !== coordinatorScope) throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
  executionScope?.assertAdmission();
  const mode = currentCloudContext();
  if (!mode) return { skipped: true, reason: 'financial_cloud_unavailable' };
  const handle = actorRuntimeController.capture();
  const key = `${handle.actorKey}:${handle.sessionId}:${handle.generation}:${handle.tenant.generation}`;
  const existing = activeRuns.get(key);
  if (existing) {
    if (executionScope && activeRunOwners.get(key) !== executionScope) {
      executionScope.markUnobservable('shared_financial_recovery_owner');
      // Observe public completion without acquiring ownership or dispatching again.
      return executionScope.run('recovery:shared_public', () => existing);
    }
    return existing;
  }
  const execute = async (task = null) => {
    handle.assertCurrent();
    const intents = await listFinancialIntentsForRecovery({ actorHandle: handle, limit });
    const results = [];
    // Deliberately serial: financial correctness wins over burst throughput.
    for (const intent of intents) {
      handle.assertCurrent();
      task?.assertCurrent();
      let result;
      try {
        result = await recoverFinancialIntent({
          intentId: intent.id, licenseKey: mode.licenseKey, actorHandle: handle,
          ...(task ? { executionScope: task } : {})
        });
      } catch (error) {
        task?.markUnobservable('financial_recovery_rejected_descendants');
        throw error;
      }
      // Projection handlers may publish DOM/store events whose subscribers are
      // outside the awaited financial runner. Never certify those descendants.
      if (['projection_applied', 'projection_failed', 'first_dispatch'].includes(result?.outcome)) {
        task?.markUnobservable('financial_projection_subscriber_lifetime');
      }
      results.push(result);
    }
    return { skipped: false, reason, key, results };
  };
  // F01-2A's executionScope propagates raw financial lifetime without changing
  // receipt-first, durable leases, retry edges or public recovery outcomes.
  const run = executionScope ? executionScope.run('recovery:run', execute) : execute();
  activeRuns.set(key, run);
  activeRunOwners.set(key, executionScope);
  try {
    return await run;
  } finally {
    if (activeRuns.get(key) === run) {
      activeRuns.delete(key);
      activeRunOwners.delete(key);
    }
  }
};

export const assertFinancialRecoveryScopeAvailable = scope => {
  scope.assertAdmission();
  if ((installed && scope !== coordinatorScope) || (
    coordinatorScope && scope !== coordinatorScope && coordinatorScope.getSnapshot().state !== 'DRAINED'
  )) throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
};
export const installFinancialIntentRecoveryCoordinator = ({ executionScope = null } = {}) => {
  if (executionScope) assertFinancialRecoveryScopeAvailable(executionScope);
  if (installed) {
    if (executionScope && executionScope !== coordinatorScope) throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
    return () => uninstallFinancialIntentRecoveryCoordinator();
  }
  if (coordinatorScope && executionScope !== coordinatorScope && coordinatorScope.getSnapshot().state !== 'DRAINED') {
    throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
  }
  executionScope?.assertAdmission();
  coordinatorScope = executionScope;
  executionScope?.addSource('financial_recovery', () => uninstallFinancialIntentRecoveryCoordinator());
  installed = true;
  unsubscribeActor = actorRuntimeController.subscribe((state) => {
    if (state.status === ACTOR_RUNTIME_STATUS.GRANTED && canAdmit(executionScope)) {
      recoverCurrentFinancialIntents({ reason: 'actor_granted', executionScope }).catch(() => {});
    }
  });
  if (typeof window !== 'undefined') {
    onlineListener = () => {
      if (!canAdmit(executionScope)) return;
      return recoverCurrentFinancialIntents({ reason: 'online', executionScope }).catch(() => {});
    };
    window.addEventListener('online', onlineListener);
  }
  return () => uninstallFinancialIntentRecoveryCoordinator();
};

export const uninstallFinancialIntentRecoveryCoordinator = () => {
  coordinatorScope?.quiesce();
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
