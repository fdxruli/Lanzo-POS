import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Navbar from '../Navbar';

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
  useBackupManager: () => ({ status: null })
}));

vi.mock('../../../hooks/usePersistentStorage', () => ({
  default: () => ({ isVolatile: false })
}));

vi.mock('../../../services/BackupRiskEvaluator', () => ({
  useBackupRiskStore: vi.fn((selector) => selector({ riskLevel: 0 }))
}));

vi.mock('../../../utils/backupRuntimeNotice', () => ({
  getBackupRuntimeNotice: () => null
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

describe('Navbar mobile menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.canAccess.mockReturnValue(true);
  });

  it('opens as a dialog and closes with Escape', () => {
    renderNavbar();

    const menuButton = screen.getByRole('button', { name: 'Abrir menú principal' });
    const drawer = document.getElementById('mobile-main-menu');

    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
    expect(drawer.hasAttribute('inert')).toBe(true);

    fireEvent.click(menuButton);

    expect(screen.getByRole('dialog', { name: 'Menú principal' }).getAttribute('aria-hidden')).toBe('false');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar menú' }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
  });

  it('closes when the backdrop is pressed', () => {
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú principal' }));
    fireEvent.click(document.querySelector('.mobile-drawer-overlay'));

    expect(screen.getByRole('button', { name: 'Abrir menú principal' }).getAttribute('aria-expanded')).toBe('false');
  });
});
