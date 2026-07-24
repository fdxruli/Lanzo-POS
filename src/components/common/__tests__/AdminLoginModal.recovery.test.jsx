import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const storeState = vi.hoisted(() => ({
  handleAdminLogin: vi.fn(),
  logout: vi.fn(),
  adminLoginMessage: null
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(storeState)
}));

import AdminLoginModal from '../AdminLoginModal';

const submitCredentials = () => {
  fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
};

beforeEach(() => {
  storeState.handleAdminLogin.mockReset();
  storeState.logout.mockReset();
  storeState.adminLoginMessage = null;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
});

describe('AdminLoginModal local database recovery', () => {
  it('releases Verificando when UpgradeError rejects', async () => {
    const error = new Error('Not yet support for changing primary key');
    error.name = 'UpgradeError';
    storeState.handleAdminLogin.mockRejectedValueOnce(error);

    render(<AdminLoginModal />);
    submitCredentials();

    expect(await screen.findByText(/esquema local antiguo/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled());
  });

  it('classifies DatabaseClosedError caused by UpgradeError', async () => {
    const inner = new Error('Not yet support for changing primary key');
    inner.name = 'UpgradeError';
    const error = new Error('DatabaseClosedError: UpgradeError Not yet support for changing primary key');
    error.name = 'DatabaseClosedError';
    error.inner = inner;
    storeState.handleAdminLogin.mockRejectedValueOnce(error);

    render(<AdminLoginModal />);
    submitCredentials();

    expect(await screen.findByText(/esquema local antiguo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('shows a retryable message for DatabaseOpenTimeoutError', async () => {
    const error = new Error('IndexedDB no terminó de abrirse');
    error.name = 'DatabaseOpenTimeoutError';
    storeState.handleAdminLogin.mockRejectedValueOnce(error);

    render(<AdminLoginModal />);
    submitCredentials();

    expect(await screen.findByText(/tardó demasiado/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('handles invalid credentials without an uncaught rejection', async () => {
    storeState.handleAdminLogin.mockResolvedValueOnce({
      success: false,
      code: 'INVALID_ADMIN_CREDENTIALS',
      message: 'invalid'
    });

    render(<AdminLoginModal />);
    submitCredentials();

    expect(await screen.findByText(/usuario o contraseña incorrectos/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('also releases loading after a successful result', async () => {
    storeState.handleAdminLogin.mockResolvedValueOnce({ success: true });

    render(<AdminLoginModal />);
    submitCredentials();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled());
  });
});
