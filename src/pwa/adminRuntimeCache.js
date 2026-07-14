import { isPublicNavigationPath } from './publicNavigationPolicy';

export const ADMIN_STATIC_CACHE = 'lanzo-admin-static-v1';
export const ADMIN_MEDIA_CACHE = 'lanzo-admin-media-v1';
export const ADMIN_RUNTIME_CACHE_NAMES = Object.freeze([ADMIN_STATIC_CACHE, ADMIN_MEDIA_CACHE]);

const HASHED_STATIC_PATH = /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:js|css)$/;
const HASHED_MEDIA_PATH = /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:woff2?|png|jpe?g|svg|webp|avif)$/;

function hasPublicReferrer(request) {
  if (!request?.referrer) return false;
  try {
    return isPublicNavigationPath(new URL(request.referrer).pathname);
  } catch {
    return false;
  }
}

function isSafeAdminAsset({ request, url, serviceWorkerOrigin }) {
  return request?.method === 'GET'
    && url?.origin === serviceWorkerOrigin
    && !isPublicNavigationPath(url.pathname)
    && !hasPublicReferrer(request);
}

export function isAdminStaticRequest(context) {
  return isSafeAdminAsset(context)
    && ['script', 'style'].includes(context.request.destination)
    && HASHED_STATIC_PATH.test(context.url.pathname);
}

export function isAdminMediaRequest(context) {
  return isSafeAdminAsset(context)
    && ['font', 'image'].includes(context.request.destination)
    && HASHED_MEDIA_PATH.test(context.url.pathname);
}

export function isObsoleteAdminRuntimeCache(cacheName = '') {
  return /^lanzo-admin-(?:static|media)-v\d+$/.test(cacheName)
    && !ADMIN_RUNTIME_CACHE_NAMES.includes(cacheName);
}

export async function cleanupObsoleteAdminRuntimeCaches(cacheStorage) {
  const cacheNames = await cacheStorage.keys();
  const obsoleteNames = cacheNames.filter(isObsoleteAdminRuntimeCache);
  await Promise.all(obsoleteNames.map((cacheName) => cacheStorage.delete(cacheName)));
  return obsoleteNames;
}

export async function clearCurrentAdminRuntimeCaches(cacheStorage) {
  await Promise.all(ADMIN_RUNTIME_CACHE_NAMES.map((cacheName) => cacheStorage.delete(cacheName)));
}
