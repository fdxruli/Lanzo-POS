const DEFAULT_CONNECTIVITY_PROBE_TIMEOUT_MS = 1_500;
const CONNECTIVITY_PROBE_PATH = '/api/__lanzo_connectivity_probe__';

function getWindowOrigin(windowTarget) {
  try {
    return new URL(windowTarget?.location?.href || '').origin;
  } catch {
    return '';
  }
}

export async function probeAdminOriginConnectivity({
  navigatorTarget = globalThis.navigator,
  windowTarget = globalThis.window,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_CONNECTIVITY_PROBE_TIMEOUT_MS,
} = {}) {
  if (navigatorTarget?.onLine === false) {
    return { status: 'offline', reason: 'navigator-offline' };
  }

  const origin = getWindowOrigin(windowTarget);
  if (!origin || typeof fetchImpl !== 'function') {
    return { status: 'unknown', reason: 'probe-unavailable' };
  }

  const probeUrl = new URL(CONNECTIVITY_PROBE_PATH, origin);
  probeUrl.searchParams.set('__lanzo_probe', String(Date.now()));

  const controller = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  let timeoutId = null;

  if (controller && timeoutMs > 0 && windowTarget?.setTimeout) {
    timeoutId = windowTarget.setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    await fetchImpl(probeUrl.toString(), {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
      ...(controller ? { signal: controller.signal } : {}),
    });

    return { status: 'online', reason: 'origin-reachable' };
  } catch (error) {
    return {
      status: 'offline',
      reason: error?.name === 'AbortError' ? 'probe-timeout' : 'probe-failed',
    };
  } finally {
    if (timeoutId !== null) {
      windowTarget?.clearTimeout?.(timeoutId);
    }
  }
}
