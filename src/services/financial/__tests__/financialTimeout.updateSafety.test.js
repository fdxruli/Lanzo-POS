// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFinancialTimeout } from '../financialTimeout';
import { getAdminUpdateDraftBlockReason } from '../../../pwa/adminUpdateSafety';

describe('financial request lifetime protects app updates', () => {
  afterEach(() => vi.useRealTimers());
  it.each(['resolve', 'reject'])('keeps the guard after public timeout until the raw request %s', async outcome => {
    vi.useFakeTimers();
    let settle;
    const operation = new Promise((resolve, reject) => { settle = outcome === 'resolve' ? resolve : reject; });
    const publicResult = withFinancialTimeout(operation, { timeoutMs: 10 }).catch(error => error);
    expect(getAdminUpdateDraftBlockReason()).toContain('financiera');
    await vi.advanceTimersByTimeAsync(10);
    expect((await publicResult).isFinancialTimeout).toBe(true);
    expect(getAdminUpdateDraftBlockReason()).toContain('financiera');
    settle(outcome === 'resolve' ? { success: true } : new Error('late-rejection'));
    await Promise.resolve();
    expect(getAdminUpdateDraftBlockReason()).toBeNull();
  });
  it('releases the guard if execution admission throws before dispatch', () => {
    expect(() => withFinancialTimeout(() => {}, { executionScope: { track() { throw new Error('denied'); } } })).toThrow('denied');
    expect(getAdminUpdateDraftBlockReason()).toBeNull();
  });
});
