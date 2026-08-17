import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  readiness: vi.fn()
}));

vi.mock('../../db/tenantRuntimeRouter', () => ({
  db: {
    table: vi.fn(() => ({ get: mocks.get }))
  },
  getTenantRuntimeReadiness: vi.fn(() => mocks.readiness())
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
  opaqueId: 't_actor_bridge',
  databaseName: 'LanzoDB_t_t_actor_bridge',
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

  it('restores Admin when Admin is the only valid session evidence', async () => {
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
