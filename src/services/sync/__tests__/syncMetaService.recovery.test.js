import { beforeEach, describe, expect, it, vi } from 'vitest';

const tableMock = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn()
}));
const dbMock = vi.hoisted(() => ({
  isOpen: vi.fn(() => false),
  table: vi.fn(() => tableMock),
  transaction: vi.fn(async (_mode, _table, callback) => callback())
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
    await expect(syncMetaService.advanceMeta('cursor', 42, { licenseKey: 'LIC-1' })).resolves.toBeNull();

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

  it('stores deferred state per license and advances the incremental cursor monotonically', async () => {
    recoveryMocks.isDatabaseRecoveryPending.mockReturnValue(false);
    runtimeMocks.ensureLocalDatabaseReady.mockResolvedValue(undefined);
    dbMock.isOpen.mockReturnValue(true);
    const records = new Map();
    tableMock.get.mockImplementation(async key => records.get(key) || null);
    tableMock.put.mockImplementation(async record => {
      records.set(record.key, record);
      return record.key;
    });

    await expect(syncMetaService.advanceLastChangeSeq(175, 'LIC-A')).resolves.toBe(175);
    await expect(syncMetaService.advanceLastChangeSeq(174, 'LIC-A')).resolves.toBe(175);
    await expect(syncMetaService.getLastChangeSeq('LIC-A')).resolves.toBe(175);
    await expect(syncMetaService.getLastChangeSeq('LIC-B')).resolves.toBe(0);

    await expect(syncMetaService.setDeferredReadPending(true, 'LIC-A')).resolves.toBe(true);
    await expect(syncMetaService.getDeferredReadPending('LIC-A')).resolves.toBe(true);
    await expect(syncMetaService.getDeferredReadPending('LIC-B')).resolves.toBe(false);
    await expect(syncMetaService.setDeferredPullRetryAfterAt(1_800_000_000_000, 'LIC-A')).resolves.toBe(true);
    await expect(syncMetaService.getDeferredPullRetryAfterAt('LIC-A')).resolves.toBe(1_800_000_000_000);
    await expect(syncMetaService.getDeferredPullRetryAfterAt('LIC-B')).resolves.toBe(0);

    expect(records.get('LIC-A:pos_last_change_seq')).toMatchObject({ value: 175 });
    expect(records.get('LIC-A:pos_deferred_read_pending')).toMatchObject({ value: true });
    expect(records.get('LIC-A:pos_deferred_pull_retry_after_at')).toMatchObject({ value: 1_800_000_000_000 });
  });

  it('stores deferred handler work per license and normalizes duplicate entity keys', async () => {
    recoveryMocks.isDatabaseRecoveryPending.mockReturnValue(false);
    runtimeMocks.ensureLocalDatabaseReady.mockResolvedValue(undefined);
    dbMock.isOpen.mockReturnValue(true);
    const records = new Map();
    tableMock.get.mockImplementation(async key => records.get(key) || null);
    tableMock.put.mockImplementation(async record => {
      records.set(record.key, record);
      return record.key;
    });

    await expect(syncMetaService.setDeferredHandlerReads(['customer', 'customer', '', null], 'LIC-A')).resolves.toBe(true);
    await expect(syncMetaService.getDeferredHandlerReads('LIC-A')).resolves.toEqual(['customer']);
    await expect(syncMetaService.getDeferredHandlerReads('LIC-B')).resolves.toEqual([]);

    expect(records.get('LIC-A:pos_deferred_handler_reads')).toMatchObject({ value: ['customer'] });
  });

  it('advances metadata atomically without allowing an older response to move it backwards', async () => {
    recoveryMocks.isDatabaseRecoveryPending.mockReturnValue(false);
    runtimeMocks.ensureLocalDatabaseReady.mockResolvedValue(undefined);
    dbMock.isOpen.mockReturnValue(true);
    let record = null;
    tableMock.get.mockImplementation(async (key) => record?.key === key ? record : null);
    tableMock.put.mockImplementation(async (next) => { record = next; return next.key; });

    await expect(syncMetaService.advanceMeta('catalog-cursor', 42, { licenseKey: 'LIC-1' })).resolves.toBe(42);
    await expect(syncMetaService.advanceMeta('catalog-cursor', 41, { licenseKey: 'LIC-1' })).resolves.toBe(42);

    expect(record).toMatchObject({ key: 'LIC-1:catalog-cursor', value: 42 });
    expect(tableMock.put).toHaveBeenCalledTimes(1);
  });
});
