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
import { PUBLIC_NAVIGATION_DENYLIST, isPublicNavigationRequest } from './publicNavigationPolicy';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

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

self.addEventListener('activate', (event) => {
  event.waitUntil(cleanupObsoleteAdminRuntimeCaches(self.caches));
});

let skipWaitingRequested = false;
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SKIP_WAITING' || skipWaitingRequested) return;
  skipWaitingRequested = true;
  event.waitUntil(self.skipWaiting());
});
