import { createContextSnapshotGuard } from './contextSnapshotGuard';
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


export const createRecoveryContextGuard = (options = {}) => createContextSnapshotGuard({
  capture: getRuntimeSnapshot,
  ...options
});
