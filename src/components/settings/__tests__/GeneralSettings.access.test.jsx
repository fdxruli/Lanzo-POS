// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  allowAccess: false,
  updateCompanyProfile: vi.fn(),
  showMessageModal: vi.fn(),
  assertCurrent: vi.fn(),
  state: { companyProfile: null }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    ...mocks.state, updateCompanyProfile: mocks.updateCompanyProfile
  })
}));

vi.mock('../../../services/utils', async (importOriginal) => ({
  ...(await importOriginal()),
  showMessageModal: (...args) => mocks.showMessageModal(...args)
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({ canAccessSection: () => mocks.allowAccess }),
  useSettingsActionGuard: () => () => {
    if (!mocks.allowAccess) throw new Error('PERMISSION_DENIED');
    return { assertCurrent: mocks.assertCurrent };
  }
}));

vi.mock('../../common/NoPermission', () => ({
  default: () => <div role="alert">No tienes acceso</div>
}));

import GeneralSettings from '../GeneralSettings';

beforeEach(() => {
  localStorage.removeItem('theme-preference');
  mocks.allowAccess = false;
  mocks.state = { companyProfile: { license_key: 'LANZO-PRO', name: 'Shop', phone: '123',
    address: 'Calle 1', logo: 'https://logo.test/a.png', business_type: ['hardware'], timezone: null } };
  mocks.updateCompanyProfile.mockReset();
  mocks.showMessageModal.mockReset();
  mocks.assertCurrent.mockReset();
});
afterEach(cleanup);

describe('GeneralSettings business timezone and access', () => {
  it('does not mount profile controls when permission is denied', () => {
    render(<GeneralSettings />);
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
    expect(screen.queryByLabelText('Zona horaria del negocio')).not.toBeInTheDocument();
    expect(mocks.updateCompanyProfile).not.toHaveBeenCalled();
  });

  it('sends the IANA zone with all profile fields and confirms only a successful update', async () => {
    mocks.allowAccess = true;
    mocks.updateCompanyProfile.mockResolvedValue({ ...mocks.state.companyProfile, timezone: 'America/Merida' });
    render(<GeneralSettings />);
    expect(screen.getByText(/gestionar correctamente fechas y horarios de tu negocio/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Zona horaria del negocio'), 'America/Merida');
    await user.click(screen.getByRole('button', { name: /Actualizar datos/i }));
    await waitFor(() => expect(mocks.updateCompanyProfile).toHaveBeenCalledTimes(1));
    expect(mocks.updateCompanyProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Shop', phone: '123', address: 'Calle 1', logo: 'https://logo.test/a.png',
      timezone: 'America/Merida', business_type: ['hardware']
    }));
    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'Zona horaria del negocio guardada.'
    ));
  });

  it('does not call Cloud with an invalid IANA zone', async () => {
    mocks.allowAccess = true;
    render(<GeneralSettings />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Zona horaria del negocio'), 'America/Inexistente');
    await user.click(screen.getByRole('button', { name: /Actualizar datos/i }));
    expect(mocks.updateCompanyProfile).not.toHaveBeenCalled();
    expect(mocks.showMessageModal).toHaveBeenCalledWith(expect.stringContaining('no es válida'),
      null, expect.objectContaining({ type: 'warning' }));
  });

  it('does not show false success when the store discards a stale license/session response', async () => {
    mocks.allowAccess = true;
    mocks.updateCompanyProfile.mockResolvedValue(null);
    render(<GeneralSettings />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Zona horaria del negocio'), 'America/Merida');
    await user.click(screen.getByRole('button', { name: /Actualizar datos/i }));
    await waitFor(() => expect(mocks.updateCompanyProfile).toHaveBeenCalledTimes(1));
    expect(mocks.showMessageModal).not.toHaveBeenCalled();
  });

  it('displays a real Cloud rejection instead of reporting success', async () => {
    mocks.allowAccess = true;
    mocks.updateCompanyProfile.mockRejectedValue(new Error('SETTINGS_PERMISSION_DENIED'));
    render(<GeneralSettings />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Zona horaria del negocio'), 'America/Merida');
    await user.click(screen.getByRole('button', { name: /Actualizar datos/i }));
    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'SETTINGS_PERMISSION_DENIED', null, expect.objectContaining({ type: 'error' })
    ));
    expect(mocks.showMessageModal).not.toHaveBeenCalledWith(
      expect.stringContaining('correctamente')
    );
  });
  it('shows protected company data as read-only and provides a compact detail toggle', async () => {
    mocks.allowAccess = true;
    render(<GeneralSettings />);
    const toggle = screen.getByRole('button', { name: 'Ver datos protegidos' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Nombre del negocio' })).not.toBeInTheDocument();
    expect(screen.getByText('Calle 1')).toBeInTheDocument();
    await userEvent.setup().click(toggle);
    expect(screen.getByRole('button', { name: 'Ocultar datos protegidos' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps incomplete identity editable without unlocking confirmed values', async () => {
    mocks.allowAccess = true;
    mocks.state.companyProfile = { ...mocks.state.companyProfile, phone: '', address: '' };
    render(<GeneralSettings />);
    expect(screen.getByLabelText('Telefono o WhatsApp')).toBeEnabled();
    expect(screen.getByLabelText('Direccion del negocio')).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: 'Nombre del negocio' })).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('Telefono o WhatsApp'), '5550101');
    expect(screen.getByRole('button', { name: /Actualizar datos/ })).toBeEnabled();
  });

  it('keeps accessible theme options, persists preference and provides legal access', async () => {
    mocks.allowAccess = true;
    render(<GeneralSettings />);
    expect(screen.getByRole('radio', { name: 'Tema Sistema' })).toBeChecked();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Tema Oscuro' }));
    expect(localStorage.getItem('theme-preference')).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Tema Oscuro' })).toBeChecked();
    expect(screen.getByRole('button', { name: /Legal y privacidad/ })).toBeEnabled();
  });

});
