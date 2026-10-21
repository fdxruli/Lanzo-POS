import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { classifySessionVerificationResponse } from '../sessionVerification';
import { isSafeAdminOfflineVerificationFailure } from '../adminOfflineAuthorization';

// Real installed client, fictitious URL/key, and a fetch that never reaches a server.
const rpcWithFetch = (fetch) => createClient('https://transport-fixture.invalid', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch }
}).rpc('verify_admin_session', {});

const rejectedFetch = () => rpcWithFetch(async () => { throw new TypeError('Failed to fetch'); });

afterEach(() => vi.unstubAllGlobals());

describe('P2-04 installed Supabase/PostgREST transport contract', () => {
  it('accepts a native fetch TypeError without a wrapper', () => {
    const result = classifySessionVerificationResponse('admin', { error: new TypeError('Failed to fetch') });
    expect(result.verificationStatus).toBe('transport_unavailable');
    expect(isSafeAdminOfflineVerificationFailure(result)).toBe(true);
  });

  it('reproduces a wrapped fetch rejection while navigator remains online', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const response = await rejectedFetch();
    expect(navigator.onLine).toBe(true);
    expect(response).toMatchObject({ data: null, count: null, status: 0, statusText: '', error: {
      message: 'TypeError: Failed to fetch', code: '', hint: '', details: expect.any(String)
    } });
    expect(response.error.name).toBeUndefined();
    expect(response.error.status).toBeUndefined();
    expect(response.error.cause).toBeUndefined();
    expect(classifySessionVerificationResponse('admin', response)).toMatchObject({
      valid: false, verificationStatus: 'transport_unavailable'
    });
  });

  it('requires the status-zero RPC envelope for the wrapped message', async () => {
    const response = await rejectedFetch();
    const result = classifySessionVerificationResponse('admin', { error: response.error });
    expect(result.verificationStatus).toBe('server_error');
    expect(isSafeAdminOfflineVerificationFailure(result)).toBe(false);
  });

  it.each([500, 502, 503, 429, 401, 403])('preserves real HTTP %s even when error has no status', async (status) => {
    const response = await rpcWithFetch(async () => new Response(JSON.stringify({
      message: 'fixture server error', code: 'PGRST000', details: '', hint: ''
    }), { status, headers: { 'Content-Type': 'application/json' } }));
    expect(response.status).toBe(status);
    expect(response.error.status).toBeUndefined();
    const result = classifySessionVerificationResponse('admin', response);
    expect(result.verificationStatus).toBe('server_error');
    expect(result.code).toBe(status === 429 ? 'SESSION_RATE_LIMITED'
      : status >= 500 ? 'SESSION_SERVER_HTTP_' + status : 'SESSION_GATEWAY_HTTP_' + status);
    expect(isSafeAdminOfflineVerificationFailure(result)).toBe(status === 429 || status >= 500);
  });

  it.each([401, 403])('never masks HTTP %s with a transport-looking message or nested zero', async (status) => {
    const response = await rejectedFetch();
    for (const error of [response.error, new TypeError('Failed to fetch'), { code: 'ERR_NETWORK', status: 0 }]) {
      const result = classifySessionVerificationResponse('admin', { ...response, status, error });
      expect(result.verificationStatus).toBe('server_error');
      expect(isSafeAdminOfflineVerificationFailure(result)).toBe(false);
    }
  });

  it('does not authorize PostgREST status zero caused by malformed JSON', async () => {
    const response = await rpcWithFetch(async () => new Response('{broken', { status: 200 }));
    expect(response.status).toBe(0);
    expect(response.error.message).toMatch(/^SyntaxError:/);
    const result = classifySessionVerificationResponse('admin', response);
    expect(result.verificationStatus).toBe('server_error');
    expect(isSafeAdminOfflineVerificationFailure(result)).toBe(false);
  });

  it.each([null, '', false, 'unknown', 0])('rejects unknown errors with status %s', (status) => {
    const result = classifySessionVerificationResponse('admin', { status, error: { message: 'unexpected local failure' } });
    expect(isSafeAdminOfflineVerificationFailure(result)).toBe(false);
  });

  it('keeps malformed and authoritative application responses blocked', async () => {
    for (const data of [null, [], { success: true }, { success: false, valid: false, code: 'ADMIN_SESSION_EXPIRED' }]) {
      const response = await rpcWithFetch(async () => new Response(JSON.stringify(data), { status: 200 }));
      const result = classifySessionVerificationResponse('admin', response);
      expect(isSafeAdminOfflineVerificationFailure(result)).toBe(false);
      expect(result.verificationStatus).toBe(data?.code ? 'authoritative_denial' : 'invalid_response');
    }
  });

  it('recovers with the same verification RPC after connectivity returns', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, valid: true }), { status: 200 }));
    const client = createClient('https://transport-fixture.invalid', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch }
    });
    expect(classifySessionVerificationResponse('admin', await client.rpc('verify_admin_session', {})).verificationStatus)
      .toBe('transport_unavailable');
    expect(classifySessionVerificationResponse('admin', await client.rpc('verify_admin_session', {})).verificationStatus)
      .toBe('verified');
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of fetch.mock.calls) expect(url).toContain('/rest/v1/rpc/verify_admin_session');
  });
});
