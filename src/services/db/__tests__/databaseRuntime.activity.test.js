import { afterEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  close: vi.fn(),
  isOpen: vi.fn(() => false),
  on: vi.fn(),
  open: vi.fn()
}));

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

vi.mock('../../Logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn()
  }
}));

import {
  getLocalDatabaseActivitySnapshot,
  retryLocalDatabaseRecovery
} from '../databaseRuntime';
import {
  openNativeDatabase,
  resetIndexedDbPreflightForTests
} from '../indexedDbPreflight';

afterEach(() => {
  resetIndexedDbPreflightForTests();
  vi.clearAllMocks();
});

describe('databaseRuntime native activity guard', () => {
  it('reports a timed-out native request separately from the rejected public promise', async () => {
    const request = {};
    const factory = { open: vi.fn(() => request) };
    const opening = openNativeDatabase({
      factory,
      name: 'LanzoDB1',
      openTimeoutMs: 5
    });

    await expect(opening).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });

    expect(getLocalDatabaseActivitySnapshot()).toMatchObject({
      preparationActive: false,
      preflightActive: false,
      hasActiveNativeRequest: true,
      hasTimedOutNativeRequest: true,
      nativeOperations: [{
        key: 'LanzoDB1:current',
        state: 'timed_out_waiting_native_settlement'
      }]
    });
  });

  it('rejects an unsafe retry without opening Dexie while the native request is alive', async () => {
    const request = {};
    const factory = { open: vi.fn(() => request) };
    const opening = openNativeDatabase({
      factory,
      name: 'LanzoDB1',
      openTimeoutMs: 5
    });
    await expect(opening).rejects.toMatchObject({ code: 'DB_OPEN_TIMEOUT' });

    await expect(retryLocalDatabaseRecovery()).rejects.toMatchObject({
      code: 'DB_OPEN_TIMEOUT'
    });

    expect(factory.open).toHaveBeenCalledTimes(1);
    expect(dbMocks.close).not.toHaveBeenCalled();
  });
});
