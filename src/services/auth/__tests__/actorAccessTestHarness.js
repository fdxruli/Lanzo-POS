import { vi } from 'vitest';

const tenantBinding = vi.hoisted(() => ({
  current: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 }
}));

vi.mock('../../db/tenantRuntimeRouter', async (importOriginal) => ({
  ...await importOriginal(),
  getTenantRuntimeReadiness: () => ({ ready: Boolean(tenantBinding.current), runtime: tenantBinding.current })
}));

export const tenantState = tenantBinding;

import { actorRuntimeController } from '../actorRuntimeController';

export const grantTestActor = ({ actorType = 'staff', actorId = 'staff-a', permissions = [], sessionId } = {}) => {
  actorRuntimeController.lock('test_session_switch');
  actorRuntimeController.beginAuthentication({ actorType });
  return actorRuntimeController.grant({
    actorType, actorId, permissions,
    sessionId: sessionId || `${actorId}-session`,
    deviceRef: 'device-a',
    authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString()
  });
};
