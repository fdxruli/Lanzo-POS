import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Navbar from '../Navbar';

const noticeMock = vi.hoisted(() => ({
  getBackupRuntimeNotice: vi.fn(() => null)
}));

const appState = {
  isVolatileDismissed: false,
  setVolatileDismissed: vi.fn(),
  updateAvailable: false,
  isInstallable: false,
  isIOS: false,
  isUpdating: false,
  isInstalling: false,
  isBackupLoading: false,
  runUpdate: vi.fn(),
  requestInstall: vi.fn(),
  needsDriveReauth: false,
  dismissedBackupNotice: null,
  showBackupNotice: vi.fn(),
  canAccess: vi.fn(() => true),
  licenseDetails: { features: { cloud_pos_sync: false } }
};

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(appState))
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasKDS: false })
}));

vi.mock('../../../hooks/useBackupManager', () => ({
  useBackupManager: () => ({
    status: {
      initialized: true,
      busy: false,
      configured: false,
      supported: true,
      permission: 'granted',
      unlocked: true,
      settings: { cronBlocked: false, cronPending: false }
    }
  })
}));

vi.mock('../../../hooks/usePersistentStorage', () => ({
  default: () => ({ isVolatile: false })
}));

vi.mock('../../../services/BackupRiskEvaluator', () => ({
  useBackupRiskStore: vi.fn((selector) => selector({ riskLevel: 0 }))
}));

vi.mock('../../../utils/backupRuntimeNotice', () => ({
  getBackupRuntimeNotice: noticeMock.getBackupRuntimeNotice
}));

vi.mock('../../common/Logo', () => ({
  default: () => <div aria-label="Lanzo" />
}));

function renderNavbar() {
  return render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>
  );
}

function openMobileMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir menú principal' }));
}

describe('Navbar backup actions by license type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noticeMock.getBackupRuntimeNotice.mockReturnValue({
      key: 'configure',
      navbarLabel: 'Configurar respaldos'
    });
    Object.assign(appState, {
      dismissedBackupNotice: 'configure',
      updateAvailable: false,
      isInstallable: false,
      licenseDetails: { features: { cloud_pos_sync: false } }
    });
    appState.canAccess.mockReturnValue(true);
  });

  it('does not show local backup actions for PRO cloud', () => {
    appState.licenseDetails = { features: { cloud_pos_sync: true } };

    renderNavbar();
    openMobileMenu();

    expect(screen.queryByRole('button', { name: 'Configurar respaldos' })).toBeNull();
  });

  it('shows local backup actions for FREE local when a notice applies', () => {
    appState.licenseDetails = { features: { cloud_pos_sync: false } };

    renderNavbar();
    openMobileMenu();

    expect(screen.queryByRole('button', { name: 'Configurar respaldos' })).not.toBeNull();
  });
});
