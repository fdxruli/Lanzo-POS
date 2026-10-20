import { probeAdminOriginConnectivity } from './adminConnectivity';
import {
  getActorCheckoutOwnerships,
  getPendingActorOperations,
} from '../services/auth/actorOperationalHandoff';

const RECOVERY_ATTEMPT_KEY = 'lanzo:admin-startup-recovery:v1';
const FORCED_RECOVERY_ATTEMPT_KEY = 'lanzo:admin-startup-recovery-force:v1';
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

const LANZO_ADMIN_CACHE_NAME_PATTERN = /^lanzo-admin-(?:static|media)-v\d+$/;
const WORKBOX_PRECACHE_PREFIX_PATTERN = /^workbox-precache-v\d+-(.+)$/;
let activeStartupRecoveryPromise = null;

function getSessionStorage(windowTarget) {
  try {
    return windowTarget?.sessionStorage || null;
  } catch {
    return null;
  }
}

const actorOperationsAreIdle = () => {
  try {
    return getActorCheckoutOwnerships().length === 0
      && getPendingActorOperations().length === 0;
  } catch {
    return false;
  }
};

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
    return true;
  } catch {
    return false;
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Recovery completion must not fail because storage is restricted.
  }
}

function getRecoveryQueryValue(windowTarget) {
  try {
    return new URL(windowTarget?.location?.href || '').searchParams.get(RECOVERY_QUERY_PARAM) || '';
  } catch {
    return '';
  }
}

function hasRecoveryQueryForCurrentBuild(windowTarget) {
  const recoveryValue = getRecoveryQueryValue(windowTarget);
  return recoveryValue === BUILD_ID || recoveryValue.startsWith(`${BUILD_ID}-`);
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

export function isLanzoAdminCacheName(cacheName = '', origin = null) {
  const name = String(cacheName);
  if (LANZO_ADMIN_CACHE_NAME_PATTERN.test(name)) return true;

  if (typeof origin !== 'string' || !origin) return false;
  const match = name.match(WORKBOX_PRECACHE_PREFIX_PATTERN);
  if (!match) return false;
  try {
    const cacheUrl = new URL(match[1]);
    return cacheUrl.origin === new URL(origin).origin && cacheUrl.pathname === '/';
  } catch {
    return false;
  }
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

async function clearLanzoAdminCaches(cacheStorage, origin, isContextCurrent, isOperationSafe) {
  if (!cacheStorage?.keys || !cacheStorage?.delete) return [];

  let cacheNames = [];
  try {
    cacheNames = await cacheStorage.keys();
  } catch {
    return [];
  }

  const matchingNames = cacheNames.filter((cacheName) => isLanzoAdminCacheName(cacheName, origin));
  const deletedNames = [];
  for (const cacheName of matchingNames) {
    if (!isContextCurrent() || !isOperationSafe()) return deletedNames;
    try {
      if (await cacheStorage.delete(cacheName)) deletedNames.push(cacheName);
    } catch {
      // Continue clearing the remaining Lanzo caches.
    }
  }
  return deletedNames;
}

function buildRecoveryUrl(windowTarget) {
  const currentUrl = new URL(windowTarget.location.href);
  const recoveryUrl = new URL(currentUrl.pathname, currentUrl.origin);
  recoveryUrl.searchParams.set(RECOVERY_QUERY_PARAM, `${BUILD_ID}-${Date.now()}`);
  return recoveryUrl.toString();
}

function replaceForRecovery(windowTarget) {
  const nextUrl = buildRecoveryUrl(windowTarget);
  windowTarget.location.replace(nextUrl);
  return nextUrl;
}

async function performAdminStartupRecovery({
  error,
  force = false,
  navigatorTarget = globalThis.navigator,
  windowTarget = globalThis.window,
  cacheStorage = globalThis.caches,
  timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS,
  probeConnectivity = probeAdminOriginConnectivity,
  isContextCurrent = () => true,
  isOperationSafe = actorOperationsAreIdle,
} = {}) {
  if (!windowTarget?.location?.replace) return { status: 'unavailable' };
  if (!force && !isRecoverableAdminStartupError(error)) return { status: 'not-recoverable' };

  const contextIsCurrent = () => {
    try {
      return isContextCurrent() !== false;
    } catch {
      return false;
    }
  };
  const operationsAreSafe = () => {
    try {
      return isOperationSafe() !== false;
    } catch {
      return false;
    }
  };
  const staleContext = () => ({
    status: 'stale-context',
    strategy: 'preserve-installed-shell',
    reason: 'actor-or-tenant-context-changed',
  });
  const operationActive = () => ({
    status: 'operation-active',
    strategy: 'preserve-installed-shell',
    reason: 'actor-operation-in-progress',
  });
  if (!contextIsCurrent()) return staleContext();
  if (force && !operationsAreSafe()) return operationActive();
  if (force && navigatorTarget?.onLine === false) {
    return {
      status: 'offline',
      strategy: 'preserve-installed-shell',
      reason: 'navigator-offline',
    };
  }

  const storage = getSessionStorage(windowTarget);
  const attemptedInStorage = safeStorageRead(storage, RECOVERY_ATTEMPT_KEY) === BUILD_ID;
  const forcedAttemptInStorage = safeStorageRead(storage, FORCED_RECOVERY_ATTEMPT_KEY) === BUILD_ID;
  if (
    hasRecoveryQueryForCurrentBuild(windowTarget)
    || (!force && attemptedInStorage)
    || (force && forcedAttemptInStorage)
  ) {
    return { status: 'already-attempted' };
  }
  safeStorageWrite(storage, force ? FORCED_RECOVERY_ATTEMPT_KEY : RECOVERY_ATTEMPT_KEY, BUILD_ID);

  // Automatic chunk recovery may preserve the running shell, but it must not
  // activate a worker or reload the POS while an operation may be in flight.
  // The user can start an explicit recovery after reviewing pending work.
  if (!force) {
    return {
      status: 'preserved',
      strategy: 'preserve-installed-shell',
      reason: 'automatic-update-disabled',
    };
  }

  const serviceWorker = navigatorTarget?.serviceWorker;
  let registration = null;

  if (serviceWorker?.getRegistration) {
    try {
      registration = await serviceWorker.getRegistration('/');
    } catch {
      registration = null;
    }
    if (!contextIsCurrent()) return staleContext();
    if (!operationsAreSafe()) return operationActive();
  }

  if (registration) {
    const waitingPromise = waitForWaitingWorker(registration, windowTarget, timeoutMs);
    try {
      await registration.update?.();
    } catch {
      // A failed update check may simply mean the network disappeared.
    }
    if (!contextIsCurrent()) return staleContext();
    if (!operationsAreSafe()) return operationActive();

    const waitingWorker = registration.waiting || await waitingPromise;
    if (!contextIsCurrent()) return staleContext();
    if (!operationsAreSafe()) return operationActive();
    if (waitingWorker) {
      if (!contextIsCurrent()) return staleContext();
      if (!operationsAreSafe()) return operationActive();
      const activated = await activateWaitingWorker({
        serviceWorker,
        waitingWorker,
        windowTarget,
        timeoutMs,
      });

      if (activated) {
        if (!contextIsCurrent()) return staleContext();
        if (!operationsAreSafe()) return operationActive();
        return {
          status: 'reloading',
          strategy: 'activate-waiting-worker',
          url: replaceForRecovery(windowTarget),
        };
      }
    }
  }

  const connectivity = await probeConnectivity({
    navigatorTarget,
    windowTarget,
  });
  if (!contextIsCurrent()) return staleContext();
  if (!operationsAreSafe()) return operationActive();

  if (connectivity?.status !== 'online') {
    return {
      status: 'offline',
      strategy: 'preserve-installed-shell',
      reason: connectivity?.reason || 'origin-unreachable',
    };
  }

  const origin = new URL(windowTarget.location.href).origin;
  const clearedCaches = await clearLanzoAdminCaches(
    cacheStorage,
    origin,
    contextIsCurrent,
    operationsAreSafe,
  );
  if (!contextIsCurrent()) return staleContext();
  if (!operationsAreSafe()) return operationActive();

  return {
    status: 'reloading',
    strategy: 'reset-lanzo-shell',
    clearedCaches,
    url: replaceForRecovery(windowTarget),
  };
}

export function recoverAdminStartup(options = {}) {
  if (activeStartupRecoveryPromise) return activeStartupRecoveryPromise;
  const operation = Promise.resolve().then(() => performAdminStartupRecovery(options));
  activeStartupRecoveryPromise = operation;
  operation.then(
    () => { if (activeStartupRecoveryPromise === operation) activeStartupRecoveryPromise = null; },
    () => { if (activeStartupRecoveryPromise === operation) activeStartupRecoveryPromise = null; },
  );
  return operation;
}

export function completeAdminStartupRecovery({ windowTarget = globalThis.window } = {}) {
  if (!windowTarget) return;
  const storage = getSessionStorage(windowTarget);
  safeStorageRemove(storage, RECOVERY_ATTEMPT_KEY);
  safeStorageRemove(storage, FORCED_RECOVERY_ATTEMPT_KEY);

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
  activeStartupRecoveryPromise = null;
  safeStorageRemove(getSessionStorage(windowTarget), RECOVERY_ATTEMPT_KEY);
}
