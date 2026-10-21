import { getTenantRuntimeReadiness } from '../db/tenantRuntimeRouter';

export const ACTOR_RUNTIME_STATUS = Object.freeze({
  LOCKED: 'locked',
  AUTHENTICATING: 'authenticating',
  HANDOFF_CHECK: 'handoff_check',
  GRANTED: 'granted'
});

export const ACTOR_RUNTIME_ERROR_CODES = Object.freeze({
  CONTEXT_LOCKED: 'ACTOR_CONTEXT_LOCKED',
  CONTEXT_STALE: 'ACTOR_CONTEXT_STALE',
  IDENTITY_INVALID: 'ACTOR_IDENTITY_INVALID',
  SESSION_REQUIRED: 'ACTOR_SESSION_REQUIRED',
  TENANT_NOT_READY: 'ACTOR_TENANT_NOT_READY',
  TENANT_MISMATCH: 'ACTOR_TENANT_MISMATCH',
  HANDOFF_REQUIRED: 'ACTOR_HANDOFF_REQUIRED',
  PERMISSION_DENIED: 'ACTOR_PERMISSION_DENIED',
  DEVICE_REQUIRED: 'ACTOR_DEVICE_REQUIRED'
});

const ACTOR_TYPES = new Set(['admin', 'staff']);

export class ActorRuntimeError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ActorRuntimeError';
    this.code = code;
    this.details = details;
  }
}

export const isActorRuntimeError = (error) => (
  error instanceof ActorRuntimeError
  || String(error?.code || '').startsWith('ACTOR_')
);

const normalizeId = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
};

export const createActorKey = (actorType, actorId) => {
  const normalizedType = normalizeId(actorType);
  const normalizedId = normalizeId(actorId);
  if (!ACTOR_TYPES.has(normalizedType) || !normalizedId) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID);
  }
  return `${normalizedType}:${normalizedId}`;
};

const normalizePermissions = (actorType, permissions) => {
  if (actorType === 'admin') return Object.freeze(['*']);
  const grantedPermissions = Array.isArray(permissions)
    ? permissions
    : Object.entries(permissions || {})
      .filter(([, granted]) => granted === true)
      .map(([permission]) => permission);
  return Object.freeze([
    ...new Set(grantedPermissions.filter((permission) => (
      typeof permission === 'string' && permission.trim().length > 0
    )).map((permission) => permission.trim()))
  ]);
};

const cloneTenantBinding = (tenant) => tenant && Object.freeze({
  opaqueId: tenant.opaqueId,
  databaseName: tenant.databaseName,
  generation: tenant.generation
});

const cloneState = (state) => Object.freeze({
  status: state.status,
  actorType: state.actorType,
  actorId: state.actorId,
  actorKey: state.actorKey,
  sessionId: state.sessionId,
  permissions: Object.freeze([...state.permissions]),
  tenant: cloneTenantBinding(state.tenant),
  deviceRef: state.deviceRef,
  authorizationExpiresAt: state.authorizationExpiresAt || null,
  generation: state.generation,
  reason: state.reason
});

const defaultTenantAuthority = () => {
  const readiness = getTenantRuntimeReadiness();
  return readiness.ready && readiness.runtime ? readiness.runtime : null;
};

export const createActorRuntimeController = ({
  getTenantAuthority = defaultTenantAuthority,
  nowProvider = () => Date.now(),
  monotonicNowProvider = () => globalThis.performance?.now?.() ?? Date.now()
} = {}) => {
  const listeners = new Set();
  let state = {
    status: ACTOR_RUNTIME_STATUS.LOCKED,
    actorType: null,
    actorId: null,
    actorKey: null,
    sessionId: null,
    permissions: [],
    tenant: null,
    deviceRef: null,
    authorizationExpiresAt: null,
    generation: 0,
    reason: 'initial'
  };
  let authorizationClockAnchor = null;

  const publish = (nextState) => {
    state = nextState;
    const snapshot = cloneState(state);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Observers are never part of the actor authority boundary.
      }
    }
    return snapshot;
  };

  const expireAdminAuthorizationIfNeeded = () => {
    if (state.status !== ACTOR_RUNTIME_STATUS.GRANTED || state.actorType !== 'admin') return false;
    const wallNow = nowProvider();
    const monotonicNow = monotonicNowProvider();
    let effectiveNow = wallNow;
    if (authorizationClockAnchor) {
      const elapsed = Number.isFinite(monotonicNow) && Number.isFinite(authorizationClockAnchor.monotonicNow)
        ? Math.max(0, monotonicNow - authorizationClockAnchor.monotonicNow)
        : 0;
      effectiveNow = Math.max(wallNow, authorizationClockAnchor.effectiveNow + elapsed);
      authorizationClockAnchor = { effectiveNow, monotonicNow };
    }
    if (!Number.isFinite(state.authorizationExpiresAt) || effectiveNow < state.authorizationExpiresAt) return false;
    authorizationClockAnchor = null;
    publish({
      status: ACTOR_RUNTIME_STATUS.LOCKED,
      actorType: null,
      actorId: null,
      actorKey: null,
      sessionId: null,
      permissions: [],
      tenant: null,
      deviceRef: null,
      authorizationExpiresAt: null,
      generation: state.generation + 1,
      reason: 'admin_offline_authorization_expired'
    });
    return true;
  };

  const requireTenantAuthority = (expectedOpaqueId = null) => {
    const tenant = getTenantAuthority?.() || null;
    if (!tenant?.opaqueId || !tenant?.databaseName || !Number.isFinite(tenant?.generation)) {
      throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.TENANT_NOT_READY);
    }
    if (expectedOpaqueId && tenant.opaqueId !== expectedOpaqueId) {
      throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.TENANT_MISMATCH, {
        expectedOpaqueId,
        actualOpaqueId: tenant.opaqueId
      });
    }
    return tenant;
  };

  const assertPermission = (snapshot, permission) => {
    if (!permission || snapshot.permissions.includes('*') || snapshot.permissions.includes(permission)) {
      return true;
    }
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.PERMISSION_DENIED, {
      actorKey: snapshot.actorKey,
      permission
    });
  };

  const controller = {
    getState() {
      expireAdminAuthorizationIfNeeded();
      return cloneState(state);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    beginAuthentication({ actorType, deviceRef = null } = {}) {
      expireAdminAuthorizationIfNeeded();
      if (!ACTOR_TYPES.has(actorType)) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID);
      }
      if (state.status === ACTOR_RUNTIME_STATUS.GRANTED) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.HANDOFF_REQUIRED, {
          actorKey: state.actorKey
        });
      }
      return publish({
        ...state,
        status: ACTOR_RUNTIME_STATUS.AUTHENTICATING,
        generation: state.generation + 1,
        actorType,
        actorId: null,
        actorKey: null,
        sessionId: null,
        permissions: [],
        tenant: null,
        deviceRef: deviceRef || null,
        authorizationExpiresAt: null,
        reason: 'authentication_started'
      });
    },

    beginHandoffCheck() {
      if (state.status !== ACTOR_RUNTIME_STATUS.AUTHENTICATING) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.HANDOFF_REQUIRED);
      }
      return publish({ ...state, status: ACTOR_RUNTIME_STATUS.HANDOFF_CHECK, reason: 'handoff_check' });
    },

    grant({
      actorType,
      actorId,
      sessionId,
      permissions = [],
      tenantOpaqueId = null,
      deviceRef = null,
      authorizationExpiresAt = null,
      authorizationNow = null
    } = {}) {
      if (![ACTOR_RUNTIME_STATUS.AUTHENTICATING, ACTOR_RUNTIME_STATUS.HANDOFF_CHECK].includes(state.status)) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.HANDOFF_REQUIRED);
      }
      if (state.actorType && state.actorType !== actorType) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.HANDOFF_REQUIRED);
      }
      const actorKey = createActorKey(actorType, actorId);
      const normalizedSessionId = normalizeId(sessionId);
      if (!normalizedSessionId) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED, { actorKey });
      }
      const tenant = requireTenantAuthority(tenantOpaqueId);
      const parsedAuthorizationExpiresAt = authorizationExpiresAt
        ? Date.parse(authorizationExpiresAt)
        : null;
      const currentAuthorizationTime = Math.max(
        nowProvider(),
        Number.isFinite(authorizationNow) ? authorizationNow : 0
      );
      if (actorType === 'admin'
        && (!Number.isFinite(parsedAuthorizationExpiresAt) || parsedAuthorizationExpiresAt <= currentAuthorizationTime)) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED, {
          reason: 'admin_offline_authorization_expired'
        });
      }
      authorizationClockAnchor = actorType === 'admin'
        ? { effectiveNow: currentAuthorizationTime, monotonicNow: monotonicNowProvider() }
        : null;
      return publish({
        status: ACTOR_RUNTIME_STATUS.GRANTED,
        actorType,
        actorId: normalizeId(actorId),
        actorKey,
        sessionId: normalizedSessionId,
        permissions: normalizePermissions(actorType, permissions),
        tenant: {
          opaqueId: tenant.opaqueId,
          databaseName: tenant.databaseName,
          generation: tenant.generation
        },
        deviceRef: deviceRef || state.deviceRef || null,
        authorizationExpiresAt: actorType === 'admin' ? parsedAuthorizationExpiresAt : null,
        generation: state.generation + 1,
        reason: 'authenticated_session_granted'
      });
    },

    refreshAdminAuthorization({ captured, authorizationExpiresAt, authorizationNow = null } = {}) {
      const current = controller.assertCurrent(captured);
      if (current.actorType !== 'admin') {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID);
      }
      const parsedAuthorizationExpiresAt = authorizationExpiresAt
        ? Date.parse(authorizationExpiresAt)
        : null;
      const currentAuthorizationTime = Math.max(
        nowProvider(),
        Number.isFinite(authorizationNow) ? authorizationNow : 0
      );
      if (!Number.isFinite(parsedAuthorizationExpiresAt) || parsedAuthorizationExpiresAt <= currentAuthorizationTime) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED, {
          reason: 'admin_offline_authorization_expired'
        });
      }
      authorizationClockAnchor = {
        effectiveNow: currentAuthorizationTime,
        monotonicNow: monotonicNowProvider()
      };
      return publish({
        ...state,
        authorizationExpiresAt: parsedAuthorizationExpiresAt,
        reason: 'admin_session_reverified'
      });
    },

    lock(reason = 'actor_locked') {
      authorizationClockAnchor = null;
      return publish({
        status: ACTOR_RUNTIME_STATUS.LOCKED,
        actorType: null,
        actorId: null,
        actorKey: null,
        sessionId: null,
        permissions: [],
        tenant: null,
        deviceRef: null,
        authorizationExpiresAt: null,
        generation: state.generation + 1,
        reason
      });
    },

    assertGranted(permission = null) {
      if (expireAdminAuthorizationIfNeeded()) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED, {
          reason: 'admin_offline_authorization_expired'
        });
      }
      if (state.status !== ACTOR_RUNTIME_STATUS.GRANTED) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_LOCKED);
      }
      const tenant = requireTenantAuthority(state.tenant?.opaqueId || null);
      if (
        tenant.generation !== state.tenant?.generation
        || tenant.databaseName !== state.tenant?.databaseName
      ) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
          capturedTenant: state.tenant,
          currentTenant: tenant
        });
      }
      const snapshot = cloneState(state);
      assertPermission(snapshot, permission);
      return snapshot;
    },

    capture(permission = null) {
      const captured = controller.assertGranted(permission);
      return Object.freeze({
        actorKey: captured.actorKey,
        actorType: captured.actorType,
        actorId: captured.actorId,
        sessionId: captured.sessionId,
        generation: captured.generation,
        tenant: captured.tenant,
        deviceRef: captured.deviceRef,
        assertCurrent(requiredPermission = permission) {
          return controller.assertCurrent({
            actorKey: captured.actorKey,
            sessionId: captured.sessionId,
            generation: captured.generation,
            tenant: captured.tenant,
            deviceRef: captured.deviceRef
          }, requiredPermission);
        }
      });
    },

    assertCurrent(captured, permission = null) {
      if (expireAdminAuthorizationIfNeeded()) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED, {
          reason: 'admin_offline_authorization_expired'
        });
      }
      if (
        state.status !== ACTOR_RUNTIME_STATUS.GRANTED
        || captured?.generation !== state.generation
        || captured?.actorKey !== state.actorKey
        || captured?.sessionId !== state.sessionId
        || captured?.deviceRef !== state.deviceRef
      ) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
          capturedGeneration: captured?.generation ?? null,
          currentGeneration: state.generation
        });
      }
      const tenant = requireTenantAuthority(captured?.tenant?.opaqueId || null);
      if (
        tenant.generation !== captured?.tenant?.generation
        || tenant.databaseName !== captured?.tenant?.databaseName
      ) {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
          capturedTenant: captured?.tenant || null,
          currentTenant: tenant
        });
      }
      const snapshot = cloneState(state);
      assertPermission(snapshot, permission);
      return snapshot;
    }
  };

  return controller;
};

/**
 * Execute async actor-sensitive work with an immutable captured handle.
 *
 * The helper checks the handle before and after the async operation. Writes that
 * can happen after an await MUST be performed through guardedWrite(); that is
 * the effective side-effect boundary and revalidates actor generation, session,
 * permissions and tenant binding immediately before invoking the write callback.
 */
export const runWithActorHandle = async (handle, operation, permission = null) => {
  if (!handle || typeof handle.assertCurrent !== 'function' || typeof operation !== 'function') {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE);
  }

  const assertCurrent = (requiredPermission = permission) => handle.assertCurrent(requiredPermission);
  const guardedWrite = (write, requiredPermission = permission) => {
    if (typeof write !== 'function') {
      throw new TypeError('guardedWrite requires a write callback');
    }
    const currentActor = assertCurrent(requiredPermission);
    return write(currentActor);
  };

  assertCurrent();
  const result = await operation(Object.freeze({ assertCurrent, guardedWrite }));
  assertCurrent();
  return result;
};

export const actorRuntimeController = createActorRuntimeController();
