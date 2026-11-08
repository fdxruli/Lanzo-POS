// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const storeState = vi.hoisted(() => ({
  handleStaffLogin: vi.fn(),
  initializeApp: vi.fn(),
  logout: vi.fn(),
  returnToLicenseAccessChoice: vi.fn(),
  staffLoginMessage: null,
  staffLoginError: null,
  staffLoginLicenseKey: 'LANZO-STAFF-VERIFY',
  licenseDetails: {
    license_key: 'LANZO-STAFF-VERIFY',
    product_name: 'Lanzo POS',
    plan_code: 'pro'
  }
}));

vi.mock('../../../store/useAppStore', () => {
  const useAppStore = (selector) => selector(storeState);
  useAppStore.getState = () => storeState;
  return { useAppStore };
});

import StaffLoginModal from '../StaffLoginModal';

beforeEach(() => {
  storeState.handleStaffLogin.mockReset();
  storeState.initializeApp.mockReset();
  storeState.logout.mockReset();
  storeState.returnToLicenseAccessChoice.mockReset();
  storeState.staffLoginMessage = null;
  storeState.staffLoginError = null;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => cleanup());

describe('StaffLoginModal verification recovery', () => {
  it('offers online verification retry without exposing the Staff login form', async () => {
    storeState.staffLoginError = { code: 'SESSION_VERIFICATION_INCONCLUSIVE' };
    storeState.staffLoginMessage = 'No pudimos verificar la sesión. Tus datos locales se mantienen protegidos.';
    storeState.initializeApp.mockResolvedValue({ status: 'staff_login_required' });

    render(<StaffLoginModal />);

    expect(screen.getByText(/No pudimos confirmar la sesión guardada/)).toBeInTheDocument();
    expect(screen.queryByText(storeState.staffLoginMessage)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar verificación' })).toBeEnabled();
    expect(screen.queryByLabelText('Usuario')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar verificación' }));
    await waitFor(() => expect(storeState.initializeApp).toHaveBeenCalledTimes(1));
    expect(storeState.handleStaffLogin).not.toHaveBeenCalled();
  });

  it('does not label an unidentified online error as a connection failure', async () => {
    storeState.handleStaffLogin.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<StaffLoginModal />);
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'cashier' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'fixture-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo iniciar sesión staff. Tus datos permanecen intactos. Vuelve a intentarlo.');
    expect(screen.queryByText(/Failed to fetch/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Comprueba la conexión/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled());
  });
});
