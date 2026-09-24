// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  getPostDowngradeCashPendingScopeKey,
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

function Probe({ name }) {
  const state = usePostDowngradeCashPending();
  return (
    <div>
      <span data-testid={`${name}-status`}>{state.status}</span>
      <span data-testid={`${name}-count`}>{state.pendingCount === null ? 'unknown' : state.pendingCount}</span>
      <span data-testid={`${name}-downgrade`}>{state.isPostDowngrade ? 'yes' : 'no'}</span>
      <span data-testid={`${name}-takeover`}>{state.takeoverCompleted ? 'yes' : 'no'}</span>
      <button type="button" onClick={() => state.refresh()}>{`refresh-${name}`}</button>
    </div>
  );
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

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
  it('does not let a late pending response from Tenant A overwrite Tenant B', async () => {
    const tenantA = deferred();
    const tenantB = deferred();
    mocks.list.mockImplementation(({ licenseKey }) => (
      licenseKey === 'LICENSE-A' ? tenantA.promise : tenantB.promise
    ));
    mocks.app = ownerFreeState({ licenseKey: 'LICENSE-A', ownerId: 'owner-A' });

    const { rerender } = render(<Probe name="tenant-switch" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    mocks.app = ownerFreeState({ licenseKey: 'LICENSE-B', ownerId: 'owner-B' });
    rerender(<Probe name="tenant-switch" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));

    tenantB.resolve({
      success: true,
      pendingCount: 5,
      cashSessions: [{ id: 'tenant-b-cash' }]
    });
    await waitFor(() => expect(screen.getByTestId('tenant-switch-count')).toHaveTextContent('5'));

    tenantA.resolve({
      success: true,
      pendingCount: 1,
      cashSessions: [{ id: 'tenant-a-cash' }]
    });
    await waitFor(() => {
      expect(screen.getByTestId('tenant-switch-count')).toHaveTextContent('5');
      expect(screen.getByTestId('tenant-switch-status')).toHaveTextContent('success');
    });
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('isolates late pending responses when the owner actor changes on one license', async () => {
    const ownerA = deferred();
    const ownerB = deferred();
    mocks.list
      .mockImplementationOnce(() => ownerA.promise)
      .mockImplementationOnce(() => ownerB.promise);
    mocks.app = ownerFreeState({ licenseKey: 'SAME-LICENSE', ownerId: 'owner-A' });

    const { rerender } = render(<Probe name="owner-switch" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    mocks.app = ownerFreeState({ licenseKey: 'SAME-LICENSE', ownerId: 'owner-B' });
    rerender(<Probe name="owner-switch" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));

    ownerB.resolve({ success: true, pendingCount: 4, cashSessions: [{ id: 'owner-b-cash' }] });
    await waitFor(() => expect(screen.getByTestId('owner-switch-count')).toHaveTextContent('4'));
    ownerA.resolve({ success: true, pendingCount: 9, cashSessions: [{ id: 'owner-a-cash' }] });

    await waitFor(() => {
      expect(screen.getByTestId('owner-switch-count')).toHaveTextContent('4');
      expect(screen.getByTestId('owner-switch-status')).toHaveTextContent('success');
    });
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('scopes takeover success to the owner and clears it on logout', async () => {
    mocks.list.mockResolvedValue({
      success: true,
      pendingCount: 0,
      cashSessions: [],
      downgradedAt: '2026-09-24T00:00:00.000Z',
      previousPlanCode: 'pro_monthly'
    });
    mocks.app = ownerFreeState({ licenseKey: 'LICENSE-A', ownerId: 'owner-A' });

    const { rerender } = render(<Probe name="takeover-scope" />);
    await waitFor(() => expect(screen.getByTestId('takeover-scope-status')).toHaveTextContent('success'));

    const ownerAScope = getPostDowngradeCashPendingScopeKey('LICENSE-A', mocks.app.currentAdminUser);
    expect(markFreeDeviceTakeoverCompleted(ownerAScope)).toBe(true);
    await waitFor(() => expect(screen.getByTestId('takeover-scope-takeover')).toHaveTextContent('yes'));

    mocks.app = ownerFreeState({ licenseKey: 'LICENSE-A', ownerId: 'owner-B' });
    rerender(<Probe name="takeover-scope" />);
    await waitFor(() => expect(screen.getByTestId('takeover-scope-takeover')).toHaveTextContent('no'));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));

    const ownerBScope = getPostDowngradeCashPendingScopeKey('LICENSE-A', mocks.app.currentAdminUser);
    expect(markFreeDeviceTakeoverCompleted(ownerBScope)).toBe(true);
    await waitFor(() => expect(screen.getByTestId('takeover-scope-takeover')).toHaveTextContent('yes'));

    mocks.app = {
      ...ownerFreeState({ licenseKey: 'LICENSE-A', ownerId: 'owner-B' }),
      currentDeviceRole: null,
      currentAdminUser: null
    };
    rerender(<Probe name="takeover-scope" />);
    await waitFor(() => {
      expect(screen.getByTestId('takeover-scope-takeover')).toHaveTextContent('no');
      expect(screen.getByTestId('takeover-scope-status')).toHaveTextContent('idle');
    });
  });

  it('deduplicates an in-flight request through an offline and online flap', async () => {
    const request = deferred();
    mocks.list.mockReturnValue(request.promise);

    render(<Probe name="network-flap" />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    setOnline(false);
    await waitFor(() => expect(screen.getByTestId('network-flap-status')).toHaveTextContent('unknown'));
    setOnline(true);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    request.resolve({
      success: true,
      pendingCount: 3,
      cashSessions: [{ id: 'cash-1' }, { id: 'cash-2' }, { id: 'cash-3' }]
    });
    await waitFor(() => {
      expect(screen.getByTestId('network-flap-status')).toHaveTextContent('success');
      expect(screen.getByTestId('network-flap-count')).toHaveTextContent('3');
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('falls back to a returned session list when the count is null and never converts a malformed response to zero', async () => {
    mocks.list
      .mockResolvedValueOnce({
        success: true,
        pendingCount: null,
        cashSessions: [{ id: 'cash-1' }]
      })
      .mockResolvedValueOnce({ success: true });

    const { unmount } = render(<Probe name="count-fallback" />);
    await waitFor(() => expect(screen.getByTestId('count-fallback-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('count-fallback-status')).toHaveTextContent('success');
    unmount();

    resetPostDowngradeCashPendingRuntime();
    render(<Probe name="malformed-count" />);
    await waitFor(() => expect(screen.getByTestId('malformed-count-status')).toHaveTextContent('error'));
    expect(screen.getByTestId('malformed-count-count')).toHaveTextContent('unknown');
  });

});
