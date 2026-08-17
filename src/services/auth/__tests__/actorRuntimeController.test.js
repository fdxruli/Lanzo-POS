import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTOR_RUNTIME_ERROR_CODES,
  ACTOR_RUNTIME_STATUS,
  createActorRuntimeController,
  runWithActorHandle
} from '../actorRuntimeController';

const TENANT_A = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 10
});

const TENANT_B = Object.freeze({
  opaqueId: 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  databaseName: 'LanzoDB_t_t_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  generation: 11
});

describe('ActorRuntimeController', () => {
  let tenant;
  let controller;

  beforeEach(() => {
    tenant = { ...TENANT_A };
    controller = createActorRuntimeController({ getTenantAuthority: () => tenant });
  });

  const grantAdmin = () => {
    controller.beginAuthentication({ actorType: 'admin' });
    return controller.grant({
      actorType: 'admin',
      actorId: 'admin-123',
      sessionId: 'admin-session-1'
    });
  };

  const grantStaff = () => {
    controller.beginAuthentication({ actorType: 'staff' });
    return controller.grant({
      actorType: 'staff',
      actorId: 'staff-456',
      sessionId: 'staff-session-1',
      permissions: ['sales.create', 'cash.read']
    });
  };

  it('starts LOCKED without actor authority', () => {
    expect(controller.getState()).toMatchObject({
      status: ACTOR_RUNTIME_STATUS.LOCKED,
      actorKey: null,
      sessionId: null,
      generation: 0
    });
    expect(() => controller.assertGranted()).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_LOCKED })
    );
  });

  it('grants an admin using a stable user-owned actor key', () => {
    const state = grantAdmin();
    expect(state.status).toBe(ACTOR_RUNTIME_STATUS.GRANTED);
    expect(state.actorKey).toBe('admin:admin-123');
    expect(state.actorId).toBe('admin-123');
    expect(state.permissions).toEqual(['*']);
    expect(state.tenant).toEqual(TENANT_A);
  });

  it('locks the actor and increments generation without changing the tenant authority', () => {
    const granted = grantAdmin();
    const tenantBefore = { ...tenant };
    const locked = controller.lock('logout');
    expect(locked.status).toBe(ACTOR_RUNTIME_STATUS.LOCKED);
    expect(locked.actorKey).toBeNull();
    expect(locked.generation).toBe(granted.generation + 1);
    expect(tenant).toEqual(tenantBefore);
  });

  it('rejects a handle captured before logout after a new staff actor is granted', () => {
    grantAdmin();
    const adminHandle = controller.capture('sales.create');
    controller.lock('admin_logout');
    const staff = grantStaff();
    expect(staff.actorKey).toBe('staff:staff-456');
    expect(() => adminHandle.assertCurrent()).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE })
    );
  });

  it('never lets an Admin A captured reference operate as Staff B', () => {
    grantAdmin();
    const capturedAdmin = controller.capture();
    controller.lock('actor_handoff');
    grantStaff();
    expect(controller.getState().actorKey).toBe('staff:staff-456');
    expect(() => capturedAdmin.assertCurrent('cash.read')).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE })
    );
  });

  it('prevents a stale handle from entering protected work after logout', async () => {
    grantAdmin();
    const adminHandle = controller.capture('sales.create');
    const protectedOperation = vi.fn();
    controller.lock('admin_logout');

    await expect(runWithActorHandle(adminHandle, protectedOperation, 'sales.create')).rejects.toMatchObject({
      code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE
    });
    expect(protectedOperation).not.toHaveBeenCalled();
  });

  it('revalidates actor generation at the effective write boundary after an await', async () => {
    grantAdmin();
    const adminHandle = controller.capture('sales.create');
    const sideEffect = vi.fn(() => 'written');
    let resume;
    const waitForResume = new Promise((resolve) => { resume = resolve; });

    const pending = runWithActorHandle(adminHandle, async ({ guardedWrite }) => {
      await waitForResume;
      return guardedWrite(sideEffect, 'sales.create');
    }, 'sales.create');

    controller.lock('admin_logout_during_async_work');
    grantStaff();
    resume();

    await expect(pending).rejects.toMatchObject({
      code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE
    });
    expect(sideEffect).not.toHaveBeenCalled();
  });

  it('does not let a new actor reuse a handle from the previous actor generation', async () => {
    grantAdmin();
    const adminHandle = controller.capture();
    controller.lock('handoff');
    grantStaff();

    await expect(runWithActorHandle(adminHandle, async ({ guardedWrite }) => (
      guardedWrite(() => 'unexpected')
    ))).rejects.toMatchObject({
      code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE
    });
  });

  it('keeps only explicit staff permissions and cannot inherit admin wildcard authority', () => {
    const state = grantStaff();
    expect(state.permissions).toEqual(['sales.create', 'cash.read']);
    expect(state.permissions).not.toContain('*');
    expect(() => controller.assertGranted('settings.admin')).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.PERMISSION_DENIED })
    );
    expect(controller.assertGranted('sales.create').actorKey).toBe('staff:staff-456');
  });

  it('does not change tenant opaque id or database when actors change', () => {
    const admin = grantAdmin();
    controller.lock('handoff');
    const staff = grantStaff();
    expect(admin.tenant.opaqueId).toBe(TENANT_A.opaqueId);
    expect(staff.tenant.opaqueId).toBe(TENANT_A.opaqueId);
    expect(admin.tenant.databaseName).toBe(TENANT_A.databaseName);
    expect(staff.tenant.databaseName).toBe(TENANT_A.databaseName);
  });

  it('fails closed when the tenant runtime changes from A to B', () => {
    grantAdmin();
    const handle = controller.capture();
    tenant = { ...TENANT_B };
    expect(() => handle.assertCurrent()).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.TENANT_MISMATCH })
    );
    expect(() => controller.assertGranted()).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.TENANT_MISMATCH })
    );
  });

  it('fails closed when the same tenant database is reopened under a new tenant generation', () => {
    grantAdmin();
    const handle = controller.capture();
    tenant = { ...TENANT_A, generation: TENANT_A.generation + 1 };
    expect(() => handle.assertCurrent()).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE })
    );
  });

  it('does not grant actor authority while TenantRuntime is unavailable', () => {
    tenant = null;
    controller.beginAuthentication({ actorType: 'admin' });
    expect(() => controller.grant({
      actorType: 'admin',
      actorId: 'admin-123',
      sessionId: 'admin-session-1'
    })).toThrowError(expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.TENANT_NOT_READY }));
    expect(controller.getState().status).not.toBe(ACTOR_RUNTIME_STATUS.GRANTED);
  });

  it('requires an authenticated session id before GRANTED', () => {
    controller.beginAuthentication({ actorType: 'staff' });
    expect(() => controller.grant({
      actorType: 'staff',
      actorId: 'staff-456',
      sessionId: null,
      permissions: ['sales.create']
    })).toThrowError(expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED }));
  });

  it('requires an explicit lock before replacing a granted actor', () => {
    grantAdmin();
    expect(() => controller.beginAuthentication({ actorType: 'staff' })).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.HANDOFF_REQUIRED })
    );
  });

  it('actor lock cannot delete or reassign tenant-owned business state', () => {
    const tenantOwned = {
      products: [{ id: 'p1' }],
      inventory: [{ id: 'i1', qty: 3 }],
      sales: [{ id: 's1' }],
      cashSessions: [{ id: 'cash-1', actor_key: 'admin:admin-123' }]
    };
    const before = structuredClone(tenantOwned);
    grantAdmin();
    controller.lock('logout');
    expect(tenantOwned).toEqual(before);
    expect(tenantOwned.cashSessions[0].actor_key).toBe('admin:admin-123');
  });

  it('blocks actor-sensitive writes while locked', () => {
    grantAdmin();
    controller.lock('logout');
    const actorSensitiveWrite = () => {
      controller.assertGranted('sales.create');
      return 'written';
    };
    expect(actorSensitiveWrite).toThrowError(
      expect.objectContaining({ code: ACTOR_RUNTIME_ERROR_CODES.CONTEXT_LOCKED })
    );
  });
});
