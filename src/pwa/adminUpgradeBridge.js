import { PUBLIC_NAVIGATION_DENYLIST } from './publicNavigationPolicy';

export const ADMIN_UPGRADE_BRIDGE_CACHE = 'lanzo-admin-upgrade-bridge-v1';
export const ADMIN_UPGRADE_BRIDGE_QUERY_PARAM = '__lanzo_sw_bridge';

const PENDING_STATE_PATH = '/__lanzo_admin_upgrade_bridge_pending__';
const COMPLETED_STATE_PATH = '/__lanzo_admin_upgrade_bridge_completed__';

const stateUrl = (origin, pathname) => new URL(pathname, origin).href;

function createStateResponse(buildId) {
  return new Response(String(buildId || 'unknown'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export function isAdminUpgradeBridgeClient(clientUrl, origin) {
  try {
    const url = new URL(clientUrl, origin);
    if (url.origin !== origin) return false;
    const navigationTarget = `${url.pathname}${url.search}`;
    return !PUBLIC_NAVIGATION_DENYLIST.some((pattern) => pattern.test(navigationTarget));
  } catch {
    return false;
  }
}

export function buildAdminUpgradeBridgeUrl(clientUrl, buildId, origin) {
  const url = new URL(clientUrl, origin);
  url.searchParams.set(ADMIN_UPGRADE_BRIDGE_QUERY_PARAM, String(buildId || 'unknown'));
  return url.toString();
}

export async function requestAdminUpgradeBridgeInstall({
  registration,
  cacheStorage,
  origin,
  buildId,
  skipWaiting,
} = {}) {
  if (!registration?.active || !cacheStorage?.open || typeof skipWaiting !== 'function') {
    return { requested: false, reason: 'not-an-update' };
  }

  const cache = await cacheStorage.open(ADMIN_UPGRADE_BRIDGE_CACHE);
  const completedUrl = stateUrl(origin, COMPLETED_STATE_PATH);
  if (await cache.match(completedUrl)) {
    return { requested: false, reason: 'already-completed' };
  }

  const pendingUrl = stateUrl(origin, PENDING_STATE_PATH);
  await cache.put(pendingUrl, createStateResponse(buildId));
  await skipWaiting();

  return { requested: true, buildId: String(buildId || 'unknown') };
}

export async function activateAdminUpgradeBridge({
  clients,
  cacheStorage,
  origin,
  buildId,
} = {}) {
  if (!clients?.claim || !clients?.matchAll || !cacheStorage?.open) {
    return { activated: false, reason: 'unavailable' };
  }

  const cache = await cacheStorage.open(ADMIN_UPGRADE_BRIDGE_CACHE);
  const pendingUrl = stateUrl(origin, PENDING_STATE_PATH);
  if (!await cache.match(pendingUrl)) {
    return { activated: false, reason: 'not-pending' };
  }

  await clients.claim();
  const windowClients = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  const navigated = [];
  for (const client of windowClients) {
    if (!client?.navigate || !isAdminUpgradeBridgeClient(client.url, origin)) continue;
    const targetUrl = buildAdminUpgradeBridgeUrl(client.url, buildId, origin);
    try {
      await client.navigate(targetUrl);
      navigated.push(targetUrl);
    } catch {
      // A closed or detached window must not block activation for other clients.
    }
  }

  await cache.delete(pendingUrl);
  await cache.put(
    stateUrl(origin, COMPLETED_STATE_PATH),
    createStateResponse(buildId),
  );

  return {
    activated: true,
    buildId: String(buildId || 'unknown'),
    navigated,
  };
}
