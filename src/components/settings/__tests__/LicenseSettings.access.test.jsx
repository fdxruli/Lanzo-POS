// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

const state = vi.hoisted(() => ({
  access: null,
  app: null,
  staffSettingsRender: vi.fn(),
  staffSettingsMount: vi.fn(),
  staffSettingsUnmount: vi.fn()
}));

const staffService = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  update: vi.fn()
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => state.access,
  useSettingsActionGuard: () => () => ({ assertCurrent: vi.fn() })
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(state.app))
}));

vi.mock('../../../services/licenseService', () => ({
  createStaffUserService: staffService.create,
  listStaffUsersService: staffService.list,
  updateStaffUserService: staffService.update
}));

vi.mock('../StaffUsersSettings', () => {
  function MockStaffUsersSettings({ licenseKey }) {
    state.staffSettingsRender(licenseKey);
    useEffect(() => {
      state.staffSettingsMount(licenseKey);
      return () => state.staffSettingsUnmount(licenseKey);
    }, [licenseKey]);
    return <div>Administracion de Staff</div>;
  }

  return { default: MockStaffUsersSettings };
});

vi.mock('../../../services/utils', () => ({
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn()
}));

import LicenseSettings from '../LicenseSettings';

describe('LicenseSettings sibling isolation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    staffService.create.mockReset();
    staffService.list.mockReset();
    staffService.update.mockReset();
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

  const localLicense = () => ({
    valid: true,
    is_entitled: true,
    status: 'active',
    license_key: 'LIC-LOCAL',
    plan_code: 'free_trial',
    features: {
      max_rubros: 1,
      allowed_rubros: ['*'],
      staff_roles: false,
      realtime_license_sync: false,
      cloud_pos_sync: false,
      notification_center: false,
      cloud_notifications: false,
      support_center: false,
      support_tickets: false,
      support_ticket_history: false
    }
  });

  const localAdminAccess = () => ({
    isAuthorizedActor: true,
    isAdmin: true,
    isStaff: false,
    actorType: 'admin',
    actorId: 'admin-a',
    actorKey: 'admin:admin-a',
    generation: 1,
    canAccessSection: (section) => section === 'license',
    canAccessPermission: () => true
  });

  const renderInApp = () => render(
    <MemoryRouter initialEntries={['/configuracion?tab=license']}>
      <LicenseSettings />
    </MemoryRouter>
  );

  it('shows Local Admin the Equipo PRO presentation without mounting or requesting Staff data', () => {
    state.app.currentStaffUser = null;
    state.app.licenseDetails = localLicense();
    state.access = localAdminAccess();

    renderInApp();

    const teamTab = screen.getByRole('tab', { name: 'Equipo PRO' });
    expect(teamTab).toBeInTheDocument();
    fireEvent.click(teamTab);

    expect(screen.getByRole('heading', { name: 'Organiza a tu equipo con Lanzo Nube' })).toBeInTheDocument();
    expect(screen.getByText(/Crea y administra usuarios Staff/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Conocer Lanzo Nube/ })).toHaveAttribute('href', '/acerca-de');
    expect(state.staffSettingsRender).not.toHaveBeenCalled();
    expect(state.staffSettingsMount).not.toHaveBeenCalled();
    expect(staffService.list).not.toHaveBeenCalled();
    expect(staffService.create).not.toHaveBeenCalled();
    expect(staffService.update).not.toHaveBeenCalled();
  });

  it('presents notification and support discovery without opening their Cloud centers', () => {
    state.app.currentStaffUser = null;
    state.app.licenseDetails = localLicense();
    state.access = localAdminAccess();

    renderInApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Capacidades Nube' }));

    expect(screen.getByRole('heading', { name: 'Centraliza los avisos importantes de tu negocio' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Da seguimiento a tus solicitudes desde Lanzo' })).toBeInTheDocument();
    expect(screen.getByText(/Los tiempos de atención dependen de la disponibilidad/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Centro de Notificaciones/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir centro de notificaciones/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Conocer Lanzo Nube/ })).toHaveAttribute('href', '/acerca-de');
  });

  it('keeps the functional Team tab for an entitled PRO Admin without a redundant showcase', () => {
    state.app.currentStaffUser = null;
    state.app.licenseDetails = {
      ...localLicense(),
      plan_code: 'pro_monthly',
      features: {
        ...localLicense().features,
        staff_roles: true,
        realtime_license_sync: true,
        cloud_pos_sync: true,
        notification_center: true,
        cloud_notifications: true,
        support_center: true,
        support_tickets: true,
        support_ticket_history: true
      }
    };
    state.access = localAdminAccess();

    renderInApp();

    expect(screen.getByRole('tab', { name: 'Equipo' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Equipo PRO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Capacidades Nube' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }));
    expect(screen.getByText('Administracion de Staff')).toBeInTheDocument();
    expect(state.staffSettingsMount).toHaveBeenCalledWith('LIC-LOCAL');
  });

  it('does not show discovery to Staff, invalid or non-active Local licenses', () => {
    state.app.currentStaffUser = { id: 'staff-a', username: 'staff-a' };
    state.app.licenseDetails = localLicense();
    state.access = {
      ...localAdminAccess(),
      isAdmin: false,
      isStaff: true,
      actorType: 'staff',
      currentStaffUser: state.app.currentStaffUser
    };
    const staffView = renderInApp();
    expect(screen.queryByRole('tab', { name: 'Equipo PRO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Capacidades Nube' })).not.toBeInTheDocument();
    staffView.unmount();

    state.app.currentStaffUser = null;
    state.access = localAdminAccess();
    state.app.licenseDetails = { ...localLicense(), valid: false };
    const invalidView = renderInApp();
    expect(screen.queryByRole('tab', { name: 'Equipo PRO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Capacidades Nube' })).not.toBeInTheDocument();
    invalidView.unmount();

    state.app.licenseDetails = {
      ...localLicense(),
      status: 'grace_period',
      expires_at: '2025-01-01T00:00:00.000Z',
      grace_period_ends: '2027-01-01T00:00:00.000Z'
    };
    renderInApp();
    expect(screen.queryByRole('tab', { name: 'Equipo PRO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Capacidades Nube' })).not.toBeInTheDocument();
    expect(state.staffSettingsRender).not.toHaveBeenCalled();
  });

  it('switches between discovery and real Team access when entitlement changes', () => {
    state.app.currentStaffUser = null;
    state.app.licenseDetails = localLicense();
    state.access = localAdminAccess();

    const view = renderInApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Equipo PRO' }));
    expect(screen.getByRole('heading', { name: 'Organiza a tu equipo con Lanzo Nube' })).toBeInTheDocument();
    expect(state.staffSettingsMount).not.toHaveBeenCalled();

    state.app.licenseDetails = {
      ...localLicense(),
      plan_code: 'pro_monthly',
      features: {
        ...localLicense().features,
        staff_roles: true,
        realtime_license_sync: true,
        cloud_pos_sync: true
      }
    };
    view.rerender(
      <MemoryRouter initialEntries={['/configuracion?tab=license']}>
        <LicenseSettings />
      </MemoryRouter>
    );

    expect(screen.getByRole('tab', { name: 'Equipo' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Equipo PRO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Capacidades Nube' })).not.toBeInTheDocument();
    expect(screen.getByText('Administracion de Staff')).toBeInTheDocument();

    state.app.licenseDetails = localLicense();
    view.rerender(
      <MemoryRouter initialEntries={['/configuracion?tab=license']}>
        <LicenseSettings />
      </MemoryRouter>
    );

    expect(screen.getByRole('tab', { name: 'Equipo PRO' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Capacidades Nube' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Organiza a tu equipo con Lanzo Nube' })).toBeInTheDocument();
    expect(screen.queryByText('Administracion de Staff')).not.toBeInTheDocument();
    expect(staffService.create).not.toHaveBeenCalled();
    expect(staffService.update).not.toHaveBeenCalled();
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

  it('mounts Staff lazily and keeps the same panel alive across tab changes', () => {
    state.app.currentStaffUser = null;
    state.access = {
      isAdmin: true,
      isStaff: false,
      actorKey: 'admin:1',
      generation: 1,
      canAccessSection: (section) => section === 'license',
      canAccessPermission: () => true
    };

    render(<LicenseSettings />);

    expect(state.staffSettingsMount).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }));
    expect(state.staffSettingsMount).toHaveBeenCalledTimes(1);
    const staffPanel = document.getElementById('license-panel-staff');
    expect(staffPanel).not.toHaveAttribute('hidden');

    fireEvent.click(screen.getByRole('tab', { name: 'Rubros' }));
    expect(state.staffSettingsUnmount).not.toHaveBeenCalled();
    expect(staffPanel).toHaveAttribute('hidden');

    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }));
    expect(state.staffSettingsMount).toHaveBeenCalledTimes(1);
    expect(document.getElementById('license-panel-staff')).toBe(staffPanel);
    expect(staffPanel).not.toHaveAttribute('hidden');
  });

  it('resets the retained Staff instance when the Admin actor changes', () => {
    state.app.currentStaffUser = null;
    state.access = {
      isAdmin: true,
      isStaff: false,
      actorKey: 'admin:1',
      generation: 1,
      canAccessSection: (section) => section === 'license',
      canAccessPermission: () => true
    };

    const view = render(<LicenseSettings />);
    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }));
    expect(state.staffSettingsMount).toHaveBeenCalledTimes(1);

    state.access = {
      ...state.access,
      actorKey: 'admin:2',
      generation: 2
    };
    view.rerender(<LicenseSettings />);

    expect(state.staffSettingsUnmount).toHaveBeenCalledWith('LIC-1');
    expect(state.staffSettingsMount).toHaveBeenCalledTimes(2);
  });

  it('does not carry Staff state into a different license identity', () => {
    state.app.currentStaffUser = null;
    state.access = {
      isAdmin: true,
      isStaff: false,
      actorKey: 'admin:1',
      generation: 1,
      canAccessSection: (section) => section === 'license',
      canAccessPermission: () => true
    };

    const view = render(<LicenseSettings />);
    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }));
    expect(state.staffSettingsMount).toHaveBeenCalledWith('LIC-1');

    state.app.licenseDetails = {
      ...state.app.licenseDetails,
      license_key: 'LIC-2'
    };
    view.rerender(<LicenseSettings />);

    expect(state.staffSettingsUnmount).toHaveBeenCalledWith('LIC-1');
    expect(state.staffSettingsMount).toHaveBeenCalledWith('LIC-2');
    expect(state.staffSettingsMount).toHaveBeenCalledTimes(2);
  });

  it('keeps the detail badge aligned with an inconclusive store lifecycle', () => {
    state.app.currentStaffUser = null;
    state.access = localAdminAccess();
    state.app.licenseDetails = {
      ...localLicense(),
      plan_code: 'pro_monthly',
      is_lifetime: false,
      is_entitled: true,
      expires_at: '2099-01-01T00:00:00.000Z',
      status: 'active'
    };
    state.app.licenseStatus = 'validation_inconclusive';

    renderInApp();

    const detailSummary = screen.getByText('Informacion de licencia').closest('summary');
    expect(detailSummary).toHaveTextContent('Validación pendiente');
    expect(detailSummary).not.toHaveTextContent('Activa');
    expect(screen.getAllByText('Validación pendiente').length).toBeGreaterThanOrEqual(2);
  });

  it('presents confirmed grace consistently across the header, summary, alerts and details', () => {
    state.app.currentStaffUser = null;
    state.access = localAdminAccess();
    state.app.licenseDetails = {
      ...localLicense(),
      plan_code: 'pro_monthly',
      is_lifetime: false,
      is_entitled: true,
      is_in_grace: true,
      expires_at: '2026-10-01T00:00:00.000Z',
      grace_period_ends: '2099-01-01T00:00:00.000Z',
      status: 'grace_period'
    };
    state.app.licenseStatus = 'grace_period';

    renderInApp();

    const detailSummary = screen.getByText('Informacion de licencia').closest('summary');
    expect(detailSummary).toHaveTextContent('Período de gracia');
    expect(screen.getAllByText('Período de gracia').length).toBeGreaterThanOrEqual(3);
  });

});
