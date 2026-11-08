// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cash = vi.hoisted(() => ({
  mode: {
    cloudEnabled: true,
    online: true,
    actor: { actorKey: 'admin:owner' }
  },
  getCurrentCashSession: vi.fn()
}));

vi.mock('../../services/cash/cashRepository', () => ({
  cashRepository: {
    getMode: () => cash.mode,
    getCurrentCashSession: (...args) => cash.getCurrentCashSession(...args)
  }
}));

import useCashSessionAgeAttention from '../useCashSessionAgeAttention';

const now = Date.parse('2026-11-08T12:00:00.000Z');
const oldSession = {
  id: 'cash-old',
  status: 'open',
  actor_key: 'admin:owner',
  opened_at: new Date(now - 30 * 60 * 60 * 1000).toISOString()
};

const cloudResult = {
  success: true,
  readOnly: false,
  networkUnavailable: false,
  stateKnown: true,
  mode: { cloudEnabled: true },
  actor: { actorKey: 'admin:owner' },
  adminOpenSessions: [oldSession],
  response: { admin_open_sessions: [oldSession] }
};

const hookOptions = {
  enabled: true,
  scopeKey: 'owner-session-cloud',
  isCloudCash: true,
  actorKey: 'admin:owner'
};

describe('useCashSessionAgeAttention', () => {
  beforeEach(() => {
    cash.mode = {
      cloudEnabled: true,
      online: true,
      actor: { actorKey: 'admin:owner' }
    };
    cash.getCurrentCashSession.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shares one authoritative refresh across mounted notification bells', async () => {
    cash.getCurrentCashSession.mockResolvedValue(cloudResult);
    const first = renderHook(() => useCashSessionAgeAttention(hookOptions));
    const second = renderHook(() => useCashSessionAgeAttention(hookOptions));

    await waitFor(() => {
      expect(first.result.current.pendingCount).toBe(1);
      expect(second.result.current.pendingCount).toBe(1);
    });
    expect(cash.getCurrentCashSession).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable instead of zero when Cloud is offline', async () => {
    cash.mode = {
      cloudEnabled: true,
      online: false,
      actor: { actorKey: 'admin:owner' }
    };
    const { result } = renderHook(() => useCashSessionAgeAttention(hookOptions));

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.sessions).toEqual([]);
    expect(cash.getCurrentCashSession).not.toHaveBeenCalled();
  });

  it('refreshes after a cash state change and clears attention only on confirmed closure', async () => {
    cash.getCurrentCashSession
      .mockResolvedValueOnce(cloudResult)
      .mockResolvedValueOnce({
        ...cloudResult,
        adminOpenSessions: [],
        response: { admin_open_sessions: [] }
      });
    const { result } = renderHook(() => useCashSessionAgeAttention(hookOptions));

    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    await act(async () => {
      window.dispatchEvent(new CustomEvent('lanzo:cash-sync-updated'));
    });
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.pendingCount).toBe(0);
    expect(cash.getCurrentCashSession).toHaveBeenCalledTimes(2);
  });
});
