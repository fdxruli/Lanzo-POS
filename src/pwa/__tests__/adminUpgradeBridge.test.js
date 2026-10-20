// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  activateAdminUpgradeBridge,
  requestAdminUpgradeBridgeInstall,
} from '../adminUpgradeBridge';

function createCacheStorage() {
  const entries = new Map();
  const cache = {
    match: vi.fn(async (request) => entries.get(String(request)) || null),
    put: vi.fn(async (request, response) => { entries.set(String(request), response); }),
    delete: vi.fn(async (request) => entries.delete(String(request))),
  };

  return { cache, entries, storage: { open: vi.fn(async () => cache) } };
}

const origin = 'https://lanzo-pos.vercel.app';

describe('administrative one-time upgrade bridge', () => {
  it('records the legacy bridge without activating the waiting worker', async () => {
    const { storage } = createCacheStorage();
    const request = await requestAdminUpgradeBridgeInstall({
      registration: { active: {} },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
    });

    expect(request).toEqual({ requested: true, buildId: 'build-153' });
    expect(storage.open).toHaveBeenCalledOnce();
  });

  it('claims clients without navigating or replacing active work', async () => {
    const { storage } = createCacheStorage();
    await requestAdminUpgradeBridgeInstall({
      registration: { active: {} },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
    });

    const navigate = vi.fn();
    const clients = {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([{ url: `${origin}/caja`, navigate }]),
    };
    const result = await activateAdminUpgradeBridge({
      clients,
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
    });

    expect(result).toEqual({ activated: true, buildId: 'build-153' });
    expect(clients.claim).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('marks completion so later deployments preserve the normal prompt flow', async () => {
    const { storage } = createCacheStorage();
    await requestAdminUpgradeBridgeInstall({
      registration: { active: {} },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
    });
    await activateAdminUpgradeBridge({
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      cacheStorage: storage,
      origin,
      buildId: 'build-153',
    });

    const laterDeployment = await requestAdminUpgradeBridgeInstall({
      registration: { active: {} },
      cacheStorage: storage,
      origin,
      buildId: 'build-154',
    });

    expect(laterDeployment).toEqual({ requested: false, reason: 'already-completed' });
  });
});
