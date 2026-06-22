import Logger from './Logger';

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const RELOAD_FLAG = 'lanzo_dev_sw_cleanup_reloaded';

export async function cleanupDevelopmentServiceWorkers() {
  if (!import.meta.env.DEV || !DEV_HOSTS.has(window.location.hostname)) {
    return true;
  }

  try {
    const registrations = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : [];

    const cacheNames = 'caches' in window
      ? await window.caches.keys()
      : [];

    if (registrations.length === 0 && cacheNames.length === 0) {
      sessionStorage.removeItem(RELOAD_FLAG);
      return true;
    }

    await Promise.all([
      ...registrations.map((registration) => registration.unregister()),
      ...cacheNames.map((cacheName) => window.caches.delete(cacheName)),
    ]);

    Logger.warn('[PWA] Service workers y caches de desarrollo eliminados.');

    if (navigator.serviceWorker?.controller && sessionStorage.getItem(RELOAD_FLAG) !== '1') {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
      return false;
    }

    sessionStorage.removeItem(RELOAD_FLAG);
    return true;
  } catch (error) {
    Logger.warn('[PWA] No se pudieron limpiar los service workers de desarrollo.', error);
    return true;
  }
}
