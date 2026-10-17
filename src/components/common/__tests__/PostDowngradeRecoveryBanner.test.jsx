// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refresh: vi.fn(),
  takeoverCompleted: false,
  consumeTakeover: vi.fn(),
  pending: null,
  pathname: '/productos',
  attentionRecords: new Map(),
  buildAttentionKey: vi.fn(),
  readAttention: vi.fn(),
  markDisplayed: vi.fn(),
  markRead: vi.fn(),
  postpone: vi.fn(),
  clearAttention: vi.fn()
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname })
}));

vi.mock('../../../hooks/usePostDowngradeCashPending', () => ({
  default: () => mocks.pending,
  consumeFreeDeviceTakeoverCompleted: (scopeKey) => mocks.consumeTakeover(scopeKey)
}));

vi.mock('../../../services/cash/postDowngradeCashAttention', () => ({
  buildPostDowngradeCashAttentionKey: (...args) => mocks.buildAttentionKey(...args),
  clearPostDowngradeCashAttention: (...args) => mocks.clearAttention(...args),
  markPostDowngradeCashAttentionDisplayed: (...args) => mocks.markDisplayed(...args),
  markPostDowngradeCashAttentionRead: (...args) => mocks.markRead(...args),
  postponePostDowngradeCashAttention: (...args) => mocks.postpone(...args),
  POST_DOWNGRADE_CASH_ATTENTION_EVENT: 'lanzo:post-downgrade-cash-attention',
  readPostDowngradeCashAttention: (...args) => mocks.readAttention(...args)
}));

import PostDowngradeRecoveryBanner from '../PostDowngradeRecoveryBanner';

const basePending = (overrides = {}) => ({
  eligible: true,
  online: true,
  status: 'success',
  pendingCount: 2,
  isPostDowngrade: true,
  downgradedAt: '2026-09-24T05:53:00.000Z',
  previousPlanCode: 'pro_monthly',
  currentPlanCode: 'free_trial',
  error: null,
  refresh: mocks.refresh,
  scopeKey: 'LANZO-A:owner-a',
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.takeoverCompleted = false;
  mocks.pathname = '/productos';
  mocks.attentionRecords = new Map();
  mocks.consumeTakeover.mockReset();
  mocks.consumeTakeover.mockImplementation(() => mocks.takeoverCompleted);
  mocks.buildAttentionKey.mockImplementation(({ scopeKey, downgradedAt }) => (
    Promise.resolve(`attention:${scopeKey}:${downgradedAt || 'legacy'}`)
  ));
  mocks.readAttention.mockImplementation((key) => (
    mocks.attentionRecords.get(key) || { version: 1, readAt: null, postponedAt: null }
  ));
  mocks.markDisplayed.mockImplementation((key) => {
    const current = mocks.readAttention(key);
    const next = { ...current, readAt: current.readAt || 'displayed' };
    mocks.attentionRecords.set(key, next);
    return next;
  });
  mocks.markRead.mockImplementation((key) => {
    const current = mocks.readAttention(key);
    const next = { ...current, readAt: current.readAt || 'read' };
    mocks.attentionRecords.set(key, next);
    return next;
  });
  mocks.postpone.mockImplementation((key) => {
    const current = mocks.readAttention(key);
    const next = { ...current, readAt: current.readAt || 'read', postponedAt: 'postponed' };
    mocks.attentionRecords.set(key, next);
    return next;
  });
  mocks.clearAttention.mockImplementation((key) => mocks.attentionRecords.delete(key));
  mocks.pending = basePending();
});

afterEach(() => cleanup());

describe('PostDowngradeRecoveryBanner', () => {
  it('shows the compact notice only after a confirmed pending count and navigates to Caja', async () => {
    render(<PostDowngradeRecoveryBanner />);

    await waitFor(() => expect(screen.getByText('2 cajas anteriores pendientes')).toBeInTheDocument());
    expect(screen.getByText(/Tu operación en Lanzo Local puede continuar/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revisar cajas' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/caja');
    expect(mocks.markRead).toHaveBeenCalledWith(
      'attention:LANZO-A:owner-a:2026-09-24T05:53:00.000Z',
      { source: 'initial-notice-review' }
    );
  });

  it('hides the broad notice when postponed and persists the event acknowledgment', async () => {
    const view = render(<PostDowngradeRecoveryBanner />);
    await waitFor(() => expect(screen.getByText('2 cajas anteriores pendientes')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }));
    expect(screen.queryByText('2 cajas anteriores pendientes')).not.toBeInTheDocument();
    expect(mocks.postpone).toHaveBeenCalledWith(
      'attention:LANZO-A:owner-a:2026-09-24T05:53:00.000Z'
    );

    view.unmount();
    render(<PostDowngradeRecoveryBanner />);
    await waitFor(() => expect(mocks.readAttention).toHaveBeenCalled());
    expect(screen.queryByText('2 cajas anteriores pendientes')).not.toBeInTheDocument();
  });

  it('does not reappear after navigation or reload for the same downgrade event', async () => {
    const view = render(<PostDowngradeRecoveryBanner />);
    await waitFor(() => expect(screen.getByText('2 cajas anteriores pendientes')).toBeInTheDocument());

    mocks.pathname = '/ventas';
    view.rerender(<PostDowngradeRecoveryBanner />);
    expect(screen.queryByText('2 cajas anteriores pendientes')).not.toBeInTheDocument();
    expect(mocks.markRead).toHaveBeenCalledWith(
      'attention:LANZO-A:owner-a:2026-09-24T05:53:00.000Z',
      { source: 'route-navigation' }
    );

    view.unmount();
    mocks.pathname = '/productos';
    render(<PostDowngradeRecoveryBanner />);
    await waitFor(() => expect(mocks.readAttention).toHaveBeenCalled());
    expect(screen.queryByText('2 cajas anteriores pendientes')).not.toBeInTheDocument();
  });

  it('shows a new real downgrade event in the same owner scope', async () => {
    const view = render(<PostDowngradeRecoveryBanner />);
    await waitFor(() => expect(screen.getByText('2 cajas anteriores pendientes')).toBeInTheDocument());

    mocks.pending = basePending({ downgradedAt: '2026-10-17T00:00:00.000Z' });
    view.rerender(<PostDowngradeRecoveryBanner />);

    await waitFor(() => expect(mocks.buildAttentionKey).toHaveBeenCalledTimes(2));
    expect(screen.getByText('2 cajas anteriores pendientes')).toBeInTheDocument();
  });

  it('disappears when the authoritative count reaches zero', () => {
    mocks.pending = basePending({ pendingCount: 0 });

    const { container } = render(<PostDowngradeRecoveryBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the last confirmed amount offline and leaves Caja reachable', async () => {
    mocks.pending = basePending({
      online: false,
      status: 'offline_known',
      pendingCount: 1
    });

    render(<PostDowngradeRecoveryBanner />);

    await waitFor(() => expect(screen.getByText('1 caja anterior pendiente')).toBeInTheDocument());
    expect(screen.getByText(/última cantidad confirmada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar cajas' })).toBeEnabled();
  });

  it('shows takeover success only after bootstrap and can be dismissed when no cash remains', () => {
    mocks.takeoverCompleted = true;
    mocks.pending = basePending({ pendingCount: 0 });

    render(<PostDowngradeRecoveryBanner />);

    expect(screen.getByText('Este dispositivo ya está activo')).toBeInTheDocument();
    expect(screen.getByText(/Revisa las ventas, caja y sincronizaciones pendientes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByText('Este dispositivo ya está activo')).not.toBeInTheDocument();
  });

  it('does not promise historical work for normal Free when the bridge reports no downgrade boundary', () => {
    mocks.pending = basePending({
      pendingCount: 0,
      isPostDowngrade: false
    });

    const { container } = render(<PostDowngradeRecoveryBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('resets dismissed takeover UI when the authenticated tenant/owner scope changes', async () => {
    mocks.takeoverCompleted = true;
    mocks.pending = basePending({ pendingCount: 0, scopeKey: 'LANZO-A:owner-a' });

    const view = render(<PostDowngradeRecoveryBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByText('Este dispositivo ya está activo')).not.toBeInTheDocument();

    mocks.takeoverCompleted = false;
    mocks.pending = basePending({
      pendingCount: 1,
      scopeKey: 'LANZO-B:owner-b'
    });
    view.rerender(<PostDowngradeRecoveryBanner />);

    await waitFor(() => expect(screen.getByText('1 caja anterior pendiente')).toBeInTheDocument());
    expect(mocks.consumeTakeover).toHaveBeenCalledWith('LANZO-A:owner-a');
    expect(mocks.consumeTakeover).toHaveBeenCalledWith('LANZO-B:owner-b');
  });

});
