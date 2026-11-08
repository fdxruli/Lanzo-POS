// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enroll: vi.fn(), discover: vi.fn(), logout: vi.fn() }));

vi.mock('../../../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return {
    useAppStore: create(() => ({
      handleAdminEnrollment: mocks.enroll,
      discoverAdminAccess: mocks.discover,
      logout: mocks.logout,
      adminLoginLicenseKey: 'TEST-LICENSE'
    }))
  };
});
vi.mock('../PreloginSupportAccess', () => ({
  default: ({ children }) => <div>{children}</div>
}));

import AdminEnrollmentModal from '../AdminEnrollmentModal';

const fillOwnerCredentials = () => {
  fireEvent.change(screen.getByLabelText('Nombre del propietario'), { target: { value: 'Propietario QA' } });
  fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner_qa' } });
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: 'OwnerPass123' } });
  fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'OwnerPass123' } });
};

describe('initial owner invitation flow', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.enroll.mockReset();
    mocks.discover.mockReset();
    mocks.logout.mockReset();
  });
  afterEach(cleanup);

  it('submits the code only with owner-created credentials and clears ephemeral credentials after a rejection', async () => {
    mocks.enroll.mockResolvedValue({ success: false, code: 'ADMIN_ONBOARDING_INVALID', message: 'El código no es válido.' });
    render(<AdminEnrollmentModal requiresInvitation />);
    const code = 'ABCDEF0123456789'.repeat(4);
    fireEvent.change(screen.getByLabelText(/Código de primera configuración/), { target: { value: code } });
    fillOwnerCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta propietaria' }));

    await waitFor(() => expect(mocks.enroll).toHaveBeenCalledWith({
      displayName: 'Propietario QA',
      username: 'owner_qa',
      password: 'OwnerPass123',
      invitationCode: code.toLowerCase()
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El código de primera configuración no es válido.');
    expect(screen.getByLabelText(/Código de primera configuración/)).toHaveValue('');
    expect(screen.getByLabelText(/^Contraseña/)).toHaveValue('');
    expect(screen.getByLabelText('Confirmar contraseña')).toHaveValue('');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('does not add the invitation field to the existing authorized enrollment screen', () => {
    render(<AdminEnrollmentModal />);
    expect(screen.queryByLabelText(/Código de primera configuración/)).not.toBeInTheDocument();
  });

  it('replaces unknown server enrollment messages with safe copy', async () => {
    mocks.enroll.mockResolvedValue({
      success: false,
      code: 'P0001',
      message: 'INTERNAL_SECRET from private.function at SQL line 42'
    });
    render(<AdminEnrollmentModal requiresInvitation />);
    fireEvent.change(screen.getByLabelText(/Código de primera configuración/), {
      target: { value: 'ABCDEF0123456789'.repeat(4) }
    });
    fillOwnerCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta propietaria' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No pudimos confirmar la creación de la cuenta propietaria/);
    expect(alert).not.toHaveTextContent(/INTERNAL_SECRET|SQL line 42|P0001/);
  });
});
