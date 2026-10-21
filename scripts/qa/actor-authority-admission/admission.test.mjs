import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openPrototype, createClient, snapshot, transaction } from '../actor-context-contract/prototype.mjs';
import { admissionDecision, recoveryDecision } from './admission-model.mjs';

let db; const connections = [];
const identity = { tenant: 'synthetic-T', actor: 'admin:A', session: 'session-A', device: 'device-A' };
const client = (next = {}) => createClient(db, { ...identity, ...next });
beforeEach(async () => { db = await openPrototype('admission-isolated', new IDBFactory()); connections.push(db); });
afterEach(() => { for (const c of connections.splice(0)) c.close(); });

describe('admission policy containment; no real legacy-retirement verifier exists', () => {
  it('ADM-01 empty authority is not evidence that legacy never ran', async () => {
    expect((await snapshot(db)).authority).toEqual([]);
    expect(admissionDecision().state).toBe('ADMISSION_RESTRICTED');
  });
  it('ADM-03/04/05/19 presence, frozen silence and no ACK never admit v2', () => {
    for (const knownLegacy of [true, false]) expect(admissionDecision({ knownLegacy }).state).toBe('ADMISSION_RESTRICTED');
  });
  it('ADM-11 unavailable storage never grants even with assumed boundary', () => {
    expect(admissionDecision({ storage: 'unavailable', verifiedBoundary: true }).state).toBe('ADMISSION_RESTRICTED');
  });
  it('ADM-07 pending takes recovery path and is not transferred', async () => {
    const a = client(); const ha = await a.grant(a.prepare()); await a.beginOperation(ha, 'pending-A');
    const before = await snapshot(db); const b = client({ actor: 'admin:B', session: 'session-B' });
    await expect(b.grant(b.prepare(), ha.binding.token)).rejects.toThrow('HANDOFF_PENDING');
    expect(await snapshot(db)).toEqual(before);
    expect(admissionDecision({ pending: true, verifiedBoundary: true }).state).toBe('RECOVERY_REQUIRED');
  });
  it('ADM-20 a synthetic boundary assumption is conditional and cannot override bad actor', () => {
    expect(admissionDecision({ verifiedBoundary: true }).code).toBe('SYNTHETIC_BOUNDARY_ASSUMED');
    expect(admissionDecision({ verifiedBoundary: true, actor: 'stale' }).state).toBe('ADMISSION_REJECTED');
  });
});

describe('shared-transaction boundaries for synthetic local effects', () => {
  it('ADM-02 two participating grants from empty predecessor cannot both win', async () => {
    const a = client(); const b = client({ actor: 'admin:B', session: 'session-B' });
    const results = await Promise.allSettled([a.grant(a.prepare()), b.grant(b.prepare())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await snapshot(db)).authority).toHaveLength(1);
  });
  it('ADM-06/14 late revocation and duplicated old hints preserve new context', async () => {
    const a = client(); const ha = await a.grant(a.prepare());
    const b = client({ session: 'session-B' }); const hb = await b.grant(b.prepare(), ha.binding.token);
    await a.invalidate(ha); await b.onHint({ tenant: identity.tenant }); await b.onHint({ tenant: identity.tenant });
    await expect(hb.assertCurrent()).resolves.toEqual(hb.binding);
    expect((await snapshot(db)).authority[0].binding).toEqual(hb.binding);
  });
  it('ADM-08 aborted local effect remains pending with no published effect', async () => {
    const a = client(); const h = await a.grant(a.prepare()); await a.beginOperation(h, 'op');
    await expect(a.commit(h, 'op', 'K', { abort: true })).rejects.toThrow('INJECTED_ABORT');
    const s = await snapshot(db); expect(s.effects).toEqual([]); expect(s.operations[0].status).toBe('pending');
  });
  it('ADM-09 overlapping commit and local revoke yield an entire effect or none', async () => {
    const a = client(); const h = await a.grant(a.prepare()); await a.beginOperation(h, 'op');
    const commit = a.commit(h, 'op', 'K'); const revoke = a.invalidate(h);
    // Invalidation immediately retires this runtime, so an in-flight transaction
    // can safely abort. No expectation of a particular scheduler order is made.
    const [result] = await Promise.allSettled([commit, revoke]); const s = await snapshot(db);
    expect(['fulfilled','rejected']).toContain(result.status);
    expect(s.effects.length).toBe(result.status === 'fulfilled' ? 1 : 0);
    expect(s.operations[0].status).toBe(result.status === 'fulfilled' ? 'committed' : 'pending');
  });
  it('ADM-09 a foreign durable revocation before effect denies a still-granted Runtime model', async () => {
    const a = client(); const h = await a.grant(a.prepare()); await a.beginOperation(h, 'op');
    // Simulate another participant, without delivering any hint to this Runtime.
    await transaction(db, ['authority','contexts'], 'readwrite', async tx => {
      const head = await tx.get('authority', identity.tenant);
      await tx.put('authority', identity.tenant, { ...head, status:'locked', revision:head.revision+1 });
      await tx.put('contexts', [identity.tenant,h.binding.token], {binding:h.binding,status:'revoked'});
    });
    expect(a.state().status).toBe('GRANTED');
    await expect(a.commit(h, 'op', 'K')).rejects.toThrow('STALE');
    expect((await snapshot(db)).effects).toEqual([]);
  });
  it('ADM-09 effect TX queued before foreign revocation commits fully in its own order', async () => {
    const a = client(); const h = await a.grant(a.prepare()); await a.beginOperation(h, 'op');
    const commit = a.commit(h, 'op', 'K');
    const revoke = transaction(db, ['authority','contexts'], 'readwrite', async tx => {
      const head = await tx.get('authority', identity.tenant);
      await tx.put('authority', identity.tenant, { ...head,status:'locked',revision:head.revision+1 });
      await tx.put('contexts',[identity.tenant,h.binding.token],{binding:h.binding,status:'revoked'});
    });
    await Promise.all([commit,revoke]); const s = await snapshot(db);
    expect(s.effects).toHaveLength(1); expect(s.operations[0].status).toBe('committed');
    expect(s.authority[0].status).toBe('locked');
    await expect(a.commit(h,'op','K')).rejects.toThrow('STALE');
  });
  it('ADM-09 completed effect survives a later revoke and is not executed by B', async () => {
    const a = client(); const h = await a.grant(a.prepare()); await a.beginOperation(h, 'op'); await a.commit(h, 'op', 'K');
    await a.invalidate(h); const b = client({ actor: 'admin:B' }); const hb = await b.grant(b.prepare(), h.binding.token);
    await expect(b.commit(hb, 'op', 'K')).rejects.toThrow('OP_OWNER_MISMATCH');
    expect((await snapshot(db)).effects).toHaveLength(1);
  });
  it('ADM-15/17 tenant switch and replacement require revalidation before effect', async () => {
    const a = client(); const h = await a.grant(a.prepare()); await a.beginOperation(h, 'op');
    a.changeIdentity({ tenant: 'synthetic-U' }); await expect(a.commit(h, 'op', 'K')).rejects.toThrow();
    expect((await snapshot(db)).effects).toEqual([]);
  });
  it('ADM-18 EXPECTED COUNTEREXAMPLE: old writer can omit the authority store entirely', async () => {
    const a = client(); const h = await a.grant(a.prepare()); await a.invalidate(h);
    await transaction(db, ['effects'], 'readwrite', tx => tx.put('effects', ['synthetic-T','legacy-K'], { legacy: true }));
    expect((await snapshot(db)).effects).toEqual([{ legacy: true }]);
    // This PASS means the safety property is REFUTED for the uncoordinated writer.
  });
});

describe('receipt-first recovery model, no network or financial product calls', () => {
  const intent = { origin: identity, state: 'DISPATCHING', attempts: 1, key: 'K', hash: 'H' };
  it('ADM-10 response lost: matching completed receipt projects existing result without charging', () => {
    const r = recoveryDecision({ intent, executor: identity, receipt: { id:'R',status:'COMPLETED',key:'K',hash:'H' } });
    expect(r).toEqual({ action:'PROJECT_EXISTING',origin:identity,receiptId:'R' });
  });
  it('ADM-10 NOT_FOUND after dispatch or unavailable receipt never means safe to resend', () => {
    for (const status of ['NOT_FOUND','UNAVAILABLE','PROCESSING']) expect(recoveryDecision({ intent, executor:identity, receipt:{status} }).action).toBe('PRESERVE');
  });
  it('new actor cannot inherit recovery; later session of same actor can inspect receipt', () => {
    const receipt={id:'R',status:'COMPLETED',key:'K',hash:'H'};
    expect(recoveryDecision({intent,receipt,executor:{...identity,actor:'admin:B'}}).action).toBe('DENY');
    expect(recoveryDecision({intent,receipt,executor:{...identity,session:'session-new'}}).action).toBe('PROJECT_EXISTING');
    expect(intent.origin.session).toBe('session-A');
  });
  it('receipt with different request fingerprint cannot complete original operation', () => {
    expect(recoveryDecision({intent,executor:identity,receipt:{status:'COMPLETED',key:'K',hash:'OTHER'}}).code).toBe('RECEIPT_MISMATCH');
  });
});
