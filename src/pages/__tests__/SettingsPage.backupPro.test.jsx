// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../SettingsPage';

const appState = {
  canAccess: vi.fn(() => true),
  companyProfile: { business_type: [] },
  currentDeviceRole: 'admin',
  currentStaffUser: null,
  licenseDetails: { features: { cloud_pos_sync: false } }
};

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(appState))
}));

vi.mock('../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({
    actorKey: 'admin:admin-1',
    generation: 1,
    canEnterSettings: true,
    visibleTabs: [
      { key: 'general' },
      { key: 'controls' },
      { key: 'license' },
      { key: 'devices' },
      { key: 'maintenance' },
      { key: 'backup' }
    ]
  })
}));

vi.mock('../../components/settings/GeneralSettings', () => ({
  default: () => <div />
}));

vi.mock('../../components/settings/LicenseSettings', () => ({
  default: () => <div />
}));

vi.mock('../../components/settings/DevicesSettings', () => ({
  default: () => <div />
}));

vi.mock('../../components/settings/MaintenanceSettings', () => ({
  default: () => <div />
}));

vi.mock('../../components/settings/BackupSettings', () => ({
  default: () => <div data-testid="backup-settings" />
}));

vi.mock('../../components/settings/PreparationStationsSettings', () => ({
  default: () => <div />
}));

vi.mock('../../components/debug/DbMigrationTester', () => ({
  default: () => <div />
}));

vi.mock('../../components/debug/SystemHealthTester', () => ({
  default: () => <div />
}));

function renderBackupSettingsPage() {
  return render(
    <MemoryRouter initialEntries={["/configuracion?tab=backup"]}>
      <SettingsPage />
    </MemoryRouter>
  );
}

describe('SettingsPage backup tab cloud UX', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    appState.canAccess.mockReturnValue(true);
    appState.licenseDetails = { features: { cloud_pos_sync: false } };
  });

  it('shows local backup as optional for PRO cloud', async () => {
    appState.licenseDetails = { features: { cloud_pos_sync: true } };

    renderBackupSettingsPage();

    expect(await screen.findByText('Respaldo adicional opcional')).not.toBeNull();
    expect(screen.queryByTestId('backup-settings')).not.toBeNull();
  });

  it('keeps the regular backup tab without optional cloud copy note for FREE local', async () => {
    appState.licenseDetails = { features: { cloud_pos_sync: false } };

    renderBackupSettingsPage();

    expect(await screen.findByTestId('backup-settings')).not.toBeNull();
    expect(screen.queryByText('Respaldo adicional opcional')).toBeNull();
  });
});
