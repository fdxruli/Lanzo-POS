// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import LicenseAccessChooser from './LicenseAccessChooser';
import AdminLoginModal from './AdminLoginModal';
import AdminEnrollmentModal from './AdminEnrollmentModal';

describe('admin access UI', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    useAppStore.setState({
      chooseLicenseAccess: vi.fn(),
      logout: vi.fn(),
      handleAdminLogin: vi.fn(),
      handleAdminEnrollment: vi.fn(),
      adminLoginMessage: null
    });
  });

  it('offers separate Administrator and Staff entry paths', () => {
    render(<LicenseAccessChooser />);
    fireEvent.click(screen.getByRole('button', { name: /^AdministradorUsa/i }));
    expect(useAppStore.getState().chooseLicenseAccess).toHaveBeenCalledWith('admin');
    fireEvent.click(screen.getByRole('button', { name: /^Personal \/ StaffUsa/i }));
    expect(useAppStore.getState().chooseLicenseAccess).toHaveBeenCalledWith('staff');
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
