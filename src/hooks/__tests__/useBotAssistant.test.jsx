/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOT_TIMEOUT_MS, useBotAssistant } from '../useBotAssistant';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const response = { title: 'Guía', message: 'Pasos' };
describe('useBotAssistant lifecycle', () => {
  it('recovers from loader rejection on the next request', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('load failed')).mockResolvedValue({ processBotMessage: async () => response });
    const { result } = renderHook(() => useBotAssistant('/', loader));
    await expect(result.current.askBot('hola')).rejects.toThrow('load failed');
    await expect(result.current.askBot('hola')).resolves.toEqual(response);
  });
  it('times out initialization too, ignores late responses and allows another request', async () => {
    vi.useFakeTimers(); let release;
    const process = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(response);
    const loader = () => Promise.resolve({ processBotMessage: process });
    const { result } = renderHook(() => useBotAssistant('/', loader));
    const first = result.current.askBot('hola');
    const rejected = expect(first).rejects.toMatchObject({ code: 'BOT_TIMEOUT' });
    await act(async () => { await vi.advanceTimersByTimeAsync(BOT_TIMEOUT_MS); });
    await rejected;
    release({ title: 'Late', message: 'Old' });
    await expect(result.current.askBot('otra')).resolves.toEqual(response);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a loader which never completes', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBotAssistant('/', () => new Promise(() => {})));
    const rejected = expect(result.current.askBot('hola')).rejects.toMatchObject({ code: 'BOT_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(BOT_TIMEOUT_MS);
    await rejected;
  });
  it('cancels on navigation and does not run an engine loaded after cancellation', async () => {
    let release; const process = vi.fn();
    const loader = () => new Promise(resolve => { release = resolve; });
    const { result, rerender } = renderHook(({ key }) => useBotAssistant(key, loader), { initialProps: { key: '/' } });
    const rejected = expect(result.current.askBot('hola')).rejects.toMatchObject({ code: 'BOT_CANCELLED' });
    await act(async () => {});
    rerender({ key: '/caja' }); await rejected;
    release({ processBotMessage: process });
    await act(async () => {});
    expect(process).not.toHaveBeenCalled();
  });
  it('rejects duplicate calls synchronously and cancels on unmount', async () => {
    const loader = () => new Promise(() => {});
    const { result, unmount } = renderHook(() => useBotAssistant('/', loader));
    const first = result.current.askBot('hola');
    const cancelled = expect(first).rejects.toMatchObject({ code: 'BOT_CANCELLED' });
    await expect(result.current.askBot('hola')).rejects.toMatchObject({ code: 'BOT_BUSY' });
    unmount(); await cancelled;
  });
});
