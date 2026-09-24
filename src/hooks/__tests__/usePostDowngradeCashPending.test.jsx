// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: null,
  list: vi.fn()
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.app)
}));

vi.mock('../../services/cash/postDowngradeCashReconciliation', () => ({
  postDowngradeCashReconciliation: {
    list: mocks.list
  }
}));

import usePostDowngradeCashPending, {
  buildPostDowngradeCashScopeKey,
  consumeFreeDeviceTakeoverCompleted,
  markFreeDeviceTakeoverCompleted,
  resetPostDowngradeCashPendingRuntime
} from '../usePostDowngradeCashPending';

const ownerFreeState = ({
  licenseKey = 'LANZO-FREE-OWNER',
  ownerId = 'owner-1',
  username = 'owner'
} = {}) => ({
  licenseStatus: 'active',
  licenseDetails: {
    license_key: licenseKey,
    status: 'active',
    plan_code: 'free_trial',
    plan_name: 'Lanzo Local',
    features: { cloud_cash_sync: false }
  },
  currentDeviceRole: 'admin',
  currentAdminUser: {
    id: ownerId,
    username,
    is_owner: true
  }
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

function Probe({ name }) {
  const state = usePostDowngradeCashPending();
  return (
    <div>
      <span data-testid={`${name}-status`}>{state.status}</span>
      <span data-testid={`${name}-count`}>{state.pendingCount === null ? 'unknown' : state.pendingCount}</span>
      <span data-testid={`${name}-downgrade`}>{state.isPostDowngrade ? 'yes' : 'no'}</span>
      <button type="button" onClick={() => state.refresh()}>{`refresh-${name}`}</button>
    </div>
  );
}

const setOnline = (online) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPostDowngradeCashPendingRuntime();
  mocks.app = ownerFreeState();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
  resetPostDowngradeCashPendingRuntime();
});

describe('post-downgrade cash pending session runtime', () => {
  it('deduplicates the authoritative list RPC across multiple consumers', async () => {
    mocks.list.mockResolvedValue({
      success: true,
      pendingCount: 2,
      cashSessions: [{ id: 'cash-1' }, { id: 'cash-2' }],
      downgradedAt: '2026-09-24T00:00:00.000Z',
      previousPlanCode: 'pro_monthly',
      currentPlanCode: 'free_trial'
    });

    render(
      <>
        <Probe name="banner" />
        <Probe name="caja" />
      </>
    );

    await waitFor(() => expect(screen.getByTestId('banner-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('caja-count')).toHaveTextContent('2');
    expect(screen.getByTestId('banner-downgrade')).toHaveTextContent('yes');
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('keeps zero distinct from unknown and does not invent downgrade history for normal Free', async () => {
    mocks.list.mockResolvedValue({
      success: true,
      pendingCount: 0,
      cashSessions: [],
      downgradedAt: null,
      previousPlanCode: null,
      currentPlanCode: null
    });

    render(<Probe name="normal-free" />);

    await waitFor(() => expect(screen.getByTestId('normal-free-count')).toHaveTextContent('0'));
    expect(screen.getByTestId('normal-free-downgrade')).toHaveTextContent('no');
    expect(screen.getByTestId('normal-free-status')).toHaveTextContent('success');
  });

  it('preserves a known pending count when connectivity is lost without another RPC', async () => {
    mocks.list.mockResolvedValue({
      success: true,
      pendingCount: 1,
      cashSessions: [{ id: 'cash-1' }],
      downgradedAt: '2026-09-24T00:00:00.000Z',
      previousPlanCode: 'pro_monthly'
    });

    render(<Probe name="offline-known" />);
    await waitFor(() => expect(screen.getByTestId('offline-known-count')).toHaveTextContent('1'));

    setOnline(false);

    await waitFor(() => expect(screen.getByTestId('offline-known-status')).toHaveTextContent('offline_known'));
    expect(screen.getByTestId('offline-known-count')).toHaveTextContent('1');
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('uses unknown rather than zero when the first check starts offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

    render(<Probe name="offline-unknown" />);

    await waitFor(() => expect(screen.getByTestId('offline-unknown-status')).toHaveTextContent('unknown'));
    expect(screen.getByTestId('offline-unknown-count')).toHaveTextContent('unknown');
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('refreshes all consumers after an explicit cash close changes pending 1 to 0', async () => {
    mocks.list
      .mockResolvedValueOnce({
        success: true,
        pendingCount: 1,
        cashSessions: [{ id: 'cash-1' }],
        downgradedAt: '2026-09-24T00:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      })
      .mockResolvedValueOnce({
        success: true,
        pendingCount: 0,
        cashSessions: [],
        downgradedAt: '2026-09-24T00:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      });

    render(
      <>
        <Probe name="banner" />
        <Probe name="caja" />
      </>
    );

    await waitFor(() => expect(screen.getByTestId('banner-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: 'refresh-caja' }));

    await waitFor(() => expect(screen.getByTestId('banner-count')).toHaveTextContent('0'));
    expect(screen.getByTestId('caja-count')).toHaveTextContent('0');
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('does not call the bridge for non-owner Admin, Staff, or an upgraded PRO plan', async () => {
    mocks.app = {
      ...ownerFreeState(),
      currentAdminUser: { id: 'admin-2', is_owner: false }
    };
    const first = render(<Probe name="non-owner" />);
    await waitFor(() => expect(screen.getByTestId('non-owner-status')).toHaveTextContent('idle'));
    expect(mocks.list).not.toHaveBeenCalled();
    first.unmount();

    resetPostDowngradeCashPendingRuntime();
    mocks.app = {
      ...ownerFreeState(),
      currentDeviceRole: 'staff',
      currentAdminUser: null
    };
    const second = render(<Probe name="staff" />);
    await waitFor(() => expect(screen.getByTestId('staff-status')).toHaveTextContent('idle'));
    expect(mocks.list).not.toHaveBeenCalled();
    second.unmount();

    resetPostDowngradeCashPendingRuntime();
    mocks.app = {
      ...ownerFreeState(),
      licenseDetails: {
        ...ownerFreeState().licenseDetails,
        plan_code: 'pro_monthly',
        plan_name: 'Lanzo Nube',
        features: { cloud_cash_sync: true }
      }
    };
    render(<Probe name="pro" />);
    await waitFor(() => expect(screen.getByTestId('pro-status')).toHaveTextContent('idle'));
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('prevents a late Tenant A response from overwriting Tenant B', async () => {
    const tenantA = deferred();
    const tenantB = deferred();
    mocks.list
      .mockReturnValueOnce(tenantA.promise)
      .mockReturnValueOnce(tenantB.promise);

    const view = render(<Probe name="tenant-race" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    mocks.app = ownerFreeState({
      licenseKey: 'LANZO-TENANT-B',
      ownerId: 'owner-b',
      username: 'owner-b'
    });
    view.rerender(<Probe name="tenant-race" />);

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));

    await act(async () => {
      tenantB.resolve({
        success: true,
        pendingCount: 2,
        cashSessions: [{ id: 'b-1' }, { id: 'b-2' }],
        downgradedAt: '2026-09-24T01:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      });
      await tenantB.promise;
    });

    await waitFor(() => expect(screen.getByTestId('tenant-race-count')).toHaveTextContent('2'));

    await act(async () => {
      tenantA.resolve({
        success: true,
        pendingCount: 9,
        cashSessions: Array.from({ length: 9 }, (_, index) => ({ id: `a-${index}` })),
        downgradedAt: '2026-09-24T00:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      });
      await tenantA.promise;
    });

    expect(screen.getByTestId('tenant-race-count')).toHaveTextContent('2');
    expect(screen.getByTestId('tenant-race-status')).toHaveTextContent('success');
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('isolates same-license owner switches while an older request is unresolved', async () => {
    const ownerA = deferred();
    const ownerB = deferred();
    mocks.list
      .mockReturnValueOnce(ownerA.promise)
      .mockReturnValueOnce(ownerB.promise);

    const view = render(<Probe name="owner-race" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    mocks.app = ownerFreeState({ ownerId: 'owner-2', username: 'owner-two' });
    view.rerender(<Probe name="owner-race" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));

    await act(async () => {
      ownerB.resolve({
        success: true,
        pendingCount: 1,
        cashSessions: [{ id: 'owner-b-cash' }],
        downgradedAt: '2026-09-24T02:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      });
      await ownerB.promise;
    });
    await waitFor(() => expect(screen.getByTestId('owner-race-count')).toHaveTextContent('1'));

    await act(async () => {
      ownerA.resolve({
        success: true,
        pendingCount: 7,
        cashSessions: Array.from({ length: 7 }, (_, index) => ({ id: `owner-a-${index}` })),
        downgradedAt: '2026-09-24T00:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      });
      await ownerA.promise;
    });

    expect(screen.getByTestId('owner-race-count')).toHaveTextContent('1');
  });

  it('invalidates an in-flight request on offline/online flap and keeps the newer response', async () => {
    const stale = deferred();
    const fresh = deferred();
    mocks.list
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);

    render(<Probe name="flap" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    setOnline(false);
    await waitFor(() => expect(screen.getByTestId('flap-status')).toHaveTextContent('unknown'));

    setOnline(true);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));

    await act(async () => {
      fresh.resolve({
        success: true,
        pendingCount: 3,
        cashSessions: [{ id: 'fresh-1' }, { id: 'fresh-2' }, { id: 'fresh-3' }],
        downgradedAt: '2026-09-24T03:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      });
      await fresh.promise;
    });
    await waitFor(() => expect(screen.getByTestId('flap-count')).toHaveTextContent('3'));

    await act(async () => {
      stale.resolve({
        success: true,
        pendingCount: 8,
        cashSessions: Array.from({ length: 8 }, (_, index) => ({ id: `stale-${index}` })),
        downgradedAt: '2026-09-24T00:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      });
      await stale.promise;
    });

    expect(screen.getByTestId('flap-count')).toHaveTextContent('3');
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('cleans the runtime on logout and rejects the response that was still pending', async () => {
    const pending = deferred();
    mocks.list.mockReturnValueOnce(pending.promise);

    const view = render(<Probe name="logout" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    mocks.app = {
      licenseStatus: 'active',
      licenseDetails: null,
      currentDeviceRole: null,
      currentAdminUser: null
    };
    view.rerender(<Probe name="logout" />);

    await waitFor(() => expect(screen.getByTestId('logout-status')).toHaveTextContent('idle'));
    expect(screen.getByTestId('logout-count')).toHaveTextContent('unknown');

    await act(async () => {
      pending.resolve({
        success: true,
        pendingCount: 4,
        cashSessions: [{ id: 'stale-after-logout' }],
        downgradedAt: '2026-09-24T00:00:00.000Z',
        previousPlanCode: 'pro_monthly'
      });
      await pending.promise;
    });

    expect(screen.getByTestId('logout-status')).toHaveTextContent('idle');
    expect(screen.getByTestId('logout-count')).toHaveTextContent('unknown');
  });

  it('scopes takeover completion to one tenant/owner and consumes it only once', () => {
    const scopeA = buildPostDowngradeCashScopeKey({
      licenseKey: 'LANZO-A',
      username: 'owner-a'
    });
    const scopeB = buildPostDowngradeCashScopeKey({
      licenseKey: 'LANZO-B',
      username: 'owner-b'
    });

    markFreeDeviceTakeoverCompleted({
      licenseKey: 'LANZO-A',
      username: 'owner-a'
    });

    expect(consumeFreeDeviceTakeoverCompleted(scopeB)).toBe(false);
    expect(consumeFreeDeviceTakeoverCompleted(scopeA)).toBe(false);

    markFreeDeviceTakeoverCompleted({
      licenseKey: 'LANZO-A',
      username: 'OWNER-A'
    });
    expect(consumeFreeDeviceTakeoverCompleted(scopeA)).toBe(true);
    expect(consumeFreeDeviceTakeoverCompleted(scopeA)).toBe(false);
  });

});
