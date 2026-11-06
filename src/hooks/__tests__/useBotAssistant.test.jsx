/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBotAssistant } from '../useBotAssistant';
import { createBotWorkerClient, BOT_TIMEOUT_MS } from '../../services/botWorkerClient';
const response = { title: 'Guía', message: 'Pasos' };
class FakeWorker {
  listeners = new Map(); messages = []; terminated = false;
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  terminate() { this.terminated = true; }
  postMessage(data) { structuredClone(data); this.messages.push(data); }
  reply(data) { this.listeners.get('message')?.({ data }); }
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
const setup = (options = {}) => {
  const workers = [];
  const factory = context => createBotWorkerClient(context, { ...options, workerFactory: () => { const w = new FakeWorker(); workers.push(w); return w; } });
  return { workers, factory };
};
const ready = worker => worker.reply({ id: worker.messages[0].id, type: 'RESULT', value: { label: 'POS', guides: [] } });
describe('Independent bot lifecycle', () => {
  it('does not create a worker while closed; terminates on close and reopens once', async () => {
    const { workers, factory } = setup();
    const { rerender } = renderHook(({ enabled }) => useBotAssistant('/', enabled, {}, factory), { initialProps: { enabled: false } });
    expect(workers).toHaveLength(0);
    rerender({ enabled: true }); expect(workers).toHaveLength(1);
    await act(async () => ready(workers[0]));
    rerender({ enabled: false }); expect(workers[0].terminated).toBe(true); expect(workers[0].listeners.size).toBe(0);
    rerender({ enabled: true }); expect(workers).toHaveLength(2);
  });
  it('waits for initialization and rejects simultaneous questions', async () => {
    const { workers, factory } = setup(); const client = factory({}); const w = workers[0];
    const first = client.ask('hola');
    await expect(client.ask('otra')).rejects.toMatchObject({ code: 'BOT_BUSY' });
    ready(w); await client.ready;
    w.reply({ id: w.messages.at(-1).id, type: 'RESULT', value: response });
    await expect(first).resolves.toEqual(response); client.stop();
  });
  it('bounds initialization failures and recovers only after explicit retry', async () => {
    vi.useFakeTimers(); const { workers, factory } = setup();
    const { result } = renderHook(() => useBotAssistant('/', true, {}, factory));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(workers[0].terminated).toBe(true); expect(workers).toHaveLength(1);
    const next = result.current.askBot('hola'); expect(workers).toHaveLength(2);
    ready(workers[1]); await act(async () => {});
    workers[1].reply({ id: workers[1].messages.at(-1).id, type: 'RESULT', value: response });
    await expect(next).resolves.toEqual(response);
  });
  it('terminates CPU on timeout, ignores late messages and clears timers', async () => {
    vi.useFakeTimers(); const { workers, factory } = setup(); const client = factory({}); ready(workers[0]);
    const rejected = expect(client.ask('hola')).rejects.toMatchObject({ code: 'BOT_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(BOT_TIMEOUT_MS); await rejected;
    workers[0].reply({ id: 2, type: 'RESULT', value: response });
    expect(client.closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels during navigation, deactivation and unmount', async () => {
    const { workers, factory } = setup();
    const { result, rerender, unmount } = renderHook(({ key }) => useBotAssistant(key, true, {}, factory), { initialProps: { key: 'tenantA' } });
    ready(workers[0]); const rejected = expect(result.current.askBot('hola')).rejects.toMatchObject({ code: 'BOT_CANCELLED' });
    rerender({ key: 'tenantB' }); await rejected;
    expect(workers[0].terminated).toBe(true); expect(workers).toHaveLength(2);
    unmount(); expect(workers[1].terminated).toBe(true);
  });
  it('rejects nonserializable messages without orphaned requests', async () => {
    const { workers, factory } = setup(); const client = factory({}); ready(workers[0]);
    await expect(client.ask('hola', { icon: () => {} })).rejects.toMatchObject({ code: 'BOT_NOT_SERIALIZABLE' });
    expect(workers[0].terminated).toBe(true);
  });
  it('rejects a malformed initialization response without keeping a worker alive', async () => {
    const { workers, factory } = setup(); const client = factory({});
    workers[0].reply({ id: 1, type: 'RESULT', value: null });
    await expect(client.ready).rejects.toMatchObject({ code: 'BOT_INVALID_RESPONSE' });
    expect(workers[0].terminated).toBe(true);
  });
  it('fails clearly when Worker is unavailable', async () => {
    const client = createBotWorkerClient({}, { workerFactory: () => { throw new Error('unsupported'); } });
    await expect(client.ask('hola')).rejects.toMatchObject({ code: 'BOT_WORKER_UNAVAILABLE' });
  });
  it('allows one typed authorized read; cancellation aborts it and discards late data', async () => {
    let resolve; let signal;
    const read = vi.fn((_intent, _range, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); });
    const { workers, factory } = setup({ read }); const client = factory({}); const w = workers[0]; ready(w);
    const rejected = expect(client.ask('ventas')).rejects.toMatchObject({ code: 'BOT_CANCELLED' }); await client.ready;
    w.reply({ id: 2, type: 'READ', intent: 'sales_report', timeframe: {} }); await Promise.resolve();
    client.stop(); await rejected; expect(signal.aborted).toBe(true);
    resolve(response); await Promise.resolve(); expect(read).toHaveBeenCalledTimes(1);
  });
});
