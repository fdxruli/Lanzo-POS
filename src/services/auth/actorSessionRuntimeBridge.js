import { loadData, STORES } from '../database';
import {
  actorRuntimeController,
  ActorRuntimeError,
  ACTOR_RUNTIME_ERROR_CODES
} from './actorRuntimeController';

const SESSION_KEYS = Object.freeze({
  admin: Object.freeze({
    token: 'admin_session_token',
    sessionId: 'admin_session_id',
    oppositeToken: 'staff_session_token'
  }),
  staff: Object.freeze({
    token: 'staff_session_token',
    sessionId: 'staff_session_id',
    oppositeToken: 'admin_session_token'
  })
});

const readSyncCacheValue = async (key) => {
  const record = await loadData(STORES.SYNC_CACHE, key);
  return record?.value || null;
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
  return candidate == null ? null : String(candidate).trim();
};

export const getExplicitActorPermissions = (actorType, actor = null) => {
  if (actorType === 'admin') return ['*'];
  const permissions = actor?.permissions;
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.filter((permission) => (
    typeof permission === 'string' && permission.trim().length > 0
  )).map((permission) => permission.trim()))];
};

export const readActorSessionBinding = async (actorType) => {
  const keys = SESSION_KEYS[actorType];
  if (!keys) throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.IDENTITY_INVALID);

  const [selectedToken, sessionId, oppositeToken] = await Promise.all([
    readSyncCacheValue(keys.token),
    readSyncCacheValue(keys.sessionId),
    readSyncCacheValue(keys.oppositeToken)
  ]);

  // Even with an explicit actor type, a dual-token cache is an invalid handoff
  // state. Never allow a residual Admin credential to coexist with Staff
  // authority (or vice versa) and silently pick the more privileged token.
  if (selectedToken && oppositeToken) {
    throw new ActorRuntimeError('ACTOR_SESSION_AMBIGUOUS', { actorType });
  }
  if (!selectedToken || !sessionId) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED, { actorType });
  }

  return Object.freeze({ actorType, sessionId: String(sessionId) });
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

export const lockActorRuntime = (reason = 'actor_locked') => actorRuntimeController.lock(reason);
