import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn()
}));

vi.mock('../../database', () => ({
  loadData: mocks.loadData,
  STORES: { SYNC_CACHE: 'sync_cache' }
}));

import {
  getExplicitActorPermissions,
  readActorSessionBinding,
  resolveStableActorId
} from '../actorSessionRuntimeBridge';

describe('actor session runtime bridge', () => {
  beforeEach(() => vi.clearAllMocks());

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
    mocks.loadData.mockImplementation(async (_store, key) => ({
      value: {
        staff_session_token: 'staff-token',
        staff_session_id: 'staff-session',
        admin_session_token: null
      }[key] ?? null
    }));

    await expect(readActorSessionBinding('staff')).resolves.toEqual({
      actorType: 'staff',
      sessionId: 'staff-session'
    });
  });

  it('fails closed on admin plus staff token ambiguity instead of selecting Admin', async () => {
    mocks.loadData.mockImplementation(async (_store, key) => ({
      value: {
        staff_session_token: 'staff-token',
        staff_session_id: 'staff-session',
        admin_session_token: 'residual-admin-token'
      }[key] ?? null
    }));

    await expect(readActorSessionBinding('staff')).rejects.toMatchObject({
      code: 'ACTOR_SESSION_AMBIGUOUS'
    });
  });

  it('requires both the actor-specific token and session id', async () => {
    mocks.loadData.mockResolvedValue({ value: null });
    await expect(readActorSessionBinding('admin')).rejects.toMatchObject({
      code: 'ACTOR_SESSION_REQUIRED'
    });
  });
});
