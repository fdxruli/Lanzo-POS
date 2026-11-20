import { actorRuntimeController } from './actorRuntimeController';
import { isRecoverableTenantReadinessError } from './actorAuthorityErrors';
import { getExplicitActorPermissions, resolveStableActorId } from './actorIdentity';

const validId = (value) => (
  (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isFinite(value))
);

/** Identity agreement and explicit grants, extracted from Settings authority. */
export const evaluateActorAccess = ({
  runtimeSnapshot = null,
  currentDeviceRole = null,
  currentAdminUser = null,
  currentStaffUser = null
} = {}) => {
  const actorType = runtimeSnapshot?.actorType;
  const actor = actorType === 'admin' ? currentAdminUser : currentStaffUser;
  const actorId = resolveStableActorId(actorType, actor);
  const runtimeCheck = inspectActorSnapshot(runtimeSnapshot);
  const actorEvidenceMatchesRuntime = runtimeSnapshot?.status === 'granted'
    && ['admin', 'staff'].includes(actorType)
    && currentDeviceRole === actorType
    && validId(runtimeSnapshot.actorId)
    && validId(runtimeSnapshot.sessionId)
    && actorId !== null && actorId === String(runtimeSnapshot.actorId).trim();
  const isVerifyingAccess = Boolean(
    actorEvidenceMatchesRuntime
    && !runtimeCheck.current
    && runtimeCheck.tenantReadinessIncomplete
  );
  const currentRuntimeSnapshot = runtimeCheck.current ? runtimeSnapshot : null;
  const isAuthorizedActor = Boolean(currentRuntimeSnapshot && actorEvidenceMatchesRuntime);
  const runtimePermissions = new Set(getExplicitActorPermissions('staff', currentRuntimeSnapshot));
  const storePermissions = getExplicitActorPermissions('staff', actor);
  const permissions = Object.freeze(storePermissions.filter((permission) => runtimePermissions.has(permission)));
  const isAdmin = isAuthorizedActor && actorType === 'admin';
  const canAccessPermission = (permission) => (
    typeof permission === 'string' && permission.trim().length > 0
    && isAuthorizedActor && (isAdmin || permissions.includes(permission))
  );

  return Object.freeze({
    isAuthorizedActor,
    isVerifyingAccess,
    isAdmin,
    actorType: isAuthorizedActor ? actorType : null,
    actorId: isAuthorizedActor ? actorId : null,
    canAccessPermission,
    // Specialized report/AI policies retain their rules over validated authority.
    runtimeSnapshot: isAuthorizedActor
      ? Object.freeze({ ...runtimeSnapshot, permissions: isAdmin ? Object.freeze(['*']) : permissions })
      : null,
    // Category policies distinguish a missing legacy switch from an explicit denial.
    permissionSession: {
      currentDeviceRole: isAdmin ? 'admin' : 'staff',
      currentStaffUser: { permissions: Object.fromEntries([
        ...new Set([
          ...Object.keys(Array.isArray(actor?.permissions) ? {} : actor?.permissions || {}),
          ...Object.keys(Array.isArray(runtimeSnapshot?.permissions) ? {} : runtimeSnapshot?.permissions || {}),
          ...permissions
        ])
      ].map((key) => [key, canAccessPermission(key)])) }
    },
    ecommerceSession: isAuthorizedActor ? {
      currentDeviceRole: actorType,
      currentStaffUser: { permissions: Object.fromEntries(permissions.map((key) => [key, true])) }
    } : {}
  });
};

const inspectActorSnapshot = (snapshot) => {
  if (snapshot?.status !== 'granted') {
    return { current: false, tenantReadinessIncomplete: false };
  }
  try {
    actorRuntimeController.assertCurrent(snapshot);
    return { current: true, tenantReadinessIncomplete: false };
  } catch (error) {
    return {
      current: false,
      tenantReadinessIncomplete: isRecoverableTenantReadinessError(error)
    };
  }
};

/** Revalidate the captured generation, session, device and live tenant binding. */
export const isActorSnapshotCurrent = (snapshot) => {
  return inspectActorSnapshot(snapshot).current;
};

export const readActorAccess = (state, snapshot = actorRuntimeController.getState()) => (
  evaluateActorAccess({ ...state, runtimeSnapshot: snapshot })
);
