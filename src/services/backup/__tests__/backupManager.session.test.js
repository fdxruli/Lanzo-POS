/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearPersistedBackupKey: vi.fn(),
  getBackupSettings: vi.fn(),
  getPersistedBackupKey: vi.fn(),
  savePersistedBackupKey: vi.fn(),
  saveBackupSettings: vi.fn(),
  tenantContext: null
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

vi.mock('../../tenant/tenantWorkerContext', () => ({
  captureActiveTenantWorkerContext: () => {
    if (!mocks.tenantContext) throw new Error('LOCAL_TENANT_WORKER_CONTEXT_REQUIRED');
    return mocks.tenantContext;
  },
  isActiveTenantWorkerContext: (context) => Boolean(mocks.tenantContext)
    && context?.databaseName === mocks.tenantContext.databaseName
    && context?.generation === mocks.tenantContext.generation
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
import { localTenantAccessController } from '../../tenant/localTenantPolicy';

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
    localTenantAccessController.reset();
    mocks.tenantContext = {
      databaseName: `LanzoDB_t_t_${'a'.repeat(32)}`,
      generation: 1,
      tenantAliases: ['license-id:test-license']
    };
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
    backupManager.tenantKey = null;
    backupManager.tenantContext = null;
    backupManager.state.initialized = false;
    backupManager.state.configured = false;
    backupManager.state.unlocked = false;
    backupManager.state.supported = false;
    backupManager.state.permission = 'unsupported';
    vi.restoreAllMocks();
  });

  it('bloquea backup antes de tocar el worker si no hay tenant concedido', async () => {
    mocks.tenantContext = null;
    const workerSpy = vi.spyOn(backupManager, 'callWorker');

    await expect(backupManager.backup()).rejects.toThrow('BACKUP_TENANT_ACCESS_REQUIRED');
    expect(workerSpy).not.toHaveBeenCalled();
  });

  it('restores on a clean device without requiring prior backup configuration', async () => {
    mocks.getBackupSettings.mockResolvedValue({ configured: false, directoryHandle: null });
    mocks.getPersistedBackupKey.mockResolvedValue(null);
    const workerSpy = vi.spyOn(backupManager, 'callWorker').mockResolvedValue({
      restored: true,
      partial: false,
      coverage: { complete: true }
    });
    const file = new Blob(['encrypted archive']);
    const preview = { destinationHasBusinessData: false };

    const result = await backupManager.restore(file, '12345678', preview);

    expect(result.restored).toBe(true);
    expect(workerSpy).toHaveBeenCalledWith('restore', expect.objectContaining({
      file,
      pin: '12345678',
      expectedDestinationHasBusinessData: false
    }));
    expect(workerSpy).not.toHaveBeenCalledWith('backup', expect.anything());
  });

  it('loads a separate configuration after the active business changes', async () => {
    const configurationKeys = [];
    mocks.getBackupSettings.mockImplementation(async (tenantKey) => {
      configurationKeys.push(tenantKey);
      return { configured: tenantKey === `t_${'a'.repeat(32)}`, directoryHandle: null };
    });
    await backupManager.initialize();
    mocks.tenantContext = {
      databaseName: `LanzoDB_t_t_${'b'.repeat(32)}`,
      generation: 2,
      tenantAliases: ['license-id:second-business']
    };

    await backupManager.ensureTenantContext(mocks.tenantContext);

    expect(configurationKeys).toEqual([`t_${'a'.repeat(32)}`, `t_${'b'.repeat(32)}`]);
    expect(backupManager.state.configured).toBe(false);
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
    }, `t_${'a'.repeat(32)}`);
    expect(backupManager.state.unlocked).toBe(true);
  });

  it('reanuda silenciosamente con una CryptoKey persistida', async () => {
    sessionStorage.setItem(`${BACKUP_KEY_SESSION_MARKER}:t_${'a'.repeat(32)}`, 'session-1');
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
    sessionStorage.setItem(`${BACKUP_KEY_SESSION_MARKER}:t_${'a'.repeat(32)}`, 'session-1');
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
    mocks.getBackupSettings.mockResolvedValue({ ...configuredSettings, directoryHandle });
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
    }, `t_${'a'.repeat(32)}`);
    expect(backupManager.state.unlocked).toBe(true);
  });
});
