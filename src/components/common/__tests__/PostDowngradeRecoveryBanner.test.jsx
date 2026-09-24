// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refresh: vi.fn(),
  takeoverCompleted: false,
  pending: null
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock('../../../hooks/usePostDowngradeCashPending', () => ({
  default: () => mocks.pending,
  consumeFreeDeviceTakeoverCompleted: () => mocks.takeoverCompleted
}));

import PostDowngradeRecoveryBanner from '../PostDowngradeRecoveryBanner';

const basePending = (overrides = {}) => ({
  eligible: true,
  online: true,
  status: 'success',
  pendingCount: 2,
  isPostDowngrade: true,
  error: null,
  refresh: mocks.refresh,
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.takeoverCompleted = false;
  mocks.pending = basePending();
});

afterEach(() => cleanup());

describe('PostDowngradeRecoveryBanner', () => {
  it('shows a human pending count and navigates explicitly to Caja', () => {
    render(<PostDowngradeRecoveryBanner />);

    expect(screen.getByText('Tu negocio ahora usa Lanzo Local')).toBeInTheDocument();
    expect(screen.getByText(/2 cajas del plan anterior pendientes de revisar/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revisar cajas pendientes' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/caja');
  });

  it('disappears when the authoritative count reaches zero', () => {
    mocks.pending = basePending({ pendingCount: 0 });

    const { container } = render(<PostDowngradeRecoveryBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a known warning offline but disables the Caja action', () => {
    mocks.pending = basePending({
      online: false,
      status: 'offline_known',
      pendingCount: 1
    });

    render(<PostDowngradeRecoveryBanner />);

    expect(screen.getByText(/conéctate a internet para revisar las cajas pendientes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar cajas pendientes' })).toBeDisabled();
  });

  it('shows takeover success only after bootstrap and can be dismissed when no cash remains', () => {
    mocks.takeoverCompleted = true;
    mocks.pending = basePending({ pendingCount: 0 });

    render(<PostDowngradeRecoveryBanner />);

    expect(screen.getByText('Este dispositivo ya está activo')).toBeInTheDocument();
    expect(screen.getByText(/Lanzo Local está listo/i)).toBeInTheDocument();
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
});
