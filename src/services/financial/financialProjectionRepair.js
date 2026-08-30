import { actorRuntimeController } from '../auth/actorRuntimeController';
import {
  FINANCIAL_INTENT_STATUS,
  FINANCIAL_PROJECTION_STATUS,
  assertFinancialIntentRecoveryAuthority,
  claimFinancialIntentRecovery,
  getFinancialIntent,
  releaseFinancialIntentRecoveryClaim,
  updateFinancialIntentForRecovery
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
  let intent = await getFinancialIntent(intentId);
  if (!intent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  if (!FINANCIAL_OPERATION_LABELS[intent.operationType]) throw new Error('FINANCIAL_PROJECTION_RETRY_OPERATION_UNSUPPORTED');
  assertFinancialIntentRecoveryAuthority(intent, handle, { allowLegacyNullDevice: isProjectionRepair(intent) });
  if (intent.status !== FINANCIAL_INTENT_STATUS.COMPLETED || ![
    FINANCIAL_PROJECTION_STATUS.PENDING,
    FINANCIAL_PROJECTION_STATUS.FAILED
  ].includes(intent.projectionStatus)) {
    throw new Error('FINANCIAL_PROJECTION_RETRY_NOT_AVAILABLE');
  }

  let claim;
  try {
    claim = await claimFinancialIntentRecovery({ intentId, actorHandle: handle, leaseMs });
  } catch (error) {
    if (error?.code === 'FINANCIAL_RECOVERY_LEASE_HELD' || error?.message === 'FINANCIAL_RECOVERY_LEASE_HELD') {
      return { intentId, outcome: 'lease_held' };
    }
    throw error;
  }

  try {
    intent = await getFinancialIntent(intentId);
    assertFinancialIntentRecoveryAuthority(intent, handle, { allowLegacyNullDevice: isProjectionRepair(intent) });
    if (intent.status !== FINANCIAL_INTENT_STATUS.COMPLETED || ![
      FINANCIAL_PROJECTION_STATUS.PENDING,
      FINANCIAL_PROJECTION_STATUS.FAILED
    ].includes(intent.projectionStatus)) throw new Error('FINANCIAL_PROJECTION_RETRY_NOT_AVAILABLE');
    try {
      await project({ intent, actorHandle: handle });
      await updateFinancialIntentForRecovery(intentId, {
        projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED,
        projectionErrorCode: null,
        lastRecoveryCode: 'FINANCIAL_PROJECTION_RETRY_APPLIED'
      }, handle, { recoveryLeaseId: claim.recoveryLeaseId, expectedStatus: FINANCIAL_INTENT_STATUS.COMPLETED });
      return { intentId, outcome: 'projection_applied' };
    } catch (error) {
      await updateFinancialIntentForRecovery(intentId, {
        projectionStatus: FINANCIAL_PROJECTION_STATUS.FAILED,
        projectionErrorCode: error?.code || 'FINANCIAL_RECOVERY_LOCAL_PROJECTION_FAILED',
        lastRecoveryCode: error?.code || 'FINANCIAL_RECOVERY_LOCAL_PROJECTION_FAILED'
      }, handle, { recoveryLeaseId: claim.recoveryLeaseId, expectedStatus: FINANCIAL_INTENT_STATUS.COMPLETED });
      return { intentId, outcome: 'projection_failed', error };
    }
  } finally {
    if (claim) {
      try {
        await releaseFinancialIntentRecoveryClaim({ intentId, leaseId: claim.recoveryLeaseId, actorHandle: handle });
      } catch {
        // A stale handle leaves its bounded claim for ordinary 5C reclamation.
      }
    }
  }
};
