import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_REQUEST_RESPONSE_STALE_CODE,
  CLOUD_RESPONSE_ORIGINS,
  cloudRequestManager
} from './cloudRequestManager';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const readRequest = ({ key, force = false, fn, allowCache = true } = {}) => cloudRequestManager.request({
  key,
  rpcName: 'pos_get_sales_final_overview',
  tags: ['cash'],
  ttlMs: 60_000,
  force,
  allowCache,
  fn
});

beforeEach(() => {
  cloudRequestManager.clear();
});

describe('cloudRequestManager cash recovery generations', () => {
  it('force starts a new request while the previous one is in flight and discards its result', async () => {
    const oldResponse = deferred();
    const call = vi.fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce({ station: 'cash_station_device_B' });

    const oldRequest = readRequest({ key: 'cash-recovery-force', fn: call });
    await Promise.resolve();

    const newRequest = readRequest({
      key: 'cash-recovery-force',
      force: true,
      fn: call
    });
    await expect(newRequest).resolves.toMatchObject({
      station: 'cash_station_device_B',
      cloudRequestMeta: {
        origin: CLOUD_RESPONSE_ORIGINS.NETWORK,
        generation: 1
      }
    });
    expect(call).toHaveBeenCalledTimes(2);

    oldResponse.resolve({ station: 'cash_station_device_A' });
    await expect(oldRequest).rejects.toMatchObject({
      code: CLOUD_REQUEST_RESPONSE_STALE_CODE,
      origin: CLOUD_RESPONSE_ORIGINS.STALE,
      generation: 0
    });

    expect(cloudRequestManager.getResponseAudit({ key: 'cash-recovery-force' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ origin: CLOUD_RESPONSE_ORIGINS.NETWORK, generation: 1 }),
        expect.objectContaining({ origin: CLOUD_RESPONSE_ORIGINS.STALE, generation: 0 })
      ]));
  });

  it('marks cache and deduped in-flight responses without treating them as network responses', async () => {
    const cacheKey = 'cash-recovery-cache-origin';
    const fetch = vi.fn().mockResolvedValue({ station: 'cash_station_device_A' });

    const networkResponse = await readRequest({ key: cacheKey, fn: fetch });
    const cacheResponse = await readRequest({ key: cacheKey, fn: fetch });

    expect(networkResponse.cloudRequestMeta).toMatchObject({ origin: CLOUD_RESPONSE_ORIGINS.NETWORK });
    expect(cacheResponse.cloudRequestMeta).toMatchObject({ origin: CLOUD_RESPONSE_ORIGINS.CACHE });
    expect(fetch).toHaveBeenCalledTimes(1);

    const inFlight = deferred();
    const inFlightKey = 'cash-recovery-in-flight-origin';
    const inFlightFetch = vi.fn(() => inFlight.promise);
    const first = readRequest({ key: inFlightKey, fn: inFlightFetch });
    await Promise.resolve();
    const second = readRequest({ key: inFlightKey, fn: inFlightFetch });
    inFlight.resolve({ station: 'cash_station_device_A' });

    await expect(first).resolves.toMatchObject({
      cloudRequestMeta: { origin: CLOUD_RESPONSE_ORIGINS.NETWORK }
    });
    await expect(second).resolves.toMatchObject({
      cloudRequestMeta: { origin: CLOUD_RESPONSE_ORIGINS.IN_FLIGHT }
    });
    expect(inFlightFetch).toHaveBeenCalledTimes(1);
  });

  it('invalidates older responses after a transport failure even without navigator.offline', async () => {
    const oldResponse = deferred();
    const oldRequest = readRequest({
      key: 'cash-recovery-old-station',
      fn: () => oldResponse.promise
    });
    await Promise.resolve();

    const transportRequest = readRequest({
      key: 'cash-recovery-transport',
      fn: () => Promise.reject(new TypeError('Failed to fetch'))
    });
    await expect(transportRequest).rejects.toMatchObject({
      message: 'Failed to fetch',
      requestId: 'cloud-8',
      generation: 0,
      responseOrigin: CLOUD_RESPONSE_ORIGINS.NETWORK
    });

    oldResponse.resolve({ station: 'cash_station_device_B' });
    await expect(oldRequest).rejects.toMatchObject({
      code: CLOUD_REQUEST_RESPONSE_STALE_CODE,
      origin: CLOUD_RESPONSE_ORIGINS.STALE,
      reason: 'connection_lost'
    });
  });
});
