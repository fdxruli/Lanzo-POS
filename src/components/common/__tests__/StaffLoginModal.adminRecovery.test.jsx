// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ state: {} }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (selector) => selector(mocks.state) }));
vi.mock('../LicenseContextSummary', () => ({ default: () => null }));
import StaffLoginModal from '../StaffLoginModal';

describe('StaffLoginModal same-device Admin recovery', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    mocks.state = {
      handleStaffLogin: vi.fn(),
      handleAdminLogin: vi.fn(),
      initializeApp: vi.fn(),
      logout: vi.fn(),
      returnToLicenseAccessChoice: vi.fn(),
      companyProfile: { business_name: 'FARMACIA MUSE QA' },
      licenseDetails: { license_key: 'LIC-TEST', plan_code: 'pro', device_mode: 'staff_only', features: { staff_roles: true } },
      staffLoginError: null,
      staffLoginMessage: null,
      actorAuthorityRecovery: null,
      _isLoggingOut: false
    };
  });

  afterEach(cleanup);

  it('shows the secondary recovery action only for a Solo Staff device', () => {
    const { rerender } = render(<StaffLoginModal />);
    expect(screen.getByRole('button', { name: 'Recuperar acceso administrativo' })).toBeInTheDocument();

    mocks.state.licenseDetails.device_mode = 'shared';
    rerender(<StaffLoginModal />);
    expect(screen.queryByRole('button', { name: 'Recuperar acceso administrativo' })).not.toBeInTheDocument();
  });

  it('requires fresh owner credentials and requests the server-side Solo Admin recovery', async () => {
    mocks.state.handleAdminLogin.mockResolvedValue({ success: false, code: 'INVALID_ADMIN_CREDENTIALS', message: 'Usuario o contraseña incorrectos.' });
    render(<StaffLoginModal />);

    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acceso administrativo' }));
    expect(screen.getByText(/requiere el usuario y la contraseña del propietario/i)).toBeInTheDocument();
    expect(screen.getByText(/cambiará a Solo Admin/i)).toBeInTheDocument();
    expect(screen.queryByText(/Configuración administrativa/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Usuario del propietario'), { target: { value: 'owner-qa' } });
    fireEvent.change(screen.getByLabelText('Contraseña del propietario'), { target: { value: 'valid-owner-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a Solo Admin' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(mocks.state.handleAdminLogin).toHaveBeenCalledWith({
      username: 'owner-qa',
      password: 'valid-owner-secret',
      recoverFromStaffOnlyDevice: true
    });
  });

  it('explains the connection requirement and prevents an offline recovery request', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    render(<StaffLoginModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acceso administrativo' }));

    expect(screen.getByText('La recuperación administrativa requiere conexión al servidor.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar a Solo Admin' })).toBeDisabled();
    expect(mocks.state.handleAdminLogin).not.toHaveBeenCalled();
  });
});
