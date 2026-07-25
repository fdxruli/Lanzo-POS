import { beforeEach, describe, expect, it, vi } from 'vitest';

const tableMock = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn()
}));
const dbMock = vi.hoisted(() => ({
  isOpen: vi.fn(() => false),
  table: vi.fn(() => tableMock)
}));
const runtimeMocks = vi.hoisted(() => ({ ensureLocalDatabaseReady: vi.fn() }));
const recoveryMocks = vi.hoisted(() => ({
  isDatabaseRecoveryPending: vi.fn(() => true),
  isStructuralDatabaseError: vi.fn(() => false),
  reportStructuralDatabaseErrorOnce: vi.fn()
}));

vi.mock('../../db/dexie', () => ({ db: dbMock }));
vi.mock('../../db/databaseRuntime', () => runtimeMocks);
vi.mock('../../db/databaseRecoveryState', () => recoveryMocks);
vi.mock('../syncDexieBootstrap', () => ({}));

import { syncMetaService } from '../syncMetaService';

beforeEach(() => {
  vi.clearAllMocks();
  recoveryMocks.isDatabaseRecoveryPending.mockReturnValue(true);
});

describe('POS Sync metadata recovery pause', () => {
  it('does not open or write IndexedDB while recovery is pending', async () => {
    await expect(syncMetaService.setSyncEnabled(true, 'LIC-1')).resolves.toBe(false);
    await expect(syncMetaService.setRealtimeStatus('connected', 'LIC-1')).resolves.toBe(false);
    await expect(syncMetaService.getSyncEnabled('LIC-1')).resolves.toBe(false);

    expect(runtimeMocks.ensureLocalDatabaseReady).not.toHaveBeenCalled();
    expect(dbMock.table).not.toHaveBeenCalled();
    expect(tableMock.put).not.toHaveBeenCalled();
  });

  it('reactivates after recovery succeeds', async () => {
    recoveryMocks.isDatabaseRecoveryPending.mockReturnValue(false);
    runtimeMocks.ensureLocalDatabaseReady.mockResolvedValue(undefined);
    dbMock.isOpen.mockReturnValue(true);
    tableMock.put.mockResolvedValue('key');
    tableMock.get.mockResolvedValue({ value: true });

    await expect(syncMetaService.setSyncEnabled(true, 'LIC-1')).resolves.toBe(true);
    await expect(syncMetaService.getSyncEnabled('LIC-1')).resolves.toBe(true);

    expect(runtimeMocks.ensureLocalDatabaseReady).toHaveBeenCalledTimes(2);
    expect(tableMock.put).toHaveBeenCalledTimes(1);
    expect(tableMock.get).toHaveBeenCalledTimes(1);
  });
});
