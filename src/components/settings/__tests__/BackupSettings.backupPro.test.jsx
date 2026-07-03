import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackupSettings from '../BackupSettings';

const backupStatus = {
  initialized: true,
  configured: false,
  supported: true,
  busy: false,
  permission: 'granted',
  unlocked: true,
  progress: 0,
  phase: '',
  settings: {
    directoryName: '',
    lastBackupAt: null,
    lastBackupFile: '',
    cronBlocked: false,
    cronPending: false,
    lastError: ''
  }
};

const backupManager = {
  chooseDirectory: vi.fn(),
  configure: vi.fn(),
  unlock: vi.fn(),
  backup: vi.fn(),
  restore: vi.fn(),
  changePin: vi.fn(),
  requestPermission: vi.fn()
};

const appState = {
  driveAccessToken: null,
  driveTokenExpiresAt: null,
  isDriveConnected: false,
  markDriveNeedsReauth: vi.fn()
};

vi.mock('../../../hooks/useBackupManager', () => ({
  useBackupManager: () => ({ status: backupStatus, backupManager })
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(appState))
}));

vi.mock('../../../services/googleDriveService', () => ({
  uploadBackup: vi.fn()
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: vi.fn()
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../GoogleDriveSettings', () => ({
  default: () => <div data-testid="google-drive-settings" />
}));

describe('BackupSettings copy by license mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(backupStatus, {
      initialized: true,
      configured: false,
      supported: true,
      busy: false,
      permission: 'granted',
      unlocked: true,
      progress: 0,
      phase: '',
      settings: {
        directoryName: '',
        lastBackupAt: null,
        lastBackupFile: '',
        cronBlocked: false,
        cronPending: false,
        lastError: ''
      }
    });
  });

  it('keeps required local backup copy for FREE local', () => {
    render(<BackupSettings isCloudLicense={false} />);

    expect(screen.queryByText('Respaldos Locales Cifrados')).not.toBeNull();
    expect(screen.queryByText('Configurar respaldos')).not.toBeNull();
  });

  it('shows optional local copy copy for PRO cloud initial setup', () => {
    render(<BackupSettings isCloudLicense />);

    expect(screen.queryByText('Copia local cifrada opcional')).not.toBeNull();
    expect(screen.queryByText('Configurar copia opcional')).not.toBeNull();
    expect(screen.queryByText('Configurar respaldos')).toBeNull();
    expect(screen.queryByTestId('google-drive-settings')).not.toBeNull();
  });

  it('shows manual copy action for PRO cloud when configured', () => {
    backupStatus.configured = true;

    render(<BackupSettings isCloudLicense />);

    expect(screen.queryByText('Copia local cifrada adicional')).not.toBeNull();
    expect(screen.queryByText('Generar copia local')).not.toBeNull();
    expect(screen.queryByText('Respaldar ahora')).toBeNull();
    expect(screen.queryByText(/caché de este dispositivo/i)).not.toBeNull();
  });
});
