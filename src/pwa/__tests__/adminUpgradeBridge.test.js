// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_UPGRADE_BRIDGE_QUERY_PARAM,
  activateAdminUpgradeBridge,
  buildAdminUpgradeBridgeUrl,
  requestAdminUpgradeBridgeInstall,
} from '../adminUpgradeBridge';

function createCacheStorage() {
  const entries = new Map();
  const cache = {
    match: vi.fn(async (request) => entries.get(String(request)) || null),
    put: vi.fn(async (request, response) => {
      entries.set(String(request), response);
    }),
    delete: vi.fn(async (request) => entries.delete(String(request))),
  };

  return {
    cache,
    entries,
    storage: {
      open: vi.fn(async () => cache),
    },
  };
}

const origin = 'https://lanzo-pos.vercel.app';

describe('administrative one-time upgrade bridge', () => {
  it('requests skip waiting only for an update that has not completed the bridge', async () => {
    const { storage } = createCacheStorage();
    const skipWaiting = vi.fn().mockResolvedValue(undefined);

    const first = await requestAdminUpgradeBridgeInstall({
      registration: { active: {} },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
      skipWaiting,
    });

    expect(first).toEqual({ requested: true, buildId: 'build-153' });
    expect(skipWaiting).toHaveBeenCalledTimes(1);

    const freshInstall = await requestAdminUpgradeBridgeInstall({
      registration: { active: null },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
      skipWaiting,
    });

    expect(freshInstall).toEqual({ requested: false, reason: 'not-an-update' });
  });

  it('claims and navigates only administrative same-origin clients', async () => {
    const { storage } = createCacheStorage();
    await requestAdminUpgradeBridgeInstall({
      registration: { active: {} },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
      skipWaiting: vi.fn().mockResolvedValue(undefined),
    });

    const adminNavigate = vi.fn().mockResolvedValue(undefined);
    const publicNavigate = vi.fn().mockResolvedValue(undefined);
    const authNavigate = vi.fn().mockResolvedValue(undefined);
    const externalNavigate = vi.fn().mockResolvedValue(undefined);
    const clients = {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([
        { url: `${origin}/pedidos-online`, navigate: adminNavigate },
        { url: `${origin}/tienda/demo-store`, navigate: publicNavigate },
        { url: `${origin}/auth/callback`, navigate: authNavigate },
        { url: 'https://example.com/', navigate: externalNavigate },
      ]),
    };

    const result = await activateAdminUpgradeBridge({
      clients,
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
    });

    expect(result.activated).toBe(true);
    expect(clients.claim).toHaveBeenCalledOnce();
    expect(clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    expect(adminNavigate).toHaveBeenCalledOnce();
    expect(adminNavigate.mock.calls[0][0]).toContain(
      `${ADMIN_UPGRADE_BRIDGE_QUERY_PARAM}=build-153`
    );
    expect(publicNavigate).not.toHaveBeenCalled();
    expect(authNavigate).not.toHaveBeenCalled();
    expect(externalNavigate).not.toHaveBeenCalled();
  });

  it('marks completion so later deployments preserve normal prompt activation', async () => {
    const { storage } = createCacheStorage();
    const skipWaiting = vi.fn().mockResolvedValue(undefined);

    await requestAdminUpgradeBridgeInstall({
      registration: { active: {} },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
      skipWaiting,
    });
    await activateAdminUpgradeBridge({
      clients: {
        claim: vi.fn().mockResolvedValue(undefined),
        matchAll: vi.fn().mockResolvedValue([]),
      },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
    });

    skipWaiting.mockClear();
    const laterDeployment = await requestAdminUpgradeBridgeInstall({
      registration: { active: {} },
      cacheStorage: storage,
      origin,
      buildId: 'build-154',
      skipWaiting,
    });

    expect(laterDeployment).toEqual({ requested: false, reason: 'already-completed' });
    expect(skipWaiting).not.toHaveBeenCalled();
  });

  it('preserves the current route while adding the bridge cache buster', () => {
    const url = buildAdminUpgradeBridgeUrl(
      `${origin}/pedidos-online?filter=pending#top`,
      'build-153',
      origin
    );

    expect(url).toContain('/pedidos-online?');
    expect(url).toContain('filter=pending');
    expect(url).toContain(`${ADMIN_UPGRADE_BRIDGE_QUERY_PARAM}=build-153`);
    expect(url).toContain('#top');
  });
});
