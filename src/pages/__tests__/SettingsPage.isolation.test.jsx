// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  access: null,
  generalRenders: vi.fn()
}));

vi.mock('../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => state.access
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector({
    licenseDetails: { features: { cloud_pos_sync: false } }
  }))
}));

vi.mock('../../components/settings/GeneralSettings', () => ({
  default: () => {
    state.generalRenders();
    return <div>General autorizado</div>;
  }
}));

vi.mock('../../components/settings/OperationalSettings', () => ({
  default: () => <div>Controles autorizados</div>
}));

vi.mock('../../components/settings/LicenseSettings', () => ({
  default: () => <div>Licencia autorizada</div>
}));

vi.mock('../../components/settings/DevicesSettings', () => ({
  default: () => <div>Dispositivos autorizados</div>
}));

vi.mock('../../components/settings/MaintenanceSettings', () => ({
  default: () => <div>Mantenimiento autorizado</div>
}));

vi.mock('../../components/settings/BackupSettings', () => ({
  default: () => <div>Respaldos autorizados</div>
}));

vi.mock('../../components/debug/DbMigrationTester', () => ({
  default: () => <div>Debug autorizado</div>
}));

vi.mock('../../components/debug/SystemHealthTester', () => ({
  default: () => <div>Test autorizado</div>
}));

import SettingsPage from '../SettingsPage';

const makeAccess = ({ actorKey = 'staff:staff-a', generation = 1, tabs = [] } = {}) => ({
  actorKey,
  generation,
  canEnterSettings: tabs.length > 0,
  visibleTabs: tabs.map((key) => ({ key }))
});

const renderPage = (entry = '/configuracion') => render(
  <MemoryRouter initialEntries={[entry]}>
    <SettingsPage />
  </MemoryRouter>
);

describe('SettingsPage section isolation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    state.access = makeAccess();
  });

  it('renders NoPermission and never mounts General when zero tabs are authorized', () => {
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
    expect(state.generalRenders).not.toHaveBeenCalled();
  });

  it('mounts License synchronously for a license-only actor without a General transient', () => {
    state.access = makeAccess({ tabs: ['license'] });

    renderPage('/configuracion?tab=general');

    expect(screen.getByText('Licencia autorizada')).toBeInTheDocument();
    expect(screen.queryByText('General autorizado')).not.toBeInTheDocument();
    expect(state.generalRenders).not.toHaveBeenCalled();
  });

  it('keeps Devices separate from its License sibling', () => {
    state.access = makeAccess({ tabs: ['devices'] });

    renderPage('/configuracion?tab=license');

    expect(screen.getByText('Dispositivos autorizados')).toBeInTheDocument();
    expect(screen.queryByText('Licencia autorizada')).not.toBeInTheDocument();
  });

  it('A: Staff with Datos y Apariencia does not mount or navigate to Controles', () => {
    state.access = makeAccess({ tabs: ['general'] });

    renderPage('/configuracion?tab=controls');

    expect(screen.getByText('General autorizado')).toBeInTheDocument();
    expect(screen.queryByText('Controles autorizados')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Datos y Apariencia' })).toBeVisible();
    expect(screen.getByText('Controles').closest('button')).toHaveAttribute('hidden');
  });

  it('B: Staff with Controles only cannot mount General, even by direct URL', () => {
    state.access = makeAccess({ tabs: ['controls'] });

    renderPage('/configuracion?tab=general');

    expect(screen.getByText('Controles autorizados')).toBeInTheDocument();
    expect(screen.queryByText('General autorizado')).not.toBeInTheDocument();
    expect(state.generalRenders).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Controles' })).toBeVisible();
    expect(screen.getByText('Datos y Apariencia').closest('button')).toHaveAttribute('hidden');
  });

  it('denies a direct messages URL when the Staff actor has no Settings section grant', () => {
    state.access = makeAccess();

    renderPage('/configuracion?tab=messages');

    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
    expect(screen.queryByText('General autorizado')).not.toBeInTheDocument();
  });

  it('F: reflects a permission change in the same Staff session without changing generation', () => {
    state.access = makeAccess({ actorKey: 'staff:staff-a', generation: 9, tabs: ['general'] });
    const view = renderPage('/configuracion?tab=general');
    expect(screen.getByText('General autorizado')).toBeInTheDocument();

    state.access = makeAccess({ actorKey: 'staff:staff-a', generation: 9, tabs: ['controls'] });
    view.rerender(
      <MemoryRouter initialEntries={['/configuracion?tab=general']}>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Controles autorizados')).toBeInTheDocument();
    expect(screen.queryByText('General autorizado')).not.toBeInTheDocument();
  });

  it('recomputes an already-mounted page for Staff A to Staff B', () => {
    state.access = makeAccess({ actorKey: 'staff:staff-a', generation: 3, tabs: ['license'] });
    const view = renderPage();
    expect(screen.getByText('Licencia autorizada')).toBeInTheDocument();

    state.access = makeAccess({ actorKey: 'staff:staff-b', generation: 5, tabs: ['maintenance'] });
    view.rerender(
      <MemoryRouter initialEntries={['/configuracion']}>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Mantenimiento autorizado')).toBeInTheDocument();
    expect(screen.queryByText('Licencia autorizada')).not.toBeInTheDocument();
    expect(state.generalRenders).not.toHaveBeenCalled();
  });

  it('mantiene la ruta maintenance con la etiqueta Actualizaciones', () => {
    state.access = makeAccess({ tabs: ['maintenance'] });
    renderPage('/configuracion?tab=maintenance');

    expect(screen.getByRole('button', { name: 'Actualizaciones' })).toBeVisible();
    expect(screen.getByText('Mantenimiento autorizado')).toBeInTheDocument();
  });

  it('closes mounted Settings immediately when the actor runtime locks', () => {
    state.access = makeAccess({ tabs: ['license'] });
    const view = renderPage();

    state.access = makeAccess({ actorKey: null, generation: 4, tabs: [] });
    view.rerender(
      <MemoryRouter initialEntries={['/configuracion']}>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Licencia autorizada')).not.toBeInTheDocument();
  });
});
