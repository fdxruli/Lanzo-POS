export const resolveStableActorId = (actorType, actor = null) => {
  if (!['admin', 'staff'].includes(actorType) || !actor || typeof actor !== 'object') return null;
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

