import Logger from './Logger';
import { isLanzoAdminCacheName } from '../pwa/adminStartupRecovery';
import { classifyIncident } from './diagnostics/incidentDiagnostics';

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const RELOAD_FLAG = 'lanzo_dev_sw_cleanup_reloaded';

const getOwnedDevelopmentWorkers = (registrations, origin) => registrations.filter((registration) => {
  try {
    const scope = new URL(registration?.scope || '', origin);
    const worker = registration?.active || registration?.waiting || registration?.installing;
    const script = new URL(worker?.scriptURL || '', origin);
    return scope.origin === origin
      && scope.pathname === '/'
      && script.origin === origin
      && ['/sw.js', '/dev-sw.js'].includes(script.pathname);
  } catch {
    return false;
  }
});

const getReloadFlag = () => {
  try { return sessionStorage.getItem(RELOAD_FLAG); } catch { return null; }
};

const setReloadFlag = (value) => {
  try { sessionStorage.setItem(RELOAD_FLAG, value); } catch { /* cleanup remains safe without the marker */ }
};

const clearReloadFlag = () => {
  try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* no unrelated session data is touched */ }
};

export async function cleanupDevelopmentServiceWorkers() {
  if (!import.meta.env.DEV || !DEV_HOSTS.has(window.location.hostname)) {
    return true;
  }

  try {
    const allRegistrations = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : [];
    const origin = window.location.origin;
    const registrations = getOwnedDevelopmentWorkers(allRegistrations, origin);

    const allCacheNames = 'caches' in window
      ? await window.caches.keys()
      : [];
    const cacheNames = allCacheNames.filter((cacheName) => isLanzoAdminCacheName(cacheName, origin));

    if (registrations.length === 0 && cacheNames.length === 0) {
      clearReloadFlag();
      return true;
    }

    await Promise.all([
      ...registrations.map((registration) => registration.unregister()),
      ...cacheNames.map((cacheName) => window.caches.delete(cacheName)),
    ]);

    Logger.warn('[PWA] Service workers y caches de desarrollo eliminados.');

    if (navigator.serviceWorker?.controller && getReloadFlag() !== '1') {
      setReloadFlag('1');
      window.location.reload();
      return false;
    }

    clearReloadFlag();
    return true;
  } catch (error) {
    const incident = classifyIncident(error, { category: 'pwa' });
    Logger.warn('[PWA] No se pudieron limpiar los recursos propios de desarrollo.', {
      code: incident.code,
      category: incident.category,
      severity: incident.severity,
    });
    return true;
  }
}
