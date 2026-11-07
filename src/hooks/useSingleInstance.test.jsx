// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSingleInstance } from './useSingleInstance';

const lockManager = () => {
  const held = new Set();
  return {
    held,
    request: vi.fn(async (name, _options, callback) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    })
  };
};

const advance = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

describe('useSingleInstance: single active POS window', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete navigator.locks;
  });

  it('keeps the first window active and blocks the second without taking its lock', async () => {
    const locks = lockManager();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });

    const first = renderHook(() => useSingleInstance());
    expect(first.result.current).toBeNull();
    await advance();
    expect(first.result.current).toBe(false);

    const second = renderHook(() => useSingleInstance());
    await advance();
    expect(second.result.current).toBe(true);
    expect(first.result.current).toBe(false);
    expect(locks.held.size).toBe(1);

    second.unmount();
    expect(first.result.current).toBe(false);
    first.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(locks.held.size).toBe(0);

    const retried = renderHook(() => useSingleInstance());
    await advance();
    expect(retried.result.current).toBe(false);
  });

  it('releases a StrictMode mount without accidentally blocking its replacement', async () => {
    const locks = lockManager();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });

    const first = renderHook(() => useSingleInstance(), { wrapper: StrictMode });
    await advance();
    expect(first.result.current).toBe(false);
    expect(locks.request).toHaveBeenCalledTimes(1);
  });

  it('falls back to a single primary BroadcastChannel participant when Web Locks are absent', async () => {
    const peers = new Set();
    class FakeBroadcastChannel {
      constructor() { this.onmessage = null; peers.add(this); }
      postMessage(data) {
        for (const other of peers) {
          if (other !== this) queueMicrotask(() => {
            if (peers.has(other)) other.onmessage?.({ data });
          });
        }
      }
      close() { peers.delete(this); }
    }
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

    const first = renderHook(() => useSingleInstance());
    const second = renderHook(() => useSingleInstance());
    await advance(0);
    await advance(300);
    expect(new Set([first.result.current, second.result.current])).toEqual(new Set([false, true]));

    const third = renderHook(() => useSingleInstance());
    await advance(0);
    await advance(300);
    expect(third.result.current).toBe(true);
    expect(new Set([first.result.current, second.result.current])).toEqual(new Set([false, true]));
  });

  it('fails closed when neither Web Locks nor BroadcastChannel is available', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    vi.stubGlobal('BroadcastChannel', undefined);
    const attempt = renderHook(() => useSingleInstance());
    await advance();
    expect(attempt.result.current).toBe(true);
  });
});
