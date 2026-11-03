// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { observeFinancialExecution } from '../../../src/services/financial/financialExecutionLifetime';
import { withFinancialTimeout } from '../../../src/services/financial/financialTimeout';
import { getDocumentInstanceCoordinator } from '../../../src/services/instance/instanceCoordinator';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const runner = () => { const jobs = new Set(); return { jobs, runExecutor(factory) { const job = Promise.resolve().then(factory); jobs.add(job); job.then(() => jobs.delete(job), () => jobs.delete(job)); return job; } }; };
const timeout = (scope, factory, ms = 8) => withFinancialTimeout(factory, { timeoutMs: ms, executionScope: scope, ambiguous: true });
const coordinator = async () => {
  const c = getDocumentInstanceCoordinator({ document: {}, isSecureContext: true, crypto: globalThis.crypto,
    navigator: { locks: { request: async (_name, _options, factory) => factory({}) } } });
  await c.start(); return c;
};

describe('F01-2A two lifetimes (synthetic work, unchanged product timeout defaults)', () => {
  it('LIFE-01 completes before timeout and preserves the value reference', async () => {
    const value = {}; const e = observeFinancialExecution(scope => timeout(scope, () => value), runner());
    expect(await e.result).toBe(value); expect(await e.settled).toMatchObject({ closed: true, pendingTasks: 0, publicStatus: 'fulfilled' });
  });
  it('LIFE-02 public timeout does not settle client execution', async () => {
    const gate = deferred(); const e = observeFinancialExecution(scope => timeout(scope, () => gate.promise), runner());
    await expect(e.result).rejects.toMatchObject({ isFinancialTimeout: true, isFinancialOperationAmbiguous: true });
    expect(e.getSnapshot()).toMatchObject({ closed: false, pendingTasks: 1, publicStatus: 'rejected' });
    gate.resolve(); await e.settled;
  });
  it('LIFE-03 preserves rejection identity before timeout', async () => {
    const error = new Error('original'); const e = observeFinancialExecution(scope => timeout(scope, () => Promise.reject(error)), runner());
    await expect(e.result).rejects.toBe(error); await e.settled;
  });
  it('LIFE-04 observes a rejection after public timeout', async () => {
    const gate = deferred(); const e = observeFinancialExecution(scope => timeout(scope, () => gate.promise), runner());
    await expect(e.result).rejects.toMatchObject({ isFinancialTimeout: true }); gate.reject(new Error('late'));
    expect(await e.settled).toMatchObject({ closed: true, publicStatus: 'rejected' });
  });
  it('LIFE-05 transport completion alone does not drain a local continuation', async () => {
    const transport = deferred(), continuation = deferred(), effect = vi.fn();
    const e = observeFinancialExecution(async scope => {
      await timeout(scope, () => transport.promise, 1000); await continuation.promise; effect(); return 'done';
    }, runner());
    transport.resolve(); await flush(); expect(e.getSnapshot().closed).toBe(false); expect(effect).not.toHaveBeenCalled();
    continuation.resolve(); expect(await e.result).toBe('done'); await e.settled; expect(effect).toHaveBeenCalledOnce();
  });
  it('LIFE-06 failed synchronous or asynchronous registration never starts work', async () => {
    for (const asyncFailure of [false, true]) {
      const failure = new Error('registration'); const operation = vi.fn();
      const e = observeFinancialExecution(operation, { runExecutor() { if (asyncFailure) return Promise.reject(failure); throw failure; } });
      await expect(e.result).rejects.toBe(failure); expect(await e.settled).toMatchObject({ started: false, closed: true }); expect(operation).not.toHaveBeenCalled();
    }
  });
  it('LIFE-07 no observer retains legacy function and promise timeout behavior', async () => {
    const gate = deferred(); await expect(withFinancialTimeout(gate.promise, { timeoutMs: 8 })).rejects.toMatchObject({ financialPhase: null, isFinancialOperationAmbiguous: false });
    gate.resolve(); expect(await withFinancialTimeout(() => 42, { timeoutMs: 0 })).toBe(42);
  });
  it('LIFE-08 invocations have independent task registries', async () => {
    const a = deferred(), b = deferred(), r = runner();
    const x = observeFinancialExecution(scope => timeout(scope, () => a.promise), r);
    const y = observeFinancialExecution(scope => timeout(scope, () => b.promise), r);
    await Promise.allSettled([x.result, y.result]); a.resolve(); await x.settled;
    expect(y.getSnapshot()).toMatchObject({ closed: false, pendingTasks: 1 }); b.resolve(); await y.settled;
  });
  it('LIFE-09 root and nested tasks register before their factories run', async () => {
    const r = runner();
    const e = observeFinancialExecution(scope => scope.track(() => {
      expect(r.jobs.size).toBe(1); expect(e.getSnapshot().pendingTasks).toBe(1);
    }), r);
    expect(e.getSnapshot().started).toBe(false); expect(r.jobs.size).toBe(1); await e.result; await e.settled;
  });
  it('LIFE-10 quiesce during local continuation retains the real coordinator executor', async () => {
    const c = await coordinator(), gate = deferred(), started = deferred();
    const e = observeFinancialExecution(async () => { started.resolve(); await gate.promise; }, c);
    await started.promise; const exit = c.quiesceAndRelease(); await flush();
    expect(c.getSnapshot()).toMatchObject({ state: 'QUIESCING', nativeHeld: true, pendingExecutors: 1 });
    gate.resolve(); await e.result; await e.settled; await exit; expect(c.getSnapshot().state).toBe('RELEASED');
  });
  it('LIFE-11 quiesce after public timeout retains the real coordinator executor', async () => {
    const c = await coordinator(), gate = deferred(); const e = observeFinancialExecution(scope => timeout(scope, () => gate.promise), c);
    await expect(e.result).rejects.toMatchObject({ isFinancialTimeout: true }); const exit = c.quiesceAndRelease(); await flush();
    expect(c.getSnapshot()).toMatchObject({ nativeHeld: true, pendingExecutors: 1 }); gate.resolve(); await e.settled; await exit;
  });
  it('LIFE-12 revoked ticket must still fence the local effect explicitly', async () => {
    const c = await coordinator(), gate = deferred(), started = deferred(), effect = vi.fn();
    const e = observeFinancialExecution(async (_scope, ticket) => { started.resolve(); await gate.promise; c.assertCurrent(ticket); effect(); }, c);
    const rejection = expect(e.result).rejects.toMatchObject({ code: 'INSTANCE_COORDINATION_STALE' });
    await started.promise; const exit = c.quiesceAndRelease(); gate.resolve(); await rejection; await e.settled; await exit; expect(effect).not.toHaveBeenCalled();
  });
  it('LIFE-23 late rejection produces no unhandled rejection', async () => {
    const events = [], listener = error => events.push(error); process.on('unhandledRejection', listener);
    try {
      const gate = deferred(), e = observeFinancialExecution(scope => timeout(scope, () => gate.promise), runner());
      await expect(e.result).rejects.toMatchObject({ isFinancialTimeout: true }); gate.reject(new Error('late')); await e.settled;
      await new Promise(done => setTimeout(done, 20)); expect(events).toEqual([]);
    } finally { process.off('unhandledRejection', listener); }
  });
  it('LIFE-24 non-settling task cannot gain release by a second timeout', async () => {
    const c = await coordinator(); const e = observeFinancialExecution(scope => timeout(scope, () => new Promise(() => {})), c);
    await expect(e.result).rejects.toMatchObject({ isFinancialTimeout: true }); void c.quiesceAndRelease();
    await new Promise(done => setTimeout(done, 35)); expect(e.getSnapshot().closed).toBe(false);
    expect(c.getSnapshot()).toMatchObject({ state: 'QUIESCING', nativeHeld: true, pendingExecutors: 1 });
    // Intentionally unsettled in this isolated fake native-lock document. No force-release API.
  });
  it('LIFE-26 finishing one of two underlying tasks cannot drain both', async () => {
    const a = deferred(), b = deferred(); const e = observeFinancialExecution(async scope => {
      await Promise.allSettled([timeout(scope, () => a.promise), timeout(scope, () => b.promise)]);
    }, runner());
    await e.result; expect(e.getSnapshot().pendingTasks).toBe(2); a.resolve(); await flush();
    expect(e.getSnapshot()).toMatchObject({ pendingTasks: 1, closed: false }); b.resolve(); await e.settled;
  });
  it('LIFE-27 composed observers both retain the complete lifetime', async () => {
    const a = runner(), b = runner(), gate = deferred();
    const e = observeFinancialExecution(scope => timeout(scope, () => gate.promise), { runExecutor: factory => a.runExecutor(() => b.runExecutor(factory)) });
    await expect(e.result).rejects.toMatchObject({ isFinancialTimeout: true }); expect(a.jobs.size).toBe(1); expect(b.jobs.size).toBe(1);
    gate.resolve(); await e.settled; await flush(); expect(a.jobs.size + b.jobs.size).toBe(0);
  });
  it('LIFE-28 settlement removes task references and closes escaped scopes', async () => {
    let scope; const e = observeFinancialExecution(s => { scope = s; return s.track(() => 1); }, runner());
    await e.result; await e.settled; const effect = vi.fn(); expect(e.getSnapshot().pendingTasks).toBe(0);
    expect(() => scope.track(effect)).toThrow('FINANCIAL_EXECUTION_SCOPE_CLOSED'); expect(effect).not.toHaveBeenCalled();
  });
  it('LIFE-29 prestarted/unobservable promise is rejected by opt-in contract; detached work remains outside it', async () => {
    const gate = deferred(); const r = runner();
    const e = observeFinancialExecution(scope => {
      scope.markUnobservable(); scope.markUnobservable();
      return withFinancialTimeout(gate.promise, { executionScope: scope, timeoutMs: 8 });
    }, r);
    await expect(e.result).rejects.toThrow('unstarted factory'); gate.resolve(); await flush();
    expect(e.getSnapshot()).toMatchObject({ unobservable: true, closed: false, pendingTasks: 1 }); expect(r.jobs.size).toBe(1);
    // Rejection is not proof the prestarted work stopped. Future gate must HOLD
    // when its caller cannot provide the complete factory/continuation boundary.
  });
});
