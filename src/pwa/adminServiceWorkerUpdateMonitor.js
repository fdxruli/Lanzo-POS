const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_UPDATE_CHECK_THROTTLE_MS = 60 * 1000;

let activeUpdateCheckPromise = null;
let lastUpdateCheckAt = 0;
let stopActiveMonitor = null;

const clearActiveCheck = (promise) => {
  if (activeUpdateCheckPromise === promise) activeUpdateCheckPromise = null;
};

export function requestAdminServiceWorkerUpdateCheck({
  navigatorTarget = globalThis.navigator,
  force = false,
  now = Date.now,
  throttleMs = DEFAULT_UPDATE_CHECK_THROTTLE_MS,
} = {}) {
  const serviceWorker = navigatorTarget?.serviceWorker;
  if (!serviceWorker?.getRegistration) {
    return Promise.resolve({ status: 'unavailable' });
  }
  if (navigatorTarget?.onLine === false) {
    return Promise.resolve({ status: 'offline' });
  }
  if (activeUpdateCheckPromise) return activeUpdateCheckPromise;

  const checkedAt = Number(now());
  if (!force && checkedAt - lastUpdateCheckAt < throttleMs) {
    return Promise.resolve({ status: 'throttled' });
  }
  lastUpdateCheckAt = checkedAt;

  const updatePromise = Promise.resolve()
    .then(() => serviceWorker.getRegistration('/'))
    .then(async (registration) => {
      if (!registration?.update) return { status: 'unavailable' };
      await registration.update();
      return { status: 'checked' };
    })
    .catch(() => ({ status: 'error' }));

  activeUpdateCheckPromise = updatePromise;
  updatePromise.then(
    () => clearActiveCheck(updatePromise),
    () => clearActiveCheck(updatePromise),
  );
  return updatePromise;
}

export function startAdminServiceWorkerUpdateMonitor({
  navigatorTarget = globalThis.navigator,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  intervalMs = DEFAULT_UPDATE_CHECK_INTERVAL_MS,
} = {}) {
  if (stopActiveMonitor) return stopActiveMonitor;

  const requestCheck = () => requestAdminServiceWorkerUpdateCheck({ navigatorTarget });
  const handleVisibilityChange = () => {
    if (documentTarget?.visibilityState === 'visible') requestCheck();
  };
  const handleResume = () => requestCheck();

  documentTarget?.addEventListener?.('visibilitychange', handleVisibilityChange);
  documentTarget?.addEventListener?.('resume', handleResume);
  windowTarget?.addEventListener?.('pageshow', handleResume);
  windowTarget?.addEventListener?.('focus', handleResume);
  windowTarget?.addEventListener?.('online', handleResume);

  const intervalId = windowTarget?.setInterval?.(requestCheck, intervalMs) ?? null;
  requestCheck();

  stopActiveMonitor = () => {
    documentTarget?.removeEventListener?.('visibilitychange', handleVisibilityChange);
    documentTarget?.removeEventListener?.('resume', handleResume);
    windowTarget?.removeEventListener?.('pageshow', handleResume);
    windowTarget?.removeEventListener?.('focus', handleResume);
    windowTarget?.removeEventListener?.('online', handleResume);
    if (intervalId !== null) windowTarget?.clearInterval?.(intervalId);
    stopActiveMonitor = null;
  };

  return stopActiveMonitor;
}

export function resetAdminServiceWorkerUpdateMonitorForTests() {
  stopActiveMonitor?.();
  stopActiveMonitor = null;
  activeUpdateCheckPromise = null;
  lastUpdateCheckAt = 0;
}
