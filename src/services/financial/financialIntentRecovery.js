import {
  FINANCIAL_INTENT_STATUS,
  FINANCIAL_PROJECTION_STATUS,
  assertFinancialIntentRecoveryAuthority,
  claimFinancialIntentRecovery,
  executePreparedFinancialIntentForRecovery,
  getFinancialIntent,
  getFinancialIntentReceiptForRecovery,
  releaseFinancialIntentRecoveryClaim,
  updateFinancialIntentForRecovery
} from './financialIntentLedger';
import { applyFinancialProjection } from './financialProjectionRegistry';

const receiptStatus = (receipt) => String(receipt?.status || '').toUpperCase();

const completedPayload = (receipt) => receipt?.result || receipt?.response || receipt;

const persistReceipt = async ({ intentId, actorHandle, receipt, status, code = null }) => (
  updateFinancialIntentForRecovery(intentId, {
    status,
    lastReceiptStatus: receiptStatus(receipt) || status,
    lastProtocolCode: code || receipt?.code || null,
    ...(status === FINANCIAL_INTENT_STATUS.COMPLETED
      ? { responsePayload: completedPayload(receipt), completedAt: new Date().toISOString() }
      : {})
  }, actorHandle)
);

const recoverProjectionOnly = async ({ intent, actorHandle, project = applyFinancialProjection }) => {
  if (![FINANCIAL_PROJECTION_STATUS.PENDING, FINANCIAL_PROJECTION_STATUS.FAILED].includes(intent.projectionStatus)) {
    return { intentId: intent.id, outcome: 'projection_not_required' };
  }
  try {
    await project({ intent, actorHandle });
    await updateFinancialIntentForRecovery(intent.id, {
      projectionStatus: FINANCIAL_PROJECTION_STATUS.APPLIED,
      projectionErrorCode: null,
      lastRecoveryCode: 'FINANCIAL_RECOVERY_PROJECTION_APPLIED'
    }, actorHandle);
    return { intentId: intent.id, outcome: 'projection_applied' };
  } catch (error) {
    await updateFinancialIntentForRecovery(intent.id, {
      projectionStatus: FINANCIAL_PROJECTION_STATUS.FAILED,
      projectionErrorCode: error?.code || 'FINANCIAL_RECOVERY_LOCAL_PROJECTION_FAILED',
      lastRecoveryCode: error?.code || 'FINANCIAL_RECOVERY_LOCAL_PROJECTION_FAILED'
    }, actorHandle);
    return { intentId: intent.id, outcome: 'projection_failed', error };
  }
};

/**
 * Receipt-first state machine for exactly one durable intent.  The only
 * execution edge is PREPARED + dispatchAttemptCount === 0 after NOT_FOUND.
 */
export const recoverFinancialIntent = async ({ intentId, licenseKey, actorHandle, project = applyFinancialProjection, leaseMs } = {}) => {
  let intent = await getFinancialIntent(intentId);
  if (!intent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(intent, actorHandle);

  if ([FINANCIAL_INTENT_STATUS.CONFLICT, FINANCIAL_INTENT_STATUS.BLOCKED].includes(intent.status)) {
    return { intentId, outcome: 'terminal_skipped' };
  }

  let claim;
  try {
    claim = await claimFinancialIntentRecovery({ intentId, actorHandle, leaseMs });
  } catch (error) {
    if (error?.code === 'FINANCIAL_RECOVERY_LEASE_HELD' || error?.message === 'FINANCIAL_RECOVERY_LEASE_HELD') {
      return { intentId, outcome: 'lease_held' };
    }
    throw error;
  }

  try {
    intent = await getFinancialIntent(intentId);
    assertFinancialIntentRecoveryAuthority(intent, actorHandle);

    if (intent.status === FINANCIAL_INTENT_STATUS.COMPLETED) {
      return recoverProjectionOnly({ intent, actorHandle, project });
    }
    if ([FINANCIAL_INTENT_STATUS.CONFLICT, FINANCIAL_INTENT_STATUS.BLOCKED].includes(intent.status)) {
      return { intentId, outcome: 'terminal_skipped' };
    }
    if (intent.status === FINANCIAL_INTENT_STATUS.PREPARED && Number(intent.dispatchAttemptCount || 0) > 0) {
      await updateFinancialIntentForRecovery(intentId, {
        status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
        lastRecoveryCode: 'FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE'
      }, actorHandle);
      return { intentId, outcome: 'inconsistent_prepared_receipt_required' };
    }

    let receipt;
    try {
      receipt = await getFinancialIntentReceiptForRecovery({ intent, licenseKey, actorHandle });
    } catch (error) {
      // An unavailable receipt never authorizes a dispatch.
      await updateFinancialIntentForRecovery(intentId, {
        lastRecoveryCode: error?.code || 'FINANCIAL_RECOVERY_RECEIPT_PENDING'
      }, actorHandle);
      return { intentId, outcome: 'receipt_unavailable', error };
    }

    switch (receiptStatus(receipt)) {
      case 'COMPLETED': {
        await persistReceipt({ intentId, actorHandle, receipt, status: FINANCIAL_INTENT_STATUS.COMPLETED });
        const completed = await getFinancialIntent(intentId);
        return recoverProjectionOnly({ intent: completed, actorHandle, project });
      }
      case 'PROCESSING':
        await persistReceipt({ intentId, actorHandle, receipt, status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT });
        return { intentId, outcome: 'receipt_processing' };
      case 'CONFLICT':
        await persistReceipt({ intentId, actorHandle, receipt, status: FINANCIAL_INTENT_STATUS.CONFLICT, code: 'IDEMPOTENCY_CONFLICT' });
        return { intentId, outcome: 'receipt_conflict' };
      case 'NOT_FOUND':
        if (intent.status === FINANCIAL_INTENT_STATUS.PREPARED && Number(intent.dispatchAttemptCount || 0) === 0) {
          const execution = await executePreparedFinancialIntentForRecovery({ intentId, licenseKey, actorHandle });
          const completed = await getFinancialIntent(intentId);
          const projection = await recoverProjectionOnly({ intent: completed, actorHandle, project });
          return { ...execution, outcome: 'first_dispatch', projection };
        }
        // An attempted request can be ambiguous even when a receipt currently
        // says NOT_FOUND.  It remains receipt-required; never resend it.
        await updateFinancialIntentForRecovery(intentId, {
          status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
          lastReceiptStatus: 'NOT_FOUND',
          lastRecoveryCode: 'FINANCIAL_RECOVERY_RECEIPT_NOT_FOUND_AFTER_ATTEMPT'
        }, actorHandle);
        return { intentId, outcome: 'receipt_not_found_no_resend' };
      default:
        await updateFinancialIntentForRecovery(intentId, {
          lastRecoveryCode: 'FINANCIAL_RECOVERY_RECEIPT_PENDING'
        }, actorHandle);
        return { intentId, outcome: 'receipt_unrecognized' };
    }
  } finally {
    if (claim) {
      try {
        await releaseFinancialIntentRecoveryClaim({ intentId, leaseId: claim.recoveryLeaseId, actorHandle });
      } catch {
        // A stale actor leaves the bounded lease to expire; it must not write.
      }
    }
  }
};
