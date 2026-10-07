import {
  isRecoverableAdminStartupError,
  recoverAdminStartup,
} from './adminStartupRecovery';
import { probeAdminOriginConnectivity } from './adminConnectivity';
import { requestAdminServiceWorkerUpdateCheck } from './adminServiceWorkerUpdateMonitor';

let activeLazyRouteRecoveryPromise = null;

const clearActiveRecovery = (promise) => {
  if (activeLazyRouteRecoveryPromise === promise) activeLazyRouteRecoveryPromise = null;
};

export function prepareAdminLazyRoute() {
  return requestAdminServiceWorkerUpdateCheck();
}

export function recoverAdminLazyRoute({
  error,
  force = false,
  navigatorTarget = globalThis.navigator,
  recoverStartup = recoverAdminStartup,
  probeConnectivity = probeAdminOriginConnectivity,
} = {}) {
  if (!force && !isRecoverableAdminStartupError(error)) {
    return Promise.resolve({ status: 'not-recoverable' });
  }
  if (navigatorTarget?.onLine === false) {
    return Promise.resolve({ status: 'offline', reason: 'navigator-offline' });
  }
  if (activeLazyRouteRecoveryPromise) return activeLazyRouteRecoveryPromise;

  const recoveryPromise = Promise.resolve()
    .then(async () => {
      const connectivity = await probeConnectivity({ navigatorTarget });
      if (connectivity?.status !== 'online') {
        return {
          status: 'offline',
          reason: connectivity?.reason || 'origin-unreachable',
        };
      }

      return recoverStartup({ error, force });
    });

  activeLazyRouteRecoveryPromise = recoveryPromise;
  recoveryPromise.then(
    () => clearActiveRecovery(recoveryPromise),
    () => clearActiveRecovery(recoveryPromise),
  );
  return recoveryPromise;
}

export function resetAdminLazyRouteRecoveryForTests() {
  activeLazyRouteRecoveryPromise = null;
}
