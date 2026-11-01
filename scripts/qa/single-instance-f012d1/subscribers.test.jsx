// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../src/test/tenantRuntimeTestHarness';
import { applySaleCancellationFinancialProjection } from '../../../src/services/financial/financialCancellationProjection';
import { createSyncExecutionScope } from '../../../src/services/sync/syncExecutionScope';

const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/services/cash/cashRepository', () => ({ cashRepository: {
  getMode: () => ({ cloudEnabled: false, actor: { actorKey: 'admin:synthetic' } }),
  getCurrentCashSession: m.read
} }));
vi.mock('../../../src/store/useAppStore', () => {
  const store = selector => selector({}); store.getState = () => ({}); return { useAppStore: store };
});
vi.mock('../../../src/services/cashOpeningPolicyService.js', () => ({
  CASH_OPENING_POLICY: { AUTOMATIC: 'automatic', MANUAL: 'manual' },
  CASH_OPENING_POLICY_EVENT: 'cash-opening-policy-changed',
  buildAutomaticOpeningData: vi.fn(), buildManualOpeningData: vi.fn(), getCashOpeningPolicy: () => 'manual', setCashOpeningPolicy: vi.fn()
}));
import { useCaja } from '../../../src/hooks/useCaja';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
beforeEach(async () => {
  await openTestTenantRuntime(); m.read.mockResolvedValue({ success: true, cashSessions: [], movements: [] });
});
afterEach(async () => { cleanup(); vi.useRealTimers(); await closeTestTenantRuntime(); });

it('COUNTEREXAMPLE: real cancellation projection returns while real useCaja schedules an unowned refresh', async () => {
  renderHook(() => useCaja()); await act(flush); expect(m.read).toHaveBeenCalledTimes(1);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const scope = createSyncExecutionScope();
  scope.markUnobservable('financial_projection_subscriber_lifetime');
  await act(async () => {
    await scope.run('real-cancellation-projection', () => applySaleCancellationFinancialProjection({
      responsePayload: { sale: { id: 'synthetic-cancel-sale', status: 'cancelled' } },
      actorHandle: { assertCurrent() {} }
    }));
  });
  scope.quiesce(); const result = await scope.settleObserved();
  expect(result).toMatchObject({ pending: 0, state: 'UNKNOWN' });
  expect(m.read).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBeGreaterThan(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  // The actual timer fired after quiesce. Removing the emitter's UNKNOWN would
  // falsely declare DRAINED before this actual consumer even began its work.
  expect(m.read).toHaveBeenCalledTimes(2);
});
