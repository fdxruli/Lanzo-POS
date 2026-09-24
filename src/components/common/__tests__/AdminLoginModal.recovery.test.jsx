// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const recoveryRuntime = vi.hoisted(() => ({
  markTakeoverCompleted: vi.fn(),
  scopeKey: (licenseKey, adminUser) => {
    const tenant = String(licenseKey || '').trim();
    const actorId = String(adminUser?.id || '').trim();
    const username = String(adminUser?.username || '').trim().toLowerCase();
    const actor = actorId ? 'id:' + actorId : username ? 'username:' + username : null;
    return tenant && actor ? JSON.stringify([tenant, actor]) : null;
  }
}));

const storeState = vi.hoisted(() => ({
  handleAdminLogin: vi.fn(),
  handleFreeDeviceTakeover: vi.fn(),
  logout: vi.fn(),
  returnToLicenseAccessChoice: vi.fn(),
  adminLoginMessage: null,
  adminLoginLicenseKey: 'LANZO-TAKEOVER-TEST',
  licenseDetails: {
    license_key: 'LANZO-TAKEOVER-TEST',
    product_name: 'Lanzo Local',
    plan_code: 'free_trial',
    max_devices: 1
  },
  currentDeviceRole: null,
  currentAdminUser: null
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector(storeState), {
    getState: () => storeState
  })
}));

vi.mock('../../../hooks/usePostDowngradeCashPending', () => ({
  getPostDowngradeCashPendingScopeKey: recoveryRuntime.scopeKey,
  markFreeDeviceTakeoverCompleted: recoveryRuntime.markTakeoverCompleted
}));

import AdminLoginModal from '../AdminLoginModal';

const submitCredentials = () => {
  fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
};

beforeEach(() => {
  storeState.handleAdminLogin.mockReset();
  storeState.handleFreeDeviceTakeover.mockReset();
  storeState.logout.mockReset();
  storeState.returnToLicenseAccessChoice.mockReset();
  recoveryRuntime.markTakeoverCompleted.mockReset();
  storeState.currentDeviceRole = null;
  storeState.currentAdminUser = null;
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
    expect(recoveryRuntime.markTakeoverCompleted).not.toHaveBeenCalled();
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

  it('shows explicit Lanzo Local takeover confirmation after valid owner credentials', async () => {
    storeState.handleAdminLogin.mockResolvedValueOnce({
      success: false,
      code: 'FREE_DEVICE_TAKEOVER_REQUIRED',
      takeoverRequired: true,
      details: { plan_code: 'free_trial', max_devices: 1 }
    });

    render(<AdminLoginModal />);
    submitCredentials();

    expect(await screen.findByRole('heading', { name: 'Tu plan cambió a Lanzo Local' })).toBeInTheDocument();
    expect(screen.getByText(/otro dispositivo registrado como activo/i)).toBeInTheDocument();
    expect(screen.getByText(/sesiones activas en los demás dispositivos se cerrarán/i)).toBeInTheDocument();
    expect(screen.getByText(/tus datos permanecerán intactos/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar este dispositivo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Usar este dispositivo' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    expect(screen.queryByText(/límite de dispositivos alcanzado/i)).not.toBeInTheDocument();
    expect(storeState.handleFreeDeviceTakeover).not.toHaveBeenCalled();
  });

  it('confirms takeover only after the owner presses Usar este dispositivo', async () => {
    storeState.handleAdminLogin.mockResolvedValueOnce({
      success: false,
      code: 'FREE_DEVICE_TAKEOVER_REQUIRED',
      takeoverRequired: true
    });
    storeState.handleFreeDeviceTakeover.mockImplementationOnce(async () => {
      storeState.currentDeviceRole = 'admin';
      storeState.currentAdminUser = {
        id: 'owner-id',
        username: 'owner',
        is_owner: true
      };
      return { success: true };
    });

    render(<AdminLoginModal />);
    submitCredentials();

    const takeoverButton = await screen.findByRole('button', { name: 'Usar este dispositivo' });
    fireEvent.click(takeoverButton);

    await waitFor(() => expect(storeState.handleFreeDeviceTakeover).toHaveBeenCalledWith({
      username: 'owner',
      password: 'secret'
    }));
    expect(storeState.handleFreeDeviceTakeover).toHaveBeenCalledTimes(1);
    expect(recoveryRuntime.markTakeoverCompleted).toHaveBeenCalledTimes(1);
    expect(recoveryRuntime.markTakeoverCompleted).toHaveBeenCalledWith(
      JSON.stringify(['LANZO-TAKEOVER-TEST', 'id:owner-id'])
    );
  });

  it('cancels takeover locally without displacing any device', async () => {
    storeState.handleAdminLogin.mockResolvedValueOnce({
      success: false,
      code: 'FREE_DEVICE_TAKEOVER_REQUIRED',
      takeoverRequired: true
    });

    render(<AdminLoginModal />);
    submitCredentials();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeDisabled();
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    await waitFor(() => expect(screen.getByLabelText('Usuario')).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Usar este dispositivo' })).not.toBeInTheDocument();
    expect(storeState.handleFreeDeviceTakeover).not.toHaveBeenCalled();
    expect(recoveryRuntime.markTakeoverCompleted).not.toHaveBeenCalled();
  });

  it('also releases loading after a successful result', async () => {
    storeState.handleAdminLogin.mockResolvedValueOnce({ success: true });

    render(<AdminLoginModal />);
    submitCredentials();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled());
  });
  it('does not show raw Postgres or RPC errors when takeover fails', async () => {
    storeState.handleAdminLogin.mockResolvedValueOnce({
      success: false,
      code: 'FREE_DEVICE_TAKEOVER_REQUIRED',
      takeoverRequired: true
    });
    storeState.handleFreeDeviceTakeover.mockResolvedValueOnce({
      success: false,
      code: 'P0001',
      message: 'POST_DOWNGRADE_CASH_OWNER_REQUIRED from private.function at SQL line 42'
    });

    render(<AdminLoginModal />);
    submitCredentials();
    fireEvent.click(await screen.findByRole('button', { name: 'Usar este dispositivo' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'No se pudo completar la acción. Tus datos permanecen intactos. Revisa tu conexión e inténtalo nuevamente.'
    );
    expect(screen.queryByText(/POST_DOWNGRADE_CASH_OWNER_REQUIRED|SQL line 42|P0001/)).not.toBeInTheDocument();
  });

  it('does not emit an unscoped success when owner bootstrap state is missing', async () => {
    storeState.handleAdminLogin.mockResolvedValueOnce({
      success: false,
      code: 'FREE_DEVICE_TAKEOVER_REQUIRED',
      takeoverRequired: true
    });
    storeState.handleFreeDeviceTakeover.mockResolvedValueOnce({ success: true });

    render(<AdminLoginModal />);
    submitCredentials();
    fireEvent.click(await screen.findByRole('button', { name: 'Usar este dispositivo' }));

    await waitFor(() => expect(storeState.handleFreeDeviceTakeover).toHaveBeenCalledTimes(1));
    expect(recoveryRuntime.markTakeoverCompleted).not.toHaveBeenCalled();
  });

});
