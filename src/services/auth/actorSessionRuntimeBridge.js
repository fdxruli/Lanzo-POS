import { db as tenantRuntimeDb, getTenantRuntimeReadiness } from '../db/tenantRuntimeRouter';
import { hydrateTenantStorageConsumers, resumeTenantStorageWrites } from '../tenant/tenantScopedStorage';
import {
  activateActorScopedStorage,
  invalidateActorScopedStorage,
  prepareActorScopedStorage,
  resumeActorScopedStorageWrites,
  subscribeActorScopedStorage,
  suspendActorScopedStorageWrites
} from './actorScopedStorage';
import {
  assertActorOperationalHandoffClear,
  configureActorOperationalPersistence,
  installActorOperationalHandoffGuards,
  rebindActorOperationalOwnership,
  refreshPersistedActorCheckoutOwnership
} from './actorOperationalHandoff';
import {
  actorRuntimeController,
  ActorRuntimeError,
  ACTOR_RUNTIME_ERROR_CODES,
  ACTOR_RUNTIME_STATUS,
  createActorKey
} from './actorRuntimeController';

export const ACTOR_SESSION_AMBIGUOUS = 'ACTOR_SESSION_AMBIGUOUS';

const SESSION_KEYS = Object.freeze({
  admin: Object.freeze({
    token: 'admin_session_token',
    sessionId: 'admin_session_id'
  }),
  staff: Object.freeze({
    token: 'staff_session_token',
    sessionId: 'staff_session_id'
  })
});

const readSyncCacheValue = async (key) => {
  // Read credentials through the authoritative tenant runtime proxy instead of
  // the historical database compatibility barrel. This keeps ActorRuntime on
  // the already-authorized LanzoDB_t_<opaque> and avoids importing unrelated
  // repositories/store modules into the authentication lifecycle.
  const record = await tenantRuntimeDb.table('sync_cache').get(key);
  return record?.value || null;
};

const readSessionEvidence = async () => {
  const [adminToken, adminSessionId, staffToken, staffSessionId] = await Promise.all([
    readSyncCacheValue(SESSION_KEYS.admin.token),
    readSyncCacheValue(SESSION_KEYS.admin.sessionId),
    readSyncCacheValue(SESSION_KEYS.staff.token),
    readSyncCacheValue(SESSION_KEYS.staff.sessionId)
  ]);

  return Object.freeze({
    admin: Object.freeze({ token: adminToken, sessionId: adminSessionId }),
    staff: Object.freeze({ token: staffToken, sessionId: staffSessionId })
  });
};

const assertUnambiguousSessionEvidence = (evidence) => {
  // Presence of both credential families is itself ambiguous. Do not infer an
  // actor from device_role, relative freshness or privilege level.
  if (evidence.admin.token && evidence.staff.token) {
    throw new ActorRuntimeError(ACTOR_SESSION_AMBIGUOUS, {
      adminSessionIdPresent: Boolean(evidence.admin.sessionId),
      staffSessionIdPresent: Boolean(evidence.staff.sessionId)
    });
  }
  return evidence;
};

export const resolveStableActorId = (actorType, actor = null) => {
  if (!SESSION_KEYS[actorType] || !actor || typeof actor !== 'object') return null;
  const candidates = actorType === 'admin'
    ? [actor.id, actor.admin_user_id, actor.user_id]
    : [actor.id, actor.staff_user_id, actor.user_id];
  const candidate = candidates.find((value) => (
    (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value))
  ));
  return candidate === null || candidate === undefined ? null : String(candidate).trim();
};

export const getExplicitActorPermissions = (actorType, actor = null) => {
  if (actorType === 'admin') return ['*'];
  const permissions = actor?.permissions;
  const grantedPermissions = Array.isArray(permissions)
    ? permissions
    : Object.entries(permissions || {})
      .filter(([, granted]) => granted === true)
      .map(([permission]) => permission);
  return [...new Set(grantedPermissions.filter((permission) => (
    typeof permission === 'string' && permission.trim().length > 0
  )).map((permission) => permission.trim()))];
};

export const readCurrentActorSessionCache = async () => (
  assertUnambiguousSessionEvidence(await readSessionEvidence())
);

export const readActorSessionBinding = async (actorType) => {
  const keys = SESSION_KEYS[actorType];
  if (!keys) throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID);

  const evidence = await readCurrentActorSessionCache();
  const selected = evidence[actorType];
  if (!selected?.token || !selected?.sessionId) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED, { actorType });
  }

  return Object.freeze({ actorType, sessionId: String(selected.sessionId) });
};

export const beginActorRuntimeAuthentication = (actorType) => (
  actorRuntimeController.beginAuthentication({ actorType })
);

const requireTenantRuntime = () => {
  const readiness = getTenantRuntimeReadiness();
  if (!readiness.ready || !readiness.runtime) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.TENANT_NOT_READY);
  }
  return readiness.runtime;
};

export const grantAuthenticatedActorRuntime = async ({
  actorType,
  actor,
  permissions = null
} = {}) => {
  const actorId = resolveStableActorId(actorType, actor);
  if (!actorId) throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID, { actorType });
  const binding = await readActorSessionBinding(actorType);
  const stateBeforeHandoff = actorRuntimeController.getState();
  if (stateBeforeHandoff.status !== ACTOR_RUNTIME_STATUS.AUTHENTICATING) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.HANDOFF_REQUIRED);
  }

  const tenant = requireTenantRuntime();
  const actorKey = createActorKey(actorType, actorId);
  const nextActorGeneration = stateBeforeHandoff.generation + 1;

  actorRuntimeController.beginHandoffCheck();
  try {
    // Durable checkout inspection must be available before any POS store is
    // mounted. Bind it directly to the already-authorized tenant runtime proxy;
    // do not import UI/store modules into the authentication authority.
    configureActorOperationalPersistence({
      db: tenantRuntimeDb,
      salesStore: 'sales'
    });
    await installActorOperationalHandoffGuards();
    // Checkout ownership is also recorded on the tenant-shared SALES row so a
    // browser restart cannot erase the safety barrier. Legacy locked rows with
    // no actor proof remain unresolved and block handoff fail-closed.
    await refreshPersistedActorCheckoutOwnership({ tenant });
    assertActorOperationalHandoffClear({ tenant, actorKey });

    // Preparation is read-only with respect to actor payloads. Legacy tenant-
    // scoped cart/draft state may be detected here, but is never mounted or
    // attributed to the actor that happens to authenticate first.
    await prepareActorScopedStorage({
      tenant,
      actorKey,
      actorGeneration: nextActorGeneration
    });

    // ActiveOrders is the registered tenant storage consumer today. Rehydrate
    // while actor writes remain suspended so the previous actor's in-memory
    // session is replaced before GRANTED.
    await hydrateTenantStorageConsumers();

    const granted = actorRuntimeController.grant({
      actorType,
      actorId,
      sessionId: binding.sessionId,
      permissions: permissions ?? getExplicitActorPermissions(actorType, actor),
      tenantOpaqueId: tenant.opaqueId
    });

    // A checkout can survive a same-actor reauthentication, but its immutable
    // ownership must bind to the new actor generation before writes resume.
    rebindActorOperationalOwnership({
      actorKey,
      tenant,
      handle: actorRuntimeController.capture()
    });
    activateActorScopedStorage(granted);
    resumeActorScopedStorageWrites();
    // The actor hydrator uses the existing tenant transition suspension helper;
    // restore tenant-shared browser writes only after the handoff succeeded.
    resumeTenantStorageWrites();
    return granted;
  } catch (error) {
    suspendActorScopedStorageWrites();
    invalidateActorScopedStorage('actor_handoff_failed');
    if (actorRuntimeController.getState().status !== ACTOR_RUNTIME_STATUS.LOCKED) {
      actorRuntimeController.lock('actor_handoff_failed');
    }
    throw error;
  }
};

/**
 * Restore the actor authority only when the tenant cache contains one
 * unambiguous credential family. This intentionally does not delete either
 * credential family when ambiguity is detected; cleanup belongs to explicit
 * authentication/logout contracts, not identity selection.
 */
export const restoreActorRuntimeFromCurrentSessionCache = async ({
  actorType,
  actor,
  permissions = null
} = {}) => {
  try {
    await readCurrentActorSessionCache();
    return await grantAuthenticatedActorRuntime({ actorType, actor, permissions });
  } catch (error) {
    if (actorRuntimeController.getState().status !== ACTOR_RUNTIME_STATUS.LOCKED) {
      lockActorRuntime(
        error?.code === ACTOR_SESSION_AMBIGUOUS
          ? 'ambiguous_actor_session_evidence'
          : `${actorType || 'unknown'}_session_restore_failed`
      );
    }
    throw error;
  }
};

export const lockActorRuntime = (reason = 'actor_locked') => {
  suspendActorScopedStorageWrites();
  const locked = actorRuntimeController.lock(reason);
  invalidateActorScopedStorage(reason);
  return locked;
};

// A second tab on the same tenant may complete the handoff first. Its durable
// actor context token invalidates this tab's storage handle. Lock only this
// tab's ActorRuntime: publishing another storage context here would invalidate
// the newly granted actor in the other tab and create a cross-tab ping-pong.
subscribeActorScopedStorage((event) => {
  if (event?.type !== 'foreign_context') return;
  const state = actorRuntimeController.getState();
  if (state.status !== ACTOR_RUNTIME_STATUS.GRANTED) return;
  if (state.tenant?.opaqueId !== event.tenantOpaqueId) return;
  suspendActorScopedStorageWrites();
  actorRuntimeController.lock('actor_context_changed_in_other_tab');
});
