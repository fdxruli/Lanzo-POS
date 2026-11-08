// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAFF_DEVICE_AUTH_MESSAGE } from '../../../store/slices/license/licenseConstants';

const mocks = vi.hoisted(() => ({ state: {} }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (selector) => selector(mocks.state) }));
vi.mock('../LicenseContextSummary', () => ({ default: () => null }));
import StaffLoginModal from '../StaffLoginModal';

describe('Staff explicit session recovery UI', () => {
  beforeEach(() => {
    mocks.state = {
      handleStaffLogin: vi.fn(), logout: vi.fn(), returnToLicenseAccessChoice: vi.fn(),
      licenseDetails: { features: { staff_roles: true } },
      staffLoginMessage: 'Tu sesión necesita volver a validarse.', staffLoginError: null,
      actorAuthorityRecovery: { actorType: 'staff', message: 'Tu sesión cambió o necesita volver a validarse. Inicia sesión nuevamente para continuar.' }
    };
  });
  afterEach(cleanup);

  const submit = () => {
    render(<StaffLoginModal />);
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'qa-staff' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'fixture-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  };

  it('handles a rejected authentication promise and permits another manual attempt', async () => {
    mocks.state.handleStaffLogin.mockRejectedValue(Object.assign(new Error('STAFF_SESSION_INVALID'), { code: 'STAFF_SESSION_INVALID' }));
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/sesión/i);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    expect(mocks.state.handleStaffLogin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Acceso administrador')).not.toBeInTheDocument();
  });

  it('does not display internal device credentials from a rejected RPC result', async () => {
    mocks.state.handleStaffLogin.mockResolvedValue({ success: false, code: 'DEVICE_TOKEN_INVALID', message: 'DEVICE_TOKEN_INVALID fingerprint=secret-device token=secret-token' });
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/sesión/i);
    expect(alert).not.toHaveTextContent(/DEVICE_TOKEN|fingerprint|secret/);
  });

  it('shows the safe actor recovery message without trusting raw store text', () => {
    mocks.state.staffLoginMessage = 'STAFF_SESSION_INVALID token=secret';
    render(<StaffLoginModal />);
    expect(screen.getByRole('status')).toHaveTextContent('Tu sesión cambió o necesita volver a validarse.');
    expect(screen.queryByText(/token=secret/)).not.toBeInTheDocument();
  });

  it('shows the classified device authorization notice but ignores unknown store messages', () => {
    mocks.state.actorAuthorityRecovery = null;
    mocks.state.staffLoginMessage = STAFF_DEVICE_AUTH_MESSAGE;
    const { unmount } = render(<StaffLoginModal />);

    expect(screen.getByRole('status')).toHaveTextContent(STAFF_DEVICE_AUTH_MESSAGE);
    expect(screen.getAllByText(STAFF_DEVICE_AUTH_MESSAGE)).toHaveLength(1);
    unmount();

    mocks.state.actorAuthorityRecovery = null;
    mocks.state.staffLoginMessage = 'DEVICE_NOT_ALLOWED token=private-server-detail';
    render(<StaffLoginModal />);
    expect(screen.queryByText(/DEVICE_NOT_ALLOWED|token=private-server-detail/)).not.toBeInTheDocument();
  });

  it('keeps the dedicated active elsewhere explanation without showing the store message twice', () => {
    mocks.state.staffLoginMessage = 'STAFF_ALREADY_IN_USE deviceToken=private';
    mocks.state.staffLoginError = {
      code: 'STAFF_ALREADY_IN_USE',
      message: 'STAFF_ALREADY_IN_USE deviceToken=private',
      active_device_name: 'Caja 2'
    };
    render(<StaffLoginModal />);

    expect(screen.getByRole('alert')).toHaveTextContent('Esta cuenta ya está activa en otro dispositivo.');
    expect(screen.getByText('Caja 2')).toBeInTheDocument();
    expect(screen.queryByText(/deviceToken=private/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Esta cuenta ya está activa en otro dispositivo/)).toHaveLength(1);
  });

  it('does not label an unidentified online error as a connection failure', async () => {
    mocks.state.handleStaffLogin.mockRejectedValue(new TypeError('Failed to fetch'));
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo iniciar sesión staff/);
    expect(screen.queryByText(/Failed to fetch|conexión/i)).not.toBeInTheDocument();
    expect(mocks.state.handleStaffLogin).toHaveBeenCalledTimes(1);
  });
});
