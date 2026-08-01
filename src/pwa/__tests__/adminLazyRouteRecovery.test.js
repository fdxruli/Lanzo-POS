// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recoverAdminLazyRoute,
  resetAdminLazyRouteRecoveryForTests,
} from '../adminLazyRouteRecovery';

const staleChunkError = new TypeError(
  'Failed to fetch dynamically imported module: https://lanzo-pos.vercel.app/assets/PosPage-old.js'
);

describe('administrative lazy route recovery', () => {
  afterEach(() => resetAdminLazyRouteRecoveryForTests());

  it('shares one strong recovery across simultaneous stale route failures', async () => {
    let resolveRecovery;
    const recoverStartup = vi.fn(() => new Promise((resolve) => {
      resolveRecovery = resolve;
    }));

    const first = recoverAdminLazyRoute({ error: staleChunkError, recoverStartup });
    const second = recoverAdminLazyRoute({ error: staleChunkError, recoverStartup });
    await Promise.resolve();

    expect(first).toBe(second);
    expect(recoverStartup).toHaveBeenCalledOnce();
    expect(recoverStartup).toHaveBeenCalledWith({ error: staleChunkError, force: false });

    resolveRecovery({ status: 'reloading' });
    await expect(first).resolves.toEqual({ status: 'reloading' });
  });

  it('does not reset the installed shell while the device is offline', async () => {
    const recoverStartup = vi.fn();

    await expect(recoverAdminLazyRoute({
      error: staleChunkError,
      navigatorTarget: { onLine: false },
      recoverStartup,
    })).resolves.toEqual({ status: 'offline' });

    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it('does not treat ordinary application errors as version mismatches', async () => {
    const recoverStartup = vi.fn();

    await expect(recoverAdminLazyRoute({
      error: new Error('ordinary business error'),
      recoverStartup,
    })).resolves.toEqual({ status: 'not-recoverable' });

    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it('allows a manual forced retry after an automatic attempt completed without reload', async () => {
    const recoverStartup = vi.fn()
      .mockResolvedValueOnce({ status: 'already-attempted' })
      .mockResolvedValueOnce({ status: 'reloading' });

    await expect(recoverAdminLazyRoute({
      error: staleChunkError,
      recoverStartup,
    })).resolves.toEqual({ status: 'already-attempted' });

    await expect(recoverAdminLazyRoute({
      error: staleChunkError,
      force: true,
      recoverStartup,
    })).resolves.toEqual({ status: 'reloading' });

    expect(recoverStartup).toHaveBeenNthCalledWith(2, {
      error: staleChunkError,
      force: true,
    });
  });
});
