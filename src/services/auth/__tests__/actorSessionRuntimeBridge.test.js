import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  readiness: vi.fn(),
  hydrateTenantStorageConsumers: vi.fn(async () => []),
  resumeTenantStorageWrites: vi.fn(),
  prepareActorScopedStorage: vi.fn(async () => ({})),
  activateActorScopedStorage: vi.fn(),
  resumeActorScopedStorageWrites: vi.fn(),
  suspendActorScopedStorageWrites: vi.fn(),
  invalidateActorScopedStorage: vi.fn(),
  subscribeActorScopedStorage: vi.fn(() => () => {}),
  configureActorOperationalPersistence: vi.fn(() => true),
  installActorOperationalHandoffGuards: vi.fn(async () => true),
  refreshPersistedActorCheckoutOwnership: vi.fn(async () => []),
  assertActorOperationalHandoffClear: vi.fn(() => true),
  rebindActorOperationalOwnership: vi.fn(() => 0)
}));

const tenantRuntimeDb = {
  table: vi.fn(() => ({ get: mocks.get }))
};

vi.mock('../../db/tenantRuntimeRouter', () => ({
  db: tenantRuntimeDb,
  getTenantRuntimeReadiness: vi.fn(() => mocks.readiness())
}));

vi.mock('../../tenant/tenantScopedStorage', () => ({
  hydrateTenantStorageConsumers: mocks.hydrateTenantStorageConsumers,
  resumeTenantStorageWrites: mocks.resumeTenantStorageWrites
}));

vi.mock('../actorScopedStorage', () => ({
  prepareActorScopedStorage: mocks.prepareActorScopedStorage,
  activateActorScopedStorage: mocks.activateActorScopedStorage,
  resumeActorScopedStorageWrites: mocks.resumeActorScopedStorageWrites,
  suspendActorScopedStorageWrites: mocks.suspendActorScopedStorageWrites,
  invalidateActorScopedStorage: mocks.invalidateActorScopedStorage,
  subscribeActorScopedStorage: mocks.subscribeActorScopedStorage
}));

vi.mock('../actorOperationalHandoff', () => ({
  configureActorOperationalPersistence: mocks.configureActorOperationalPersistence,
  installActorOperationalHandoffGuards: mocks.installActorOperationalHandoffGuards,
  refreshPersistedActorCheckoutOwnership: mocks.refreshPersistedActorCheckoutOwnership,
  assertActorOperationalHandoffClear: mocks.assertActorOperationalHandoffClear,
  rebindActorOperationalOwnership: mocks.rebindActorOperationalOwnership
}));

import { actorRuntimeController, ACTOR_RUNTIME_STATUS } from '../actorRuntimeController';
import {
  beginActorRuntimeAuthentication,
  getExplicitActorPermissions,
  readActorSessionBinding,
  resolveStableActorId,
  restoreActorRuntimeFromCurrentSessionCache
} from '../actorSessionRuntimeBridge';

const TENANT_RUNTIME = Object.freeze({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 7
});

const setCache = (values) => {
  mocks.get.mockImplementation(async (key) => ({ value: values[key] ?? null }));
};

describe('actor session runtime bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readiness.mockReturnValue({ ready: true, runtime: TENANT_RUNTIME });
    actorRuntimeController.lock('test_reset');
  });

  it('resolves stable actor ids only from user identity fields', () => {
    expect(resolveStableActorId('admin', { id: 'admin-1', device_id: 'device-x' })).toBe('admin-1');
    expect(resolveStableActorId('staff', { staff_user_id: 'staff-2', fingerprint: 'fp-x' })).toBe('staff-2');
    expect(resolveStableActorId('staff', { fingerprint: 'fp-only' })).toBeNull();
  });

  it('keeps staff permissions explicit and never grants the admin wildcard', () => {
    expect(getExplicitActorPermissions('staff', {
      permissions: ['sales.create', 'cash.read', 'sales.create']
    })).toEqual(['sales.create', 'cash.read']);
    expect(getExplicitActorPermissions('staff', {})).toEqual([]);
    expect(getExplicitActorPermissions('admin', { permissions: [] })).toEqual(['*']);
  });

  it('reads only the explicitly requested staff session binding', async () => {
    setCache({
      staff_session_token: 'staff-token',
      staff_session_id: 'staff-session'
    });

    await expect(readActorSessionBinding('staff')).resolves.toEqual({
      actorType: 'staff',
      sessionId: 'staff-session'
    });
  });

  it('fails closed on admin plus staff token ambiguity instead of selecting Admin', async () => {
    setCache({
      staff_session_token: 'staff-token',
      staff_session_id: 'staff-session',
      admin_session_token: 'residual-admin-token',
      admin_session_id: 'admin-session'
    });

    await expect(readActorSessionBinding('staff')).rejects.toMatchObject({
      code: 'ACTOR_SESSION_AMBIGUOUS'
    });
  });

  it('requires both the actor-specific token and session id', async () => {
    setCache({});
    await expect(readActorSessionBinding('admin')).rejects.toMatchObject({
      code: 'ACTOR_SESSION_REQUIRED'
    });
  });

  it('restores Admin only after durable checkout inspection and handoff validation', async () => {
    setCache({
      admin_session_token: 'admin-token',
      admin_session_id: 'admin-session'
    });
    beginActorRuntimeAuthentication('admin');

    const restored = await restoreActorRuntimeFromCurrentSessionCache({
      actorType: 'admin',
      actor: { id: 'admin-1' }
    });

    expect(restored).toMatchObject({
      status: ACTOR_RUNTIME_STATUS.GRANTED,
      actorKey: 'admin:admin-1',
      sessionId: 'admin-session'
    });
    expect(mocks.configureActorOperationalPersistence).toHaveBeenCalledWith({
      db: tenantRuntimeDb,
      salesStore: 'sales'
    });
    expect(mocks.refreshPersistedActorCheckoutOwnership).toHaveBeenCalledWith({
      tenant: TENANT_RUNTIME
    });
    expect(mocks.assertActorOperationalHandoffClear).toHaveBeenCalledWith({
      tenant: TENANT_RUNTIME,
      actorKey: 'admin:admin-1'
    });
    expect(mocks.configureActorOperationalPersistence.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refreshPersistedActorCheckoutOwnership.mock.invocationCallOrder[0]
    );
    expect(mocks.refreshPersistedActorCheckoutOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertActorOperationalHandoffClear.mock.invocationCallOrder[0]
    );
  });

  it('restores Staff when Staff is the only valid session evidence and preserves only Staff permissions', async () => {
    setCache({
      staff_session_token: 'staff-token',
      staff_session_id: 'staff-session'
    });
    beginActorRuntimeAuthentication('staff');

    const restored = await restoreActorRuntimeFromCurrentSessionCache({
      actorType: 'staff',
      actor: { id: 'staff-2', permissions: ['sales.create', 'cash.read'] }
    });

    expect(restored).toMatchObject({
      status: ACTOR_RUNTIME_STATUS.GRANTED,
      actorKey: 'staff:staff-2',
      sessionId: 'staff-session',
      permissions: ['sales.create', 'cash.read']
    });
    expect(restored.permissions).not.toContain('*');
  });

  it('locks ActorRuntime when valid Admin and Staff session evidence coexist', async () => {
    setCache({
      admin_session_token: 'admin-token',
      admin_session_id: 'admin-session',
      staff_session_token: 'staff-token',
      staff_session_id: 'staff-session'
    });
    beginActorRuntimeAuthentication('admin');

    await expect(restoreActorRuntimeFromCurrentSessionCache({
      actorType: 'admin',
      actor: { id: 'admin-1' }
    })).rejects.toMatchObject({ code: 'ACTOR_SESSION_AMBIGUOUS' });

    expect(actorRuntimeController.getState()).toMatchObject({
      status: ACTOR_RUNTIME_STATUS.LOCKED,
      actorKey: null,
      actorId: null,
      sessionId: null,
      reason: 'ambiguous_actor_session_evidence'
    });
  });
});
