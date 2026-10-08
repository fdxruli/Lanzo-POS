import { lazy } from 'react';
import Logger from '../services/Logger';
import { isRecoverableAdminStartupError } from './adminStartupRecovery';
import {
  prepareAdminLazyRoute,
  recoverAdminLazyRoute,
} from './adminLazyRouteRecovery';

function EmptyOptionalAdminModule() {
  return null;
}

const EMPTY_OPTIONAL_MODULE = { default: EmptyOptionalAdminModule };

const isBrowserOffline = () => globalThis.navigator?.onLine === false;

const warnUnavailableOffline = (surfaceName) => {
  Logger.warn(`[${surfaceName}] No disponible temporalmente sin conexión; Lanzo continúa en modo Local.`);
};

/**
 * Lazy-loads an optional admin surface without letting a stale or unavailable
 * asset take down the Local shell when the browser has no connection.
 * Programming errors and online load errors still reach the app ErrorBoundary.
 */
export function createOptionalAdminLazy(importer, { surfaceName = 'Optional admin surface' } = {}) {
  return lazy(async () => {
    try {
      await prepareAdminLazyRoute();
    } catch {
      // The optional surface may still load even if the SW update check fails.
      Logger.warn(`[${surfaceName}] No se pudo comprobar si hay una versión nueva.`);
    }

    try {
      return await importer();
    } catch (error) {
      if (!isRecoverableAdminStartupError(error)) throw error;

      if (isBrowserOffline()) {
        warnUnavailableOffline(surfaceName);
        return EMPTY_OPTIONAL_MODULE;
      }

      let recoveryResult;
      try {
        recoveryResult = await recoverAdminLazyRoute({ error });
      } catch {
        Logger.warn(`[${surfaceName}] Falló la recuperación de un recurso opcional.`);
        throw error;
      }

      if (recoveryResult?.status === 'reloading') {
        return new Promise(() => {});
      }

      if (recoveryResult?.status === 'offline' || isBrowserOffline()) {
        warnUnavailableOffline(surfaceName);
        return EMPTY_OPTIONAL_MODULE;
      }

      Logger.warn(`[${surfaceName}] No se pudo recuperar el recurso opcional.`);
      throw error;
    }
  });
}
