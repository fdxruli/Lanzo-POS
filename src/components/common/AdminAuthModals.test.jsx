// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import LicenseAccessChooser from './LicenseAccessChooser';
import AdminLoginModal from './AdminLoginModal';
import AdminEnrollmentModal from './AdminEnrollmentModal';
import StaffLoginModal from './StaffLoginModal';

describe('admin access UI', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    useAppStore.setState({
      chooseLicenseAccess: vi.fn(),
      returnToLicenseAccessChoice: vi.fn(),
      logout: vi.fn(),
      handleAdminLogin: vi.fn(),
      handleStaffLogin: vi.fn(),
      handleAdminEnrollment: vi.fn(),
      adminLoginMessage: null,
      staffLoginMessage: null,
      staffLoginError: null,
      staffLoginLicenseKey: 'LANZO-TEST-CHOOSER',
      companyProfile: { name: 'Cafeteria Brisa' },
      licenseDetails: {
        license_key: 'LANZO-TEST-CHOOSER',
        license_id: '11111111-2222-4333-8444-555555555555',
        product_name: 'Lanzo POS',
        plan_name: 'Pro',
        features: { staff_roles: true }
      }
    });
  });

  it('offers separate Administrator and Staff entry paths when the plan includes staff roles', () => {
    render(<LicenseAccessChooser />);
    fireEvent.click(screen.getByRole('button', { name: /^AdministradorUsa/i }));
    expect(useAppStore.getState().chooseLicenseAccess).toHaveBeenCalledWith('admin');
    fireEvent.click(screen.getByRole('button', { name: /^Personal \/ StaffUsa/i }));
    expect(useAppStore.getState().chooseLicenseAccess).toHaveBeenCalledWith('staff');
  });

  it('does not offer Staff when the current plan has no staff_roles feature', () => {
    useAppStore.setState({ licenseDetails: { features: { staff_roles: false } } });
    render(<LicenseAccessChooser />);
    expect(screen.getByRole('button', { name: /^AdministradorUsa/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Personal \/ StaffUsa/i })).not.toBeInTheDocument();
  });

  it.each([
    ['profile selection', LicenseAccessChooser],
    ['administrator access', AdminLoginModal],
    ['Staff access', StaffLoginModal],
    ['owner enrollment', AdminEnrollmentModal]
  ])('renders %s as a page instead of a modal', (_name, Component) => {
    render(<Component />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.auth-page')).toBeInTheDocument();
  });

  it('allows auth page scrolling and restores the app scroll lock on exit', () => {
    const { unmount } = render(<AdminLoginModal />);
    expect(document.documentElement).toHaveClass('auth-page-document');
    expect(document.body).toHaveClass('auth-page-document');

    unmount();
    expect(document.documentElement).not.toHaveClass('auth-page-document');
    expect(document.body).not.toHaveClass('auth-page-document');
  });

  it('asks who will sign in and does not announce a completed two-step flow', () => {
    render(<LicenseAccessChooser />);
    expect(screen.getByRole('heading', { name: '¿Quién va a ingresar?' })).toBeInTheDocument();
    expect(screen.queryByText(/Paso 2 de 2/)).not.toBeInTheDocument();
  });

  it.each([
    ['profile selection', LicenseAccessChooser],
    ['administrator access', AdminLoginModal],
    ['Staff access', StaffLoginModal],
    ['independent owner enrollment', AdminEnrollmentModal]
  ])('keeps safe license context visible in %s', (_name, Component) => {
    const { container } = render(<Component />);
    expect(container.querySelector('.auth-license-context__license'))
      .toHaveTextContent('Licencia 11111111-2222-4333-8444-555555555555');
    expect(container.querySelector('.auth-license-context__meta'))
      .toHaveTextContent('Cafeteria Brisa');
    expect(container.innerHTML).not.toContain('LANZO-TEST-CHOOSER');
    expect(container.querySelector('.auth-license-context__status svg')).toBeInTheDocument();
    if (Component === StaffLoginModal) {
      expect(screen.queryByText('Sesión para')).not.toBeInTheDocument();
    }
  });

  it('submits admin credentials without persisting the password in store', async () => {
    const login = vi.fn().mockResolvedValue({ success: true });
    useAppStore.setState({ handleAdminLogin: login });
    render(<AdminLoginModal />);
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner_test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'fixture-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith({ username: 'owner_test', password: 'fixture-password' }));
    expect(useAppStore.getState().password).toBeUndefined();
  });

  it('shows a safe incorrect-login response on the full access page', async () => {
    useAppStore.setState({
      handleAdminLogin: vi.fn().mockResolvedValue({
        success: false,
        code: 'INVALID_ADMIN_CREDENTIALS',
        message: 'Credenciales incorrectas.'
      })
    });
    render(<AdminLoginModal />);
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner_test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'wrong-fixture' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(alert).not.toHaveTextContent('Credenciales incorrectas.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns to profile selection from both login modals', () => {
    const returnToChoice = vi.fn();
    useAppStore.setState({ returnToLicenseAccessChoice: returnToChoice });

    render(<AdminLoginModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar perfil' }));
    expect(returnToChoice).toHaveBeenCalledTimes(1);

    cleanup();
    render(<StaffLoginModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar perfil' }));
    expect(returnToChoice).toHaveBeenCalledTimes(2);
  });

  it('allows viewing the password in both login modals', () => {
    render(<AdminLoginModal />);
    const adminPassword = screen.getByLabelText('Contraseña');
    expect(adminPassword).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(adminPassword).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toBeInTheDocument();

    cleanup();
    render(<StaffLoginModal />);
    const staffPassword = screen.getByLabelText('Contraseña');
    expect(staffPassword).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(staffPassword).toHaveAttribute('type', 'text');
  });

  it('allows viewing both new owner password fields independently', () => {
    render(<AdminEnrollmentModal />);

    const password = screen.getByLabelText('Contraseña');
    const confirmation = screen.getByLabelText('Confirmar contraseña');
    const toggles = screen.getAllByRole('button', { name: 'Mostrar contraseña' });

    expect(password).toHaveAttribute('type', 'password');
    expect(confirmation).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(confirmation).toHaveAttribute('autocomplete', 'new-password');

    fireEvent.click(toggles[0]);
    expect(password).toHaveAttribute('type', 'text');
    expect(confirmation).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getAllByRole('button', { name: 'Mostrar contraseña' })[1]);
    expect(confirmation).toHaveAttribute('type', 'text');
  });

  it('blocks owner enrollment when password confirmation differs', () => {
    const enroll = vi.fn();
    useAppStore.setState({ handleAdminEnrollment: enroll });
    render(<AdminEnrollmentModal />);
    fireEvent.change(screen.getByLabelText('Nombre del propietario'), { target: { value: 'Test Owner' } });
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner_test' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: 'FixturePass123' } });
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'DifferentPass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta propietaria' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.');
    expect(enroll).not.toHaveBeenCalled();
  });
});
