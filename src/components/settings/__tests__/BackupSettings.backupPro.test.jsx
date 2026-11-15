// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackupSettings from '../BackupSettings';
import { downloadBackup, listBackups, uploadBackup } from '../../../services/googleDriveService';
import toast from 'react-hot-toast';
import { showConfirmModal } from '../../../services/utils';

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
  uploadBackup: vi.fn(), listBackups: vi.fn(), downloadBackup: vi.fn()
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

vi.mock('@react-oauth/google', () => ({ useGoogleLogin: () => vi.fn() }));

describe('BackupSettings copy by license mode', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    backupManager.inspectRestore.mockReset();
    backupManager.backup.mockReset();
    uploadBackup.mockReset();
    listBackups.mockReset();
    downloadBackup.mockReset();
    backupManager.restore.mockReset();
    showConfirmModal.mockReset();
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
    expect(screen.getByText('Respaldo en Google Drive')).toBeInTheDocument();
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

  it('warns without retrying when Drive transfer state is uncertain', async () => {
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
    uploadBackup.mockResolvedValue({
      uploadStatus: 'verification_pending',
      transferStatus: 'pending',
      verificationStatus: 'pending',
      uploadedFile: null
    });

    render(<BackupSettings isCloudLicense />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar copia local' }));

    await waitFor(() => {
      expect(uploadBackup).toHaveBeenCalledTimes(1);
      expect(backupManager.backup).toHaveBeenCalledWith(expect.objectContaining({ includeBlob: true }));
      expect(toast).toHaveBeenCalledWith(
        'El respaldo local se guardó. No se pudo determinar si Google Drive terminó la transferencia. Conserva la copia local y revisa Drive antes de volver a intentarlo.',
        { icon: '⚠️' }
      );
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith('Respaldo cifrado subido a Google Drive.');
  });

  it('shows byte-confirmed progress while a large Drive upload is active', async () => {
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

    let finishUpload;
    uploadBackup.mockImplementation(async (_token, _blob, _fileName, { onProgress }) => {
      onProgress({ phase: 'uploading', bytesConfirmed: 4, totalBytes: 10, percent: 40 });
      return new Promise((resolve) => {
        finishUpload = () => {
          onProgress({ phase: 'verifying', bytesConfirmed: 10, totalBytes: 10, percent: 100 });
          resolve({ uploadStatus: 'confirmed', cleanupStatus: 'completed' });
        };
      });
    });

    render(<BackupSettings isCloudLicense />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar copia local' }));

    expect(await screen.findByText('Subiendo a Google Drive... 40%')).toBeInTheDocument();
    expect(screen.queryByText('Subiendo a Google Drive... 100%')).toBeNull();
    finishUpload();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Respaldo cifrado subido a Google Drive.'));
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

  describe('Drive recovery through the existing restore panel', () => {
    const listed = { id: 'drive-copy', name: 'synthetic.lzbk', size: '1024', createdTime: '2026-01-01T00:00:00Z' };
    const file = new File(['encrypted fixture'], listed.name);
    const preview = {
      formatVersion: 2, header: { createdAt: listed.createdTime },
      destinationHasBusinessData: false, destinationPendingOperationCounts: {},
      coverage: { complete: false, categoryCounts: { sales: 1 }, partialReasons: ['pending_browser_operations_excluded'] }
    };

    beforeEach(() => {
      vi.useFakeTimers();
      access.isAdmin = true;
      appState.driveAccessToken = 'synthetic-token';
      appState.driveTokenExpiresAt = Date.now() + 3_600_000;
      appState.isDriveConnected = true;
      listBackups.mockResolvedValue({ files: [listed] });
      downloadBackup.mockResolvedValue(file);
      backupManager.inspectRestore.mockResolvedValue(preview);
    });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

    const selectDriveFile = async () => {
      const view = render(<BackupSettings />);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actualizar respaldos' })));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: `Recuperar ${listed.name}` })));
      return view;
    };

    it('downloads, requests PIN, previews partial coverage and restores once only after explicit confirmation', async () => {
      await selectDriveFile();
      expect(backupManager.inspectRestore).not.toHaveBeenCalled();
      expect(backupManager.restore).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Archivo de respaldo a restaurar')).toHaveAttribute('accept', '.lzbk,application/octet-stream');
      fireEvent.change(screen.getByLabelText('PIN del archivo de respaldo'), { target: { value: '12345678' } });
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Revisar archivo' })));
      expect(backupManager.inspectRestore).toHaveBeenCalledWith(file, '12345678');
      expect(screen.getByText(/La cobertura de este archivo es parcial/)).toBeInTheDocument();
      let confirm;
      showConfirmModal.mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
      backupManager.restore.mockResolvedValue({ restored: true });
      fireEvent.click(screen.getByRole('button', { name: 'Restaurar datos' }));
      fireEvent.click(screen.getByRole('button', { name: 'Restaurar datos' }));
      expect(showConfirmModal).toHaveBeenCalledTimes(1);
      expect(backupManager.restore).not.toHaveBeenCalled();
      await act(async () => confirm(true));
      expect(backupManager.restore).toHaveBeenCalledTimes(1);
      expect(backupManager.restore).toHaveBeenCalledWith(file, '12345678', preview);
    });

    it('can cancel confirmation, invalidates preview on PIN changes and preserves manual import', async () => {
      await selectDriveFile();
      fireEvent.change(screen.getByLabelText('PIN del archivo de respaldo'), { target: { value: '12345678' } });
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Revisar archivo' })));
      showConfirmModal.mockResolvedValue(false);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Restaurar datos' })));
      expect(backupManager.restore).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText('PIN del archivo de respaldo'), { target: { value: '87654321' } });
      expect(screen.getByRole('button', { name: 'Restaurar datos' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByLabelText('PIN del archivo de respaldo')).not.toBeInTheDocument();
      const manual = new File(['manual'], 'manual.lzbk');
      fireEvent.change(screen.getByLabelText('Archivo de respaldo a restaurar'), { target: { files: [manual] } });
      expect(screen.getByText('manual.lzbk')).toBeInTheDocument();
    });

    it('reports a failed download and permits retry without inspecting or restoring', async () => {
      downloadBackup.mockRejectedValue(new Error('La copia fue eliminada.'));
      await selectDriveFile();
      expect(screen.getByRole('alert')).toHaveTextContent('La copia fue eliminada.');
      expect(screen.getByRole('button', { name: 'Actualizar respaldos' })).toBeEnabled();
      expect(backupManager.inspectRestore).not.toHaveBeenCalled();
      expect(backupManager.restore).not.toHaveBeenCalled();
    });

    it('can cancel an in-flight download and ignores its later result', async () => {
      let finish;
      downloadBackup.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      await selectDriveFile();
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga o consulta' }));
      expect(downloadBackup.mock.calls[0][2].signal.aborted).toBe(true);
      await act(async () => finish(file));
      expect(screen.queryByLabelText('PIN del archivo de respaldo')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Actualizar respaldos' })).toBeEnabled();
      expect(backupManager.restore).not.toHaveBeenCalled();
    });

    it('retains only the encrypted selection when Drive is disconnected after download', async () => {
      const view = await selectDriveFile();
      appState.driveAccessToken = null;
      appState.isDriveConnected = false;
      view.rerender(<BackupSettings />);
      expect(screen.getByLabelText('PIN del archivo de respaldo')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Actualizar respaldos' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('PIN del archivo de respaldo'), { target: { value: '12345678' } });
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Revisar archivo' })));
      expect(backupManager.inspectRestore).toHaveBeenCalledWith(file, '12345678');
    });

    it('shows an empty list and recovers from a failed refresh', async () => {
      listBackups.mockResolvedValue({ files: [] });
      render(<BackupSettings />);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actualizar respaldos' })));
      expect(screen.getByText('No se encontraron copias verificables para este negocio.')).toBeInTheDocument();
      listBackups.mockRejectedValue(new Error('DRIVE_LIST_INCOMPLETE'));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actualizar respaldos' })));
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo obtener un listado completo');
      expect(screen.getByRole('button', { name: 'Actualizar respaldos' })).toBeEnabled();
    });

    it('shows expiration and stops queries when the token expires while the page remains open', async () => {
      appState.driveTokenExpiresAt = Date.now() + 1000;
      render(<BackupSettings />);
      expect(screen.getByRole('button', { name: 'Actualizar respaldos' })).toBeEnabled();
      await act(async () => vi.advanceTimersByTime(1001));
      expect(screen.getByRole('button', { name: 'Actualizar respaldos' })).toBeDisabled();
      expect(screen.getByText('La sesión venció. Reconecta Google Drive para consultar tus copias.')).toBeInTheDocument();
      expect(listBackups).not.toHaveBeenCalled();
    });

    it('does not keep controls blocked after PIN or restore failures', async () => {
      await selectDriveFile();
      backupManager.inspectRestore.mockRejectedValueOnce(new Error('BACKUP_AUTHENTICATION_FAILED'));
      fireEvent.change(screen.getByLabelText('PIN del archivo de respaldo'), { target: { value: '12345678' } });
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Revisar archivo' })));
      expect(screen.getByText(/PIN incorrecto o archivo dañado/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Restaurar datos' })).toBeDisabled();
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Revisar archivo' })));
      backupManager.restore.mockRejectedValue(new Error('BACKUP_PRE_RESTORE_FAILED'));
      showConfirmModal.mockResolvedValue(true);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Restaurar datos' })));
      expect(screen.getByText(/Falló la copia preventiva/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Restaurar datos' })).toBeEnabled();
    });
  });
});
