import { describe, expect, it, vi } from 'vitest';
import {
  CASH_NETWORK_UNAVAILABLE_CODE,
  CASH_NETWORK_UNAVAILABLE_MESSAGE,
  isCashNetworkUnavailableError,
  normalizeCashNetworkError
} from './cashNetwork';

describe('cash network recovery classification', () => {
  it.each([
    ['ERR_CONNECTION_CLOSED', new Error('net::ERR_CONNECTION_CLOSED')],
    ['Failed to fetch', new TypeError('Failed to fetch')],
    ['NetworkError', new Error('NetworkError when attempting to fetch resource')],
    ['408', Object.assign(new Error('Request timeout'), { status: 408 })],
    ['429', Object.assign(new Error('Too many requests'), { status: 429 })],
    ['5xx', Object.assign(new Error('Bad gateway'), { status: 503 })]
  ])('classifies %s as unavailable', (_label, error) => {
    expect(isCashNetworkUnavailableError(error)).toBe(true);
  });

  it('recognizes a browser offline signal without throwing', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(() => isCashNetworkUnavailableError(new Error('any transport error'))).not.toThrow();
    expect(isCashNetworkUnavailableError(new Error('any transport error'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('normalizes transport errors to the financial read-only code', () => {
    const normalized = normalizeCashNetworkError(new TypeError('Failed to fetch'), {
      rpcName: 'pos_get_current_cash_session'
    });

    expect(normalized).toMatchObject({
      name: 'CashNetworkUnavailableError',
      code: CASH_NETWORK_UNAVAILABLE_CODE,
      rpcName: 'pos_get_current_cash_session'
    });
    expect(normalized.message).toBe(CASH_NETWORK_UNAVAILABLE_MESSAGE);
  });

  it('preserves diagnostic generation zero', () => {
    const normalized = normalizeCashNetworkError(
      Object.assign(new TypeError('Failed to fetch'), { generation: 0 }),
      { rpcName: 'pos_get_current_cash_session' }
    );

    expect(normalized.generation).toBe(0);
  });

  it('does not reinterpret a station or authorization error as a network error', () => {
    expect(isCashNetworkUnavailableError(new Error('CASH_SESSION_STATION_MISMATCH'))).toBe(false);
    expect(isCashNetworkUnavailableError(Object.assign(new Error('device denied'), { code: 'DEVICE_NOT_ALLOWED' }))).toBe(false);
  });
});
