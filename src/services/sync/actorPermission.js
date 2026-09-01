import { ACTOR_RUNTIME_STATUS, actorRuntimeController } from '../auth/actorRuntimeController';

export const hasActorPermission = (actorState, permission) => {
  const normalizedPermission = typeof permission === 'string' ? permission.trim() : '';
  if (!normalizedPermission || actorState?.status !== ACTOR_RUNTIME_STATUS.GRANTED) return false;

  const permissions = Array.isArray(actorState.permissions) ? actorState.permissions : [];
  return permissions.includes('*') || permissions.includes(normalizedPermission);
};

export const hasCurrentActorPermission = (permission) => (
  hasActorPermission(actorRuntimeController.getState(), permission)
);
