import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  close: vi.fn(),
  isOpen: vi.fn(() => false),
  on: vi.fn(),
  open: vi.fn()
}));

const tenantRuntimeMocks = vi.hoisted(() => ({
  getActiveTenantDatabase: vi.fn(),
  getActiveTenantRuntime: vi.fn()
}));

const createNativeDatabase = (name, version) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, version);
  request.onupgradeneeded = () => request.result.createObjectStore('sales', { keyPath: 'id' });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
});

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
});

vi.mock('../dexie', () => ({
  db: dbMocks,
  STORES: {}
}));

vi.mock('../databaseSchema', async () => {
  const actual = await vi.importActual('../databaseSchema');
  return {
    ...actual,
    registerCanonicalDexieExtensions: vi.fn()
  };
});

vi.mock('../indexedDbPreflightCoordinator', () => ({
  getActiveIndexedDbPreflightOperations: () => [],
  preflightAndRepairIndexedDb: vi.fn()
}));

vi.mock('../tenantRuntimeRouter', () => tenantRuntimeMocks);

vi.mock('../../Logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn()
  }
}));

import {
  DATABASE_PREPARATION_TIMEOUT_MS,
  getLocalDatabaseActivitySnapshot,
  prepareLocalDatabase,
  retryLocalDatabaseRecovery
} from '../databaseRuntime';
import {
  openNativeDatabase,
  resetIndexedDbPreflightForTests
} from '../indexedDbPreflight';
import {
  clearDatabaseRecoveryState,
  DATABASE_RECOVERY_STATUS,
  getDatabaseRecoveryState
} from '../databaseRecoveryState';

afterEach(() => {
  resetIndexedDbPreflightForTests();
  clearDatabaseRecoveryState();
  vi.useRealTimers();
  vi.clearAllMocks();
});

beforeEach(() => {
  tenantRuntimeMocks.getActiveTenantDatabase.mockReset();
  tenantRuntimeMocks.getActiveTenantRuntime.mockReset();
  clearDatabaseRecoveryState();
});

describe('databaseRuntime native activity guard', () => {
  it('reports a timed-out native request separately from the rejected public promise', async () => {
    const request = {};
    const factory = { open: vi.fn(() => request) };
    const opening = openNativeDatabase({
      factory,
      name: 'LanzoDB_t_runtime_activity_test',
      openTimeoutMs: 5
    });

    await expect(opening).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });

    expect(getLocalDatabaseActivitySnapshot()).toMatchObject({
      preparationActive: false,
      preflightActive: false,
      hasActiveNativeRequest: true,
      hasTimedOutNativeRequest: true,
      nativeOperations: [{
        key: 'LanzoDB_t_runtime_activity_test:current',
        state: 'timed_out_waiting_native_settlement'
      }]
    });
  });

  it('rejects an unsafe retry without opening Dexie while the native request is alive', async () => {
    const request = {};
    const factory = { open: vi.fn(() => request) };
    const opening = openNativeDatabase({
      factory,
      name: 'LanzoDB_t_runtime_activity_test',
      openTimeoutMs: 5
    });
    await expect(opening).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });

    await expect(retryLocalDatabaseRecovery()).rejects.toMatchObject({
      code: 'DB_OPEN_TIMEOUT'
    });

    expect(factory.open).toHaveBeenCalledTimes(1);
    expect(dbMocks.close).not.toHaveBeenCalled();
  });

  it('publishes a real IndexedDB block and prevents a second preparation until it settles', async () => {
    const databaseName = `LanzoDB_t_database_runtime_blocked_${Date.now()}`;
    const blocker = await createNativeDatabase(databaseName, 10);
    blocker.onversionchange = () => {};
    await requestResult(blocker.transaction('sales', 'readwrite')
      .objectStore('sales').put({ id: 'sale-preserved', total: 1250 }));

    const database = new Dexie(databaseName);
    database.version(2).stores({ sales: 'id, status' });
    tenantRuntimeMocks.getActiveTenantRuntime.mockReturnValue({ databaseName });
    tenantRuntimeMocks.getActiveTenantDatabase.mockReturnValue(database);

    const preparation = prepareLocalDatabase();
    expect(getDatabaseRecoveryState().status).toBe(DATABASE_RECOVERY_STATUS.CHECKING);
    expect(getLocalDatabaseActivitySnapshot().preparationActive).toBe(true);

    await vi.waitFor(() => {
      expect(getDatabaseRecoveryState()).toMatchObject({
        status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
        errorCode: 'DB_BLOCKED',
        databaseName
      });
    });
    await expect(retryLocalDatabaseRecovery()).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });
    blocker.close();

    await expect(preparation).resolves.toMatchObject({ ready: true, databaseName });
    expect(getDatabaseRecoveryState().status).toBe(DATABASE_RECOVERY_STATUS.READY);
    expect(getLocalDatabaseActivitySnapshot().preparationActive).toBe(false);
    expect(await database.table('sales').get('sale-preserved')).toEqual({ id: 'sale-preserved', total: 1250 });
    database.close();
    await Dexie.delete(databaseName);
  });

  it('publishes a terminal failure when Dexie rejects during preparation', async () => {
    const database = {
      name: 'LanzoDB_t_database_runtime_failure_test',
      isOpen: vi.fn(() => false),
      on: vi.fn(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() })),
      open: vi.fn().mockRejectedValue(new Error('open failed'))
    };
    tenantRuntimeMocks.getActiveTenantRuntime.mockReturnValue({ databaseName: database.name });
    tenantRuntimeMocks.getActiveTenantDatabase.mockReturnValue(database);

    await expect(prepareLocalDatabase()).rejects.toThrow('open failed');

    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_OPERATION_FAILED',
      isRetryable: false,
      databaseName: database.name
    });
    expect(getLocalDatabaseActivitySnapshot().preparationActive).toBe(false);
  });

  it('bounds a pending database open without allowing a parallel retry', async () => {
    vi.useFakeTimers();
    let resolveOpen;
    const opening = new Promise((resolve) => { resolveOpen = resolve; });
    const database = {
      name: 'LanzoDB_t_database_runtime_timeout_test',
      isOpen: vi.fn(() => false),
      on: vi.fn(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() })),
      open: vi.fn(() => opening)
    };
    tenantRuntimeMocks.getActiveTenantRuntime.mockReturnValue({ databaseName: database.name });
    tenantRuntimeMocks.getActiveTenantDatabase.mockReturnValue(database);

    const preparation = prepareLocalDatabase();
    await vi.advanceTimersByTimeAsync(DATABASE_PREPARATION_TIMEOUT_MS);

    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_TIMEOUT',
      isRetryable: false,
      databaseName: database.name
    });
    expect(getLocalDatabaseActivitySnapshot().preparationActive).toBe(true);
    await expect(retryLocalDatabaseRecovery()).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });
    expect(database.open).toHaveBeenCalledTimes(1);

    resolveOpen(database);
    await expect(preparation).resolves.toMatchObject({ ready: true, databaseName: database.name });
    expect(getDatabaseRecoveryState().status).toBe(DATABASE_RECOVERY_STATUS.READY);
    expect(getLocalDatabaseActivitySnapshot().preparationActive).toBe(false);
  });
});
