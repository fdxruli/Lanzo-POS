import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import {
  ADMIN_MEDIA_CACHE,
  ADMIN_STATIC_CACHE,
  cleanupObsoleteAdminRuntimeCaches,
  isAdminMediaRequest,
  isAdminStaticRequest,
} from './adminRuntimeCache';
import {
  activateAdminUpgradeBridge,
  requestAdminUpgradeBridgeInstall,
} from './adminUpgradeBridge';
import { PUBLIC_NAVIGATION_DENYLIST, isPublicNavigationPath, isPublicNavigationRequest } from './publicNavigationPolicy';

const WORKER_BUILD_ID = import.meta.env.VITE_BUILD_COMMIT
  || import.meta.env.VITE_APP_VERSION
  || 'unknown';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname === '/build-info.json',
  new NetworkOnly(),
  'GET',
);

registerRoute(
  ({ request, url }) => isPublicNavigationRequest({
    request,
    url,
    serviceWorkerOrigin: self.location.origin,
  }),
  new NetworkOnly(),
  'GET',
);

registerRoute(
  ({ request, url }) => isAdminStaticRequest({
    request,
    url,
    serviceWorkerOrigin: self.location.origin,
  }),
  new CacheFirst({
    cacheName: ADMIN_STATIC_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
  'GET',
);

registerRoute(
  ({ request, url }) => isAdminMediaRequest({
    request,
    url,
    serviceWorkerOrigin: self.location.origin,
  }),
  new CacheFirst({
    cacheName: ADMIN_MEDIA_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
  'GET',
);

registerRoute(new NavigationRoute(
  createHandlerBoundToURL('/index.html'),
  { denylist: PUBLIC_NAVIGATION_DENYLIST },
));

self.addEventListener('install', (event) => {
  event.waitUntil(requestAdminUpgradeBridgeInstall({
    registration: self.registration,
    cacheStorage: self.caches,
    origin: self.location.origin,
    buildId: WORKER_BUILD_ID,
  }).catch((error) => {
    console.warn('[PWA] No se pudo preparar el puente de actualización.', error);
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    cleanupObsoleteAdminRuntimeCaches(self.caches),
    self.clients.claim(),
    activateAdminUpgradeBridge({
      clients: self.clients,
      cacheStorage: self.caches,
      origin: self.location.origin,
      buildId: WORKER_BUILD_ID,
    }).catch((error) => {
      console.warn('[PWA] No se pudo completar el puente de actualización.', error);
    }),
  ]));
});

let skipWaitingRequested = false;
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ADMIN_BUILD_INFO') {
    event.ports?.[0]?.postMessage({ buildId: import.meta.env.VITE_BUILD_ID });
    return;
  }
  if (event.data?.type !== 'SKIP_WAITING' || skipWaitingRequested) return;
  event.waitUntil((async () => {
    // Workbox cleans superseded precache entries on activation. Do not replace
    // another administrative document's resources, even if it is suspended.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const otherAdminWindows = windows.filter(client => (
      client.id !== event.source?.id && !isPublicNavigationPath(new URL(client.url).pathname)
    ));
    if (otherAdminWindows.length) {
      event.source?.postMessage({ type: 'ADMIN_UPDATE_BLOCKED' });
      return;
    }
    skipWaitingRequested = true;
    await self.skipWaiting();
  })());
});
