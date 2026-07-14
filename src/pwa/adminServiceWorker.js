const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVATION_TIMEOUT_MS = 20_000;

const listeners = new Set();

let registration = null;
let startPromise = null;
let updateInterval = null;
let waitingWorker = null;
let activationPromise = null;
let resolveActivation = null;
let rejectActivation = null;
let activationTimeout = null;
let skipWaitingSent = false;
let controllerChangeHandled = false;
let navigatorRef = null;
let windowRef = null;

let state = {
  registered: false,
  installing: false,
  waiting: false,
  active: false,
  error: false,
};

const publish = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener({ ...state }));
};

export const getAdminServiceWorkerState = () => ({ ...state });

export function subscribeAdminServiceWorker(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function watchInstallingWorker(worker) {
  if (!worker) return;
  publish({ installing: true });

  const handleStateChange = () => {
    if (worker.state === 'installed') {
      const isUpdate = Boolean(navigatorRef.serviceWorker.controller);
      waitingWorker = isUpdate ? (registration.waiting || worker) : null;
      publish({
        installing: false,
        waiting: Boolean(waitingWorker),
        active: !isUpdate && Boolean(registration.active),
      });
    } else if (worker.state === 'activated') {
      publish({ installing: false, active: true });
    } else if (worker.state === 'redundant') {
      publish({ installing: false });
    }
  };

  worker.addEventListener('statechange', handleStateChange);
}

function handleControllerChange() {
  if (!skipWaitingSent || controllerChangeHandled) return;
  controllerChangeHandled = true;
  waitingWorker = null;
  publish({ waiting: false, active: true });

  if (activationTimeout) windowRef.clearTimeout(activationTimeout);
  resolveActivation?.(true);
  resolveActivation = null;
  rejectActivation = null;

  windowRef.location.reload();
}

export function startAdminServiceWorker({
  navigatorTarget = navigator,
  windowTarget = window,
} = {}) {
  if (startPromise) return startPromise;
  navigatorRef = navigatorTarget;
  windowRef = windowTarget;

  if (!navigatorRef.serviceWorker?.register) {
    publish({ error: true });
    startPromise = Promise.resolve(null);
    return startPromise;
  }

  navigatorRef.serviceWorker.addEventListener('controllerchange', handleControllerChange);

  startPromise = navigatorRef.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  }).then((nextRegistration) => {
    registration = nextRegistration;
    waitingWorker = registration.waiting || null;
    publish({
      registered: true,
      waiting: Boolean(waitingWorker),
      active: Boolean(registration.active),
      error: false,
    });

    registration.addEventListener('updatefound', () => watchInstallingWorker(registration.installing));
    watchInstallingWorker(registration.installing);

    updateInterval = windowRef.setInterval(() => {
      if (navigatorRef.onLine === false) return;
      registration.update().catch(() => publish({ error: true }));
    }, CHECK_INTERVAL_MS);

    return registration;
  }).catch(() => {
    publish({ error: true });
    return null;
  });

  return startPromise;
}

export function activateAdminServiceWorkerUpdate() {
  if (activationPromise) return activationPromise;
  waitingWorker = registration?.waiting || waitingWorker;

  if (!waitingWorker) return Promise.reject(new Error('No hay un Service Worker en espera.'));

  activationPromise = new Promise((resolve, reject) => {
    resolveActivation = resolve;
    rejectActivation = reject;
    activationTimeout = windowRef.setTimeout(() => {
      rejectActivation?.(new Error('La activación del Service Worker agotó el tiempo de espera.'));
      resolveActivation = null;
      rejectActivation = null;
      activationPromise = null;
    }, ACTIVATION_TIMEOUT_MS);
  });

  if (!skipWaitingSent) {
    skipWaitingSent = true;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }

  return activationPromise;
}

export function resetAdminServiceWorkerForTests() {
  if (updateInterval && windowRef) windowRef.clearInterval(updateInterval);
  if (activationTimeout && windowRef) windowRef.clearTimeout(activationTimeout);
  navigatorRef?.serviceWorker?.removeEventListener?.('controllerchange', handleControllerChange);
  listeners.clear();
  registration = null;
  startPromise = null;
  updateInterval = null;
  waitingWorker = null;
  activationPromise = null;
  resolveActivation = null;
  rejectActivation = null;
  activationTimeout = null;
  skipWaitingSent = false;
  controllerChangeHandled = false;
  navigatorRef = null;
  windowRef = null;
  state = { registered: false, installing: false, waiting: false, active: false, error: false };
}
