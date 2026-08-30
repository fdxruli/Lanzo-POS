import { actorRuntimeController } from '../auth/actorRuntimeController';
import {
  FINANCIAL_INTENT_STATUS,
  assertFinancialIntentRecoveryAuthority,
  claimFinancialIntentRecovery,
  getFinancialIntent,
  getFinancialIntentReceiptForRecovery,
  releaseFinancialIntentRecoveryClaim,
  updateFinancialIntentForRecovery
} from './financialIntentLedger';
import { FINANCIAL_RECEIPT_CLASSIFICATION, classifyFinancialReceipt } from './financialReceiptClassifier';
import { FINANCIAL_OPERATION_LABELS } from './financialIntentDiagnostics';

const completedPayload = (receipt) => receipt?.result || receipt?.response || receipt;
const now = () => new Date().toISOString();

/**
 * A manual receipt lookup. It intentionally has no dependency on the 5C
 * recovery state machine or the financial execute RPC.
 */
export const refreshFinancialIntentReceipt = async ({ intentId, licenseKey, actorHandle = null, leaseMs } = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  let intent = await getFinancialIntent(intentId);
  if (!intent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  if (!FINANCIAL_OPERATION_LABELS[intent.operationType]) throw new Error('FINANCIAL_RECEIPT_RECONCILIATION_OPERATION_UNSUPPORTED');
  assertFinancialIntentRecoveryAuthority(intent, handle);
  if ([FINANCIAL_INTENT_STATUS.CONFLICT, FINANCIAL_INTENT_STATUS.BLOCKED].includes(intent.status)) {
    return { intentId, outcome: 'terminal_skipped' };
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
    assertFinancialIntentRecoveryAuthority(intent, handle);
    let receipt;
    try {
      receipt = await getFinancialIntentReceiptForRecovery({ intent, licenseKey, actorHandle: handle });
    } catch (error) {
      await updateFinancialIntentForRecovery(intentId, {
        lastRecoveryCode: error?.code || 'FINANCIAL_RECEIPT_REFRESH_UNAVAILABLE'
      }, handle, { recoveryLeaseId: claim.recoveryLeaseId });
      return { intentId, outcome: 'receipt_unavailable', error };
    }

    switch (classifyFinancialReceipt(receipt)) {
      case FINANCIAL_RECEIPT_CLASSIFICATION.COMPLETED:
        await updateFinancialIntentForRecovery(intentId, {
          status: FINANCIAL_INTENT_STATUS.COMPLETED,
          lastReceiptStatus: 'COMPLETED',
          lastProtocolCode: receipt?.code || null,
          lastRecoveryCode: 'FINANCIAL_RECEIPT_REFRESH_COMPLETED',
          responsePayload: completedPayload(receipt),
          completedAt: now()
        }, handle, { recoveryLeaseId: claim.recoveryLeaseId });
        return { intentId, outcome: 'receipt_completed' };
      case FINANCIAL_RECEIPT_CLASSIFICATION.PROCESSING:
        await updateFinancialIntentForRecovery(intentId, {
          status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
          lastReceiptStatus: 'PROCESSING',
          lastProtocolCode: receipt?.code || null,
          lastRecoveryCode: 'FINANCIAL_RECEIPT_REFRESH_PROCESSING'
        }, handle, { recoveryLeaseId: claim.recoveryLeaseId });
        return { intentId, outcome: 'receipt_processing' };
      case FINANCIAL_RECEIPT_CLASSIFICATION.CONFLICT:
        await updateFinancialIntentForRecovery(intentId, {
          status: FINANCIAL_INTENT_STATUS.CONFLICT,
          lastReceiptStatus: 'CONFLICT',
          lastProtocolCode: receipt?.code || 'IDEMPOTENCY_CONFLICT',
          lastRecoveryCode: 'FINANCIAL_RECEIPT_REFRESH_CONFLICT'
        }, handle, { recoveryLeaseId: claim.recoveryLeaseId });
        return { intentId, outcome: 'receipt_conflict' };
      case FINANCIAL_RECEIPT_CLASSIFICATION.NOT_FOUND:
        if (intent.status === FINANCIAL_INTENT_STATUS.PREPARED && Number(intent.dispatchAttemptCount || 0) === 0) {
          await updateFinancialIntentForRecovery(intentId, {
            lastReceiptStatus: 'NOT_FOUND',
            lastProtocolCode: receipt?.code || null,
            lastRecoveryCode: 'FINANCIAL_RECEIPT_REFRESH_NOT_FOUND_PREPARED'
          }, handle, { recoveryLeaseId: claim.recoveryLeaseId });
          return { intentId, outcome: 'receipt_not_found_prepared_no_dispatch' };
        }
        await updateFinancialIntentForRecovery(intentId, {
          status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
          lastReceiptStatus: 'NOT_FOUND',
          lastProtocolCode: receipt?.code || null,
          lastRecoveryCode: 'FINANCIAL_RECEIPT_REFRESH_NOT_FOUND_AFTER_ATTEMPT'
        }, handle, { recoveryLeaseId: claim.recoveryLeaseId });
        return { intentId, outcome: 'receipt_not_found_no_resend' };
      default:
        await updateFinancialIntentForRecovery(intentId, {
          lastReceiptStatus: receipt?.status || null,
          lastProtocolCode: receipt?.code || null,
          lastRecoveryCode: 'FINANCIAL_RECEIPT_REFRESH_UNRECOGNIZED'
        }, handle, { recoveryLeaseId: claim.recoveryLeaseId });
        return { intentId, outcome: 'receipt_unrecognized' };
    }
  } finally {
    if (claim) {
      try {
        await releaseFinancialIntentRecoveryClaim({ intentId, leaseId: claim.recoveryLeaseId, actorHandle: handle });
      } catch {
        // A switched actor must never write a late release into a new session.
      }
    }
  }
};
