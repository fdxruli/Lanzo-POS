import { actorRuntimeController, ACTOR_RUNTIME_STATUS } from './actorRuntimeController';
import {
  invalidateActorScopedStorage,
  suspendActorScopedStorageWrites
} from './actorScopedStorage';
import { classifyActorAuthorityError } from './actorAuthorityErrors';

const listeners = new Set();
let recovery = null;
let previousRuntime = actorRuntimeController.getState();
let reportedOperation = null;

const publish = (snapshot) => {
  recovery = snapshot && Object.freeze(snapshot);
  for (const listener of listeners) {
    try { listener(recovery); } catch { /* observers do not grant authority */ }
  }
};

export const getActorAuthorityRecoverySnapshot = () => recovery;
export const subscribeActorAuthorityRecovery = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const clearActorAuthorityRecovery = () => publish(null);

const createRecoverySnapshot = (classification, options = {}, runtime = previousRuntime) => ({
  kind: classification.kind,
  reason: classification.reason,
  actorType: classification.actorType || runtime?.actorType || recovery?.actorType || null,
  message: (options.durableSaveSucceeded || recovery?.durableSaveSucceeded)
    ? 'La mesa quedó guardada. Vuelve a iniciar sesión para continuar operándola.'
    : classification.message,
  durableSaveSucceeded: Boolean(options.durableSaveSucceeded || recovery?.durableSaveSucceeded),
  operation: options.operation || recovery?.operation || null,
  requiresReauthentication: true
});

/** Publish a login requirement without clearing any tenant/actor payloads. */
export const reportActorAuthorityError = (error, options = {}) => {
  const runtime = actorRuntimeController.getState();
  if (runtime.status === ACTOR_RUNTIME_STATUS.LOCKED
    && /logged_out|license_session_cleared|return_to_license_access_choice/.test(runtime.reason || '')) return false;
  const classification = classifyActorAuthorityError(error, {
    ...runtime,
    actorType: runtime.actorType || recovery?.actorType || previousRuntime.actorType
  });
  if (classification?.kind === 'device_blocked' || classification?.kind === 'cloning_detected') {
    suspendActorScopedStorageWrites();
    if (runtime.status !== ACTOR_RUNTIME_STATUS.LOCKED || runtime.reason !== classification.reason) {
      actorRuntimeController.lock(classification.reason, { operation: options.operation || null });
      invalidateActorScopedStorage(classification.reason);
    }
    clearActorAuthorityRecovery();
    return false;
  }
  if (!classification?.requiresReauthentication) return false;
  if (classification.kind === 'logout') return false;
  // A rejected immutable handle from a previous session must stay rejected,
  // while the newly authenticated actor keeps its independently valid grant.
  if (classification.kind === 'stale_actor'
    && runtime.status === ACTOR_RUNTIME_STATUS.GRANTED
    && Number.isFinite(error?.details?.capturedGeneration)
    && error.details.capturedGeneration !== runtime.generation) return true;

  const snapshot = createRecoverySnapshot(classification, options, runtime);
  suspendActorScopedStorageWrites();
  if (runtime.status !== ACTOR_RUNTIME_STATUS.LOCKED) {
    reportedOperation = options.operation || null;
    actorRuntimeController.lock(classification.reason, { operation: reportedOperation });
    reportedOperation = null;
    // A foreign tab has already published the current context. Do not publish
    // an invalidation back to it, which would create a context ping-pong.
    if (classification.kind !== 'foreign_tab') invalidateActorScopedStorage(classification.reason);
  }
  publish(snapshot);
  return true;
};

/** Called only after authenticated handoff, hydration and storage activation. */
export const completeActorAuthorityRecovery = () => {
  if (actorRuntimeController.getState().status === ACTOR_RUNTIME_STATUS.GRANTED) clearActorAuthorityRecovery();
};

actorRuntimeController.subscribe((runtime) => {
  const previous = previousRuntime;
  previousRuntime = runtime;
  if (runtime.status !== ACTOR_RUNTIME_STATUS.LOCKED) return;
  const classification = classifyActorAuthorityError({ code: 'ACTOR_CONTEXT_LOCKED' }, {
    ...runtime, actorType: previous.actorType || recovery?.actorType || null
  });
  if (classification?.kind === 'logout' || /logged_out|license_session_cleared|return_to_license_access_choice/.test(runtime.reason || '')) {
    clearActorAuthorityRecovery();
    return;
  }
  if (/license_(?:plan_blocked|validation_fatal|renewal_required)|offline_license_expired/.test(runtime.reason || '')) return;
  // Recover only known authority-loss transitions. Initial/bootstrap locks
  // retain their existing screens; a later guarded caller may report them.
  if (previous.status !== ACTOR_RUNTIME_STATUS.GRANTED || !classification?.requiresReauthentication) return;
  suspendActorScopedStorageWrites();
  publish(createRecoverySnapshot(classification, { operation: reportedOperation }, previous));
});
