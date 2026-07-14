// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_MEDIA_CACHE,
  ADMIN_RUNTIME_CACHE_NAMES,
  ADMIN_STATIC_CACHE,
  cleanupObsoleteAdminRuntimeCaches,
  clearCurrentAdminRuntimeCaches,
  isAdminMediaRequest,
  isAdminStaticRequest,
  isObsoleteAdminRuntimeCache,
} from '../adminRuntimeCache';

const origin = 'http://127.0.0.1:4173';
const context = ({
  pathname = '/assets/AboutPage-AbCd1234.js',
  method = 'GET',
  destination = 'script',
  referrer = `${origin}/configuracion`,
  urlOrigin = origin,
} = {}) => ({
  request: { method, destination, referrer },
  url: new URL(pathname, urlOrigin),
  serviceWorkerOrigin: origin,
});

describe('administrative runtime cache policy', () => {
  it('allows a same-origin hashed JavaScript requested from administration', () => {
    expect(isAdminStaticRequest(context())).toBe(true);
  });

  it('allows a same-origin hashed stylesheet requested from administration', () => {
    expect(isAdminStaticRequest(context({ pathname: '/assets/AboutPage-AbCd.css', destination: 'style' }))).toBe(true);
  });

  it.each([
    { method: 'POST' },
    { pathname: '/rest/v1/orders' },
    { pathname: '/rpc/create_order' },
    { pathname: '/auth/v1/token' },
    { pathname: '/functions/v1/private' },
    { pathname: '/storage/v1/object/file' },
    { referrer: `${origin}/tienda/demo` },
    { urlOrigin: 'https://fixture.invalid' },
  ])('rejects a non-static, private, public, or unsafe request %#', (overrides) => {
    expect(isAdminStaticRequest(context(overrides))).toBe(false);
  });

  it('allows only hashed same-origin media with an administrative referrer', () => {
    expect(isAdminMediaRequest(context({ pathname: '/assets/font-AbCd.woff2', destination: 'font' }))).toBe(true);
    expect(isAdminMediaRequest(context({ pathname: '/assets/logo-AbCd.png', destination: 'image' }))).toBe(true);
    expect(isAdminMediaRequest(context({ pathname: '/logo.png', destination: 'image' }))).toBe(false);
  });

  it('identifies only obsolete, explicitly owned runtime cache versions', () => {
    expect(isObsoleteAdminRuntimeCache('lanzo-admin-static-v0')).toBe(true);
    expect(isObsoleteAdminRuntimeCache('lanzo-admin-media-v2')).toBe(true);
    expect(isObsoleteAdminRuntimeCache(ADMIN_STATIC_CACHE)).toBe(false);
    expect(isObsoleteAdminRuntimeCache(ADMIN_MEDIA_CACHE)).toBe(false);
    expect(isObsoleteAdminRuntimeCache('lanzo-public-store-cache')).toBe(false);
    expect(isObsoleteAdminRuntimeCache('external-fixture-cache')).toBe(false);
    expect(isObsoleteAdminRuntimeCache('workbox-precache-v2-origin')).toBe(false);
  });

  it('deletes an old Lanzo cache while preserving current and external caches', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue([
        'lanzo-admin-static-v0',
        ADMIN_STATIC_CACHE,
        ADMIN_MEDIA_CACHE,
        'external-fixture-cache',
        'lanzo-public-store-cache',
      ]),
      delete: deleteCache,
    };

    await expect(cleanupObsoleteAdminRuntimeCaches(cacheStorage)).resolves.toEqual(['lanzo-admin-static-v0']);
    expect(deleteCache).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith('lanzo-admin-static-v0');
  });

  it('clears only current administrative runtime caches during explicit recovery', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);

    await clearCurrentAdminRuntimeCaches({ delete: deleteCache });

    expect(deleteCache.mock.calls.map(([name]) => name)).toEqual(ADMIN_RUNTIME_CACHE_NAMES);
    expect(deleteCache).not.toHaveBeenCalledWith('lanzo-public-store-cache');
  });
});
