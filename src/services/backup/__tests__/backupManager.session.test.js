/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearPersistedBackupKey: vi.fn(),
  getBackupSettings: vi.fn(),
  getPersistedBackupKey: vi.fn(),
  savePersistedBackupKey: vi.fn(),
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
  clearPersistedBackupKey: mocks.clearPersistedBackupKey,
  DEFAULT_BACKUP_SETTINGS: {
    configured: false,
    directoryHandle: null
  },
  getBackupSettings: mocks.getBackupSettings,
  getPersistedBackupKey: mocks.getPersistedBackupKey,
  savePersistedBackupKey: mocks.savePersistedBackupKey,
  saveBackupSettings: mocks.saveBackupSettings
}));

import {
  BACKUP_KEY_SESSION_MARKER,
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

const persistedCryptoKey = {
  type: 'secret',
  extractable: false,
  algorithm: { name: 'AES-GCM' },
  usages: ['encrypt', 'decrypt']
};

describe('BackupManager persisted key', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.clearPersistedBackupKey.mockReset();
    mocks.getBackupSettings.mockReset();
    mocks.getPersistedBackupKey.mockReset();
    mocks.savePersistedBackupKey.mockReset();
    mocks.saveBackupSettings.mockReset();
    mocks.getBackupSettings.mockResolvedValue({ ...configuredSettings });
    mocks.getPersistedBackupKey.mockResolvedValue(null);
    mocks.savePersistedBackupKey.mockResolvedValue();
    mocks.clearPersistedBackupKey.mockResolvedValue();
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

  it('persiste solo la CryptoKey despues de desbloquear correctamente', async () => {
    vi.spyOn(backupManager, 'callWorker').mockResolvedValue({
      key: persistedCryptoKey,
      verifier: 'verifier'
    });

    await backupManager.unlock('12345678');

    expect(sessionStorage.getItem(BACKUP_PIN_SESSION_KEY)).toBeNull();
    expect(mocks.savePersistedBackupKey).toHaveBeenCalledWith({
      key: persistedCryptoKey,
      verifier: 'verifier',
      salt: 'salt',
      iterations: 1000,
      sessionId: expect.any(String)
    });
    expect(backupManager.state.unlocked).toBe(true);
  });

  it('reanuda silenciosamente con una CryptoKey persistida', async () => {
    sessionStorage.setItem(BACKUP_KEY_SESSION_MARKER, 'session-1');
    mocks.getPersistedBackupKey.mockResolvedValue({
      key: persistedCryptoKey,
      verifier: 'verifier',
      salt: 'salt',
      iterations: 1000,
      sessionId: 'session-1'
    });
    const callWorker = vi.spyOn(backupManager, 'callWorker').mockResolvedValue({
      resumed: true
    });

    const status = await backupManager.initialize();

    expect(callWorker).toHaveBeenCalledWith('resume', {
      key: persistedCryptoKey,
      verifier: 'verifier',
      salt: 'salt',
      iterations: 1000
    });
    expect(status.unlocked).toBe(true);
  });

  it('elimina el PIN legado de sessionStorage al inicializar', async () => {
    sessionStorage.setItem(BACKUP_PIN_SESSION_KEY, '12345678');

    await backupManager.initialize();

    expect(sessionStorage.getItem(BACKUP_PIN_SESSION_KEY)).toBeNull();
  });

  it('descarta una clave persistida que no coincide con la configuracion', async () => {
    sessionStorage.setItem(BACKUP_KEY_SESSION_MARKER, 'session-1');
    mocks.getPersistedBackupKey.mockResolvedValue({
      key: persistedCryptoKey,
      verifier: 'old-verifier',
      salt: 'salt',
      iterations: 1000,
      sessionId: 'session-1'
    });

    const status = await backupManager.initialize();

    expect(status.unlocked).toBe(false);
    expect(mocks.clearPersistedBackupKey).toHaveBeenCalledOnce();
  });

  it('descarta la clave al iniciar una nueva sesion del navegador', async () => {
    mocks.getPersistedBackupKey.mockResolvedValue({
      key: persistedCryptoKey,
      verifier: 'verifier',
      salt: 'salt',
      iterations: 1000,
      sessionId: 'closed-session'
    });

    const status = await backupManager.initialize();

    expect(status.unlocked).toBe(false);
    expect(mocks.clearPersistedBackupKey).toHaveBeenCalledOnce();
  });

  it('borra la clave persistida al bloquear', async () => {
    sessionStorage.setItem(BACKUP_PIN_SESSION_KEY, '12345678');
    backupManager.state.unlocked = true;

    await backupManager.lock();

    expect(sessionStorage.getItem(BACKUP_PIN_SESSION_KEY)).toBeNull();
    expect(mocks.clearPersistedBackupKey).toHaveBeenCalledOnce();
    expect(backupManager.state.unlocked).toBe(false);
  });

  it('mantiene el desbloqueo en memoria si no puede persistir la CryptoKey', async () => {
    mocks.savePersistedBackupKey.mockRejectedValue(new DOMException('Blocked', 'DataCloneError'));
    vi.spyOn(backupManager, 'callWorker').mockResolvedValue({
      key: persistedCryptoKey,
      verifier: 'verifier'
    });

    await expect(backupManager.unlock('12345678')).resolves.toBe(true);
    expect(backupManager.state.unlocked).toBe(true);
  });

  it('reemplaza la CryptoKey persistida despues de cambiar el PIN', async () => {
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
      .mockResolvedValueOnce({ key: persistedCryptoKey, verifier: 'verifier' })
      .mockResolvedValueOnce({
        key: persistedCryptoKey,
        verifier: 'new-verifier',
        lastFileName: 'backup.lanzo'
      });
    mocks.saveBackupSettings.mockImplementation(async (updates) => ({
      ...backupManager.settings,
      ...updates
    }));

    await backupManager.changePin('12345678', '87654321');

    expect(sessionStorage.getItem(BACKUP_PIN_SESSION_KEY)).toBeNull();
    expect(mocks.savePersistedBackupKey).toHaveBeenLastCalledWith({
      key: persistedCryptoKey,
      verifier: 'new-verifier',
      salt: expect.any(String),
      iterations: expect.any(Number),
      sessionId: expect.any(String)
    });
    expect(backupManager.state.unlocked).toBe(true);
  });
});
