import { useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  ACTOR_RUNTIME_ERROR_CODES,
  ActorRuntimeError,
  actorRuntimeController
} from './actorRuntimeController';
import {
  evaluateSettingsAccess,
  SETTINGS_LEGACY_PERMISSION_FALLBACKS
} from './settingsAccessPolicy';
import { readActorAccess } from './actorAccessPolicy';
import { useActorAccess } from './useActorAccess';

const settingsForActor = (access, isDev) => evaluateSettingsAccess({
  runtimeSnapshot: access.runtimeSnapshot,
  actorAccess: access,
  isDev
});

const readCurrentSettingsAccess = (isDev) => (
  settingsForActor(readActorAccess(useAppStore.getState()), isDev)
);

export const useSettingsAccess = () => {
  const access = useActorAccess();
  return useMemo(() => settingsForActor(access, import.meta.env.DEV), [access]);
};

/**
 * Capture the actor shown by the current render and revalidate both runtime and
 * app-store identity after every await. Old component/modal closures therefore
 * cannot adopt the next actor's authority.
 */
export const useSettingsActionGuard = () => {
  const access = useSettingsAccess();

  return useCallback((permission, { adminOnly = false } = {}) => {
    if (
      !access.isAuthorizedActor
      || !access.canAccessPermission(permission)
      || (adminOnly && !access.isAdmin)
    ) {
      throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.PERMISSION_DENIED, {
        permission,
        actorKey: access.actorKey
      });
    }

    const runtimePermissions = access.runtimeSnapshot?.permissions || [];
    const runtimePermission = [
      permission,
      ...(SETTINGS_LEGACY_PERMISSION_FALLBACKS[permission] || [])
    ].find((candidate) => runtimePermissions.includes(candidate)) || permission;
    const runtimeHandle = actorRuntimeController.capture(runtimePermission);
    if (
      runtimeHandle.actorKey !== access.actorKey
      || runtimeHandle.generation !== access.generation
    ) {
      throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE);
    }

    const assertCurrent = (requiredPermission = permission) => {
      const runtime = runtimeHandle.assertCurrent(runtimePermission);
      const currentAccess = readCurrentSettingsAccess(import.meta.env.DEV);
      if (
        !currentAccess.isAuthorizedActor
        || currentAccess.actorKey !== access.actorKey
        || currentAccess.generation !== access.generation
        || !currentAccess.canAccessPermission(requiredPermission)
        || (adminOnly && !currentAccess.isAdmin)
      ) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE);
      }
      return runtime;
    };

    return Object.freeze({ ...runtimeHandle, assertCurrent });
  }, [access]);
};

export default useSettingsAccess;
