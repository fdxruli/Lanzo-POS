// RESEARCH ONLY. A policy model, not authentication, attestation or product API.
// No production caller can obtain an enforcement witness from this module.
export const admissionDecision = ({ storage = 'available', actor = 'current',
  pending = false, knownLegacy = false, verifiedBoundary = false } = {}) => {
  if (actor !== 'current') return { state: 'ADMISSION_REJECTED', code: 'ACTOR_INVALID' };
  if (storage !== 'available') return { state: 'ADMISSION_RESTRICTED', code: 'STORAGE_UNAVAILABLE' };
  if (pending) return { state: 'RECOVERY_REQUIRED', code: 'PENDING_ORIGIN_PRESERVED' };
  if (knownLegacy) return { state: 'ADMISSION_RESTRICTED', code: 'LEGACY_DETECTED' };
  // verifiedBoundary is a synthetic assumption used only to test downstream
  // participants. This phase supplies NO real verifier that can set it true.
  if (verifiedBoundary !== true) return { state: 'ADMISSION_RESTRICTED', code: 'EXCLUSIVITY_UNPROVEN' };
  return { state: 'ADMISSION_GRANTED', code: 'SYNTHETIC_BOUNDARY_ASSUMED' };
};

// Durable origin, payload fingerprint and receipt are separate from executor.
// Models a server receipt lookup; never dispatches a payment or changes owner.
export const recoveryDecision = ({ intent, receipt, executor }) => {
  if (!intent || !executor || executor.tenant !== intent.origin.tenant
    || executor.actor !== intent.origin.actor || executor.device !== intent.origin.device) {
    return { action: 'DENY', code: 'RECOVERY_ORIGIN_MISMATCH' };
  }
  if (!receipt || receipt.status === 'UNAVAILABLE' || receipt.status === 'PROCESSING') {
    return { action: 'PRESERVE', code: 'RESULT_AMBIGUOUS' };
  }
  if (receipt.status === 'COMPLETED') {
    if (receipt.key !== intent.key || receipt.hash !== intent.hash) return { action: 'DENY', code: 'RECEIPT_MISMATCH' };
    return { action: 'PROJECT_EXISTING', origin: intent.origin, receiptId: receipt.id };
  }
  if (receipt.status === 'NOT_FOUND' && intent.attempts === 0 && intent.state === 'PREPARED') {
    return { action: 'REVIEW_FIRST_DISPATCH', key: intent.key, hash: intent.hash };
  }
  return { action: 'PRESERVE', code: 'NO_SAFE_REDISPATCH_PROOF' };
};
