import { getActiveTenantRuntime } from '../db/tenantRuntimeRouter';
import {
  LOCAL_TENANT_STATUS,
  areLocalTenantAliasesCompatible,
  isTenantWorkerDatabaseName,
  localTenantAccessController
} from './localTenantPolicy';

// Worker database names are produced exclusively by tenantRuntimeRouter.  Do
// not relax this to a generic Dexie name: that would make the legacy vault a
// normal runtime target again.
export { isTenantWorkerDatabaseName } from './localTenantPolicy';

export const captureActiveTenantWorkerContext = () => {
  const tenant = localTenantAccessController.getState();
  const runtime = getActiveTenantRuntime();
  if (
    tenant.status !== LOCAL_TENANT_STATUS.GRANTED
    || !runtime
    || !isTenantWorkerDatabaseName(runtime.databaseName)
    || !Array.isArray(tenant.identities)
    || tenant.identities.length === 0
  ) {
    throw new Error('LOCAL_TENANT_WORKER_CONTEXT_REQUIRED');
  }

  return Object.freeze({
    databaseName: runtime.databaseName,
    generation: runtime.generation,
    tenantAliases: [...tenant.identities]
  });
};

export const isActiveTenantWorkerContext = (context) => {
  if (!context || !isTenantWorkerDatabaseName(context.databaseName)) return false;
  const tenant = localTenantAccessController.getState();
  const runtime = getActiveTenantRuntime();
  return tenant.status === LOCAL_TENANT_STATUS.GRANTED
    && runtime?.databaseName === context.databaseName
    && runtime?.generation === context.generation
    && areLocalTenantAliasesCompatible(tenant.identities, context.tenantAliases);
};
