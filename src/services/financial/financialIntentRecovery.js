import {
  FINANCIAL_INTENT_STATUS,
  FINANCIAL_PROJECTION_STATUS,
  assertFinancialIntentRecoveryAuthority,
  assertFinancialIntentRetryEquivalence,
  claimFinancialIntentRecovery,
  executeBlockedFinancialIntentForRecovery,
  executePreparedFinancialIntentForRecovery,
  getFinancialIntent,
  getFinancialIntentReceiptForRecovery,
  isExplicitSaleFinancialRetry,
  releaseFinancialIntentRecoveryClaim,
  runFinancialProjectionUnderLease,
  updateFinancialIntentForRecovery
} from './financialIntentLedger';
import { applyFinancialProjection } from './financialProjectionRegistry';
import { FINANCIAL_RECEIPT_CLASSIFICATION, classifyFinancialReceipt } from './financialReceiptClassifier';

const completedPayload = (receipt) => receipt?.result || receipt?.response || receipt;
const receiptStatus = (receipt) => String(receipt?.status || '').toUpperCase();
const isProjectionRepair = (intent) => (
  intent?.status === FINANCIAL_INTENT_STATUS.COMPLETED
  && [FINANCIAL_PROJECTION_STATUS.PENDING, FINANCIAL_PROJECTION_STATUS.FAILED].includes(intent.projectionStatus)
);

const persistReceipt = async ({ intentId, actorHandle, receipt, status, code = null, recoveryLeaseId }) => (
  updateFinancialIntentForRecovery(intentId, {
    status,
    lastReceiptStatus: receiptStatus(receipt) || status,
    lastProtocolCode: code || receipt?.code || null,
    ...(status === FINANCIAL_INTENT_STATUS.COMPLETED
      ? { responsePayload: completedPayload(receipt), completedAt: new Date().toISOString() }
      : {})
  }, actorHandle, { recoveryLeaseId })
);

const recoverProjectionOnly = async ({ intent, actorHandle, project = applyFinancialProjection, recoveryLeaseId }) => {
  return runFinancialProjectionUnderLease({
    intentId: intent.id,
    actorHandle,
    project,
    recoveryLeaseId
  });
};

/**
 * Receipt-first state machine for exactly one durable intent. Background
 * recovery only executes the existing PREPARED + zero-attempt edge; the
 * BLOCKED redispatch edge is available only to an explicit sale retry.
 */
export const recoverFinancialIntent = async ({
  intentId,
  licenseKey,
  actorHandle,
  project = applyFinancialProjection,
  leaseMs,
  explicitRetry = false,
  candidateIntent = null
} = {}) => {
  let intent = await getFinancialIntent(intentId);
  if (!intent) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  assertFinancialIntentRecoveryAuthority(intent, actorHandle, {
    allowLegacyNullDevice: !explicitRetry && isProjectionRepair(intent)
  });

  if (explicitRetry) {
    if (!isExplicitSaleFinancialRetry(intent.operationType)) {
      throw new Error('FINANCIAL_RECOVERY_EXPLICIT_RETRY_UNSUPPORTED');
    }
    if (!candidateIntent) throw new Error('FINANCIAL_RECOVERY_RETRY_EVIDENCE_REQUIRED');
    assertFinancialIntentRetryEquivalence(intent, candidateIntent, actorHandle);
  }

  if (intent.status === FINANCIAL_INTENT_STATUS.CONFLICT || (
    intent.status === FINANCIAL_INTENT_STATUS.BLOCKED && !explicitRetry
  )) {
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
    assertFinancialIntentRecoveryAuthority(intent, actorHandle, {
      allowLegacyNullDevice: !explicitRetry && isProjectionRepair(intent)
    });
    if (explicitRetry) assertFinancialIntentRetryEquivalence(intent, candidateIntent, actorHandle);

    if (intent.status === FINANCIAL_INTENT_STATUS.COMPLETED) {
      return await recoverProjectionOnly({ intent, actorHandle, project, recoveryLeaseId: claim.recoveryLeaseId });
    }
    if (intent.status === FINANCIAL_INTENT_STATUS.CONFLICT || (
      intent.status === FINANCIAL_INTENT_STATUS.BLOCKED && !explicitRetry
    )) {
      return { intentId, outcome: 'terminal_skipped' };
    }
    if (intent.status === FINANCIAL_INTENT_STATUS.PREPARED && Number(intent.dispatchAttemptCount || 0) > 0) {
      await updateFinancialIntentForRecovery(intentId, {
        status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
        lastRecoveryCode: 'FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE'
      }, actorHandle, { recoveryLeaseId: claim.recoveryLeaseId, expectedStatus: FINANCIAL_INTENT_STATUS.PREPARED });
      return { intentId, outcome: 'inconsistent_prepared_receipt_required' };
    }

    let receipt;
    try {
      receipt = await getFinancialIntentReceiptForRecovery({ intent, licenseKey, actorHandle });
    } catch (error) {
      // An unavailable receipt never authorizes a dispatch.
      await updateFinancialIntentForRecovery(intentId, {
        lastRecoveryCode: error?.code || 'FINANCIAL_RECOVERY_RECEIPT_PENDING'
      }, actorHandle, { recoveryLeaseId: claim.recoveryLeaseId });
      return { intentId, outcome: 'receipt_unavailable', error };
    }

    switch (classifyFinancialReceipt(receipt)) {
      case FINANCIAL_RECEIPT_CLASSIFICATION.COMPLETED: {
        await persistReceipt({ intentId, actorHandle, receipt, status: FINANCIAL_INTENT_STATUS.COMPLETED, recoveryLeaseId: claim.recoveryLeaseId });
        const completed = await getFinancialIntent(intentId);
        return await recoverProjectionOnly({ intent: completed, actorHandle, project, recoveryLeaseId: claim.recoveryLeaseId });
      }
      case FINANCIAL_RECEIPT_CLASSIFICATION.PROCESSING:
        await persistReceipt({ intentId, actorHandle, receipt, status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT, recoveryLeaseId: claim.recoveryLeaseId });
        return { intentId, outcome: 'receipt_processing' };
      case FINANCIAL_RECEIPT_CLASSIFICATION.CONFLICT:
        await persistReceipt({ intentId, actorHandle, receipt, status: FINANCIAL_INTENT_STATUS.CONFLICT, code: 'IDEMPOTENCY_CONFLICT', recoveryLeaseId: claim.recoveryLeaseId });
        return { intentId, outcome: 'receipt_conflict' };
      case FINANCIAL_RECEIPT_CLASSIFICATION.NOT_FOUND:
        if (intent.status === FINANCIAL_INTENT_STATUS.PREPARED && Number(intent.dispatchAttemptCount || 0) === 0) {
          const execution = await executePreparedFinancialIntentForRecovery({ intentId, licenseKey, actorHandle, recoveryLeaseId: claim.recoveryLeaseId });
          const completed = await getFinancialIntent(intentId);
          const projection = await recoverProjectionOnly({ intent: completed, actorHandle, project, recoveryLeaseId: claim.recoveryLeaseId });
          return { ...execution, outcome: 'first_dispatch', projection };
        }
        if (intent.status === FINANCIAL_INTENT_STATUS.BLOCKED && explicitRetry) {
          const execution = await executeBlockedFinancialIntentForRecovery({
            intentId,
            licenseKey,
            actorHandle,
            recoveryLeaseId: claim.recoveryLeaseId
          });
          const completed = await getFinancialIntent(intentId);
          const projection = await recoverProjectionOnly({ intent: completed, actorHandle, project, recoveryLeaseId: claim.recoveryLeaseId });
          return { ...execution, outcome: 'blocked_redispatch', projection };
        }
        // An attempted request can be ambiguous even when a receipt currently
        // says NOT_FOUND.  It remains receipt-required; never resend it.
        await updateFinancialIntentForRecovery(intentId, {
          status: FINANCIAL_INTENT_STATUS.PENDING_RECEIPT,
          lastReceiptStatus: 'NOT_FOUND',
          lastRecoveryCode: 'FINANCIAL_RECOVERY_RECEIPT_NOT_FOUND_AFTER_ATTEMPT'
        }, actorHandle, { recoveryLeaseId: claim.recoveryLeaseId, expectedStatus: intent.status });
        return { intentId, outcome: 'receipt_not_found_no_resend' };
      default:
        await updateFinancialIntentForRecovery(intentId, {
          lastRecoveryCode: 'FINANCIAL_RECOVERY_RECEIPT_PENDING'
        }, actorHandle, { recoveryLeaseId: claim.recoveryLeaseId });
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

const explicitRetryFailure = ({ intent, result }) => {
  if (result?.outcome === 'lease_held') return 'FINANCIAL_RECOVERY_LEASE_HELD';
  if (intent?.status === FINANCIAL_INTENT_STATUS.CONFLICT || result?.outcome === 'receipt_conflict') {
    return 'IDEMPOTENCY_CONFLICT';
  }
  if (
    intent?.status === FINANCIAL_INTENT_STATUS.PENDING_RECEIPT
    || ['receipt_processing', 'receipt_not_found_no_resend', 'inconsistent_prepared_receipt_required'].includes(result?.outcome)
  ) {
    return 'FINANCIAL_RECOVERY_RECEIPT_PENDING';
  }
  if (result?.outcome === 'receipt_unavailable' || result?.outcome === 'receipt_unrecognized') {
    return 'FINANCIAL_RECOVERY_RECEIPT_UNAVAILABLE';
  }
  return 'FINANCIAL_RECOVERY_RETRY_NOT_COMPLETED';
};

/**
 * Entry point used only by an explicit high-level sale retry after the strict
 * allocator reports that the stable K already has a durable owner.
 */
export const retryExistingFinancialIntentExplicitly = async ({
  intentId,
  candidateIntent,
  licenseKey,
  actorHandle,
  project = applyFinancialProjection,
  leaseMs
} = {}) => {
  const initial = await getFinancialIntent(intentId);
  if (!initial) throw new Error('FINANCIAL_INTENT_NOT_FOUND');
  if (!['sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split', 'sale.layaway_complete'].includes(initial.operationType)) {
    throw new Error('FINANCIAL_RECOVERY_EXPLICIT_RETRY_UNSUPPORTED');
  }
  assertFinancialIntentRetryEquivalence(initial, candidateIntent, actorHandle);

  const result = await recoverFinancialIntent({
    intentId,
    licenseKey,
    actorHandle,
    project,
    leaseMs,
    explicitRetry: true,
    candidateIntent
  });
  const intent = await getFinancialIntent(intentId);
  if (intent?.status === FINANCIAL_INTENT_STATUS.COMPLETED && intent.responsePayload) {
    return { ...result, intentId, intent, response: intent.responsePayload };
  }

  const code = explicitRetryFailure({ intent, result });
  const error = new Error(code);
  error.code = code;
  error.recovery = result;
  throw error;
};
