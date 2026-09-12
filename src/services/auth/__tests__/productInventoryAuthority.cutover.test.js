import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  class TestActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }
  return {
    TestActorRuntimeError,
    state: null,
    tenant: null,
    actor: null,
    assertGranted: vi.fn(),
    capture: vi.fn()
  };
});

vi.mock('../actorRuntimeController', () => ({
  ACTOR_RUNTIME_ERROR_CODES: {
    CONTEXT_LOCKED: 'ACTOR_CONTEXT_LOCKED',
    CONTEXT_STALE: 'ACTOR_CONTEXT_STALE',
    PERMISSION_DENIED: 'ACTOR_PERMISSION_DENIED'
  },
  ActorRuntimeError: runtime.TestActorRuntimeError,
  actorRuntimeController: {
    assertGranted: runtime.assertGranted,
    capture: runtime.capture
  }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => runtime.state }
}));

vi.mock('../../db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: runtime.tenant })
}));

import {
  assertProductInventoryMutationCurrent,
  assertProductInventoryOperationActorCurrent,
  captureProductInventoryMutation
} from '../productInventoryAuthority';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../../sync/syncConstants';

const proLicense = () => ({
  license_key: 'LANZO-CUTOVER',
  valid: true,
  plan_code: 'pro_monthly',
  max_devices: 2,
  device_role: 'admin',
  features: { cloud_pos_sync: true, cloud_products_sync: true, staff_roles: true }
});

const freeLicense = () => ({
  license_key: 'LANZO-CUTOVER',
  valid: true,
  plan_code: 'free_trial',
  max_devices: 1,
  device_role: 'admin',
  features: { cloud_pos_sync: false, cloud_products_sync: false, staff_roles: false }
});

beforeEach(() => {
  vi.clearAllMocks();
  runtime.tenant = {
    opaqueId: 'tenant-cutover',
    databaseName: 'LanzoDB_tenant-cutover',
    generation: 9
  };
  runtime.state = {
    appStatus: 'ready',
    licenseDetails: proLicense(),
    currentDeviceRole: 'admin',
    currentStaffUser: null
  };
  runtime.actor = {
    actorType: 'admin',
    actorId: 'admin-cutover',
    actorKey: 'admin:admin-cutover',
    sessionId: 'session-cutover',
    generation: 12,
    permissions: ['*'],
    tenant: runtime.tenant,
    deviceRef: 'device-cutover',
    status: 'granted'
  };

  runtime.assertGranted.mockImplementation(() => runtime.actor);
  runtime.capture.mockImplementation(() => {
    const captured = { ...runtime.actor };
    return Object.freeze({
      ...captured,
      assertCurrent() {
        if (
          runtime.actor.status !== 'granted'
          || runtime.actor.actorKey !== captured.actorKey
          || runtime.actor.generation !== captured.generation
        ) {
          throw new runtime.TestActorRuntimeError('ACTOR_CONTEXT_STALE');
        }
        return runtime.actor;
      }
    });
  });
});

describe('PRO -> FREE authority cutover', () => {
  it('invalidates an in-flight actor-bound handle immediately when the effective plan becomes FREE', () => {
    const handle = captureProductInventoryMutation({ products: true });
    expect(handle.authorityMode).toBe('actor_bound');

    runtime.state = {
      ...runtime.state,
      licenseDetails: freeLicense()
    };

    expect(() => assertProductInventoryMutationCurrent(handle, { products: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_STALE' }));
  });

  it('blocks replay of an old Pro actor-bound outbox row after downgrade even if the old actor has not locked yet', () => {
    runtime.state = {
      ...runtime.state,
      licenseDetails: freeLicense()
    };

    expect(() => assertProductInventoryOperationActorCurrent({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      operation: SYNC_OPERATIONS.UPDATE,
      actorSensitivity: 'actor_bound',
      originActorKey: 'admin:admin-cutover',
      originActorGeneration: 12
    })).toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_STALE' }));
  });
});
