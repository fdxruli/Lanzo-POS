// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cloud: true }));

vi.mock('../../services/customerMessaging', () => ({
  isCloudCustomerMessagingEnabled: () => state.cloud
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector({ licenseDetails: {} }))
}));

vi.mock('../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({
    canEnterSettings: true,
    visibleTabs: [{ key: 'general' }, { key: 'messages' }],
    actorKey: 'admin:admin-1',
    generation: 1
  })
}));

vi.mock('../../components/settings/GeneralSettings', () => ({ default: () => <div>Datos generales</div> }));
vi.mock('../../components/settings/OperationalSettings', () => ({ default: () => <div>Controles</div> }));
vi.mock('../../components/settings/LicenseSettings', () => ({ default: () => <div>Licencia</div> }));
vi.mock('../../components/settings/DevicesSettings', () => ({ default: () => <div>Dispositivos</div> }));
vi.mock('../../components/settings/MaintenanceSettings', () => ({ default: () => <div>Mantenimiento</div> }));
vi.mock('../../components/settings/BackupSettings', () => ({ default: () => <div>Respaldos</div> }));
vi.mock('../../components/debug/DbMigrationTester', () => ({ default: () => null }));
vi.mock('../../components/debug/SystemHealthTester', () => ({ default: () => null }));

import SettingsPage from '../SettingsPage';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

const renderRedirect = (cloud) => {
  state.cloud = cloud;
  return render(
    <MemoryRouter initialEntries={['/configuracion?tab=messages']}>
      <Routes>
        <Route path="/configuracion" element={<SettingsPage />} />
        <Route path="/clientes" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
};

describe('legacy customer messaging Settings route', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.cloud = true;
  });

  it('redirects Pro/Nube to the customer message configuration tab', () => {
    renderRedirect(true);
    expect(screen.getByTestId('location')).toHaveTextContent('/clientes?tab=message-config');
    expect(screen.queryByRole('button', { name: 'Mensajes al cliente' })).not.toBeInTheDocument();
  });

  it('redirects Free/Local to the customer list', () => {
    renderRedirect(false);
    expect(screen.getByTestId('location')).toHaveTextContent('/clientes?tab=list');
  });
});
