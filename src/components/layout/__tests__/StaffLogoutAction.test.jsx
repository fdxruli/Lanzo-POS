// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { status: 'granted', actorType: 'staff', actorKey: 'staff:qa-staff' },
  state: { _isLoggingOut: false, logoutStaff: vi.fn() },
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.state)
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => mocks.actor
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: mocks.showConfirmModal,
  showMessageModal: mocks.showMessageModal
}));

import StaffLogoutAction from '../StaffLogoutAction';

describe('StaffLogoutAction', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor = { status: 'granted', actorType: 'staff', actorKey: 'staff:qa-staff' };
    mocks.state._isLoggingOut = false;
    mocks.state.logoutStaff.mockResolvedValue({ success: true });
    mocks.showConfirmModal.mockResolvedValue(true);
  });

  it('is available to Staff without an Admin permission and asks for confirmation', async () => {
    render(<StaffLogoutAction className="drawer-link staff-logout-action" />);

    const action = screen.getByRole('button', { name: 'Cerrar sesión Staff' });
    expect(action).toBeVisible();
    fireEvent.click(action);

    await waitFor(() => expect(mocks.showConfirmModal).toHaveBeenCalledWith(
      expect.stringContaining('Los datos locales y las operaciones ya guardadas se conservarán'),
      expect.objectContaining({
        title: 'Cerrar sesión Staff',
        confirmButtonText: 'Sí, cerrar sesión',
        cancelButtonText: 'Seguir trabajando'
      })
    ));
    expect(mocks.state.logoutStaff).toHaveBeenCalledOnce();
  });

  it('uses the same accessible action styling in the desktop sidebar', () => {
    render(<StaffLogoutAction className="nav-link staff-logout-action" />);

    expect(screen.getByRole('button', { name: 'Cerrar sesión Staff' })).toHaveClass('nav-link');
  });

  it('does not close the session when the confirmation is cancelled', async () => {
    mocks.showConfirmModal.mockResolvedValue(false);
    render(<StaffLogoutAction />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión Staff' }));

    await waitFor(() => expect(mocks.showConfirmModal).toHaveBeenCalledOnce());
    expect(mocks.state.logoutStaff).not.toHaveBeenCalled();
  });

  it('explains when a safe operational guard prevents logout', async () => {
    mocks.state.logoutStaff.mockResolvedValue({
      success: false,
      code: 'ACTOR_HANDOFF_CHECKOUT_OWNED',
      message: 'Hay un cobro o cierre de venta en curso.'
    });
    render(<StaffLogoutAction />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión Staff' }));

    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'Hay un cobro o cierre de venta en curso.',
      null,
      { type: 'warning' }
    ));
  });

  it('explains that logout must wait for a backup or restore', async () => {
    render(<StaffLogoutAction disabled />);

    const action = screen.getByRole('button', { name: 'Cerrar sesión Staff' });
    expect(action).toHaveAttribute('aria-disabled', 'true');
    expect(action).not.toBeDisabled();
    fireEvent.click(action);

    expect(mocks.showMessageModal).toHaveBeenCalledWith(
      expect.stringContaining('respaldo o la restauración'),
      null,
      { type: 'warning' }
    );
    expect(mocks.showConfirmModal).not.toHaveBeenCalled();
    expect(mocks.state.logoutStaff).not.toHaveBeenCalled();
  });

  it('is not rendered for Admin or a locked actor', () => {
    mocks.actor = { status: 'granted', actorType: 'admin', actorKey: 'admin:owner' };
    const { rerender } = render(<StaffLogoutAction />);
    expect(screen.queryByRole('button', { name: 'Cerrar sesión Staff' })).not.toBeInTheDocument();

    mocks.actor = { status: 'locked', actorType: null };
    rerender(<StaffLogoutAction />);
    expect(screen.queryByRole('button', { name: 'Cerrar sesión Staff' })).not.toBeInTheDocument();
  });
});
