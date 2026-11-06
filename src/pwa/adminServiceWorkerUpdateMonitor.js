import { APP_BUILD_ID } from '../config/appVersion';
import { getAdminServiceWorkerState, refreshAdminServiceWorkerBuild, setAdminPublishedBuild, startAdminServiceWorker } from './adminServiceWorker';

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_UPDATE_CHECK_THROTTLE_MS = 60 * 1000;
const CHECK_TIMEOUT_MS = 20_000;
let activeUpdateCheckPromise = null;
let registrationUpdatePromise = null;
let lastUpdateCheckAt = null;
let stopActiveMonitor = null;
let snapshot = { status: 'idle', publishedBuild: null, checkedAt: null };
const listeners = new Set();
export const getAdminUpdateCheckState = () => snapshot;
export const subscribeAdminUpdateCheck = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const publish = (patch) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(listener => listener());
};

function updateRegistration(registration) {
  // A public timeout cannot cancel the browser's native update job. Reuse it
  // until it settles so retry never creates a second outstanding update job.
  if (registrationUpdatePromise) return registrationUpdatePromise;
  const promise = Promise.resolve().then(() => registration.update());
  registrationUpdatePromise = promise;
  const clear = () => { if (registrationUpdatePromise === promise) registrationUpdatePromise = null; };
  promise.then(clear, clear);
  return promise;
}

function waitForInstallation(registration, signal) {
  const worker = registration?.installing;
  if (!worker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      worker.removeEventListener('statechange', onChange);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(new Error('installation-timeout'));
    const onChange = () => {
      if (worker.state === 'redundant') finish(new Error('installation-failed'));
      else if (['installed', 'activated'].includes(worker.state)) finish();
    };
    worker.addEventListener('statechange', onChange);
    signal.addEventListener('abort', onAbort, { once: true });
    onChange();
  });
}

export function requestAdminServiceWorkerUpdateCheck({
  navigatorTarget = globalThis.navigator,
  fetchTarget = globalThis.fetch,
  runningBuildId = APP_BUILD_ID,
  force = false,
  now = Date.now,
  throttleMs = DEFAULT_UPDATE_CHECK_THROTTLE_MS,
  timeoutMs = CHECK_TIMEOUT_MS,
} = {}) {
  if (activeUpdateCheckPromise) return activeUpdateCheckPromise;
  if (navigatorTarget?.onLine === false) {
    publish({ status: 'offline' });
    return Promise.resolve({ status: 'offline' });
  }
  const checkedAt = Number(now());
  if (!force && lastUpdateCheckAt !== null && checkedAt - lastUpdateCheckAt < throttleMs) {
    return Promise.resolve({ status: 'throttled' });
  }
  lastUpdateCheckAt = checkedAt;
  publish({ status: 'checking' });
  const abort = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(new Error('check-timeout')); }, timeoutMs);
  });
  const check = async () => {
    // Never precached: older workers also pass this non-navigation request to
    // the network. A missing endpoint / SPA fallback must never mean success.
    const response = await fetchTarget(`/build-info.json?check=${checkedAt}`, {
      cache: 'no-store', credentials: 'same-origin', signal: abort.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('invalid-build-response');
    }
    const build = await response.json();
    if (build.app !== 'lanzo-pos' || typeof build.buildId !== 'string' || !build.buildId
      || typeof build.commit !== 'string' || !build.commit
      || typeof build.version !== 'string' || !Number.isFinite(Date.parse(build.builtAt))) {
      throw new Error('invalid-build-info');
    }
    const registration = navigatorTarget?.serviceWorker?.register
      ? await startAdminServiceWorker({ navigatorTarget })
      : await navigatorTarget?.serviceWorker?.getRegistration?.('/');
    if (navigatorTarget?.serviceWorker?.register && !registration) throw new Error('registration-failed');
    if (registration) {
      await updateRegistration(registration);
      if (abort.signal.aborted) throw new Error('check-timeout');
      await waitForInstallation(registration, abort.signal);
    }
    if (abort.signal.aborted) throw new Error('check-timeout');
    await refreshAdminServiceWorkerBuild();
    if (abort.signal.aborted) throw new Error('check-timeout');
    setAdminPublishedBuild(build, runningBuildId);
    const worker = getAdminServiceWorkerState();
    const status = worker.reloadDeferred ? 'pending'
      : (registration?.waiting || build.buildId !== runningBuildId) ? 'available' : 'current';
    let completed = false;
    try {
      const storage = globalThis.window?.sessionStorage;
      completed = status === 'current' && storage?.getItem('lanzo:update-target') === runningBuildId;
      if (completed) storage.removeItem('lanzo:update-target');
    } catch { /* Receipt is optional, build comparison remains authoritative. */ }
    return { status, publishedBuild: build, checkedAt, completed };
  };
  const promise = Promise.race([check(), timeout])
    .catch(() => ({ status: navigatorTarget?.onLine === false ? 'offline' : 'error' }))
    .then(result => { publish(result); return result; })
    .finally(() => { clearTimeout(timer); if (activeUpdateCheckPromise === promise) activeUpdateCheckPromise = null; });
  activeUpdateCheckPromise = promise;
  return promise;
}

export function startAdminServiceWorkerUpdateMonitor({
  navigatorTarget = globalThis.navigator,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  fetchTarget = globalThis.fetch,
  intervalMs = DEFAULT_UPDATE_CHECK_INTERVAL_MS,
} = {}) {
  if (stopActiveMonitor) return stopActiveMonitor;

  const requestCheck = () => {
    if (documentTarget?.visibilityState === 'hidden') return;
    return requestAdminServiceWorkerUpdateCheck({ navigatorTarget, fetchTarget });
  };
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
  registrationUpdatePromise = null;
  lastUpdateCheckAt = null;
  snapshot = { status: 'idle', publishedBuild: null, checkedAt: null };
  listeners.clear();
}
