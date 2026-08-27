/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('Supabase Auth Navigator Lock behavior', () => {
  let client;
  let lockManager;
  let previousLocksDescriptor;
  let warnSpy;

  beforeEach(() => {
    previousLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    lockManager = {
      request: vi.fn(async (_name, _options, callback) => callback(null))
    };
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: lockManager
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    client?.removeAllChannels();
    warnSpy.mockRestore();

    if (previousLocksDescriptor) {
      Object.defineProperty(navigator, 'locks', previousLocksDescriptor);
    } else {
      delete navigator.locks;
    }
  });

  it('does not use Navigator LockManager when browser session persistence is disabled', async () => {
    const fetchMock = vi.fn();
    client = createClient('https://example.supabase.co', 'test-publishable-key', {
      global: { fetch: fetchMock },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    const result = await client.auth.getSession();

    expect(result).toEqual({ data: { session: null }, error: null });
    expect(lockManager.request).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some(([message]) => (
        typeof message === 'string'
        && message.includes('Navigator LockManager returned a null lock')
      ))
    ).toBe(false);
  });
});
