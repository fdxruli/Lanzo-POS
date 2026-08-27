// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleLogin: vi.fn(),
  handleFreeTrial: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  buildSupportMailtoUrl: vi.fn(() => 'mailto:soporte@example.com'),
  copyTextToClipboard: vi.fn(),
  showMessageModal: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    handleLogin: mocks.handleLogin,
    handleFreeTrial: mocks.handleFreeTrial
  })
}));
vi.mock('../../../services/Logger', () => ({ default: mocks.logger }));
vi.mock('../../../services/utils', () => ({ showMessageModal: mocks.showMessageModal }));
vi.mock('../../../services/support/supportContact', () => ({
  buildSupportMailtoUrl: mocks.buildSupportMailtoUrl,
  copyTextToClipboard: mocks.copyTextToClipboard,
  getSupportEmail: () => 'soporte@example.com'
}));

import WelcomeModal from '../WelcomeModal';

const submitLicense = async (outcome) => {
  if (outcome instanceof Error) {
    mocks.handleLogin.mockRejectedValueOnce(outcome);
  } else {
    mocks.handleLogin.mockResolvedValueOnce(outcome);
  }

  render(<WelcomeModal />);
  fireEvent.change(screen.getByLabelText(/clave de licencia/i), {
    target: { value: 'LANZO-TEST' }
  });
  fireEvent.click(screen.getByRole('button', { name: /acceder con licencia/i }));

  await waitFor(() => expect(mocks.handleLogin).toHaveBeenCalledWith('LANZO-TEST'));
};

const expectNoWelcomeActivationAlert = async () => {
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('WelcomeModal activation errors', () => {
  it('shows a neutral mapped message for a mistyped license', async () => {
    await submitLicense({
      success: false,
      code: 'LICENSE_NOT_FOUND',
      message: 'Error de activacion.'
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Licencia no disponible');
    expect(alert.textContent).toContain('Revisa que hayas escrito la clave correctamente');
    expect(alert.textContent).not.toContain('Error de activacion.');
    expect(alert.textContent).not.toContain('Esta licencia no existe');
  });

  it('sanitizes a raw transport message before it reaches the user-visible alert', async () => {
    await submitLicense(new Error('PGRST500: SQL statement failed; stack trace follows'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No pudimos validar la licencia');
    expect(alert.textContent).toContain('Inténtalo nuevamente.');
    expect(alert.textContent).not.toMatch(/PGRST|SQL|stack|500/i);
  });

  it('does not render an activation error for the access-choice transition', async () => {
    await submitLicense({
      success: false,
      code: 'ADMIN_OR_STAFF_LOGIN_REQUIRED',
      accessChoiceRequired: true,
      message: 'Elige como deseas ingresar.'
    });

    await expectNoWelcomeActivationAlert();
  });

  it('does not render an activation error for the admin-enrollment transition', async () => {
    await submitLicense({
      success: false,
      code: 'ADMIN_ENROLLMENT_REQUIRED',
      adminEnrollmentRequired: true,
      message: 'Crea las credenciales del propietario.'
    });

    await expectNoWelcomeActivationAlert();
  });

  it('does not render an activation error for the staff-login transition', async () => {
    await submitLicense({
      success: false,
      code: 'STAFF_LOGIN_REQUIRED',
      staffLoginRequired: true,
      message: 'Este dispositivo requiere login staff.'
    });

    await expectNoWelcomeActivationAlert();
  });

  it('does not render a generic activation error when license change takes over', async () => {
    await submitLicense({
      success: false,
      code: 'PLAN_DOWNGRADE_DEVICE_LIMIT',
      licenseChangeRequired: true,
      message: 'Esta licencia requiere cambiarse en este dispositivo.'
    });

    await expectNoWelcomeActivationAlert();
  });

  it('does not render a generic activation error when local-tenant protection takes over', async () => {
    await submitLicense({
      success: false,
      code: 'LOCAL_TENANT_MISMATCH',
      localTenantMismatch: true,
      message: 'The local tenant belongs to another license.'
    });

    await expectNoWelcomeActivationAlert();
  });
});
