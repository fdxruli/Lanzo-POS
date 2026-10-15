import { actorRuntimeController } from '../auth/actorRuntimeController';
import { getTenantRuntimeReadiness } from '../db/tenantRuntimeRouter';

const getRuntimeSnapshot = () => {
  const actor = actorRuntimeController.getState();
  const tenantReadiness = getTenantRuntimeReadiness();
  const tenant = tenantReadiness?.runtime || null;

  return Object.freeze({
    actorStatus: actor?.status || 'unknown',
    actorKey: actor?.actorKey || null,
    sessionId: actor?.sessionId || null,
    actorGeneration: Number.isFinite(actor?.generation) ? actor.generation : null,
    tenantReady: tenantReadiness?.ready === true,
    tenantOpaqueId: tenant?.opaqueId || null,
    tenantDatabaseName: tenant?.databaseName || null,
    tenantGeneration: Number.isFinite(tenant?.generation) ? tenant.generation : null
  });
};

const sameSnapshot = (left, right) => (
  left?.actorStatus === right?.actorStatus
  && left?.actorKey === right?.actorKey
  && left?.sessionId === right?.sessionId
  && left?.actorGeneration === right?.actorGeneration
  && left?.tenantReady === right?.tenantReady
  && left?.tenantOpaqueId === right?.tenantOpaqueId
  && left?.tenantDatabaseName === right?.tenantDatabaseName
  && left?.tenantGeneration === right?.tenantGeneration
);

/**
 * Captures actor/session and tenant generations in memory for recovery guards.
 * The values are never serialized into support reports or console entries.
 */
export const createRecoveryContextGuard = ({
  capture = getRuntimeSnapshot,
  compare = sameSnapshot
} = {}) => {
  let captured;
  try {
    captured = capture();
  } catch {
    captured = null;
  }

  return () => {
    if (!captured) return false;
    try {
      return compare(captured, capture());
    } catch {
      return false;
    }
  };
};
