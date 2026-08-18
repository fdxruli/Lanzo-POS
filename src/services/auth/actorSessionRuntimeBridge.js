import { db as tenantRuntimeDb } from '../db/tenantRuntimeRouter';
import {
  actorRuntimeController,
  ActorRuntimeError,
  ACTOR_RUNTIME_ERROR_CODES
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
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.filter((permission) => (
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

export const grantAuthenticatedActorRuntime = async ({
  actorType,
  actor,
  permissions = null
} = {}) => {
  const actorId = resolveStableActorId(actorType, actor);
  if (!actorId) throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID, { actorType });
  const binding = await readActorSessionBinding(actorType);
  return actorRuntimeController.grant({
    actorType,
    actorId,
    sessionId: binding.sessionId,
    permissions: permissions ?? getExplicitActorPermissions(actorType, actor)
  });
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
    actorRuntimeController.lock(
      error?.code === ACTOR_SESSION_AMBIGUOUS
        ? 'ambiguous_actor_session_evidence'
        : `${actorType || 'unknown'}_session_restore_failed`
    );
    throw error;
  }
};

export const lockActorRuntime = (reason = 'actor_locked') => actorRuntimeController.lock(reason);
