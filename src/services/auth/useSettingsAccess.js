import { useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  ACTOR_RUNTIME_ERROR_CODES,
  ActorRuntimeError,
  actorRuntimeController
} from './actorRuntimeController';
import { evaluateSettingsAccess } from './settingsAccessPolicy';
import { useActorRuntimeSnapshot } from './useActorRuntimeSnapshot';

const readCurrentSettingsAccess = (isDev) => {
  const state = useAppStore.getState();
  return evaluateSettingsAccess({
    runtimeSnapshot: actorRuntimeController.getState(),
    currentDeviceRole: state.currentDeviceRole,
    currentAdminUser: state.currentAdminUser,
    currentStaffUser: state.currentStaffUser,
    isDev
  });
};

export const useSettingsAccess = () => {
  const runtimeSnapshot = useActorRuntimeSnapshot();
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentAdminUser = useAppStore((state) => state.currentAdminUser);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);

  return useMemo(() => evaluateSettingsAccess({
    runtimeSnapshot,
    currentDeviceRole,
    currentAdminUser,
    currentStaffUser,
    isDev: import.meta.env.DEV
  }), [currentAdminUser, currentDeviceRole, currentStaffUser, runtimeSnapshot]);
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

    const runtimeHandle = actorRuntimeController.capture(permission);
    if (
      runtimeHandle.actorKey !== access.actorKey
      || runtimeHandle.generation !== access.generation
    ) {
      throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE);
    }

    const assertCurrent = (requiredPermission = permission) => {
      const runtime = runtimeHandle.assertCurrent(requiredPermission);
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
