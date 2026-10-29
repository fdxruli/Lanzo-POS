// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { getDocumentInstanceCoordinator } from '../instanceCoordinator';
import { INSTANCE_LOCK_NAME, INSTANCE_CHANNEL_NAME, validateInstanceMessage } from '../instanceProtocol';

const flush = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function lab() {
  const queue = [], channels = [], sent = [];
  let held = false;
  function pump() {
    if (held || !queue.length) return;
    const next = queue.shift();
    if (next.options.signal.aborted) { pump(); return; }
    held = true;
    next.options.signal.removeEventListener('abort', next.cancel);
    Promise.resolve().then(() => next.callback({ name: INSTANCE_LOCK_NAME }))
      .then(next.resolve, next.reject).finally(() => { held = false; pump(); });
  }
  const request = vi.fn((name, options, callback) => new Promise((resolve, reject) => {
    const item = { name, options, callback, resolve, reject };
    item.cancel = () => { const index = queue.indexOf(item); if (index >= 0) queue.splice(index, 1); reject(new DOMException('aborted', 'AbortError')); };
    if (options.signal.aborted) { item.cancel(); return; }
    options.signal.addEventListener('abort', item.cancel, { once: true });
    queue.push(item); queueMicrotask(pump);
  }));
  class Channel {
    constructor(name) { this.name = name; this.closed = false; channels.push(this); }
    postMessage(message) {
      sent.push(message);
      for (const peer of channels) if (peer !== this && !peer.closed && peer.name === this.name) {
        queueMicrotask(() => { if (!peer.closed) peer.onmessage?.({ data: message }); });
      }
    }
    close() { this.closed = true; }
  }
  const document = (overrides = {}) => ({ isSecureContext: true, document: {}, crypto: webcrypto,
    navigator: { locks: { request } }, BroadcastChannel: Channel, ...overrides });
  return { document, request, channels, sent, queue };
}
const make = (testLab, overrides) => getDocumentInstanceCoordinator(testLab.document(overrides));

describe('F01-1 document coordinator', () => {
  it('is inert until start; one cryptographic identity per document, new identity for a duplicated document', async () => {
    const l = lab(), target = l.document(), a = getDocumentInstanceCoordinator(target), b = make(l);
    expect(getDocumentInstanceCoordinator(target)).toBe(a);
    expect(a.getSnapshot().instanceId).toMatch(/^[a-f0-9]{32}$/);
    expect(a.getSnapshot().instanceId).not.toBe(b.getSnapshot().instanceId);
    expect(l.request).not.toHaveBeenCalled(); expect(l.channels).toHaveLength(0);
    await a.quiesceAndRelease(); await b.quiesceAndRelease();
  });
  it('serializes five documents; directed secondary responses never evict the incumbent', async () => {
    const l = lab(), a = make(l); await a.start(); const ticket = a.captureTicket();
    const others = Array.from({ length: 4 }, () => make(l)); others.forEach(c => { void c.start(); }); await flush();
    expect(a.isCurrent(ticket)).toBe(true);
    expect(others.map(c => c.getSnapshot().state)).toEqual(Array(4).fill('SECONDARY'));
    expect(l.sent.filter(m => m.type !== 'PROBE').every(m => m.to !== null)).toBe(true);
    expect(l.sent.every(m => !['I_AM_HERE', 'CHECK_EXISTING'].includes(m.type))).toBe(true);
    expect(l.channels.every(c => c.name === INSTANCE_CHANNEL_NAME)).toBe(true);
    expect(l.request.mock.calls.every(([name, options]) => name === INSTANCE_LOCK_NAME && options.mode === 'exclusive' && !('steal' in options))).toBe(true);
    for (const c of [a, ...others]) { await c.quiesceAndRelease(); }
  });
  it('start is single-flight, view unsubscribe never releases and RELEASED cannot restart', async () => {
    const l = lab(), a = make(l); const first = a.start(); expect(a.start()).toBe(first); await first;
    const stop = a.subscribe(() => {}); stop(); expect(a.getSnapshot().nativeHeld).toBe(true);
    expect(l.request).toHaveBeenCalledTimes(1);
    await a.quiesceAndRelease(); await expect(a.start()).rejects.toMatchObject({ code: 'INSTANCE_RESTART_FORBIDDEN' });
  });
  it('cancels a queued secondary, then the next candidate acquires without it', async () => {
    const l = lab(), a = make(l), b = make(l), c = make(l); await a.start();
    const bReady = b.start(); const cReady = c.start();
    await b.quiesceAndRelease(); expect((await bReady).state).toBe('RELEASED');
    await a.quiesceAndRelease(); expect((await cReady).state).toBe('COORDINATOR_HELD');
    await c.quiesceAndRelease();
  });
  it.each(['no-bc', 'bc-denied', 'bc-post-denied', 'bc-messageerror'])('%s preserves native locking', async mode => {
    const l = lab(); let BC = l.document().BroadcastChannel;
    if (mode === 'no-bc') BC = undefined;
    if (mode === 'bc-denied') BC = class { constructor() { throw Error('denied'); } };
    if (mode === 'bc-post-denied') BC = class { postMessage() { throw Error('denied'); } close() {} };
    const a = make(l, { BroadcastChannel: BC }); await a.start(); const b = make(l); const bReady = b.start();
    if (mode === 'bc-messageerror') l.channels[0].onmessageerror();
    await flush(); expect(a.getSnapshot().messaging).toBe('unavailable');
    expect(b.getSnapshot().state).toBe('SECONDARY'); await a.quiesceAndRelease(); await bReady;
    await b.quiesceAndRelease();
  });
  it.each(['no-locks', 'insecure', 'no-crypto', 'crypto-denied'])('%s fails closed without messaging fallback', async mode => {
    const l = lab(), override = mode === 'no-locks' ? { navigator: {} } : mode === 'insecure' ? { isSecureContext: false }
      : { crypto: mode === 'no-crypto' ? {} : { getRandomValues() { throw Error('denied'); } } };
    const a = make(l, override); expect((await a.start()).state).toBe('ERROR');
    expect(l.request).not.toHaveBeenCalled(); expect(() => a.captureTicket()).toThrow();
    expect(l.channels).toHaveLength(0); await a.quiesceAndRelease();
  });
  it.each(['sync-throw', 'async-reject', 'null-lock'])('%s produces restricted ERROR', async mode => {
    const l = lab(), request = mode === 'sync-throw' ? () => { throw Error('denied'); }
      : mode === 'null-lock' ? async (_name, _options, callback) => callback(null) : () => Promise.reject(Error('denied'));
    const a = make(l, { navigator: { locks: { request } } });
    expect((await a.start()).state).toBe('ERROR'); expect(a.getSnapshot().nativeHeld).toBe(false);
    expect(() => a.captureTicket()).toThrow(); await a.quiesceAndRelease();
  });
  it('retries after transient denial once, including concurrent retries and epoch invalidation', async () => {
    const l = lab(); const request = vi.fn().mockRejectedValueOnce(Error('denied')).mockImplementation(l.request);
    const a = make(l, { navigator: { locks: { request } } }); await a.start(); const epoch = a.getSnapshot().localEpoch;
    await Promise.all([a.retry(), a.retry()]);
    expect(request).toHaveBeenCalledTimes(2); expect(a.getSnapshot().localEpoch).toBe(epoch + 1);
    const ticket = a.captureTicket(); expect(Object.isFrozen(ticket)).toBe(true);
    expect(a.isCurrent({ ...ticket })).toBe(false);
    await a.quiesceAndRelease(); expect(ticket.signal.aborted).toBe(true); expect(a.isCurrent(ticket)).toBe(false);
  });
  it('invalidates continuations synchronously and drains a late callback before releasing', async () => {
    const l = lab(), a = make(l), b = make(l); await a.start(); const gate = pending(), effect = vi.fn();
    const work = a.runExecutor(async ticket => { await gate.promise; a.assertCurrent(ticket); effect(); });
    const denied = expect(work).rejects.toMatchObject({ code: 'INSTANCE_COORDINATION_STALE' });
    await flush(); const ticket = a.captureTicket(); const bReady = b.start();
    const stop = a.quiesceAndRelease(); expect(a.quiesceAndRelease()).toBe(stop);
    expect(a.getSnapshot()).toMatchObject({ state: 'QUIESCING', nativeHeld: true, pendingExecutors: 1 });
    expect(a.isCurrent(ticket)).toBe(false); expect(() => a.runExecutor(effect)).toThrow();
    await expect(a.start()).rejects.toThrow(); await flush(); expect(b.getSnapshot().state).toBe('SECONDARY');
    gate.resolve(); await denied; await stop; await bReady;
    expect(effect).not.toHaveBeenCalled(); expect(a.getSnapshot().pendingExecutors).toBe(0);
    await b.quiesceAndRelease();
  });
  it('drains rejected executors and does not promote tickets to synthetic authority', async () => {
    const l = lab(), a = make(l); await a.start(); const authority = false;
    const work = a.runExecutor(ticket => { a.assertCurrent(ticket); if (!authority) throw Error('AUTH_REQUIRED'); });
    await expect(work).rejects.toThrow('AUTH_REQUIRED'); await a.waitForExecutors();
    expect(a.getSnapshot().nativeHeld).toBe(true); await a.quiesceAndRelease();
  });
  it.each(['CHECKING', 'SECONDARY', 'RECOVERING', 'COORDINATOR_HELD'])('handles synchronous observer shutdown during %s without leaking a native request', async wanted => {
    const l = lab(), a = make(l); let closing;
    a.subscribe(s => { if (s.state === wanted) closing = a.quiesceAndRelease(); });
    await a.start(); await closing; expect(a.getSnapshot().state).toBe('RELEASED');
    expect(a.getSnapshot().nativeHeld).toBe(false); expect(l.queue).toHaveLength(0);
  });
  it('observer exceptions cannot release ownership; retry outside ERROR is forbidden', async () => {
    const l = lab(), a = make(l); a.subscribe(() => { throw Error('view error'); }); await a.start();
    await expect(a.retry()).rejects.toThrow(); expect(a.getSnapshot().nativeHeld).toBe(true); await a.quiesceAndRelease();
  });
  it('unexpected API rejection revokes work and supports an observer-requested drain', async () => {
    const l = lab(); let lose;
    const request = (name, options, callback) => new Promise((resolve, reject) => {
      lose = reject; l.request(name, options, callback).then(resolve, reject);
    });
    const a = make(l, { navigator: { locks: { request } } }); await a.start();
    const ticket = a.captureTicket(), gate = pending();
    const task = a.runExecutor(async captured => { await gate.promise; a.assertCurrent(captured); });
    const rejected = expect(task).rejects.toMatchObject({ code: 'INSTANCE_COORDINATION_STALE' });
    await flush(); let stopped;
    a.subscribe(s => { if (s.state === 'QUIESCING' && !stopped) stopped = a.quiesceAndRelease(); });
    lose(Error('unexpected native failure')); await flush();
    expect(a.isCurrent(ticket)).toBe(false); expect(a.getSnapshot().state).toBe('QUIESCING');
    gate.resolve(); await rejected; await stopped;
    expect(a.getSnapshot().state).toBe('RELEASED');
  });
  it('requires an actual document', () => { expect(() => getDocumentInstanceCoordinator({})).toThrow('INSTANCE_DOCUMENT_REQUIRED'); });
});

describe('F01-1 directed bounded protocol', () => {
  const own = 'a'.repeat(32), peer = 'b'.repeat(32), request = 'c'.repeat(32);
  const envelope = extra => ({ v: 1, type: 'STATUS', from: peer, to: own, requestId: request,
    messageId: `${peer}:1`, epoch: 1, mode: 'web-locks', state: 'COORDINATOR_HELD', ...extra });
  it.each([
    null, [], {}, envelope({ v: 99 }), envelope({ from: own }), envelope({ to: peer }),
    envelope({ requestId: 'd'.repeat(32) }), envelope({ epoch: 0 }), envelope({ epoch: 1.1 }),
    envelope({ mode: 'bc-only' }), envelope({ type: 'I_AM_HERE' }), envelope({ state: 'SECONDARY' }),
    envelope({ payload: 'secret' }), envelope({ messageId: `${peer}:0` }), envelope({ messageId: 'x'.repeat(5000) }),
    envelope({ to: null }), envelope({ epoch: Number.MAX_SAFE_INTEGER + 1 }),
  ])('rejects invalid envelope %#', message => { expect(validateInstanceMessage(message, own, request)).toBe(false); });
  it('accepts only a broadcast PROBE, directed STATUS, secondary CANDIDATE or terminal RELEASE', () => {
    for (const fields of [{}, { type: 'PROBE', to: null }, { type: 'CANDIDATE', state: 'SECONDARY' }, { type: 'RELEASE', state: 'RELEASED' }]) {
      expect(validateInstanceMessage(envelope(fields), own, request)).toBe(true);
    }
  });
  it('ignores historical, duplicate and reordered hints, accepts correlated release, never admits', async () => {
    const l = lab(), a = make(l), b = make(l); await a.start(); void b.start(); await flush();
    const bChannel = l.channels[1], id = b.getSnapshot().instanceId, sender = 'e'.repeat(32);
    const req = b.probe(); await flush();
    const message = extra => envelope({ from: sender, to: id, requestId: req, messageId: `${sender}:10`, ...extra });
    bChannel.onmessage({ data: message() }); expect(b.getSnapshot().observedOwner.instanceId).toBe(sender);
    for (const bad of [message(), message({ messageId: `${sender}:9` }), message({ requestId: 'f'.repeat(32), messageId: `${sender}:11` }),
      message({ type: 'RELEASE', state: 'RELEASED', epoch: 2, messageId: `${sender}:11` })]) bChannel.onmessage({ data: bad });
    expect(b.getSnapshot().observedOwner.instanceId).toBe(sender); expect(b.getSnapshot().state).toBe('SECONDARY');
    bChannel.onmessage({ data: message({ type: 'RELEASE', state: 'RELEASED', messageId: `${sender}:12` }) });
    expect(b.getSnapshot().observedOwner).toBeNull(); expect(b.getSnapshot().state).toBe('SECONDARY');
    // New discovery round invalidates old correlations, including higher sequence replies.
    b.probe(); bChannel.onmessage({ data: message({ messageId: `${sender}:12` }) });
    expect(b.getSnapshot().observedOwner).toBeNull();
    await a.quiesceAndRelease(); await flush(); expect(b.getSnapshot().state).toBe('COORDINATOR_HELD'); await b.quiesceAndRelease();
  });
  it('bounds discovered recipients under many valid probes; no historical hint can confer authority', async () => {
    const l = lab(), a = make(l); await a.start(); const receiver = l.channels[0];
    for (let i = 1; i <= 2000; i++) {
      const from = i.toString(16).padStart(32, '0');
      receiver.onmessage({ data: envelope({ type: 'PROBE', to: null, from, messageId: `${from}:1`, state: 'SECONDARY' }) });
    }
    expect(a.getSnapshot().state).toBe('COORDINATOR_HELD');
    await a.quiesceAndRelease();
    expect(l.sent.filter(m => m.type === 'RELEASE')).toHaveLength(128);
  });
});
