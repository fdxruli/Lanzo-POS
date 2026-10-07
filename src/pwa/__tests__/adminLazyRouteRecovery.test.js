// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recoverAdminLazyRoute,
  resetAdminLazyRouteRecoveryForTests,
} from '../adminLazyRouteRecovery';

const staleChunkError = new TypeError(
  'Failed to fetch dynamically imported module: https://lanzo-pos.vercel.app/assets/PosPage-old.js'
);

const createOnlineProbe = () => vi.fn().mockResolvedValue({
  status: 'online',
  reason: 'origin-reachable',
});

describe('administrative lazy route recovery', () => {
  afterEach(() => resetAdminLazyRouteRecoveryForTests());

  it('shares one strong recovery across simultaneous stale route failures', async () => {
    let resolveRecovery;
    const recoverStartup = vi.fn(() => new Promise((resolve) => {
      resolveRecovery = resolve;
    }));
    const probeConnectivity = createOnlineProbe();

    const first = recoverAdminLazyRoute({
      error: staleChunkError,
      recoverStartup,
      probeConnectivity,
    });
    const second = recoverAdminLazyRoute({
      error: staleChunkError,
      recoverStartup,
      probeConnectivity,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(first).toBe(second);
    expect(probeConnectivity).toHaveBeenCalledOnce();
    expect(recoverStartup).toHaveBeenCalledOnce();
    expect(recoverStartup).toHaveBeenCalledWith({ error: staleChunkError, force: false });

    resolveRecovery({ status: 'reloading' });
    await expect(first).resolves.toEqual({ status: 'reloading' });
  });

  it('does not reset the installed shell while navigator already reports offline', async () => {
    const recoverStartup = vi.fn();
    const probeConnectivity = vi.fn();

    await expect(recoverAdminLazyRoute({
      error: staleChunkError,
      navigatorTarget: { onLine: false },
      recoverStartup,
      probeConnectivity,
    })).resolves.toEqual({
      status: 'offline',
      reason: 'navigator-offline',
    });

    expect(probeConnectivity).not.toHaveBeenCalled();
    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it('treats a failed origin probe as offline even while navigator.onLine is still true', async () => {
    const recoverStartup = vi.fn();
    const probeConnectivity = vi.fn().mockResolvedValue({
      status: 'offline',
      reason: 'probe-failed',
    });

    await expect(recoverAdminLazyRoute({
      error: staleChunkError,
      navigatorTarget: { onLine: true },
      recoverStartup,
      probeConnectivity,
    })).resolves.toEqual({
      status: 'offline',
      reason: 'probe-failed',
    });

    expect(probeConnectivity).toHaveBeenCalledOnce();
    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it('does not treat ordinary application errors as version mismatches', async () => {
    const recoverStartup = vi.fn();
    const probeConnectivity = vi.fn();

    await expect(recoverAdminLazyRoute({
      error: new Error('ordinary business error'),
      recoverStartup,
      probeConnectivity,
    })).resolves.toEqual({ status: 'not-recoverable' });

    expect(probeConnectivity).not.toHaveBeenCalled();
    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it('allows a manual forced retry after an automatic attempt completed without reload', async () => {
    const recoverStartup = vi.fn()
      .mockResolvedValueOnce({ status: 'preserved' })
      .mockResolvedValueOnce({ status: 'reloading' });
    const probeConnectivity = createOnlineProbe();

    await expect(recoverAdminLazyRoute({
      error: staleChunkError,
      recoverStartup,
      probeConnectivity,
    })).resolves.toEqual({ status: 'preserved' });

    await expect(recoverAdminLazyRoute({
      error: staleChunkError,
      force: true,
      recoverStartup,
      probeConnectivity,
    })).resolves.toEqual({ status: 'reloading' });

    expect(recoverStartup).toHaveBeenNthCalledWith(2, {
      error: staleChunkError,
      force: true,
    });
  });
});
