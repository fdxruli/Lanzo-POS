// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  access: null,
  app: null,
  deviceManagerRender: vi.fn()
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => state.access
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(state.app))
}));

vi.mock('../../common/DeviceManager', () => ({
  default: ({ licenseKey }) => {
    state.deviceManagerRender(licenseKey);
    return <div>Administrador de dispositivos</div>;
  }
}));

import DevicesSettings from '../DevicesSettings';

const renderSettings = () => render(
  <MemoryRouter>
    <DevicesSettings />
  </MemoryRouter>
);

describe('DevicesSettings actor isolation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    state.app = {
      licenseDetails: { valid: true, license_key: 'LIC-1' },
      currentStaffUser: null
    };
    state.access = {
      actorId: null,
      isAdmin: false,
      canAccessSection: () => false
    };
  });

  it('gives Staff with devices permission a safe read-only current-device view', () => {
    state.app.currentStaffUser = { id: 'staff-a', display_name: 'Staff A' };
    state.access = {
      actorId: 'staff-a',
      isAdmin: false,
      canAccessSection: (section) => section === 'devices'
    };

    renderSettings();

    expect(screen.getByTestId('staff-device-readonly')).toHaveTextContent('Solo lectura');
    expect(screen.getByText('Staff A')).toBeInTheDocument();
    expect(screen.queryByText('Administrador de dispositivos')).not.toBeInTheDocument();
    expect(state.deviceManagerRender).not.toHaveBeenCalled();
  });

  it('mounts the existing Admin-only device manager only for Admin', () => {
    state.access = {
      actorId: 'admin-a',
      isAdmin: true,
      canAccessSection: (section) => section === 'devices'
    };

    renderSettings();

    expect(screen.getByText('Administrador de dispositivos')).toBeInTheDocument();
    expect(state.deviceManagerRender).toHaveBeenCalledWith('LIC-1');
    expect(screen.queryByTestId('staff-device-readonly')).not.toBeInTheDocument();
  });

  it('keeps Local Admin device management and adds only a secondary Nube explanation', () => {
    state.app.licenseDetails = {
      valid: true,
      is_entitled: true,
      status: 'active',
      plan_code: 'free_trial',
      license_key: 'LIC-LOCAL',
      features: {
        staff_roles: false,
        realtime_license_sync: false,
        cloud_pos_sync: false
      }
    };
    state.access = {
      isAuthorizedActor: true,
      actorType: 'admin',
      isAdmin: true,
      canAccessSection: (section) => section === 'devices'
    };

    renderSettings();

    expect(screen.getByText('Administrador de dispositivos')).toBeInTheDocument();
    expect(state.deviceManagerRender).toHaveBeenCalledWith('LIC-LOCAL');
    expect(screen.getByRole('heading', { name: 'Trabaja con más dispositivos usando Lanzo Nube' })).toBeInTheDocument();
    expect(screen.getByText(/según las capacidades contratadas/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Conocer Lanzo Nube/ })).toHaveAttribute('href', '/acerca-de');
  });

  it('does not show the device promotion to an entitled Nube Admin', () => {
    state.app.licenseDetails = {
      valid: true,
      is_entitled: true,
      status: 'active',
      plan_code: 'pro_monthly',
      license_key: 'LIC-PRO',
      features: {
        staff_roles: true,
        realtime_license_sync: true,
        cloud_pos_sync: true
      }
    };
    state.access = {
      isAuthorizedActor: true,
      actorType: 'admin',
      isAdmin: true,
      canAccessSection: (section) => section === 'devices'
    };

    renderSettings();

    expect(screen.getByText('Administrador de dispositivos')).toBeInTheDocument();
    expect(state.deviceManagerRender).toHaveBeenCalledWith('LIC-PRO');
    expect(screen.queryByRole('heading', { name: 'Trabaja con más dispositivos usando Lanzo Nube' })).not.toBeInTheDocument();
  });

  it('fails closed without devices permission', () => {
    renderSettings();
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso');
    expect(state.deviceManagerRender).not.toHaveBeenCalled();
  });
});
