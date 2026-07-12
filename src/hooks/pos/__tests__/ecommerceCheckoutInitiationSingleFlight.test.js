import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearEcommerceCheckoutInitiationIfOwned,
  ecommerceCheckoutInitiationSingleFlightInternals,
  getEcommerceCheckoutInitiation,
  runEcommerceCheckoutInitiationSingleFlight
} from '../ecommerceCheckoutInitiationSingleFlight';

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  ecommerceCheckoutInitiationSingleFlightInternals.resetEcommerceCheckoutInitiations();
});

describe('ecommerce checkout initiation single-flight', () => {
  it('shares one operation across ten simultaneous calls for the same order', async () => {
    const deferred = createDeferred();
    const result = { success: true, modalOpened: true };
    const run = vi.fn(() => deferred.promise);
    const onStart = vi.fn();
    const onSettled = vi.fn();

    const calls = Array.from({ length: 10 }, () => (
      runEcommerceCheckoutInitiationSingleFlight({
        orderId: 'ecom-order-1',
        onStart,
        run,
        onSettled
      })
    ));

    expect(calls.every((promise) => promise === calls[0])).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(getEcommerceCheckoutInitiation('ecom-order-1')?.promise).toBe(calls[0]);

    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    deferred.resolve(result);
    const results = await Promise.all(calls);

    expect(results).toEqual(Array.from({ length: 10 }, () => result));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(getEcommerceCheckoutInitiation('ecom-order-1')).toBeNull();
  });

  it('does not let an old operation clear a newer entry for the same order', async () => {
    const firstDeferred = createDeferred();
    const firstOperation = runEcommerceCheckoutInitiationSingleFlight({
      orderId: 'ecom-order-1',
      run: () => firstDeferred.promise
    });
    const firstToken = getEcommerceCheckoutInitiation('ecom-order-1').token;

    firstDeferred.resolve({ success: true, attempt: 'a' });
    await firstOperation;

    const secondDeferred = createDeferred();
    const secondOperation = runEcommerceCheckoutInitiationSingleFlight({
      orderId: 'ecom-order-1',
      run: () => secondDeferred.promise
    });
    const secondEntry = getEcommerceCheckoutInitiation('ecom-order-1');

    expect(secondEntry.token).not.toBe(firstToken);
    expect(clearEcommerceCheckoutInitiationIfOwned('ecom-order-1', firstToken)).toBe(false);
    expect(getEcommerceCheckoutInitiation('ecom-order-1')).toBe(secondEntry);

    secondDeferred.resolve({ success: true, attempt: 'b' });
    await secondOperation;
    expect(getEcommerceCheckoutInitiation('ecom-order-1')).toBeNull();
  });

  it('releases a failed operation so a later click can retry', async () => {
    const firstFailure = new Error('first initiation failed');
    const firstRun = vi.fn(() => Promise.reject(firstFailure));

    await expect(runEcommerceCheckoutInitiationSingleFlight({
      orderId: 'ecom-order-1',
      run: firstRun
    })).rejects.toThrow(firstFailure.message);

    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(getEcommerceCheckoutInitiation('ecom-order-1')).toBeNull();

    const secondRun = vi.fn(() => Promise.resolve({ success: true }));
    await expect(runEcommerceCheckoutInitiationSingleFlight({
      orderId: 'ecom-order-1',
      run: secondRun
    })).resolves.toEqual({ success: true });

    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('allows different orders to initiate independently', async () => {
    const orderA = createDeferred();
    const orderB = createDeferred();
    const runA = vi.fn(() => orderA.promise);
    const runB = vi.fn(() => orderB.promise);

    const promiseA = runEcommerceCheckoutInitiationSingleFlight({
      orderId: 'ecom-order-a',
      run: runA
    });
    const promiseB = runEcommerceCheckoutInitiationSingleFlight({
      orderId: 'ecom-order-b',
      run: runB
    });

    await Promise.resolve();
    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).toHaveBeenCalledTimes(1);
    expect(getEcommerceCheckoutInitiation('ecom-order-a')).not.toBeNull();
    expect(getEcommerceCheckoutInitiation('ecom-order-b')).not.toBeNull();

    orderA.resolve({ orderId: 'a' });
    orderB.resolve({ orderId: 'b' });

    await expect(Promise.all([promiseA, promiseB])).resolves.toEqual([
      { orderId: 'a' },
      { orderId: 'b' }
    ]);
  });

  it('does not change a successful result when visual cleanup throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runEcommerceCheckoutInitiationSingleFlight({
      orderId: 'ecom-order-1',
      run: () => Promise.resolve({ success: true }),
      onSettled: () => {
        throw new Error('visual cleanup failed');
      }
    })).resolves.toEqual({ success: true });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(getEcommerceCheckoutInitiation('ecom-order-1')).toBeNull();
    consoleError.mockRestore();
  });
});
