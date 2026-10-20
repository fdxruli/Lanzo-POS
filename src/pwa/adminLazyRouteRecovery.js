import {
  isRecoverableAdminStartupError,
  recoverAdminStartup,
} from './adminStartupRecovery';
import { probeAdminOriginConnectivity } from './adminConnectivity';
import { createRecoveryContextGuard } from '../services/diagnostics/recoveryContext';

let activeLazyRouteRecoveryPromise = null;

const clearActiveRecovery = (promise) => {
  if (activeLazyRouteRecoveryPromise === promise) activeLazyRouteRecoveryPromise = null;
};

export function prepareAdminLazyRoute() {
  // The app-wide update monitor already checks for new workers. A route import
  // must not trigger a second PWA update check or delay an offline Local flow.
  return Promise.resolve({ status: 'not-required' });
}

export function recoverAdminLazyRoute({
  error,
  force = false,
  navigatorTarget = globalThis.navigator,
  recoverStartup = recoverAdminStartup,
  probeConnectivity = probeAdminOriginConnectivity,
  createContextGuard = createRecoveryContextGuard,
  isContextCurrent: suppliedContextGuard = null,
} = {}) {
  if (!force && !isRecoverableAdminStartupError(error)) {
    return Promise.resolve({ status: 'not-recoverable' });
  }
  if (navigatorTarget?.onLine === false) {
    return Promise.resolve({ status: 'offline', reason: 'navigator-offline' });
  }
  if (activeLazyRouteRecoveryPromise) return activeLazyRouteRecoveryPromise;

  const isContextCurrent = typeof suppliedContextGuard === 'function'
    ? suppliedContextGuard
    : createContextGuard();
  if (!isContextCurrent()) {
    return Promise.resolve({
      status: 'stale-context',
      reason: 'actor-or-tenant-context-changed',
    });
  }

  const recoveryPromise = Promise.resolve()
    .then(async () => {
      if (!isContextCurrent()) {
        return { status: 'stale-context', reason: 'actor-or-tenant-context-changed' };
      }

      if (force) {
        const connectivity = await probeConnectivity({ navigatorTarget });
        if (!isContextCurrent()) {
          return { status: 'stale-context', reason: 'actor-or-tenant-context-changed' };
        }
        if (connectivity?.status !== 'online') {
          return {
            status: 'offline',
            reason: connectivity?.reason || 'origin-unreachable',
          };
        }
      }

      return recoverStartup({ error, force, isContextCurrent });
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
