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
    actor: null,
    storeState: null,
    tenantReadiness: null,
    assertGranted: vi.fn(),
    capture: vi.fn()
  };
});

vi.mock('../actorRuntimeController', () => ({
  ACTOR_RUNTIME_ERROR_CODES: {
    CONTEXT_LOCKED: 'ACTOR_CONTEXT_LOCKED',
    CONTEXT_STALE: 'ACTOR_CONTEXT_STALE',
    TENANT_MISMATCH: 'ACTOR_TENANT_MISMATCH',
    PERMISSION_DENIED: 'ACTOR_PERMISSION_DENIED'
  },
  ActorRuntimeError: runtime.TestActorRuntimeError,
  actorRuntimeController: {
    assertGranted: runtime.assertGranted,
    capture: runtime.capture
  }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => runtime.storeState }
}));

vi.mock('../../db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => runtime.tenantReadiness
}));

import {
  PRODUCT_INVENTORY_AUTHORITY_MODES,
  actorOriginFromHandle,
  captureProductInventoryMutation,
  isLegacyLocalOwnerProductInventoryAuthority,
  resolveProductInventoryMutationAuthority
} from '../productInventoryAuthority';

const tenant = (overrides = {}) => ({
  opaqueId: 'tenant-free-a',
  databaseName: 'LanzoDB_tenant-free-a',
  generation: 7,
  ...overrides
});

const freeLicense = (overrides = {}) => ({
  license_key: 'LANZO-FREE-A',
  valid: true,
  plan_code: 'free_trial',
  plan_name: 'Lanzo Local',
  max_devices: 1,
  device_role: 'admin',
  features: {
    cloud_pos_sync: false,
    cloud_products_sync: false,
    staff_roles: false,
    realtime_license_sync: false
  },
  ...overrides
});

const proLicense = (overrides = {}) => ({
  license_key: 'LANZO-PRO-A',
  valid: true,
  plan_code: 'pro_monthly',
  plan_name: 'Lanzo Nube',
  max_devices: 3,
  device_role: 'admin',
  features: {
    cloud_pos_sync: true,
    cloud_products_sync: true,
    staff_roles: true,
    realtime_license_sync: true
  },
  ...overrides
});

const setStore = (licenseDetails, overrides = {}) => {
  runtime.storeState = {
    appStatus: 'ready',
    licenseDetails,
    currentDeviceRole: licenseDetails?.device_role || 'admin',
    currentAdminUser: null,
    currentStaffUser: null,
    gracePeriodEnds: null,
    ...overrides
  };
};

const installLockedActor = () => {
  runtime.actor = { status: 'locked', generation: (runtime.actor?.generation || 0) + 1 };
};

const installActor = ({
  actorType = 'admin',
  actorId = actorType === 'admin' ? 'admin-a' : 'staff-a',
  permissions = actorType === 'admin' ? ['*'] : ['products', 'inventory'],
  generation = 3
} = {}) => {
  runtime.actor = {
    status: 'granted',
    actorType,
    actorId,
    actorKey: `${actorType}:${actorId}`,
    sessionId: `session-${actorId}`,
    permissions,
    generation,
    tenant: tenant(),
    deviceRef: 'device-a'
  };
};

const assertPermission = (snapshot, permission = null) => {
  if (!permission || snapshot.permissions.includes('*') || snapshot.permissions.includes(permission)) return;
  throw new runtime.TestActorRuntimeError('ACTOR_PERMISSION_DENIED', { permission });
};

beforeEach(() => {
  vi.clearAllMocks();
  runtime.tenantReadiness = { ready: true, runtime: tenant() };
  setStore(proLicense());
  installActor();

  runtime.assertGranted.mockImplementation((permission = null) => {
    if (runtime.actor?.status !== 'granted') {
      throw new runtime.TestActorRuntimeError('ACTOR_CONTEXT_LOCKED');
    }
    assertPermission(runtime.actor, permission);
    return runtime.actor;
  });

  runtime.capture.mockImplementation(() => {
    const captured = runtime.assertGranted();
    return Object.freeze({
      actorType: captured.actorType,
      actorId: captured.actorId,
      actorKey: captured.actorKey,
      sessionId: captured.sessionId,
      generation: captured.generation,
      tenant: captured.tenant,
      deviceRef: captured.deviceRef,
      assertCurrent(permission = null) {
        if (
          runtime.actor?.status !== 'granted'
          || runtime.actor.actorKey !== captured.actorKey
          || runtime.actor.generation !== captured.generation
          || runtime.actor.sessionId !== captured.sessionId
        ) {
          throw new runtime.TestActorRuntimeError('ACTOR_CONTEXT_STALE');
        }
        assertPermission(runtime.actor, permission);
        return runtime.actor;
      }
    });
  });
});

describe('FREE/local product and inventory authority transitions', () => {
  it('allows explicit FREE local catalog/inventory while ActorRuntime stays LOCKED without creating a fake actor', () => {
    setStore(freeLicense());
    installLockedActor();

    const authority = resolveProductInventoryMutationAuthority();
    expect(authority.mode).toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER);

    for (const requirements of [
      { products: true },
      { inventory: true },
      { products: true, inventory: true }
    ]) {
      const handle = captureProductInventoryMutation(requirements);
      expect(isLegacyLocalOwnerProductInventoryAuthority(handle)).toBe(true);
      expect(handle.actorKey).toBeNull();
      expect(handle.cloudEligible).toBe(false);
      expect(() => handle.assertCurrent()).not.toThrow();
      expect(() => actorOriginFromHandle(handle)).toThrowError(expect.objectContaining({
        code: 'ACTOR_CONTEXT_STALE'
      }));
    }

    expect(runtime.capture).not.toHaveBeenCalled();
  });

  it('fails closed for an explicit FREE plan when the local-owner contract is not fully proven', () => {
    setStore(freeLicense({
      features: {
        cloud_pos_sync: false,
        cloud_products_sync: true,
        staff_roles: false
      }
    }));
    installActor();

    expect(resolveProductInventoryMutationAuthority()).toMatchObject({
      mode: PRODUCT_INVENTORY_AUTHORITY_MODES.DENIED,
      reason: 'free_cloud_features_not_explicitly_disabled'
    });
    expect(() => captureProductInventoryMutation({ products: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_LOCKED' }));
    expect(runtime.capture).not.toHaveBeenCalled();
  });

  it('switches FREE -> PRO immediately and requires a valid actor before allowing new mutations', () => {
    setStore(freeLicense());
    installLockedActor();
    expect(captureProductInventoryMutation({ products: true }).authorityMode)
      .toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER);

    setStore(proLicense());
    installLockedActor();
    expect(() => captureProductInventoryMutation({ products: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_LOCKED' }));

    installActor();
    expect(captureProductInventoryMutation({ products: true }).authorityMode)
      .toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND);
  });

  it('keeps PRO Staff products and inventory permissions separated', () => {
    setStore(proLicense({ device_role: 'staff' }), {
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-a' }
    });
    installActor({ actorType: 'staff', permissions: ['products'] });

    expect(() => captureProductInventoryMutation({ products: true })).not.toThrow();
    expect(() => captureProductInventoryMutation({ inventory: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_PERMISSION_DENIED' }));

    installActor({ actorType: 'staff', permissions: ['inventory'], generation: 4 });
    expect(() => captureProductInventoryMutation({ inventory: true })).not.toThrow();
    expect(() => captureProductInventoryMutation({ products: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_PERMISSION_DENIED' }));
  });

  it('switches PRO -> FREE without retaining prior cloud actor authority', () => {
    setStore(proLicense());
    installActor();
    expect(captureProductInventoryMutation({ products: true }).authorityMode)
      .toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND);

    setStore(freeLicense());
    const handle = captureProductInventoryMutation({ products: true, inventory: true });
    expect(handle.authorityMode).toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER);
    expect(handle.actorKey).toBeNull();
    expect(runtime.capture).toHaveBeenCalledTimes(1);
  });

  it('preserves FREE -> PRO -> FREE -> PRO deterministically across repeated plan changes', () => {
    setStore(freeLicense());
    installLockedActor();
    expect(captureProductInventoryMutation({ products: true }).authorityMode)
      .toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER);

    setStore(proLicense());
    expect(() => captureProductInventoryMutation({ products: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_LOCKED' }));
    installActor({ generation: 10 });
    expect(captureProductInventoryMutation({ products: true }).authorityMode)
      .toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND);

    setStore(freeLicense());
    expect(captureProductInventoryMutation({ inventory: true }).authorityMode)
      .toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER);

    setStore(proLicense());
    installLockedActor();
    expect(() => captureProductInventoryMutation({ inventory: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_LOCKED' }));
  });

  it('never treats PRO offline as FREE local authority', () => {
    setStore(proLicense(), { networkUnavailable: true });
    installLockedActor();

    expect(resolveProductInventoryMutationAuthority().mode)
      .toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND);
    expect(() => captureProductInventoryMutation({ products: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_LOCKED' }));
  });

  it('fails closed for ambiguous bootstrap when the plan is unresolved and ActorRuntime is LOCKED', () => {
    setStore({
      license_key: 'LANZO-UNKNOWN',
      valid: true,
      max_devices: 1,
      features: { cloud_pos_sync: false, cloud_products_sync: false, staff_roles: false }
    }, { appStatus: 'loading' });
    installLockedActor();

    expect(resolveProductInventoryMutationAuthority().mode)
      .toBe(PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND);
    expect(() => captureProductInventoryMutation({ products: true }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_LOCKED' }));
  });

  it('invalidates a captured FREE handle after tenant or license changes', () => {
    setStore(freeLicense());
    installLockedActor();
    const handle = captureProductInventoryMutation({ products: true });

    runtime.tenantReadiness = { ready: true, runtime: tenant({ opaqueId: 'tenant-b', generation: 8 }) };
    expect(() => handle.assertCurrent('products'))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_STALE' }));

    runtime.tenantReadiness = { ready: true, runtime: tenant() };
    const secondHandle = captureProductInventoryMutation({ products: true });
    setStore(freeLicense({ license_key: 'LANZO-FREE-B' }));
    expect(() => secondHandle.assertCurrent('products'))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_STALE' }));
  });
});
