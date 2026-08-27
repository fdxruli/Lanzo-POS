import { afterEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}));

vi.mock('../Logger', () => ({ default: loggerMocks }));

const installNavigator = ({ persisted, persist, estimate, permissionState = 'prompt' }) => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      storage: persisted === undefined && persist === undefined && estimate === undefined
        ? undefined
        : {
            persisted,
            persist,
            estimate
          },
      permissions: {
        query: vi.fn().mockResolvedValue({ state: permissionState })
      }
    }
  });
};

const loadManager = async () => {
  vi.resetModules();
  return (await import('../storageManager')).storageManager;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('StorageManager best-effort persistence', () => {
  it('reports granted when persist returns true', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    installNavigator({
      persisted: vi.fn().mockResolvedValue(false),
      persist,
      estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 })
    });
    const manager = await loadManager();

    const result = await manager.initialize();

    expect(result.canStart).toBe(true);
    expect(result.persistenceState).toBe('granted');
    expect(result.isVolatile).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('keeps boot available when persist returns false and does not retry', async () => {
    const persist = vi.fn().mockResolvedValue(false);
    installNavigator({
      persisted: vi.fn().mockResolvedValue(false),
      persist,
      estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 })
    });
    const manager = await loadManager();

    const first = await manager.initialize();
    const second = await manager.initialize();

    expect(first.canStart).toBe(true);
    expect(first.persistenceState).toBe('denied');
    expect(first.isVolatile).toBe(true);
    expect(second.canStart).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(loggerMocks.error).not.toHaveBeenCalled();
    expect(loggerMocks.info).toHaveBeenCalledWith(
      '[StorageManager] Persistencia no concedida; IndexedDB continuará en modo best-effort. El navegador puede administrar o liberar estos datos según su política de almacenamiento.'
    );
  });

  it('keeps boot available when persist rejects', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('permission request failed'));
    installNavigator({
      persisted: vi.fn().mockResolvedValue(false),
      persist,
      estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 })
    });
    const manager = await loadManager();

    const result = await manager.initialize();

    expect(result.canStart).toBe(true);
    expect(result.isVolatile).toBe(true);
    expect(manager.getState().lastPersistenceError).toBe('permission request failed');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      '[StorageManager] La solicitud de persistencia falló. Se continúa en modo best-effort sin bloquear IndexedDB.'
    );
  });

  it('keeps boot available when the Storage API is unavailable', async () => {
    installNavigator({});
    const manager = await loadManager();

    const result = await manager.initialize();

    expect(result.canStart).toBe(true);
    expect(result.persistenceState).toBe('unsupported');
    expect(result.isVolatile).toBe(true);
  });
});
