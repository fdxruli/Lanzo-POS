// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const storeState = vi.hoisted(() => ({
  handleStaffLogin: vi.fn(),
  initializeApp: vi.fn(),
  logout: vi.fn(),
  returnToLicenseAccessChoice: vi.fn(),
  staffLoginMessage: null,
  staffLoginError: null,
  staffLoginLicenseKey: 'LANZO-STAFF-INACTIVE',
  licenseDetails: {
    license_key: 'LANZO-STAFF-INACTIVE',
    product_name: 'Lanzo POS',
    plan_code: 'pro',
    features: { staff_roles: true }
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

describe('StaffLoginModal credential feedback', () => {
  it.each([
    ['STAFF_ACCOUNT_INACTIVE', 'Esta cuenta de personal está desactivada. Solicita al administrador que la habilite para poder ingresar.'],
    ['INVALID_STAFF_CREDENTIALS', 'Usuario o contraseña incorrectos.']
  ])('shows the safe message for %s', async (code, expectedMessage) => {
    storeState.handleStaffLogin.mockResolvedValueOnce({
      success: false,
      code,
      message: expectedMessage
    });
    render(<StaffLoginModal />);

    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'prueba' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'fixture-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expectedMessage);
    expect(screen.getByRole('button', { name: /perfil/i })).toBeEnabled();
  });

  it('keeps profile switching available after an inactive-account response', async () => {
    storeState.handleStaffLogin.mockResolvedValueOnce({
      success: false,
      code: 'STAFF_ACCOUNT_INACTIVE',
      message: 'Esta cuenta de personal está desactivada. Solicita al administrador que la habilite para poder ingresar.'
    });
    render(<StaffLoginModal />);

    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'prueba' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'fixture-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta cuenta de personal está desactivada.');

    fireEvent.click(screen.getByRole('button', { name: /perfil/i }));
    expect(storeState.returnToLicenseAccessChoice).toHaveBeenCalledTimes(1);
  });
});
