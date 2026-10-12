/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenant = vi.hoisted(() => ({
  opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  databaseName: 'LanzoDB_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation: 1
}));
vi.mock('../db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: tenant })
}));

import { actorRuntimeController } from '../auth/actorRuntimeController';
import { clearActorAuthorityRecovery, getActorAuthorityRecoverySnapshot } from '../auth/actorAuthorityRecovery';
import { cloudRequestManager, isTemporaryCloudRequestError } from './cloudRequestManager';

const grantAdmin = () => {
  actorRuntimeController.lock('test_reset');
  actorRuntimeController.beginAuthentication({ actorType: 'admin' });
  actorRuntimeController.beginHandoffCheck();
  return actorRuntimeController.grant({
    actorType: 'admin', actorId: 'admin-qa', sessionId: 'session-A',
    tenantOpaqueId: tenant.opaqueId, deviceRef: 'fingerprint-X'
  });
};
const request = (fn, overrides = {}) => cloudRequestManager.request({
  key: 'restaurant-authority:token-A', rpcName: 'restaurant_list_open_orders',
  ttlMs: 0, allowCache: false, fn, ...overrides
});

describe('Cloud device authority loss', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    cloudRequestManager.clear();
    grantAdmin();
    clearActorAuthorityRecovery();
  });

  it.each(['DEVICE_TOKEN_INVALID', 'DEVICE_TOKEN_REQUIRED'])(
    'fails closed on the first PostgREST %s rejection', async (code) => {
      const error = { code: 'P0001', message: code };
      const rpc = vi.fn().mockRejectedValue(error);
      const captured = actorRuntimeController.capture();

      await expect(request(rpc)).rejects.toMatchObject(error);

      expect(rpc).toHaveBeenCalledTimes(1);
      expect(cloudRequestManager.getStats().backoffSize).toBe(0);
      expect(actorRuntimeController.getState()).toMatchObject({
        status: 'locked', reason: 'device_auth_reauthentication_required'
      });
      expect(() => captured.assertCurrent()).toThrow('ACTOR_CONTEXT_STALE');
      await expect(request(rpc, { force: true })).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_LOCKED' });
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  );

  it('does not classify invalid device credentials as retryable while offline', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(isTemporaryCloudRequestError({ code: 'P0001', message: 'DEVICE_TOKEN_INVALID' })).toBe(false);
  });

  it.each(['DEVICE_NOT_ALLOWED', 'CLONING_DETECTED'])(
    'keeps %s a hard lock without offering reauthentication', async (code) => {
      const error = { code: 'P0001', message: code };
      const captured = actorRuntimeController.capture();

      await expect(request(() => Promise.reject(error))).rejects.toMatchObject(error);

      expect(actorRuntimeController.getState()).toMatchObject({
        status: 'locked', reason: code === 'CLONING_DETECTED' ? 'device_integrity_rejected' : 'device_authorization_blocked'
      });
      expect(() => captured.assertCurrent()).toThrow('ACTOR_CONTEXT_STALE');
      expect(getActorAuthorityRecoverySnapshot()).toBeNull();
      expect(cloudRequestManager.getStats().backoffSize).toBe(0);
    }
  );

  it.each(['DEVICE_TOKEN_INVALID', 'DEVICE_NOT_ALLOWED', 'CLONING_DETECTED'])(
    'rejects an unsuccessful %s payload before writing it to cache', async (code) => {
      await expect(request(() => Promise.resolve({ success: false, code }), {
        allowCache: true, ttlMs: 60_000
      })).rejects.toMatchObject({ code });

      expect(actorRuntimeController.getState().status).toBe('locked');
      expect(cloudRequestManager.getStats().cacheSize).toBe(0);
      expect(cloudRequestManager.getStats().backoffSize).toBe(0);
      expect(Boolean(getActorAuthorityRecoverySnapshot())).toBe(code === 'DEVICE_TOKEN_INVALID');
    }
  );

  it.each([
    new TypeError('Failed to fetch'),
    Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' })
  ])('keeps valid actor authority on a transport/rate-limit failure', async (error) => {
    await expect(request(() => Promise.reject(error))).rejects.toBe(error);
    expect(actorRuntimeController.getState().status).toBe('granted');
  });

  it('discards a successful old read after an actor generation change without relocking the recovered actor', async () => {
    let resolveRead;
    const pending = new Promise((resolve) => { resolveRead = resolve; });
    const oldRead = request(() => pending, { allowCache: true, ttlMs: 60_000 });
    await Promise.resolve();
    grantAdmin();
    clearActorAuthorityRecovery();
    resolveRead({ tables: ['old-context-table'] });
    await expect(oldRead).rejects.toMatchObject({ code: 'CLOUD_REQUEST_RESPONSE_STALE', reason: 'actor_changed' });
    expect(actorRuntimeController.getState().status).toBe('granted');
    expect(cloudRequestManager.getStats().cacheSize).toBe(0);
  });
});
