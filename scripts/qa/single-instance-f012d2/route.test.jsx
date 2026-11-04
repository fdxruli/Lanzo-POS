// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../src/test/tenantRuntimeTestHarness';
import { db, STORES } from '../../../src/services/db/dexie';
import { applySaleCancellationFinancialProjection } from '../../../src/services/financial/financialCancellationProjection';
import { applyFinancialProjection } from '../../../src/services/financial/financialProjectionRegistry';
import { createSyncExecutionScope } from '../../../src/services/sync/syncExecutionScope';
import { getCancellationCashRefreshRoute, publishCancellationCashUpdate } from '../../../src/services/financial/cancellationCashRefreshRoute';
import * as cashActor from '../../../src/services/cash/cashActor';
import { actorRuntimeController } from '../../../src/services/auth/actorRuntimeController';
import * as ledger from '../../../src/services/financial/financialIntentLedger';
import * as recovery from '../../../src/services/financial/financialIntentRecovery';
import { recoverCurrentFinancialIntents } from '../../../src/services/financial/financialIntentRecoveryCoordinator';

const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/services/cash/cashRepository', () => ({ cashRepository: {
  getMode: () => ({ cloudEnabled: false, actor: { actorKey: 'admin:synthetic' } }), getCurrentCashSession: m.read
} }));
vi.mock('../../../src/store/useAppStore', () => {
  const store = selector => selector({}); store.getState = () => ({}); return { useAppStore: store };
});
vi.mock('../../../src/services/cashOpeningPolicyService.js', () => ({
  CASH_OPENING_POLICY: { AUTOMATIC: 'automatic', MANUAL: 'manual' }, CASH_OPENING_POLICY_EVENT: 'cash-opening-policy-changed',
  buildAutomaticOpeningData: vi.fn(), buildManualOpeningData: vi.fn(), getCashOpeningPolicy: () => 'manual', setCashOpeningPolicy: vi.fn()
}));
import { useCaja } from '../../../src/hooks/useCaja';

const response = () => ({ success: true, cashSessions: [], movements: [], stateKnown: true });
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
let scopes;
const owner = options => { const s = createSyncExecutionScope(options); scopes.push(s); return s; };
const mount = async scope => {
  const hook = renderHook(({ executionScope }) => useCaja({ executionScope }), { initialProps: { executionScope: scope } });
  await act(flush); return hook;
};
const project = scope => scope.run('test:real-cancellation', () => applyFinancialProjection({
  intent: { operationType: 'sale.cancel', responsePayload: { sale: { id: 'synthetic-sale', status: 'cancelled' } } },
  actorHandle: { assertCurrent() {} }, executionScope: scope
}));
const timers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
beforeEach(async () => { scopes = []; await openTestTenantRuntime(); m.read.mockReset().mockResolvedValue(response()); });
afterEach(async () => { cleanup(); for (const s of scopes) s.quiesce(); await flush(); vi.useRealTimers(); vi.restoreAllMocks(); await closeTestTenantRuntime(); });

describe('F012D2 actual cancellation projection -> DOM -> useCaja', () => {
  it('publishes the same events/order/detail after the real Dexie transaction, with unchanged actor checks and durable key', async () => {
    const names = ['sales', 'cash', 'products', 'customer-credit', 'reports'].map(x => `lanzo:${x}-sync-updated`);
    const seen = [], listeners = names.map(name => {
      const listener = event => { seen.push({ name: event.type, detail: event.detail }); };
      window.addEventListener(name, listener); return listener;
    });
    const actorHandle = { assertCurrent: vi.fn() };
    try {
      const result = await applySaleCancellationFinancialProjection({ responsePayload: { sale: { id: 'synthetic-sale', status: 'cancelled' } }, actorHandle });
      expect(result).toMatchObject({ id: 'synthetic-sale', status: 'cancelled' });
      expect(actorHandle.assertCurrent).toHaveBeenCalledTimes(2);
      expect(seen).toEqual(names.map(name => ({ name, detail: null })));
      expect(await db.table(STORES.SALES).get('synthetic-sale')).toMatchObject({ status: 'cancelled' });
      expect(await db.table(STORES.TRANSACTION_LOG).get('txn_cloud_sale_cancel_synthetic-sale')).toMatchObject({ type: 'CLOUD_SALE_CANCELLED', status: 'COMPLETED' });
    } finally { names.forEach((name, i) => window.removeEventListener(name, listeners[i])); }
  });

  it('active scope keeps zero-delay coalescing and reads exactly once for two projections', async () => {
    const s = owner(); await mount(s); expect(m.read).toHaveBeenCalledTimes(1); timers();
    await act(async () => { await project(s); await project(s); });
    expect(m.read).toHaveBeenCalledTimes(1); expect(s.getSnapshot().scheduled).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(m.read).toHaveBeenCalledTimes(2); expect(s.getSnapshot().scheduled).toBe(0);
    s.quiesce(); expect((await s.drain()).state).toBe('DRAINED');
  });

  it('quiesce between publication and timer prevents every Caja read', async () => {
    const s = owner(); await mount(s); timers(); await act(async () => { await project(s); });
    expect(s.getSnapshot().scheduled).toBe(1); s.quiesce();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(m.read).toHaveBeenCalledTimes(1); expect((await s.drain()).state).toBe('DRAINED');
  });

  it.each(['cancelled-but-queued', 'fired-before-factory'])('%s timer callback checks original scope before effects', async mode => {
    const callbacks = [], timerApi = { setTimeout: fn => { callbacks.push(fn); return callbacks.length; }, clearTimeout: vi.fn() };
    const s = owner({ timerApi }); await mount(s); await act(async () => { await project(s); });
    expect(callbacks).toHaveLength(1);
    act(() => {
      if (mode === 'fired-before-factory') callbacks[0]();
      s.quiesce();
      if (mode === 'cancelled-but-queued') callbacks[0]();
    });
    await act(flush); await s.drain(); expect(m.read).toHaveBeenCalledTimes(1);
  });

  it('stop is synchronous for admission, single-flight, and awaits the already-started read', async () => {
    const s = owner(), gate = deferred(); const hook = await mount(s); const before = hook.result.current.estadoCaja;
    m.read.mockReturnValueOnce(gate.promise); timers(); await act(async () => { await project(s); await vi.advanceTimersByTimeAsync(0); });
    expect(m.read).toHaveBeenCalledTimes(2);
    const route = getCancellationCashRefreshRoute(s), a = route.stop(), b = route.stop(); expect(a).toBe(b);
    s.quiesce(); let stopped = false, drained = false; void a.then(() => { stopped = true; }); void s.drain().then(() => { drained = true; });
    await act(flush); expect(stopped).toBe(false); expect(drained).toBe(false); expect(s.getSnapshot().pending).toBeGreaterThan(0);
    await act(async () => { gate.resolve(response()); await a; await s.drain(); });
    expect(stopped && drained).toBe(true); expect(hook.result.current.estadoCaja).toBe(before);
  });

  it('late events and captured old listener are inert; duplicate stops do not repeat cleanup', async () => {
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    const s = owner(); await mount(s); const listener = add.mock.calls.find(([name]) => name === 'lanzo:cash-sync-updated')[1];
    const route = getCancellationCashRefreshRoute(s); const a = route.stop(); const b = route.stop(); expect(a).toBe(b);
    s.quiesce(); await a; await s.drain();
    await act(async () => { publishCancellationCashUpdate(s); listener(new CustomEvent('lanzo:cash-sync-updated')); await flush(); });
    expect(m.read).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.filter(([name, fn]) => name === 'lanzo:cash-sync-updated' && fn === listener)).toHaveLength(1);
  });

  it('next authorized scope obtains discarded update from existing initial load, without old-instance callbacks', async () => {
    const a = owner(), hook = await mount(a); timers(); await act(async () => { await project(a); });
    a.quiesce(); await a.drain(); expect(m.read).toHaveBeenCalledTimes(1);
    const b = owner(); hook.rerender({ executionScope: b }); await act(flush);
    expect(m.read).toHaveBeenCalledTimes(2); // existing mount/load flow, no replay queue
    expect(await db.table(STORES.SALES).get('synthetic-sale')).toMatchObject({ status: 'cancelled' });
    await act(async () => { publishCancellationCashUpdate(a); await vi.advanceTimersByTimeAsync(0); });
    expect(m.read).toHaveBeenCalledTimes(2);
    await act(async () => { await project(b); await vi.advanceTimersByTimeAsync(0); });
    expect(m.read).toHaveBeenCalledTimes(3); b.quiesce(); await b.drain();
  });

  it('same-owner initial read is observed and coalesced rather than retrospectively adopting a legacy promise', async () => {
    const s = owner(), gate = deferred(); m.read.mockReturnValueOnce(gate.promise); await mount(s); timers();
    await act(async () => { await project(s); await vi.advanceTimersByTimeAsync(0); });
    expect(m.read).toHaveBeenCalledTimes(1); s.quiesce(); await act(flush); expect(s.getSnapshot().pending).toBeGreaterThan(0);
    await act(async () => { gate.resolve(response()); await s.drain(); }); expect(s.getSnapshot().pending).toBe(0);
  });

  it('old in-flight verification cannot publish into a newly rendered hook owner', async () => {
    const a = owner(), gate = deferred(), hook = await mount(a);
    m.read.mockReturnValueOnce(gate.promise); timers(); await act(async () => { await project(a); await vi.advanceTimersByTimeAsync(0); });
    a.quiesce(); const b = owner(); hook.rerender({ executionScope: b }); await act(flush);
    const before = hook.result.current.estadoCaja;
    await act(async () => { gate.resolve({ ...response(), success: false, message: 'old error' }); await a.drain(); });
    expect(hook.result.current.estadoCaja).toBe(before); expect(hook.result.current.error).toBeNull();
  });

  it('original context invalidation suppresses late state/error publication and new reads', async () => {
    let current = true; const s = owner({ isContextCurrent: () => current }), gate = deferred(), hook = await mount(s);
    m.read.mockReturnValueOnce(gate.promise); timers(); await act(async () => { await project(s); await vi.advanceTimersByTimeAsync(0); });
    const before = hook.result.current.estadoCaja; current = false;
    await act(async () => { gate.reject(new Error('late read failure')); await flush(); publishCancellationCashUpdate(s); await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.estadoCaja).toBe(before); expect(hook.result.current.error).toBeNull(); expect(m.read).toHaveBeenCalledTimes(2);
    s.quiesce(); await s.drain();
  });

  it('never-settling admitted read is never reported stopped/drained by time', async () => {
    const s = owner(); await mount(s); m.read.mockReturnValueOnce(new Promise(() => {})); timers();
    await act(async () => { await project(s); await vi.advanceTimersByTimeAsync(0); });
    let done = false; const route = getCancellationCashRefreshRoute(s); void route.stop().then(() => { done = true; }); s.quiesce();
    await vi.advanceTimersByTimeAsync(86400000); expect(done).toBe(false); expect(s.getSnapshot().pending).toBeGreaterThan(0);
  });

  it('does not clear UNKNOWN from unrelated projection consumers', async () => {
    const s = owner(); s.markUnobservable('financial_projection_subscriber_lifetime'); await mount(s);
    s.quiesce(); expect((await s.settleObserved()).unknown).toContain('financial_projection_subscriber_lifetime');
  });

  it('quiesce from the preceding sales notification preserves cancellation/event publication but rejects the cash listener immediately', async () => {
    const s = owner(); await mount(s); timers();
    const close = () => s.quiesce(), published = vi.fn();
    window.addEventListener('lanzo:sales-sync-updated', close);
    window.addEventListener('lanzo:cash-sync-updated', published);
    try {
      await act(async () => { await project(s); await vi.advanceTimersByTimeAsync(0); });
      expect(published).toHaveBeenCalledTimes(1); expect(m.read).toHaveBeenCalledTimes(1);
      expect(await db.table(STORES.SALES).get('synthetic-sale')).toMatchObject({ status: 'cancelled' });
      expect((await s.drain()).state).toBe('DRAINED');
    } finally { window.removeEventListener('lanzo:sales-sync-updated', close); window.removeEventListener('lanzo:cash-sync-updated', published); }
  });

  it('StrictMode reinstall retains one live subscription and one active initial read', async () => {
    const s = owner(); renderHook(() => useCaja({ executionScope: s }), { wrapper: StrictMode }); await act(flush);
    expect(m.read).toHaveBeenCalledTimes(1); timers();
    await act(async () => { await project(s); await vi.advanceTimersByTimeAsync(0); });
    expect(m.read).toHaveBeenCalledTimes(2); s.quiesce(); await s.drain();
  });

  it('actual recovery coordinator carries original Sync scope through its existing project callback, retaining other subscriber UNKNOWN', async () => {
    const s = owner(); await mount(s); timers();
    const handle = { actorKey: 'admin:synthetic', sessionId: 'S', generation: 3, tenant: { generation: 4 }, assertCurrent() {} };
    vi.spyOn(actorRuntimeController, 'capture').mockReturnValue(handle);
    vi.spyOn(cashActor, 'getCashMode').mockReturnValue({ cloudEnabled: true, licenseKey: 'synthetic-T' });
    const intent = { id: 'synthetic-intent', operationType: 'sale.cancel', responsePayload: { sale: { id: 'synthetic-sale', status: 'cancelled' } } };
    vi.spyOn(ledger, 'listFinancialIntentsForRecovery').mockResolvedValue([intent]);
    // Control the financial recovery result only. Its caller, project callback,
    // registry, cancellation projection, transaction, event and hook are real.
    vi.spyOn(recovery, 'recoverFinancialIntent').mockImplementation(async args => {
      await args.project({ intent, actorHandle: handle }); return { outcome: 'projection_applied' };
    });
    await act(async () => { await recoverCurrentFinancialIntents({ executionScope: s }); await vi.advanceTimersByTimeAsync(0); });
    expect(m.read).toHaveBeenCalledTimes(2);
    s.quiesce(); expect((await s.settleObserved()).unknown).toContain('financial_projection_subscriber_lifetime');
  });
});
