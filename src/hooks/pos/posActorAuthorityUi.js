import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { classifyActorAuthorityError } from '../../services/auth/actorAuthorityErrors';
import { getActorAuthorityRecoverySnapshot, reportActorAuthorityError } from '../../services/auth/actorAuthorityRecovery';
import { showMessageModal } from '../../services/utils';

export const handlePosActorAuthorityError = (error, operation, options = {}) => {
  const classification = classifyActorAuthorityError(error, actorRuntimeController.getState?.());
  if (!classification) return null;
  const reported = reportActorAuthorityError(error, { operation, ...options });
  const recoveryRequired = Boolean(getActorAuthorityRecoverySnapshot()?.requiresReauthentication);
  if (!reported && classification.kind !== 'response_stale') {
    showMessageModal(classification.message, null, { type: 'warning' });
  }
  return { success: false, code: classification.code, recoveryRequired };
};

// UI callbacks always settle. Actor guards continue rejecting at their own
// boundary; only the caller turns a known rejection into a controlled result.
export const runPosActorUiOperation = async (operation, action, ...args) => {
  try {
    return await action(...args);
  } catch (error) {
    const authorityResult = handlePosActorAuthorityError(error, operation);
    if (authorityResult) return authorityResult;
    showMessageModal('No se pudo completar la operación. Revisa el pedido y vuelve a intentarlo.', null, { type: 'error' });
    return { success: false, code: 'POS_OPERATION_FAILED' };
  }
};
