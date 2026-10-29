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
let activationWorker = null;
let controllerAtActivationStart = null;
let skipWaitingSent = false;
let currentController = null;
let activatedUpdateObserved = false;
let reloadRequested = false;
let reloadGuard = null;
let navigatorRef = null;
let windowRef = null;

let state = {
  registered: false,
  installing: false,
  waiting: false,
  active: false,
  error: false,
  reloadDeferred: false,
};

// The POS installs a synchronous guard after bootstrap. Keep this startup
// module independent of business stores; absence/exception is fail-closed.
export function setAdminServiceWorkerReloadGuard(guard) {
  reloadGuard = typeof guard === 'function' ? guard : null;
}

function canReloadNow() {
  try { return reloadGuard?.() === true; } catch { return false; }
}

const publish = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener({ ...state }));
};

export const getAdminServiceWorkerState = () => ({ ...state });

export function subscribeAdminServiceWorker(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function clearActivationTimer() {
  if (activationTimeout === null || activationTimeout === undefined || !windowRef) return;
  windowRef.clearTimeout(activationTimeout);
  activationTimeout = null;
}

function resolveCurrentActivation(reloaded) {
  const resolve = resolveActivation;
  clearActivationTimer();
  activationPromise = null;
  activationWorker = null;
  controllerAtActivationStart = null;
  resolveActivation = null;
  rejectActivation = null;
  resolve?.(reloaded);
}

function rejectCurrentActivation(error) {
  const reject = rejectActivation;
  clearActivationTimer();
  activationPromise = null;
  activationWorker = null;
  controllerAtActivationStart = null;
  resolveActivation = null;
  rejectActivation = null;
  skipWaitingSent = false;
  reject?.(error);
}

function reloadOnce() {
  if (reloadRequested) return true;
  if (!windowRef?.location?.reload) return false;
  if (!canReloadNow()) {
    publish({ reloadDeferred: true });
    return false;
  }
  reloadRequested = true;
  publish({ reloadDeferred: false });
  windowRef.location.reload();
  return true;
}

function workerHasActivated(worker) {
  return worker?.state === 'activated'
    || (Boolean(worker) && registration?.active === worker);
}

function watchInstallingWorker(worker) {
  if (!worker) return;
  skipWaitingSent = false;
  activatedUpdateObserved = false;
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
      if (waitingWorker === worker) waitingWorker = null;
      publish({ installing: false, waiting: false, active: true, error: false });
    } else if (worker.state === 'redundant') {
      if (waitingWorker === worker) waitingWorker = null;
      publish({ installing: false, waiting: Boolean(registration?.waiting) });
    }
  };

  worker.addEventListener('statechange', handleStateChange);
}

function handleControllerChange() {
  const previousController = currentController;
  currentController = navigatorRef?.serviceWorker?.controller || null;
  const isUpdate = Boolean(previousController) || skipWaitingSent || Boolean(waitingWorker);

  waitingWorker = null;
  publish({
    installing: false,
    waiting: false,
    active: Boolean(currentController || registration?.active),
    error: false,
  });

  if (!isUpdate) return;

  activatedUpdateObserved = true;
  resolveCurrentActivation(reloadOnce());
}

export function startAdminServiceWorker({
  navigatorTarget = navigator,
  windowTarget = window,
} = {}) {
  if (startPromise) return startPromise;
  navigatorRef = navigatorTarget;
  windowRef = windowTarget;
  currentController = navigatorRef.serviceWorker?.controller || null;

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
      active: Boolean(registration.active || currentController),
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
  if (!canReloadNow()) {
    return Promise.reject(Object.assign(
      new Error('Termina la operación en curso antes de actualizar.'),
      { code: 'ADMIN_UPDATE_OPERATION_ACTIVE' }
    ));
  }

  const registeredWaitingWorker = registration?.waiting || null;
  if (registeredWaitingWorker) waitingWorker = registeredWaitingWorker;

  const candidateWorker = waitingWorker;
  const controllerNow = navigatorRef?.serviceWorker?.controller || null;
  const activationAlreadyCompleted = activatedUpdateObserved
    || workerHasActivated(candidateWorker)
    || (
      Boolean(currentController)
      && Boolean(controllerNow)
      && currentController !== controllerNow
    );

  if (!candidateWorker || candidateWorker.state === 'activated') {
    if (activationAlreadyCompleted) {
      waitingWorker = null;
      publish({ waiting: false, active: true, error: false });
      return Promise.resolve(reloadOnce());
    }
    return Promise.reject(new Error('No hay un Service Worker en espera.'));
  }

  activationWorker = candidateWorker;
  controllerAtActivationStart = controllerNow;
  activationPromise = new Promise((resolve, reject) => {
    resolveActivation = resolve;
    rejectActivation = reject;
    activationTimeout = windowRef.setTimeout(() => {
      const controllerAfterTimeout = navigatorRef?.serviceWorker?.controller || null;
      const activationCompleted = workerHasActivated(activationWorker)
        || (
          Boolean(controllerAtActivationStart)
          && Boolean(controllerAfterTimeout)
          && controllerAtActivationStart !== controllerAfterTimeout
        );

      if (activationCompleted) {
        activatedUpdateObserved = true;
        waitingWorker = null;
        publish({ waiting: false, active: true, error: false });
        resolveCurrentActivation(reloadOnce());
        return;
      }

      rejectCurrentActivation(new Error('La activación del Service Worker agotó el tiempo de espera.'));
    }, ACTIVATION_TIMEOUT_MS);
  });
  const pendingActivation = activationPromise;

  if (!skipWaitingSent) {
    try {
      skipWaitingSent = true;
      candidateWorker.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      rejectCurrentActivation(error);
    }
  }

  return pendingActivation;
}

export function resetAdminServiceWorkerForTests() {
  if (updateInterval && windowRef) windowRef.clearInterval(updateInterval);
  clearActivationTimer();
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
  activationWorker = null;
  controllerAtActivationStart = null;
  skipWaitingSent = false;
  currentController = null;
  activatedUpdateObserved = false;
  reloadRequested = false;
  navigatorRef = null;
  windowRef = null;
  reloadGuard = null;
  state = { registered: false, installing: false, waiting: false, active: false, error: false, reloadDeferred: false };
}
