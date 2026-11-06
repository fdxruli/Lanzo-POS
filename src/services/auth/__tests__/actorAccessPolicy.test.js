import { beforeEach, describe, expect, it } from 'vitest';
import { grantTestActor, tenantState } from './actorAccessTestHarness';
import { evaluateActorAccess, readActorAccess } from '../actorAccessPolicy';
import { actorRuntimeController } from '../actorRuntimeController';

let state;
const staff = (permissions = { pos: true }) => {
  state = { currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-a', permissions } };
  return grantTestActor({ permissions: Object.entries(permissions).filter(([, v]) => v === true).map(([k]) => k) });
};

beforeEach(() => {
  tenantState.current = { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 };
  staff();
});

describe('current actor route authority', () => {
  it('preserves a confirmed Free/Admin without requiring plan or profile fields', () => {
    grantTestActor({ actorType: 'admin', actorId: 'owner' });
    const access = readActorAccess({ currentDeviceRole: 'admin', currentAdminUser: { id: 'owner' } });
    expect(access.isAdmin).toBe(true);
    for (const permission of ['pos', 'cash_register', 'settings', 'ecommerce', 'devices']) {
      expect(access.canAccessPermission(permission)).toBe(true);
    }
    for (const permission of [null, undefined, false, {}, '', ' ']) {
      expect(access.canAccessPermission(permission)).toBe(false);
    }
  });

  it('allows explicit POS and denies false, missing and malformed grants', () => {
    staff({ pos: true, cash_register: false, settings: false, customers: 'true', products: 1 });
    const access = readActorAccess(state);
    expect(access.canAccessPermission('pos')).toBe(true);
    for (const permission of ['cash_register', 'settings', 'customers', 'products', 'inventory', null, {}]) {
      expect(access.canAccessPermission(permission)).toBe(false);
    }
  });

  it('intersects runtime and store grants, including legacy array permissions', () => {
    staff({ pos: true, settings: true });
    state.currentStaffUser.permissions = ['pos', 'ecommerce'];
    const access = readActorAccess(state);
    expect(access.canAccessPermission('pos')).toBe(true);
    expect(access.canAccessPermission('settings')).toBe(false);
    expect(access.canAccessPermission('ecommerce')).toBe(false);
  });

  it('never promotes a Staff runtime from a legacy Admin device role or identity', () => {
    state.currentDeviceRole = 'admin';
    state.currentAdminUser = { id: 'previous-admin' };
    const access = readActorAccess(state);
    expect(access.isAdmin).toBe(false);
    expect(access.canAccessPermission('settings')).toBe(false);
  });

  it.each(['locked', 'authenticating', 'handoff_check'])('denies %s even on an Admin device', (status) => {
    grantTestActor({ actorType: 'admin', actorId: 'owner' });
    const snapshot = { ...actorRuntimeController.getState(), status };
    expect(evaluateActorAccess({ runtimeSnapshot: snapshot, currentDeviceRole: 'admin', currentAdminUser: { id: 'owner' } })
      .canAccessPermission('settings')).toBe(false);
    actorRuntimeController.lock('logout');
    expect(readActorAccess({ currentDeviceRole: 'admin', currentAdminUser: { id: 'owner' } }).isAdmin).toBe(false);
  });

  it('denies runtime Staff A with store Staff B', () => {
    state.currentStaffUser.id = 'staff-b';
    expect(readActorAccess(state).canAccessPermission('pos')).toBe(false);
  });

  it('denies Admin without its active identity', () => {
    grantTestActor({ actorType: 'admin', actorId: 'owner' });
    expect(readActorAccess({ currentDeviceRole: 'admin' }).isAdmin).toBe(false);
  });

  it.each([{ actorId: null }, { actorId: ' ' }, { sessionId: null }, { sessionId: false }])(
    'denies incomplete session evidence %j', (missingEvidence) => {
      const runtimeSnapshot = { ...actorRuntimeController.getState(), ...missingEvidence };
      expect(evaluateActorAccess({ ...state, runtimeSnapshot }).canAccessPermission('pos')).toBe(false);
    }
  );

  it('exposes the legacy Free compatibility hold instead of manufacturing Admin authority', () => {
    actorRuntimeController.lock('legacy_local_owner');
    const access = readActorAccess({
      appStatus: 'ready', currentDeviceRole: 'admin', currentAdminUser: null,
      licenseDetails: { valid: true, plan_code: 'free_trial', max_devices: 1,
        features: { cloud_pos_sync: false, cloud_products_sync: false, staff_roles: false } }
    });
    expect(access.isAdmin).toBe(false);
    expect(access.canAccessPermission('pos')).toBe(false);
  });

  it.each([
    { opaqueId: 'other-tenant', databaseName: 'LanzoDB_t_other', generation: 1 },
    { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 2 },
    null
  ])('denies changed or unavailable live tenant %j', (tenant) => {
    tenantState.current = tenant;
    expect(readActorAccess(state).canAccessPermission('pos')).toBe(false);
  });

  it('rejects the prior session snapshot after same-user reauthentication', () => {
    const old = staff();
    grantTestActor({ sessionId: 'replacement-session', permissions: ['pos'] });
    expect(readActorAccess(state, old).canAccessPermission('pos')).toBe(false);
    expect(readActorAccess(state).canAccessPermission('pos')).toBe(true);
  });

  it('does not inherit Admin grants after Admin → Staff', () => {
    grantTestActor({ actorType: 'admin', actorId: 'owner' });
    expect(readActorAccess({ currentDeviceRole: 'admin', currentAdminUser: { id: 'owner' } }).isAdmin).toBe(true);
    staff();
    const access = readActorAccess({ ...state, currentAdminUser: { id: 'owner' } });
    expect(access.canAccessPermission('pos')).toBe(true);
    expect(access.canAccessPermission('settings')).toBe(false);
  });
});
