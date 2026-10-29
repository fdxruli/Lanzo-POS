// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncExecutionScope } from '../../../src/services/sync/syncExecutionScope';
import { ownsScopedPosRealtimeListener } from '../../../src/services/sync/scopedPosRealtimeListener';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let client, channels, api, scopes, current, online;
const makeScope = (options = {}) => {
  const scope = createSyncExecutionScope({
    context: { actor: 'A', session: 'S', tenant: 'T' },
    isContextCurrent: () => current, ...options
  });
  scopes.push(scope);
  return scope;
};
const start = (scope, callbacks = {}) => api.startPosRealtimeListener({
  posTopic: 'pos:synthetic-f012d1', executionScope: scope, callbacks
});
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); channels = []; scopes = []; current = true; online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  client = {
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn((_type, _filter, callback) => { channel.broadcast = callback; return channel; }),
        subscribe: vi.fn(callback => { channel.status = callback; return channel; })
      };
      channels.push(channel); return channel;
    }),
    removeChannel: vi.fn(async () => 'ok')
  };
  vi.doMock('../../../src/services/supabase', () => ({ supabaseClient: client }));
  api = await import('../../../src/services/posRealtime');
});
afterEach(async () => {
  for (const scope of scopes) { scope.quiesce(); }
  await flush(); vi.useRealTimers();
  vi.doUnmock('../../../src/services/supabase');
});
describe('F012D1 real POS Realtime producer, controlled transport only', () => {
  it('registers connection before its first effect and cancels before factory', async () => {
    const s = makeScope(); start(s);
    expect(s.getSnapshot()).toMatchObject({ sources: 1, pending: 1 });
    s.quiesce(); await s.drain(); expect(client.channel).not.toHaveBeenCalled();
  });
  it('attests implementation handles, rejects copied version declarations', async () => {
    const s = makeScope(), handle = start(s); await flush();
    // Import through the same module instance used by the real provider.
    const { ownsScopedPosRealtimeListener: owns } = await import('../../../src/services/sync/scopedPosRealtimeListener');
    expect(owns(handle, s)).toBe(true);
    expect(owns({ ...handle, version: 1 }, s)).toBe(false);
    expect(owns(handle, makeScope())).toBe(false);
    expect(ownsScopedPosRealtimeListener({}, s)).toBe(false);
  });
  it('stops a connecting channel and blocks all late status/change callbacks', async () => {
    const s = makeScope(), changes = vi.fn(), restored = vi.fn(), status = vi.fn();
    const handle = start(s, { onPosChangeAvailable: changes, onConnectionRestored: restored, onStatusChange: status });
    await flush(); const channel = channels[0]; const before = status.mock.calls.length;
    await api.stopPosRealtimeListener(handle); s.quiesce(); await s.drain();
    channel.status('SUBSCRIBED'); channel.status('CLOSED'); channel.status('CHANNEL_ERROR'); channel.broadcast({});
    await vi.advanceTimersByTimeAsync(100000);
    expect(client.removeChannel).toHaveBeenCalledTimes(1); expect(client.channel).toHaveBeenCalledTimes(1);
    expect(changes).not.toHaveBeenCalled(); expect(restored).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(before);
  });
  it('retains raw channel removal after public start and duplicate stop', async () => {
    const s = makeScope(), d = deferred(), handle = start(s); await flush();
    client.removeChannel.mockReturnValue(d.promise);
    const a = api.stopPosRealtimeListener(handle), b = handle.stop(); s.quiesce();
    let drained = false; void s.drain().then(() => { drained = true; }); await flush();
    expect(drained).toBe(false); expect(client.removeChannel).toHaveBeenCalledTimes(1);
    d.resolve('ok'); await Promise.all([a, b, s.drain()]); expect(drained).toBe(true);
  });
  it('observes a late cleanup rejection and preserves UNKNOWN permanently', async () => {
    const s = makeScope(), d = deferred(); start(s); await flush();
    client.removeChannel.mockReturnValue(d.promise); s.quiesce(); await flush();
    d.reject(new Error('late transport cleanup'));
    const result = await s.settleObserved();
    expect(result.state).toBe('UNKNOWN'); expect(result.pending).toBe(0);
    await vi.advanceTimersByTimeAsync(86400000);
    expect((await s.settleObserved()).state).toBe('UNKNOWN');
  });
  it('never releases a removal that never settles by elapsed time', async () => {
    const s = makeScope(); start(s); await flush();
    client.removeChannel.mockReturnValue(new Promise(() => {})); s.quiesce(); await flush();
    let drained = false; void s.drain().then(() => { drained = true; });
    await vi.advanceTimersByTimeAsync(86400000);
    expect(drained).toBe(false); expect(s.getSnapshot().pending).toBeGreaterThan(0);
  });
  it('cancels an untriggered reconnect timer and observes old retirement', async () => {
    const s = makeScope(); start(s); await flush(); channels[0].status('CHANNEL_ERROR'); await flush();
    expect(s.getSnapshot().scheduled).toBe(1);
    s.quiesce(); await s.drain(); await vi.advanceTimersByTimeAsync(100000);
    expect(client.channel).toHaveBeenCalledTimes(1);
  });
  it('fired reconnect is registered and old-channel callbacks cannot replace it', async () => {
    const s = makeScope(), restored = vi.fn(); start(s, { onConnectionRestored: restored }); await flush();
    const first = channels[0]; first.status('TIMED_OUT'); await flush();
    await vi.advanceTimersByTimeAsync(3000); expect(channels).toHaveLength(2);
    first.status('SUBSCRIBED'); first.status('CLOSED'); await flush();
    expect(restored).not.toHaveBeenCalled();
    channels[1].status('SUBSCRIBED'); await flush(); expect(restored).toHaveBeenCalledTimes(1);
    s.quiesce(); await s.drain(); expect(client.removeChannel).toHaveBeenCalledTimes(2);
  });
  it('online listener removed at stop cannot reconnect from a captured callback', async () => {
    online = false;
    const add = vi.spyOn(window, 'addEventListener'), s = makeScope(); const handle = start(s); await flush();
    const callback = add.mock.calls.find(([name]) => name === 'online')[1];
    await handle.stop(); online = true; callback(); await flush();
    expect(client.channel).not.toHaveBeenCalled(); s.quiesce(); await s.drain(); add.mockRestore();
  });
  it('online already fired retains asynchronous callbacks through stop', async () => {
    online = false; const s = makeScope(), d = deferred();
    const handle = start(s, { onStatusChange: () => d.promise }); await flush();
    online = true; window.dispatchEvent(new Event('online')); await flush();
    const stopped = handle.stop(); s.quiesce(); let drained = false;
    void s.drain().then(() => { drained = true; }); await flush(); expect(drained).toBe(false);
    d.resolve(); await stopped; await s.drain(); expect(client.channel).not.toHaveBeenCalled();
  });
  it('retains initiated asynchronous change callback after listener removal', async () => {
    const s = makeScope(), d = deferred(), callback = vi.fn(() => d.promise);
    const handle = start(s, { onPosChangeAvailable: callback }); await flush();
    channels[0].broadcast({ payload: { change_seq: 17 } }); await flush(); expect(callback).toHaveBeenCalledTimes(1);
    await handle.stop(); s.quiesce(); let drained = false; void s.drain().then(() => { drained = true; });
    await flush(); expect(drained).toBe(false); d.resolve(); await s.drain();
  });
  it.each(['actor', 'session', 'tenant'])('original %s invalidation fences queued callbacks', async () => {
    const s = makeScope(), changes = vi.fn(); start(s, { onPosChangeAvailable: changes }); await flush();
    channels[0].broadcast({}); current = false; await flush();
    channels[0].status('CHANNEL_ERROR'); await flush(); s.quiesce(); await s.drain();
    expect(changes).not.toHaveBeenCalled(); expect(client.channel).toHaveBeenCalledTimes(1);
  });
  it('fresh generation works only after old drain; old callbacks remain fenced', async () => {
    const a = makeScope(), handle = start(a); await flush(); const old = channels[0];
    expect(start(a)).toBe(handle);
    expect(() => api.startPosRealtimeListener({ executionScope: a, posTopic: 'pos:other' })).toThrow('RESTART_REQUIRED');
    expect(() => start(makeScope())).toThrow('OWNER_MISMATCH');
    await handle.stop(); expect(() => start(a)).toThrow('RESTART_REQUIRED'); a.quiesce(); await a.drain();
    const b = makeScope(), changes = vi.fn(); start(b, { onPosChangeAvailable: changes }); await flush();
    old.broadcast({}); old.status('CHANNEL_ERROR'); channels[1].broadcast({}); await flush();
    expect(changes).toHaveBeenCalledTimes(1);
  });
  it('cannot replace UNKNOWN ownership or retrospectively adopt legacy', async () => {
    const a = makeScope(); start(a); await flush(); a.markUnobservable('specific descendant');
    a.quiesce(); await a.settleObserved(); expect(() => start(makeScope())).toThrow('OWNER_MISMATCH');
  });
  it('no-scope listener preserves private topic and callback payload compatibility', async () => {
    const changes = vi.fn(), channel = start(undefined, { onPosChangeAvailable: changes });
    channel.status('SUBSCRIBED'); channel.broadcast({ payload: { change_seq: 7, entity_type: 'product' } });
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ entity: 'product', changeSeq: 7 }));
    await api.stopPosRealtimeListener(channel);
    expect(() => start(makeScope())).toThrow('LEGACY_OWNER_ACTIVE');
  });
  it.each(['error', undefined])('all retirements settle and unknown cleanup result %s stays UNKNOWN', async cleanupResult => {
    const s = makeScope(); start(s); await flush(); channels[0].status('CLOSED'); await flush();
    await vi.advanceTimersByTimeAsync(3000); channels[1].status('SUBSCRIBED'); await flush();
    const d = deferred(); client.removeChannel.mockReturnValueOnce(d.promise);
    s.quiesce(); await flush(); expect(s.getSnapshot().pending).toBeGreaterThan(0);
    d.resolve(cleanupResult); expect((await s.settleObserved()).state).toBe('UNKNOWN');
  });
});

describe('F012D1 registered cleanup contract', () => {
  it('manual cleanup is registered before effect, works after context loss, is single-flight', async () => {
    const s = makeScope(), d = deferred(), cleanup = vi.fn(() => {
      expect(s.getSnapshot().pending).toBe(1); return d.promise;
    });
    const source = s.addSource('real-source', cleanup); current = false;
    const a = source.stop(), b = source.stop(); expect(a).toBe(b); s.quiesce(); await flush();
    expect(cleanup).toHaveBeenCalledTimes(1); d.resolve(); await a; await s.drain();
  });
  it('reentrant quiesce during cleanup registration does not duplicate cleanup', async () => {
    const s = makeScope({ onEvent: event => { if (event.type === 'registered') s.quiesce(); } });
    const cleanup = vi.fn(), source = s.addSource('reentrant', cleanup);
    await source.stop(); await s.drain(); expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
