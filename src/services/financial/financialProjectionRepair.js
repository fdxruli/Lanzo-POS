import { actorRuntimeController } from '../auth/actorRuntimeController';
import {
  FINANCIAL_INTENT_STATUS,
  FINANCIAL_PROJECTION_STATUS,
  assertFinancialIntentRecoveryAuthority,
  getFinancialIntent,
  runFinancialProjectionUnderLease
} from './financialIntentLedger';
import { applyFinancialProjection } from './financialProjectionRegistry';
import { FINANCIAL_OPERATION_LABELS } from './financialIntentDiagnostics';

const isProjectionRepair = (intent) => (
  intent?.status === FINANCIAL_INTENT_STATUS.COMPLETED
  && [FINANCIAL_PROJECTION_STATUS.PENDING, FINANCIAL_PROJECTION_STATUS.FAILED].includes(intent.projectionStatus)
);

/** Replays only the existing local projection handler for a completed receipt. */
export const retryFinancialIntentProjection = async ({ intentId, actorHandle = null, project = applyFinancialProjection, leaseMs } = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  const intent = await getFinancialIntent(intentId);
  if (!intent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  if (!FINANCIAL_OPERATION_LABELS[intent.operationType]) throw new Error('FINANCIAL_PROJECTION_RETRY_OPERATION_UNSUPPORTED');
  assertFinancialIntentRecoveryAuthority(intent, handle, { allowLegacyNullDevice: isProjectionRepair(intent) });
  if (intent.status !== FINANCIAL_INTENT_STATUS.COMPLETED || ![
    FINANCIAL_PROJECTION_STATUS.PENDING,
    FINANCIAL_PROJECTION_STATUS.FAILED
  ].includes(intent.projectionStatus)) {
    throw new Error('FINANCIAL_PROJECTION_RETRY_NOT_AVAILABLE');
  }

  try {
    return await runFinancialProjectionUnderLease({
      intentId,
      actorHandle: handle,
      project,
      leaseMs
    });
  } catch (error) {
    if (error?.code === 'FINANCIAL_RECOVERY_LEASE_HELD' || error?.message === 'FINANCIAL_RECOVERY_LEASE_HELD') {
      return { intentId, outcome: 'lease_held' };
    }
    throw error;
  }
};
