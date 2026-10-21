import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, openPrototype, snapshot, transaction } from './prototype.mjs';

let db; let factory; const connections = [];
const identity = (overrides = {}) => ({ tenant: 'synthetic-T', actor: 'admin:A', session: 'session-A', device: 'device-A', ...overrides });
const client = (overrides, options) => createClient(db, identity(overrides), options);
const mount = (c, expected = null) => c.grant(c.prepare(), expected);
beforeEach(async () => { factory = new IDBFactory(); db = await openPrototype('isolated-research', factory); connections.push(db); });
afterEach(() => { for (const connection of connections.splice(0)) connection.close(); });

describe('prototype v2 — properties for participating clients only', () => {
  it('ARCH-04/24, R1: stale invalidation targets A and preserves B after an earlier read', async () => {
    const a = client(); const ha = await mount(a); const earlier = await snapshot(db);
    const b = client({ session: 'session-B' }); const hb = await mount(b, ha.binding.token);
    expect(earlier.authority[0].binding.token).toBe(ha.binding.token);
    expect(await a.invalidate(ha)).toEqual({ revokedCurrent: false });
    await expect(hb.assertCurrent()).resolves.toEqual(hb.binding);
    await expect(ha.assertCurrent()).rejects.toThrow();
    expect((await snapshot(db)).authority[0].binding).toEqual(hb.binding);
  });
  it('ARCH-09/R8: concurrent auth with the same expected predecessor has exactly one winner', async () => {
    const other = await openPrototype('isolated-research', factory); connections.push(other);
    const a = client(); const b = createClient(other, identity({ session: 'session-B' }));
    const outcomes = await Promise.allSettled([mount(a), mount(b)]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((r) => r.status === 'rejected').reason.code).toBe('CONFLICT');
    expect((await snapshot(db)).contexts.filter((c) => c.status === 'granted')).toHaveLength(1);
  });
  it.each(['revoke-first', 'grant-first'])('ARCH-11/R2: defined transaction order %s', async (order) => {
    const a = client(); const ha = await mount(a); const b = client({ session: 'session-B' });
    const operations = order === 'revoke-first'
      ? [a.invalidate(ha), mount(b, ha.binding.token)] : [mount(b, ha.binding.token), a.invalidate(ha)];
    await Promise.all(operations);
    await expect(b.capture().assertCurrent()).resolves.toBeTruthy();
    expect((await snapshot(db)).authority[0].binding.session).toBe('session-B');
  });
  it('ARCH-10: duplicate concurrent revocations are idempotent and never create a grant', async () => {
    const a = client(); const ha = await mount(a);
    await Promise.all([a.invalidate(ha), a.invalidate(ha)]);
    expect((await snapshot(db)).authority[0].status).toBe('locked');
    await expect(ha.assertCurrent()).rejects.toThrow();
  });
  it('ARCH-23/R3: duplicate and out-of-order hints cannot revoke a valid B or resurrect A', async () => {
    const a = client(); const ha = await mount(a); const b = client({ session: 'session-B' }); const hb = await mount(b, ha.binding.token);
    for (const h of [hb.binding, ha.binding, ha.binding]) await b.onHint(h);
    await hb.assertCurrent(); await a.onHint(ha.binding);
    expect(a.state().status).toBe('STALE'); await expect(ha.assertCurrent()).rejects.toThrow();
  });
  it('ARCH-25: legitimate current revocation denies writes and remains revoked', async () => {
    const a = client(); const h = await mount(a); await a.beginOperation(h, 'op'); await a.invalidate(h);
    await expect(a.commit(h, 'op', 'key')).rejects.toThrow();
    await a.onHint(h.binding); expect(a.state().status).toBe('INVALIDATED');
    expect((await snapshot(db)).effects).toHaveLength(0);
  });
  it('ARCH-12: corrupt authority fails closed without an implicit recovery grant', async () => {
    const a = client(); const h = await mount(a);
    await transaction(db, ['authority'], 'readwrite', (tx) => tx.put('authority', 'synthetic-T', { protocol: 2 }));
    await expect(h.assertCurrent()).rejects.toThrow();
    await expect(mount(client())).rejects.toThrow('CORRUPT_AUTHORITY');
  });
  it('ARCH-13/R4: inaccessible storage rejects handles and leaves no synthetic effects', async () => {
    const a = client(); const h = await mount(a); a.blockStorage();
    await expect(h.assertCurrent()).rejects.toThrow('STORAGE_UNAVAILABLE');
    await expect(a.beginOperation(h, 'op')).rejects.toThrow();
    expect((await snapshot(db)).effects).toHaveLength(0);
  });
  it('ARCH-14/R5: tenant switch discards old auth and does not touch the previous owner', async () => {
    const a = client(); const t = a.prepare(); a.changeIdentity({ tenant: 'synthetic-U' });
    await expect(a.grant(t)).rejects.toThrow('AUTH_STALE');
    expect((await snapshot(db)).authority).toHaveLength(0);
    const h = await mount(a); expect(h.binding.tenant).toBe('synthetic-U');
  });
  it('R5: a tenant switch after the transaction reads aborts the publication atomically', async () => {
    let a;
    a = client(undefined, { beforePublish: () => a.changeIdentity({ tenant: 'synthetic-U' }) });
    await expect(mount(a)).rejects.toThrow('AUTH_STALE');
    const state = await snapshot(db); expect(state.authority).toHaveLength(0); expect(state.contexts).toHaveLength(0);
  });
  it('ARCH-14: clients cannot revoke handles issued to another tenant/client', async () => {
    const a = client(); const ha = await mount(a); const b = client({ tenant: 'synthetic-U' }); const hb = await mount(b);
    await expect(a.invalidate(hb)).rejects.toThrow('HANDLE_NOT_OWNED');
    await ha.assertCurrent(); await hb.assertCurrent();
  });
  it('ARCH-15: device change denies reuse and requires new explicit auth', async () => {
    const a = client(); const h = await mount(a); a.changeIdentity({ device: 'device-B' });
    await expect(h.assertCurrent()).rejects.toThrow();
    const next = await mount(a, h.binding.token); expect(next.binding.device).toBe('device-B');
  });
  it('R6: delayed synthetic RPC proof cannot grant after generation changes', async () => {
    const a = client(); const old = a.prepare(); const newer = a.prepare();
    await expect(a.grant(old)).rejects.toThrow('AUTH_STALE');
    const h = await a.grant(newer); expect(h.binding.generation).toBe(newer.generation);
  });
  it('ARCH-16: an unfinished handoff grants no handle', async () => {
    const a = client(); a.prepare(); expect(() => a.capture()).toThrow('LOCKED');
    expect(a.state().status).toBe('AUTHENTICATING');
  });
  it('ARCH-17: a pending operation blocks replacement and keeps its original owner after invalidation', async () => {
    const a = client(); const ha = await mount(a); await a.beginOperation(ha, 'payment');
    const b = client({ actor: 'admin:B', session: 'session-B' });
    await expect(mount(b, ha.binding.token)).rejects.toThrow('HANDOFF_PENDING');
    await a.invalidate(ha); await expect(a.commit(ha, 'payment', 'payment-key')).rejects.toThrow();
    const state = await snapshot(db); expect(state.operations[0].owner).toEqual(ha.binding);
    expect(state.operations[0].status).toBe('pending'); expect(state.effects).toHaveLength(0);
  });
  it('ARCH-17: committed synthetic effect stays durable and retries are idempotent', async () => {
    const a = client(); const h = await mount(a); await a.beginOperation(h, 'payment');
    const committed = await a.commit(h, 'payment', 'key'); await a.commit(h, 'payment', 'key');
    const b = client({ session: 'session-B' }); await mount(b, h.binding.token);
    expect((await snapshot(db)).effects).toEqual([committed]);
    await expect(a.commit(h, 'payment', 'key')).rejects.toThrow();
  });
  it('abort rolls back authority and its context together', async () => {
    const a = client(); const ticket = a.prepare();
    await expect(a.grant(ticket, null, { abort: true })).rejects.toThrow('INJECTED_ABORT');
    const s = await snapshot(db); expect(s.authority).toHaveLength(0); expect(s.contexts).toHaveLength(0);
    expect(a.state().status).toBe('LOCKED');
  });
  it('abort rolls back the effect and retains pending operation, without duplicate retry', async () => {
    const a = client(); const h = await mount(a); await a.beginOperation(h, 'op');
    await expect(a.commit(h, 'op', 'key', { abort: true })).rejects.toThrow('INJECTED_ABORT');
    let s = await snapshot(db); expect(s.effects).toHaveLength(0); expect(s.operations[0].status).toBe('pending');
    await a.commit(h, 'op', 'key'); s = await snapshot(db); expect(s.effects).toHaveLength(1);
  });
  it('ARCH-20: notification absence/failure cannot bypass durable checks', async () => {
    const a = client(undefined, { notify: () => { throw new Error('NO_BC'); } }); const ha = await mount(a);
    const b = client({ session: 'session-B' }); const hb = await mount(b, ha.binding.token);
    await expect(ha.assertCurrent()).rejects.toThrow(); await hb.assertCurrent();
  });
});

describe('counterexamples — assertion PASS means the unsafe property was disproved', () => {
  it('A/C individual records and directed self-revocation alone do not elect an owner', () => {
    const records = new Map([['A', { granted: true }], ['B', { granted: true }]]);
    expect(records.get('A').granted && records.get('B').granted).toBe(true); // INV03 FAIL
  });
  it('E/R1 a read then conditional setItem still clobbers B', () => {
    let durable = 'A'; const readByA = durable; durable = 'B';
    if (readByA === 'A') durable = 'locked-A';
    expect(durable).toBe('locked-A'); // INV02/13 FAIL
  });
  it('R7 ignoring v1 protects v2 record but leaves a legacy handle current', async () => {
    const legacy = { token: 'legacy-A', granted: true }; const oldHandle = () => legacy.granted && legacy.token === 'legacy-A';
    const b = client({ session: 'new-B' }); const h = await mount(b);
    expect(oldHandle()).toBe(true); await h.assertCurrent(); // INV03/11 FAIL
  });
  it('R7 a writer that omits the coordinator from its effect transaction bypasses the fence', async () => {
    const a = client(); const ha = await mount(a); await ha.assertCurrent();
    const b = client({ session: 'new-B' }); await mount(b, ha.binding.token);
    // Synthetic representation of an unfenced legacy write, not a real POS sale.
    await transaction(db, ['effects'], 'readwrite', (tx) => tx.put('effects', ['synthetic-T', 'legacy-bypass'], {
      owner: ha.binding, synthetic: true, legacyUnfenced: true
    }));
    const s = await snapshot(db);
    expect(s.effects[0].owner.token).not.toBe(s.authority[0].binding.token); // INV03/07 FAIL
  });
});
