// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({}));
vi.mock('../../../store/useAppStore', () => {
  const useAppStore = (selector) => selector(state);
  useAppStore.getState = () => state;
  return { useAppStore };
});
vi.mock('../../../services/supabase', () => ({ getBusinessProfile: vi.fn() }));
vi.mock('../../../hooks/usePostDowngradeCashPending', () => ({ markFreeDeviceTakeoverCompleted: vi.fn() }));
import WelcomeModal from '../WelcomeModal';
import LicenseAccessChooser from '../LicenseAccessChooser';
import AdminLoginModal from '../AdminLoginModal';
import StaffLoginModal from '../StaffLoginModal';
import AdminEnrollmentModal from '../AdminEnrollmentModal';

beforeEach(() => {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, {
    licenseDetails: { license_key: 'SECRET-LICENSE', features: { staff_roles: true } },
    companyProfile: { name: 'SECRET-BUSINESS' },
    logout: vi.fn(), chooseLicenseAccess: vi.fn(), returnToLicenseAccessChoice: vi.fn(),
    handleLogin: vi.fn(), handleFreeTrial: vi.fn(), handleAdminLogin: vi.fn(),
    handleStaffLogin: vi.fn(), handleAdminEnrollment: vi.fn(), initializeApp: vi.fn(),
    resumeAdminSessionPreparation: vi.fn(), handleFreeDeviceTakeover: vi.fn()
  });
});
afterEach(cleanup);
const toggle = () => {
  expect(screen.getAllByRole('button', { name: 'Soporte' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Soporte' }));
  const support = screen.queryByRole('dialog', { name: 'Soporte oficial de LANZO' })
    || screen.queryByRole('region', { name: 'Soporte oficial de LANZO' });
  expect(support).toBeVisible();
  if (support.getAttribute('role') === 'dialog') expect(support).toHaveAttribute('aria-modal', 'true');
  const url = new URL(screen.getByRole('link', { name: 'Abrir borrador de correo' }).href);
  expect(url.href).not.toMatch(/SECRET|password|token|tenant|userAgent/i);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar soporte' }));
};
const noMutations = () => {
  for (const value of Object.values(state)) if (vi.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
};

describe('support integration without changing access state', () => {
  it.each([
    ['welcome', WelcomeModal], ['chooser', LicenseAccessChooser],
    ['admin', AdminLoginModal], ['staff', StaffLoginModal], ['owner', AdminEnrollmentModal]
  ])('offers one support entry in %s without triggering business actions', (_name, Component) => {
    render(<Component />);
    toggle();
    noMutations();
    expect(state.licenseDetails.license_key).toBe('SECRET-LICENSE');
  });

  it.each([['admin', AdminLoginModal], ['staff', StaffLoginModal], ['owner', AdminEnrollmentModal]])('preserves %s credentials and still submits normally after support', async (_name, Component) => {
    render(<Component />);
    const username = screen.getByLabelText('Usuario');
    const password = screen.getByLabelText('Contraseña');
    fireEvent.change(username, { target: { value: 'fixture_owner' } });
    fireEvent.change(password, { target: { value: 'SECRET-PASSWORD' } });
    toggle();
    expect(username).toHaveValue('fixture_owner');
    expect(password).toHaveValue('SECRET-PASSWORD');
    noMutations();
    if (Component === AdminEnrollmentModal) {
      fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'SECRET-PASSWORD' } });
      fireEvent.change(screen.getByLabelText('Nombre del propietario'), { target: { value: 'Fixture' } });
    }
    const handler = Component === AdminLoginModal ? state.handleAdminLogin
      : Component === StaffLoginModal ? state.handleStaffLogin : state.handleAdminEnrollment;
    let finish;
    handler.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    fireEvent.submit(username.closest('form'));
    expect(handler).toHaveBeenCalledTimes(1);
    // Support remains usable while a login/enrollment is in flight.
    toggle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.logout).not.toHaveBeenCalled();
    await act(async () => finish({ success: false, code: 'INVALID_CREDENTIALS' }));
    expect(username).toHaveValue('fixture_owner');
  });

  it.each(['SESSION_VERIFICATION_INCONCLUSIVE', 'ACTOR_RUNTIME_RESTORE_FAILED', 'ADMIN_OFFLINE_EVIDENCE_PENDING'])('supports pending administrator verification %s', (code) => {
    state.adminLoginError = { code };
    render(<AdminLoginModal />);
    toggle();
    expect(screen.getByRole('button', { name: 'Reintentar verificación' })).toBeEnabled();
    noMutations();
  });

  it('supports verified administrator preparation without retrying or signing out', () => {
    state.pendingAdminSessionResult = { result: { success: true, token: 'SECRET-TOKEN' } };
    render(<AdminLoginModal />);
    toggle();
    expect(screen.getByRole('button', { name: 'Reintentar carga' })).toBeEnabled();
    noMutations();
    expect(state.pendingAdminSessionResult.result.token).toBe('SECRET-TOKEN');
  });

  it.each(['SESSION_VERIFICATION_INCONCLUSIVE', 'ACTOR_RUNTIME_RESTORE_FAILED', 'STAFF_ALREADY_IN_USE'])('supports staff state %s', (code) => {
    state.staffLoginError = { code };
    render(<StaffLoginModal />);
    toggle();
    noMutations();
  });

  it('leaves support to Setup when owner enrollment is embedded', () => {
    render(<AdminEnrollmentModal embedded />);
    expect(screen.queryByRole('button', { name: 'Soporte' })).not.toBeInTheDocument();
  });
});
