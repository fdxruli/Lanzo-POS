const RECOVERY_ATTEMPT_KEY = 'lanzo:admin-startup-recovery:v1';
const RECOVERY_QUERY_PARAM = '__lanzo_recovery';
const DEFAULT_UPDATE_TIMEOUT_MS = 5_000;
const BUILD_ID = import.meta.env.VITE_BUILD_COMMIT || import.meta.env.VITE_APP_VERSION || 'unknown';

const RECOVERABLE_ERROR_PATTERNS = Object.freeze([
  /ChunkLoadError/i,
  /Loading chunk [^ ]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Expected a JavaScript(?:-or-Wasm)? module script/i,
  /MIME type[\s\S]*text\/html/i,
  /Unexpected token ['"]?</i,
]);

const LANZO_CACHE_NAME_PATTERN = /^(?:workbox-precache|lanzo-admin-(?:static|media)-v\d+$)/;

function safeStorageRead(storage, key) {
  try {
    return storage?.getItem?.(key) || '';
  } catch {
    return '';
  }
}

function safeStorageWrite(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // Recovery must remain available when sessionStorage is restricted.
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Recovery completion must not fail because storage is restricted.
  }
}

function collectErrorText(error) {
  const parts = [];
  let current = error;
  let depth = 0;

  while (current && depth < 4) {
    if (typeof current === 'string') {
      parts.push(current);
      break;
    }
    if (current.name) parts.push(String(current.name));
    if (current.message) parts.push(String(current.message));
    current = current.cause;
    depth += 1;
  }

  return parts.join(' ');
}

export function isRecoverableAdminStartupError(error) {
  const errorText = collectErrorText(error);
  return RECOVERABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errorText));
}

export function isLanzoAdminCacheName(cacheName = '') {
  return LANZO_CACHE_NAME_PATTERN.test(String(cacheName));
}

function waitForWaitingWorker(registration, windowTarget, timeoutMs) {
  if (registration?.waiting) return Promise.resolve(registration.waiting);
  if (!registration?.addEventListener) return Promise.resolve(null);

  return new Promise((resolve) => {
    let installingWorker = registration.installing || null;
    let settled = false;
    let timeoutId = null;

    const cleanup = () => {
      registration.removeEventListener?.('updatefound', handleUpdateFound);
      installingWorker?.removeEventListener?.('statechange', handleStateChange);
      if (timeoutId !== null) windowTarget?.clearTimeout?.(timeoutId);
    };

    const finish = (worker) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(worker || null);
    };

    const handleStateChange = () => {
      if (registration.waiting) {
        finish(registration.waiting);
      } else if (installingWorker?.state === 'installed') {
        finish(installingWorker);
      } else if (installingWorker?.state === 'redundant') {
        finish(null);
      }
    };

    const watchInstallingWorker = () => {
      installingWorker?.removeEventListener?.('statechange', handleStateChange);
      installingWorker = registration.installing || null;
      installingWorker?.addEventListener?.('statechange', handleStateChange);
      handleStateChange();
    };

    const handleUpdateFound = () => watchInstallingWorker();
    registration.addEventListener('updatefound', handleUpdateFound);
    watchInstallingWorker();

    if (!settled) {
      timeoutId = windowTarget?.setTimeout?.(() => finish(registration.waiting), timeoutMs) ?? null;
    }
  });
}

function activateWaitingWorker({ serviceWorker, waitingWorker, windowTarget, timeoutMs }) {
  if (!waitingWorker?.postMessage || !serviceWorker?.addEventListener) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;

    const cleanup = () => {
      serviceWorker.removeEventListener?.('controllerchange', handleControllerChange);
      if (timeoutId !== null) windowTarget?.clearTimeout?.(timeoutId);
    };

    const finish = (activated) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(activated);
    };

    const handleControllerChange = () => finish(true);
    serviceWorker.addEventListener('controllerchange', handleControllerChange);
    timeoutId = windowTarget?.setTimeout?.(() => finish(false), timeoutMs) ?? null;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  });
}

function isRootLanzoRegistration(registration, origin) {
  try {
    const scope = new URL(registration?.scope || '', origin);
    return scope.origin === origin && scope.pathname === '/';
  } catch {
    return false;
  }
}

async function unregisterLanzoWorkers({ serviceWorker, registration, origin }) {
  let registrations = registration ? [registration] : [];

  if (serviceWorker?.getRegistrations) {
    try {
      registrations = await serviceWorker.getRegistrations();
    } catch {
      // Fall back to the registration already resolved for this startup.
    }
  }

  const lanzoRegistrations = registrations.filter((candidate) => (
    isRootLanzoRegistration(candidate, origin)
  ));

  await Promise.all(lanzoRegistrations.map(async (candidate) => {
    try {
      await candidate.unregister?.();
    } catch {
      // A failed unregister must not block the cache cleanup and network reload.
    }
  }));

  return lanzoRegistrations.length;
}

async function clearLanzoAdminCaches(cacheStorage) {
  if (!cacheStorage?.keys || !cacheStorage?.delete) return [];

  let cacheNames = [];
  try {
    cacheNames = await cacheStorage.keys();
  } catch {
    return [];
  }

  const matchingNames = cacheNames.filter(isLanzoAdminCacheName);
  await Promise.all(matchingNames.map(async (cacheName) => {
    try {
      await cacheStorage.delete(cacheName);
    } catch {
      // Continue clearing the remaining Lanzo caches.
    }
  }));
  return matchingNames;
}

function buildRecoveryUrl(windowTarget) {
  const currentUrl = new URL(windowTarget.location.href);
  currentUrl.searchParams.set(RECOVERY_QUERY_PARAM, `${BUILD_ID}-${Date.now()}`);
  return currentUrl.toString();
}

function replaceForRecovery(windowTarget) {
  const nextUrl = buildRecoveryUrl(windowTarget);
  windowTarget.location.replace(nextUrl);
  return nextUrl;
}

export async function recoverAdminStartup({
  error,
  force = false,
  navigatorTarget = globalThis.navigator,
  windowTarget = globalThis.window,
  cacheStorage = globalThis.caches,
  timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS,
} = {}) {
  if (!windowTarget?.location?.replace) return { status: 'unavailable' };
  if (!force && !isRecoverableAdminStartupError(error)) return { status: 'not-recoverable' };

  const storage = windowTarget.sessionStorage;
  if (!force && safeStorageRead(storage, RECOVERY_ATTEMPT_KEY) === BUILD_ID) {
    return { status: 'already-attempted' };
  }
  safeStorageWrite(storage, RECOVERY_ATTEMPT_KEY, BUILD_ID);

  const serviceWorker = navigatorTarget?.serviceWorker;
  let registration = null;

  if (serviceWorker?.getRegistration) {
    try {
      registration = await serviceWorker.getRegistration('/');
    } catch {
      registration = null;
    }
  }

  if (registration) {
    const waitingPromise = waitForWaitingWorker(registration, windowTarget, timeoutMs);
    try {
      await registration.update?.();
    } catch {
      // The hard reset below remains available when the update check fails.
    }

    const waitingWorker = registration.waiting || await waitingPromise;
    if (waitingWorker) {
      const activated = await activateWaitingWorker({
        serviceWorker,
        waitingWorker,
        windowTarget,
        timeoutMs,
      });

      if (activated) {
        return {
          status: 'reloading',
          strategy: 'activate-waiting-worker',
          url: replaceForRecovery(windowTarget),
        };
      }
    }
  }

  const origin = new URL(windowTarget.location.href).origin;
  const [unregisteredWorkers, clearedCaches] = await Promise.all([
    unregisterLanzoWorkers({ serviceWorker, registration, origin }),
    clearLanzoAdminCaches(cacheStorage),
  ]);

  return {
    status: 'reloading',
    strategy: 'reset-lanzo-shell',
    unregisteredWorkers,
    clearedCaches,
    url: replaceForRecovery(windowTarget),
  };
}

export function completeAdminStartupRecovery({ windowTarget = globalThis.window } = {}) {
  if (!windowTarget) return;
  safeStorageRemove(windowTarget.sessionStorage, RECOVERY_ATTEMPT_KEY);

  try {
    const currentUrl = new URL(windowTarget.location.href);
    if (!currentUrl.searchParams.has(RECOVERY_QUERY_PARAM)) return;
    currentUrl.searchParams.delete(RECOVERY_QUERY_PARAM);
    windowTarget.history?.replaceState?.(
      windowTarget.history.state,
      '',
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
  } catch {
    // Query cleanup is cosmetic and must never affect successful startup.
  }
}

export function resetAdminStartupRecoveryForTests({ windowTarget = globalThis.window } = {}) {
  safeStorageRemove(windowTarget?.sessionStorage, RECOVERY_ATTEMPT_KEY);
}
