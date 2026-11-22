/* @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { traceTenantRuntime } from '../tenantRuntimeTrace';

afterEach(() => {
  window.lanzoRuntimeTrace.stop();
  vi.useRealTimers();
});

it('retains only bounded sanitized events until the temporary capture expires', () => {
  vi.useFakeTimers();
  const { start, read } = window.lanzoRuntimeTrace;
  traceTenantRuntime('actor', 'granted', 1);
  expect(read()).toEqual([]);
  start();
  traceTenantRuntime('private-event', 'granted');
  traceTenantRuntime('actor', 'private-token', 1);
  traceTenantRuntime('tenant_reason', 'private-license');
  traceTenantRuntime('proxy_error', 'closed', 'private-business', 'private-consumer');
  expect(read()).toEqual([
    { event: 'tenant_reason', detail: 'other', ms: 0 },
    { event: 'proxy_error', detail: 'closed', ms: 0, code: 'TENANT_RUNTIME_NOT_READY' }
  ]);
  read()[0].detail = 'tampered';
  expect(read()[0].detail).toBe('other');
  for (let generation = 1; generation <= 70; generation += 1) {
    traceTenantRuntime('actor', 'locked', generation);
  }
  expect(read()).toHaveLength(64);
  expect(read()[0].generation).toBe(7);
  vi.advanceTimersByTime(600_000);
  expect(read()).toEqual([]);
});
