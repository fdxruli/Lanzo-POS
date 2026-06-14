/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBackupSettings: vi.fn(),
  saveBackupSettings: vi.fn()
}));

vi.mock('../../db/dexie', () => ({
  db: {
    open: vi.fn(),
    close: vi.fn(),
    tables: []
  }
}));

vi.mock('../../BackupRiskEvaluator', () => ({
  evaluator: {
    markBackupCompleted: vi.fn()
  }
}));

vi.mock('../../Logger', () => ({
  default: {
    error: vi.fn()
  }
}));

vi.mock('../backupConfigDb', () => ({
  DEFAULT_BACKUP_SETTINGS: {
    configured: false,
    directoryHandle: null
  },
  getBackupSettings: mocks.getBackupSettings,
  saveBackupSettings: mocks.saveBackupSettings
}));

import {
  BACKUP_PIN_SESSION_KEY,
  backupManager
} from '../backupManager';

const configuredSettings = {
  configured: true,
  directoryHandle: null,
  salt: 'salt',
  verifier: 'verifier',
  iterations: 1000
};

describe('BackupManager session PIN', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.getBackupSettings.mockReset();
    mocks.getBackupSettings.mockResolvedValue({ ...configuredSettings });
    backupManager.worker = null;
    backupManager.pending.clear();
    backupManager.settings = {};
    backupManager.state.initialized = false;
    backupManager.state.configured = false;
    backupManager.state.unlocked = false;
    backupManager.state.supported = false;
    backupManager.state.permission = 'unsupported';
    vi.restoreAllMocks();
  });

  it('guarda el PIN solo despues de desbloquear correctamente', async () => {
    vi.spyOn(backupManager, 'callWorker').mockResolvedValue({ verifier: 'verifier' });

    await backupManager.unlock('12345678');

    expect(sessionStorage.getItem(BACKUP_PIN_SESSION_KEY)).toBe('12345678');
    expect(backupManager.state.unlocked).toBe(true);
  });

  it('se desbloquea silenciosamente al inicializar con un PIN de sesion', async () => {
    sessionStorage.setItem(BACKUP_PIN_SESSION_KEY, '12345678');
    const callWorker = vi.spyOn(backupManager, 'callWorker').mockResolvedValue({
      verifier: 'verifier'
    });

    const status = await backupManager.initialize();

    expect(callWorker).toHaveBeenCalledWith('unlock', {
      pin: '12345678',
      salt: 'salt',
      iterations: 1000,
      expectedVerifier: 'verifier'
    });
    expect(status.unlocked).toBe(true);
  });

  it('descarta un PIN de sesion invalido sin romper la inicializacion', async () => {
    sessionStorage.setItem(BACKUP_PIN_SESSION_KEY, '87654321');
    vi.spyOn(backupManager, 'callWorker').mockRejectedValue(new Error('BACKUP_PIN_INVALID'));

    const status = await backupManager.initialize();

    expect(status.initialized).toBe(true);
    expect(status.unlocked).toBe(false);
    expect(sessionStorage.getItem(BACKUP_PIN_SESSION_KEY)).toBeNull();
  });

  it('borra el PIN de sesion al bloquear', async () => {
    sessionStorage.setItem(BACKUP_PIN_SESSION_KEY, '12345678');
    backupManager.state.unlocked = true;

    await backupManager.lock();

    expect(sessionStorage.getItem(BACKUP_PIN_SESSION_KEY)).toBeNull();
    expect(backupManager.state.unlocked).toBe(false);
  });

  it('mantiene el desbloqueo en memoria si sessionStorage esta bloqueado', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(backupManager, 'callWorker').mockResolvedValue({ verifier: 'verifier' });

    await expect(backupManager.unlock('12345678')).resolves.toBe(true);
    expect(backupManager.state.unlocked).toBe(true);
  });

  it('reemplaza el PIN de sesion despues de cambiarlo correctamente', async () => {
    const directoryHandle = {
      queryPermission: vi.fn().mockResolvedValue('granted')
    };
    backupManager.settings = {
      ...configuredSettings,
      directoryHandle
    };
    backupManager.state.initialized = true;
    backupManager.state.configured = true;
    backupManager.state.supported = true;
    vi.spyOn(backupManager, 'callWorker')
      .mockResolvedValueOnce({ verifier: 'verifier' })
      .mockResolvedValueOnce({ verifier: 'new-verifier', lastFileName: 'backup.lanzo' });
    mocks.saveBackupSettings.mockImplementation(async (updates) => ({
      ...backupManager.settings,
      ...updates
    }));

    await backupManager.changePin('12345678', '87654321');

    expect(sessionStorage.getItem(BACKUP_PIN_SESSION_KEY)).toBe('87654321');
    expect(backupManager.state.unlocked).toBe(true);
  });
});
