/* @vitest-environment jsdom */
import { StrictMode, useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAdminResumeChecks } from '../adminResumeChecks';

const visible = value => Object.defineProperty(document, 'visibilityState', { configurable: true, value });
const fire = (name, target = window) => target.dispatchEvent(new Event(name));
const context = () => ({ status: 'granted', actorKey: 'admin:a', sessionId: 'a', deviceRef: 'a', generation: 1,
  tenant: { opaqueId: 'tenant-a', generation: 1, databaseName: 'qa-a' } });
let stop;
beforeEach(() => { vi.useFakeTimers(); visible('visible'); });
afterEach(() => { stop?.(); stop = null; cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); sessionStorage.clear(); });
const setup = (performHealthCheck = vi.fn()) => {
  let current = context();
  const evaluateLocalAuthority = vi.fn(() => current);
  stop = startAdminResumeChecks({ performHealthCheck, evaluateLocalAuthority });
  return { performHealthCheck, evaluateLocalAuthority, replace: x => { current = x; } };
};

describe('F02 resume scheduling', () => {
  it('RESUME-01: evaluates each visible signal synchronously and coalesces remote work', async () => {
    const x = setup();
    fire('focus'); fire('online'); fire('pageshow'); fire('resume', document); fire('visibilitychange', document);
    expect(x.evaluateLocalAuthority).toHaveBeenCalledTimes(5);
    expect(x.performHealthCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(x.performHealthCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(x.performHealthCheck).toHaveBeenCalledExactlyOnceWith('online');
  });
  it('RESUME-02: removes listeners and cancels the timer before unmount', async () => {
    const x = setup(); fire('focus'); stop();
    fire('focus'); fire('online'); fire('resume', document); fire('pageshow');
    await vi.runAllTimersAsync();
    expect(x.evaluateLocalAuthority).toHaveBeenCalledTimes(1);
    expect(x.performHealthCheck).not.toHaveBeenCalled();
  });
  it('RESUME-03: hidden at timer execution discards work even without a visibility event', async () => {
    const x = setup(); fire('focus'); visible('hidden');
    await vi.advanceTimersByTimeAsync(250);
    expect(x.performHealthCheck).not.toHaveBeenCalled();
    fire('online'); expect(x.evaluateLocalAuthority).toHaveBeenCalledTimes(1);
  });
  it('RESUME-03: pagehide marks inactivity and cancels pending work', async () => {
    const x = setup(); fire('focus'); fire('pagehide');
    expect(Number(sessionStorage.getItem('lanzo_last_active'))).toBeGreaterThan(0);
    await vi.runAllTimersAsync(); expect(x.performHealthCheck).not.toHaveBeenCalled();
  });
  it('RESUME-04: StrictMode mounts leave exactly one set of listeners', async () => {
    const check = vi.fn(); const evaluate = vi.fn(context);
    function Mount() {
      useEffect(() => startAdminResumeChecks({ performHealthCheck: check, evaluateLocalAuthority: evaluate }), []);
      return null;
    }
    const view = render(<StrictMode><Mount /></StrictMode>);
    fire('focus'); await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(check).toHaveBeenCalledTimes(1);
    view.unmount(); fire('focus'); await vi.runAllTimersAsync();
    expect(check).toHaveBeenCalledTimes(1);
  });
  it.each(['throw', 'reject'])('RESUME-05: contains a health check %s and accepts a later event', async mode => {
    const check = vi.fn(() => { if (mode === 'throw') throw Error('synthetic'); return Promise.reject(Error('synthetic')); });
    setup(check); fire('focus'); await vi.advanceTimersByTimeAsync(250);
    fire('focus'); await vi.advanceTimersByTimeAsync(250);
    expect(check).toHaveBeenCalledTimes(2);
  });
  it('RESUME-06: online while pending still evaluates expiry but never overlaps remote work', async () => {
    let resolve; const check = vi.fn(() => new Promise(done => { resolve = done; }));
    const x = setup(check); fire('focus'); await vi.advanceTimersByTimeAsync(250);
    const calls = x.evaluateLocalAuthority.mock.calls.length;
    fire('online'); fire('resume', document); await vi.advanceTimersByTimeAsync(500);
    expect(x.evaluateLocalAuthority).toHaveBeenCalledTimes(calls + 2);
    expect(check).toHaveBeenCalledTimes(1);
    resolve(); await Promise.resolve();
    fire('online'); await vi.advanceTimersByTimeAsync(250);
    expect(check).toHaveBeenCalledTimes(2); resolve();
  });
  it('does not cancel or replay a remote operation when unmounted while pending', async () => {
    let resolve; const check = vi.fn(() => new Promise(done => { resolve = done; }));
    setup(check); fire('focus'); await vi.advanceTimersByTimeAsync(250);
    stop(); resolve(); await Promise.resolve(); fire('focus'); await vi.runAllTimersAsync();
    expect(check).toHaveBeenCalledTimes(1);
  });
  it.each(['generation', 'sessionId', 'deviceRef', 'actorKey', 'status', 'tenant'])('EXP-F02-15: discards deferred work after %s changes', async field => {
    const x = setup(); fire('focus');
    x.replace({ ...context(), [field]: field === 'tenant' ? { ...context().tenant, generation: 2 } : 'changed' });
    await vi.advanceTimersByTimeAsync(250);
    expect(x.performHealthCheck).not.toHaveBeenCalled();
  });
  it('RESUME-09: initializing state is evaluated without starting any bootstrap', async () => {
    const x = setup(); x.replace({ ...context(), status: 'authenticating' }); fire('focus');
    expect(x.evaluateLocalAuthority).toHaveBeenCalledTimes(1);
    stop(); await vi.runAllTimersAsync(); expect(x.performHealthCheck).not.toHaveBeenCalled();
  });
  it('activity storage failure cannot suppress the next local evaluation', () => {
    const x = setup(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('denied'); });
    expect(() => fire('pagehide')).not.toThrow(); fire('focus');
    expect(x.evaluateLocalAuthority).toHaveBeenCalledTimes(1);
  });
});
