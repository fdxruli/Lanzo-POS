// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  access: null,
  app: null,
  staffSettingsRender: vi.fn()
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => state.access,
  useSettingsActionGuard: () => () => ({ assertCurrent: vi.fn() })
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(state.app))
}));

vi.mock('../StaffUsersSettings', () => ({
  default: ({ licenseKey }) => {
    state.staffSettingsRender(licenseKey);
    return <div>Administracion de Staff</div>;
  }
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn()
}));

import LicenseSettings from '../LicenseSettings';

describe('LicenseSettings sibling isolation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    state.app = {
      companyProfile: { business_type: ['food_service'] },
      updateCompanyProfile: vi.fn(),
      licenseDetails: {
        valid: true,
        status: 'active',
        license_key: 'LIC-1',
        features: {
          max_rubros: 2,
          allowed_rubros: ['*'],
          staff_roles: true,
          realtime_license_sync: false
        }
      },
      currentStaffUser: {
        id: 'staff-a',
        username: 'staff-a',
        permissions: { license: true }
      },
      logoutStaff: vi.fn(),
      logoutAdmin: vi.fn(),
      renewLicense: vi.fn()
    };
    state.access = {
      isAdmin: false,
      isStaff: true,
      canAccessSection: (section) => section === 'license',
      canAccessPermission: (permission) => permission === 'license'
    };
  });

  it('lets license-only Staff read license content without business-profile controls', () => {
    render(<LicenseSettings />);

    expect(screen.getByText('Informacion de licencia')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Configuracion de modulos')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Equipo' })).not.toBeInTheDocument();
    expect(screen.queryByText('Administracion de Staff')).not.toBeInTheDocument();
  });

  it('shows rubro/business-profile controls only with settings permission', () => {
    state.access.canAccessPermission = (permission) => ['license', 'settings'].includes(permission);

    render(<LicenseSettings />);

    expect(screen.getByRole('tab', { name: 'Rubros' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Rubros' }));
    expect(screen.getByText('Configuracion de modulos')).toBeInTheDocument();
    expect(screen.queryByText('Informacion de licencia')).not.toBeInTheDocument();
  });

  it('keeps Staff management Admin-only', () => {
    state.app.currentStaffUser = null;
    state.access = {
      isAdmin: true,
      isStaff: false,
      canAccessSection: (section) => section === 'license',
      canAccessPermission: () => true
    };

    render(<LicenseSettings />);

    expect(screen.getByRole('tab', { name: 'Resumen' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Equipo' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rubros' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equipo staff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rubros' })).not.toBeInTheDocument();
    expect(screen.queryByText('Administracion de Staff')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }));
    expect(screen.getByText('Administracion de Staff')).toBeInTheDocument();
    expect(state.staffSettingsRender).toHaveBeenCalledWith('LIC-1');
  });

  it('does not expose Staff management when the license lacks staff_roles', () => {
    state.app.currentStaffUser = null;
    state.app.licenseDetails.features.staff_roles = false;
    state.access = {
      isAdmin: true,
      isStaff: false,
      canAccessSection: (section) => section === 'license',
      canAccessPermission: () => true
    };

    render(<LicenseSettings />);

    expect(screen.queryByRole('tab', { name: 'Equipo' })).not.toBeInTheDocument();
  });

  it('falls back to Summary immediately when the active Staff section loses authority', () => {
    state.app.currentStaffUser = null;
    state.access = {
      isAdmin: true,
      isStaff: false,
      canAccessSection: (section) => section === 'license',
      canAccessPermission: () => true
    };

    const view = render(<LicenseSettings />);
    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }));
    expect(screen.getByText('Administracion de Staff')).toBeInTheDocument();

    state.access = {
      isAdmin: false,
      isStaff: true,
      canAccessSection: (section) => section === 'license',
      canAccessPermission: (permission) => permission === 'license'
    };
    state.app.currentStaffUser = { id: 'staff-b', username: 'staff-b', permissions: { license: true } };
    view.rerender(<LicenseSettings />);

    expect(screen.queryByText('Administracion de Staff')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Equipo' })).not.toBeInTheDocument();
  });
});
