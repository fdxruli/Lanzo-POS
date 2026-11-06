import { APP_BUILD_ID } from '../config/appVersion';
const ACTIVATION_TIMEOUT_MS = 20_000;

const listeners = new Set();

let registration = null;
let startPromise = null;
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
  publishedBuild: null,
  updateId: null,
};

const publish = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener({ ...state }));
};

export const getAdminServiceWorkerState = () => ({ ...state });

// A differing deployment remains pending until this document actually runs it.
export function setAdminPublishedBuild(build, runningBuildId) {
  const differs = build.buildId !== runningBuildId;
  publish({ publishedBuild: build, updateId: differs ? build.buildId : null });
}

export function reloadAdminWebUpdate() {
  if (navigatorRef?.serviceWorker?.controller) {
    return Promise.reject(new Error('Actualización pendiente de completar. Vuelve a buscar actualizaciones.'));
  }
  if (navigatorRef?.onLine === false) {
    return Promise.reject(new Error('Conéctate a Internet para descargar la actualización.'));
  }
  if (!canReloadNow()) {
    return Promise.reject(new Error(getReloadBlockReason()));
  }
  return Promise.resolve(requestSafeReload());
}

export function refreshAdminServiceWorkerBuild() {
  const worker = registration?.waiting || navigatorRef?.serviceWorker?.controller;
  if (!worker || !windowRef?.MessageChannel) return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new windowRef.MessageChannel();
    const finish = buildId => {
      windowRef.clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      if (buildId && buildId !== APP_BUILD_ID) {
        publish({ updateId: buildId, reloadDeferred: !registration?.waiting || state.reloadDeferred });
      }
      resolve(buildId);
    };
    const timer = windowRef.setTimeout(() => finish(null), 1500);
    channel.port1.onmessage = event => finish(event.data?.buildId || null);
    try { worker.postMessage({ type: 'ADMIN_BUILD_INFO' }, [channel.port2]); }
    catch { finish(null); }
  });
}

function handleWorkerMessage(event) {
  if (event.data?.type !== 'ADMIN_UPDATE_BLOCKED' || !activationPromise) return;
  rejectCurrentActivation(Object.assign(new Error(
    'Cierra las otras pestañas o ventanas de LANZO POS para actualizar. Puedes seguir trabajando.'
  ), { code: 'ADMIN_UPDATE_OTHER_WINDOWS' }));
}

export function subscribeAdminServiceWorker(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAdminServiceWorkerReloadGuard(guard) {
  reloadGuard = typeof guard === 'function' ? guard : null;
}

const getReloadBlockReason = () => {
  try {
    const result = reloadGuard?.();
    return result === true ? null : typeof result === 'string' ? result : 'Termina la operación en curso antes de actualizar.';
  } catch {
    return 'No pudimos comprobar si es seguro actualizar. Inténtalo de nuevo.';
  }
};
const canReloadNow = () => getReloadBlockReason() === null;

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

function requestSafeReload() {
  if (!windowRef?.location?.reload) return false;
  if (!canReloadNow()) {
    publish({ reloadDeferred: true });
    return false;
  }
  try { windowRef.sessionStorage?.setItem('lanzo:update-target', state.updateId || ''); } catch { /* optional receipt */ }
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
      const isUpdate = Boolean(navigatorRef.serviceWorker.controller)
        || Boolean(registration.active && registration.active !== worker);
      waitingWorker = isUpdate ? (registration.waiting || worker) : null;
      publish({
        installing: false,
        waiting: Boolean(waitingWorker),
        active: !isUpdate && Boolean(registration.active),
      });
      if (isUpdate) refreshAdminServiceWorkerBuild();
    } else if (worker.state === 'activated') {
      if (waitingWorker === worker) waitingWorker = null;
      publish({ installing: false, waiting: false, active: true, error: false });
    } else if (worker.state === 'redundant') {
      if (waitingWorker === worker) waitingWorker = null;
      publish({ installing: false, waiting: Boolean(registration?.waiting), error: true });
    }
  };

  worker.addEventListener('statechange', handleStateChange);
  handleStateChange();
}

function handleControllerChange() {
  const previousController = currentController;
  currentController = navigatorRef?.serviceWorker?.controller || null;
  const isUpdate = previousController !== currentController
    && (Boolean(previousController) || skipWaitingSent || Boolean(waitingWorker));

  waitingWorker = null;
  publish({
    installing: false,
    waiting: false,
    active: Boolean(currentController || registration?.active),
    reloadDeferred: isUpdate || state.reloadDeferred,
    error: false,
  });

  if (!isUpdate) return;

  activatedUpdateObserved = true;
  // Only the tab whose user requested the update may reload automatically.
  if (activationPromise) resolveCurrentActivation(requestSafeReload());
  else publish({ reloadDeferred: true });
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
  navigatorRef.serviceWorker.addEventListener('message', handleWorkerMessage);

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

    refreshAdminServiceWorkerBuild();
    registration.addEventListener('updatefound', () => watchInstallingWorker(registration.installing));
    watchInstallingWorker(registration.installing);

    return registration;
  }).catch(() => {
    publish({ error: true });
    startPromise = null;
    navigatorRef.serviceWorker.removeEventListener?.('controllerchange', handleControllerChange);
    navigatorRef.serviceWorker.removeEventListener?.('message', handleWorkerMessage);
    return null;
  });

  return startPromise;
}

export function activateAdminServiceWorkerUpdate() {
  if (activationPromise) return activationPromise;
  if (!canReloadNow()) {
    return Promise.reject(Object.assign(
      new Error(getReloadBlockReason()),
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
      return Promise.resolve(requestSafeReload());
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
        resolveCurrentActivation(requestSafeReload());
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
  clearActivationTimer();
  navigatorRef?.serviceWorker?.removeEventListener?.('controllerchange', handleControllerChange);
  navigatorRef?.serviceWorker?.removeEventListener?.('message', handleWorkerMessage);
  listeners.clear();
  registration = null;
  startPromise = null;
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
  navigatorRef = null;
  windowRef = null;
  reloadGuard = null;
  state = { registered: false, installing: false, waiting: false, active: false, error: false, reloadDeferred: false, publishedBuild: null, updateId: null };
}
