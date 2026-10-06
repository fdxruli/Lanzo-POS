// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { probeAdminOriginConnectivity } from '../adminConnectivity';

function createWindowTarget() {
  return {
    location: {
      href: 'https://lanzo-pos.vercel.app/ventas',
    },
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
  };
}

describe('admin origin connectivity probe', () => {
  it('trusts an explicit browser offline state without issuing a request', async () => {
    const fetchImpl = vi.fn();

    await expect(probeAdminOriginConnectivity({
      navigatorTarget: { onLine: false },
      windowTarget: createWindowTarget(),
      fetchImpl,
    })).resolves.toEqual({
      status: 'offline',
      reason: 'navigator-offline',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('detects a real network failure while navigator.onLine is still true', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(probeAdminOriginConnectivity({
      navigatorTarget: { onLine: true },
      windowTarget: createWindowTarget(),
      fetchImpl,
      timeoutMs: 0,
    })).resolves.toEqual({
      status: 'offline',
      reason: 'probe-failed',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/__lanzo_connectivity_probe__');
    expect(options).toMatchObject({
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
  });

  it('treats any same-origin HTTP response as proof that the origin is reachable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 404 });

    await expect(probeAdminOriginConnectivity({
      navigatorTarget: { onLine: true },
      windowTarget: createWindowTarget(),
      fetchImpl,
      timeoutMs: 0,
    })).resolves.toEqual({
      status: 'online',
      reason: 'origin-reachable',
    });
  });
});
