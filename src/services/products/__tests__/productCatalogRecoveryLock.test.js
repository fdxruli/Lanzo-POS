import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithProductCatalogRecoveryLock } from '../productCatalogRecoveryLock';

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

describe('product catalog recovery lock', () => {
  it('serializes the general and individual recovery paths under the same tenant lock', async () => {
    let tail = Promise.resolve();
    const request = vi.fn(async (_name, _options, callback) => {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback({ name: 'lock' });
      } finally {
        release();
      }
    });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });

    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const secondStarted = vi.fn();
    const first = runWithProductCatalogRecoveryLock({
      licenseKey: 'tenant-a',
      operation: async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
        return 'general';
      }
    });
    await firstStarted.promise;
    const second = runWithProductCatalogRecoveryLock({
      licenseKey: 'tenant-a',
      operation: async () => {
        secondStarted();
        return 'individual';
      }
    });

    expect(secondStarted).not.toHaveBeenCalled();
    releaseFirst.resolve();
    await expect(first).resolves.toBe('general');
    await expect(second).resolves.toBe('individual');
    expect(secondStarted).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
  });

  it('fails closed for individual recovery when Web Locks are unavailable', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    await expect(runWithProductCatalogRecoveryLock({
      licenseKey: 'tenant-a',
      requireWebLock: true,
      operation: vi.fn()
    })).rejects.toMatchObject({ code: 'PRODUCT_RECOVERY_LOCK_UNAVAILABLE' });
  });
});
