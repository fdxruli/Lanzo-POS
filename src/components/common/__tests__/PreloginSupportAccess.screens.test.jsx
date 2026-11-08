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

// jsdom does not implement the native top-layer dialog methods.
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  if (originalShowModal) HTMLDialogElement.prototype.showModal = originalShowModal;
  else delete HTMLDialogElement.prototype.showModal;
  if (originalClose) HTMLDialogElement.prototype.close = originalClose;
  else delete HTMLDialogElement.prototype.close;
});

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
  expect(screen.getByRole('region', { name: 'Soporte oficial de LANZO' })).toBeVisible();
  if (document.querySelector('.prelogin-support__dialog')) {
    expect(screen.getByRole('dialog', { name: 'Soporte LANZO' })).toHaveAttribute('open');
  }
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
    const supportTrigger = screen.getByRole('button', { name: 'Soporte' });
    if (_name === 'welcome') {
      expect(supportTrigger).not.toHaveClass('auth-page__footer-link');
      expect(supportTrigger).toHaveClass('ui-button--ghost');
    } else {
      expect(supportTrigger).toHaveClass('auth-page__footer-link');
    }
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
    const retryLabel = code === 'SESSION_VERIFICATION_INCONCLUSIVE'
      ? 'Reintentar verificación'
      : 'Reintentar recuperación';
    expect(screen.getByRole('button', { name: retryLabel })).toBeEnabled();
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

describe('welcome support as modal', () => {
  it('opens outside the welcome layout and restores keyboard focus on close', () => {
    render(<WelcomeModal />);
    const trigger = screen.getByRole('button', { name: 'Soporte' });
    const footer = document.querySelector('.welcome-secondary');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Soporte LANZO' });
    expect(dialog).toHaveAttribute('open');
    expect(footer.contains(dialog)).toBe(false);
    expect(dialog).toContainElement(screen.getByRole('region', { name: 'Soporte oficial de LANZO' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar soporte' }));
    expect(screen.queryByRole('dialog', { name: 'Soporte LANZO' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    noMutations();
  });

  it('closes with Escape and does not change the license workflow', () => {
    render(<WelcomeModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Soporte' }));
    const dialog = screen.getByRole('dialog', { name: 'Soporte LANZO' });
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog', { name: 'Soporte LANZO' })).not.toBeInTheDocument();
    noMutations();
  });
});
