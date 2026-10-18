// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  handleAdminLogin: vi.fn(), resumeAdminSessionPreparation: vi.fn(),
  handleFreeDeviceTakeover: vi.fn(), logout: vi.fn(), returnToLicenseAccessChoice: vi.fn(),
  pendingAdminSessionResult: null,
  adminLoginLicenseKey: 'QA-LICENSE', licenseDetails: { plan_code: 'free_trial', license_key: 'QA-LICENSE' }
}));
vi.mock('../../../store/useAppStore', () => {
  const useAppStore = (selector) => selector(state);
  useAppStore.getState = () => state;
  return { useAppStore };
});
vi.mock('../../../hooks/usePostDowngradeCashPending', () => ({ markFreeDeviceTakeoverCompleted: vi.fn() }));
import AdminLoginModal from '../AdminLoginModal';

const fill = () => {
  fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'fixture-only' } });
};
beforeEach(() => {
  vi.clearAllMocks();
  state.pendingAdminSessionResult = null;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(cleanup);

describe('Admin preparation recovery UI', () => {
  it('offers an accessible focused preparation retry without asking for credentials again', async () => {
    state.handleAdminLogin.mockImplementation(async () => {
      state.pendingAdminSessionResult = { result: { success: true } };
      return { success: false, remoteAuthenticated: true, recoveryRequired: true };
    });
    render(<AdminLoginModal />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    const retry = await screen.findByRole('button', { name: 'Reintentar carga' });
    expect(retry).toBeEnabled();
    await waitFor(() => expect(retry).toHaveFocus());
    expect(screen.getByRole('alert')).toHaveTextContent(/tu sesión se verificó correctamente/i);
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('prevents duplicate submissions while the same remote request is pending', async () => {
    let finish;
    state.handleAdminLogin.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { container } = render(<AdminLoginModal />);
    fill();
    const form = container.querySelector('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(state.handleAdminLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Verificando...' })).toBeDisabled();
    await act(async () => finish({ success: false, code: 'INVALID_CREDENTIALS' }));
  });

  it('retries once, announces recovery, and returns focus to login after rejected authority', async () => {
    state.pendingAdminSessionResult = { result: { success: true } };
    let finish;
    state.resumeAdminSessionPreparation.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<AdminLoginModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar carga' }));
    expect(screen.getByRole('status')).toHaveTextContent(/recuperando tu sesión de forma segura/i);
    expect(screen.getByRole('button', { name: 'Recuperando sesión...' })).toBeDisabled();
    await act(async () => {
      state.pendingAdminSessionResult = null;
      finish({ success: false, code: 'ACTOR_CONTEXT_STALE' });
    });
    await waitFor(() => expect(screen.getByLabelText('Usuario')).toHaveFocus());
    expect(screen.getByRole('alert')).toHaveTextContent(/no pudimos recuperar tu sesión de forma segura/i);
    expect(screen.queryByText(/ACTOR_CONTEXT_STALE/)).not.toBeInTheDocument();
    expect(state.resumeAdminSessionPreparation).toHaveBeenCalledTimes(1);
    expect(state.handleAdminLogin).not.toHaveBeenCalled();
  });

  it('permits the guarded preparation retry offline', () => {
    state.pendingAdminSessionResult = { result: { success: true } };
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<AdminLoginModal />);
    expect(screen.getByRole('button', { name: 'Reintentar carga' })).toBeEnabled();
  });

  it.each([
    [{ code: 'ADMIN_LOGIN_ERROR', message: 'Failed to fetch' }, /problema de conexión/i],
    [{ code: 'ACTOR_HANDOFF_REQUIRED' }, /no pudimos recuperar tu sesión de forma segura/i]
  ])('shows safe specific copy for %s', async (result, message) => {
    state.handleAdminLogin.mockResolvedValue({ success: false, ...result });
    render(<AdminLoginModal />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText(/ActorRuntimeError|ACTOR_HANDOFF_REQUIRED/)).not.toBeInTheDocument();
  });
});
