export const ADMIN_UPGRADE_BRIDGE_CACHE = 'lanzo-admin-upgrade-bridge-v1';

const PENDING_STATE_PATH = '/__lanzo_admin_upgrade_bridge_pending__';
const COMPLETED_STATE_PATH = '/__lanzo_admin_upgrade_bridge_completed__';

const stateUrl = (origin, pathname) => new URL(pathname, origin).href;

function createStateResponse(buildId) {
  return new Response(String(buildId || 'unknown'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Records that the one-time legacy bridge is available, but leaves the new
 * worker waiting for the app's explicit update flow to activate it.
 */
export async function requestAdminUpgradeBridgeInstall({
  registration,
  cacheStorage,
  origin,
  buildId,
} = {}) {
  if (!registration?.active || !cacheStorage?.open) {
    return { requested: false, reason: 'not-an-update' };
  }

  const cache = await cacheStorage.open(ADMIN_UPGRADE_BRIDGE_CACHE);
  const completedUrl = stateUrl(origin, COMPLETED_STATE_PATH);
  if (await cache.match(completedUrl)) {
    return { requested: false, reason: 'already-completed' };
  }

  const pendingUrl = stateUrl(origin, PENDING_STATE_PATH);
  await cache.put(pendingUrl, createStateResponse(buildId));

  return { requested: true, buildId: String(buildId || 'unknown') };
}

/**
 * Claims clients after an explicitly activated bridge update. Each tab handles
 * its own controllerchange and can defer reload while an operation is active.
 */
export async function activateAdminUpgradeBridge({
  clients,
  cacheStorage,
  origin,
  buildId,
} = {}) {
  if (!clients?.claim || !cacheStorage?.open) {
    return { activated: false, reason: 'unavailable' };
  }

  const cache = await cacheStorage.open(ADMIN_UPGRADE_BRIDGE_CACHE);
  const pendingUrl = stateUrl(origin, PENDING_STATE_PATH);
  if (!await cache.match(pendingUrl)) {
    return { activated: false, reason: 'not-pending' };
  }

  await clients.claim();
  await cache.delete(pendingUrl);
  await cache.put(
    stateUrl(origin, COMPLETED_STATE_PATH),
    createStateResponse(buildId),
  );

  return {
    activated: true,
    buildId: String(buildId || 'unknown'),
  };
}
