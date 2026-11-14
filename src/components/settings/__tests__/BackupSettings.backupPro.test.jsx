// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackupSettings from '../BackupSettings';
import { uploadBackup } from '../../../services/googleDriveService';
import toast from 'react-hot-toast';

const access = vi.hoisted(() => ({ isAdmin: false }));

const backupStatus = {
  initialized: true,
  configured: false,
  legacyConfiguration: null,
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
  inspectRestore: vi.fn(),
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

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({
    canAccessSection: (section) => section === 'backup',
    isAdmin: access.isAdmin
  }),
  useSettingsActionGuard: () => () => ({ assertCurrent: vi.fn() })
}));

vi.mock('../../../services/googleDriveService', () => ({
  uploadBackup: vi.fn()
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: vi.fn()
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn()
  })
}));

vi.mock('../GoogleDriveSettings', () => ({
  default: () => <div data-testid="google-drive-settings" />
}));

describe('BackupSettings copy by license mode', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    backupManager.inspectRestore.mockReset();
    backupManager.backup.mockReset();
    uploadBackup.mockReset();
    appState.driveAccessToken = null;
    appState.driveTokenExpiresAt = null;
    appState.isDriveConnected = false;
    access.isAdmin = false;
    Object.assign(backupStatus, {
      initialized: true,
      configured: false,
      legacyConfiguration: null,
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

  it('shows the recovery path for an unassigned prior backup configuration', () => {
    backupStatus.legacyConfiguration = {
      available: true,
      configured: true,
      hasPersistedKey: true,
      directoryName: 'Respaldos V1'
    };

    render(<BackupSettings isCloudLicense={false} />);

    expect(screen.getByText('Se encontró una configuración de respaldo anterior.')).toBeInTheDocument();
    expect(screen.getByText(/no se asignó al negocio activo porque no se puede comprobar su propietario/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configurar respaldo para este negocio' })).toBeInTheDocument();
  });

  it('shows manual copy action for PRO cloud when configured', () => {
    backupStatus.configured = true;

    render(<BackupSettings isCloudLicense />);

    expect(screen.queryByText('Copia local cifrada adicional')).not.toBeNull();
    expect(screen.queryByText('Generar copia local')).not.toBeNull();
    expect(screen.queryByText('Respaldar ahora')).toBeNull();
    expect(screen.queryByText(/cache de este dispositivo/i)).toBeNull();
  });

  it('reports confirmed Drive upload when cleanup is pending', async () => {
    backupStatus.configured = true;
    access.isAdmin = true;
    appState.driveAccessToken = 'temporary-drive-token';
    appState.driveTokenExpiresAt = Date.now() + 60_000;
    appState.isDriveConnected = true;
    backupManager.backup.mockResolvedValue({
      success: true,
      blob: new Blob(['encrypted V2 backup']),
      fileName: 'RESPALDO_LANZO_test.lzbk',
      coverage: { complete: true }
    });
    uploadBackup.mockResolvedValue({ uploadStatus: 'confirmed', cleanupStatus: 'pending' });

    render(<BackupSettings isCloudLicense />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar copia local' }));

    await waitFor(() => {
      expect(uploadBackup).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(
        'Respaldo cifrado subido a Google Drive. La limpieza de copias anteriores quedó pendiente; se conservaron.',
        { icon: '⚠️' }
      );
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not claim Drive success when upload fails after local generation', async () => {
    backupStatus.configured = true;
    access.isAdmin = true;
    appState.driveAccessToken = 'temporary-drive-token';
    appState.driveTokenExpiresAt = Date.now() + 60_000;
    appState.isDriveConnected = true;
    backupManager.backup.mockResolvedValue({
      success: true,
      blob: new Blob(['encrypted V2 backup']),
      fileName: 'RESPALDO_LANZO_test.lzbk',
      coverage: { complete: true }
    });
    uploadBackup.mockRejectedValue(Object.assign(new Error('network failure'), { code: 'NETWORK_ERROR' }));

    render(<BackupSettings isCloudLicense />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar copia local' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'El respaldo local quedó generado, pero no se confirmó la subida a Google Drive.'
      );
    });
    expect(screen.getByText(/no se confirmó la subida a Google Drive/i)).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalledWith('Respaldo cifrado subido a Google Drive.');
  });

  it('still generates the local copy when the Drive token has expired', async () => {
    backupStatus.configured = true;
    access.isAdmin = true;
    appState.driveAccessToken = 'expired-drive-token';
    appState.driveTokenExpiresAt = Date.now() - 1;
    appState.isDriveConnected = true;
    backupManager.backup.mockResolvedValue({
      success: true,
      coverage: { complete: true }
    });

    render(<BackupSettings isCloudLicense />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar copia local' }));

    await waitFor(() => {
      expect(backupManager.backup).toHaveBeenCalledWith({
        reason: 'manual_settings',
        manual: true,
        includeBlob: false
      });
      expect(toast).toHaveBeenCalledWith(
        'Respaldo local completado. Google Drive requiere reconexión; no se subió una copia.',
        { icon: '⚠️' }
      );
    });
    expect(uploadBackup).not.toHaveBeenCalled();
    expect(appState.markDriveNeedsReauth).toHaveBeenCalledOnce();
  });

  it('keeps destructive restore controls unavailable to Staff with backup access', () => {
    backupStatus.configured = true;
    access.isAdmin = false;

    render(<BackupSettings isCloudLicense />);

    expect(screen.getByText('Generar copia local')).toBeInTheDocument();
    expect(screen.queryByText('Restaurar respaldo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restaurar' })).not.toBeInTheDocument();
  });

  it('keeps restore available for an authorized Admin', () => {
    backupStatus.configured = true;
    access.isAdmin = true;

    render(<BackupSettings isCloudLicense />);

    expect(screen.getByText('Restaurar respaldo')).toBeInTheDocument();
  });

  it('blocks and explains restore when the destination has pending operations', async () => {
    backupStatus.configured = true;
    access.isAdmin = true;
    backupManager.inspectRestore.mockResolvedValue({
      formatVersion: 2,
      destinationHasBusinessData: true,
      destinationPendingOperationCounts: { sync_outbox: 1, financial_intents: 1 },
      coverage: { complete: true, categoryCounts: {} }
    });
    render(<BackupSettings />);

    fireEvent.change(screen.getByLabelText('Archivo de respaldo a restaurar'), {
      target: { files: [new File(['encrypted archive'], 'business.lzbk')] }
    });
    fireEvent.change(screen.getByLabelText('PIN del archivo de respaldo'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar archivo' }));

    await waitFor(() => expect(screen.getByText(/Restauración bloqueada: el negocio destino tiene 1 sincronización pendiente, 1 intenciones financieras sin recibo confirmado/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Restaurar datos' })).toBeDisabled();
  });
});
