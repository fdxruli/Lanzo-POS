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

  it('keeps license context visible in chooser and both login modals', () => {
    render(<LicenseAccessChooser />);
    expect(screen.getByText(/Licencia LANZO-TEST/)).toBeInTheDocument();
    expect(screen.getByText(/Cafeteria Brisa/)).toBeInTheDocument();

    cleanup();
    render(<AdminLoginModal />);
    expect(screen.getByText(/Licencia LANZO-TEST/)).toBeInTheDocument();

    cleanup();
    render(<StaffLoginModal />);
    expect(screen.getByText(/Licencia LANZO-TEST/)).toBeInTheDocument();
    expect(screen.queryByText('Sesión para')).not.toBeInTheDocument();
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

  it('shows an incorrect-login response and stays in the modal', async () => {
    useAppStore.setState({ handleAdminLogin: vi.fn().mockResolvedValue({ success: false, message: 'Credenciales incorrectas.' }) });
    render(<AdminLoginModal />);
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner_test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'wrong-fixture' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales incorrectas.');
  });

  it('returns to profile selection from both login modals', () => {
    const returnToChoice = vi.fn();
    useAppStore.setState({ returnToLicenseAccessChoice: returnToChoice });

    render(<AdminLoginModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro perfil' }));
    expect(returnToChoice).toHaveBeenCalledTimes(1);

    cleanup();
    render(<StaffLoginModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro perfil' }));
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
