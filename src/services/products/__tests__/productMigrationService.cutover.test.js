import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMeta: vi.fn(),
  setMeta: vi.fn(),
  advanceMeta: vi.fn(),
  applyCloudCatalog: vi.fn(),
  pullCatalogSnapshot: vi.fn(),
  negotiateSnapshotProtocol: vi.fn(),
  runRecovery: vi.fn()
}));

vi.mock('../../sync/syncMetaService', () => ({ syncMetaService: {
  getMeta: mocks.getMeta, setMeta: mocks.setMeta, advanceMeta: mocks.advanceMeta
} }));
vi.mock('../productLocalRepository', () => ({ productLocalRepository: {
  applyCloudCatalog: mocks.applyCloudCatalog
} }));
vi.mock('../productLocalCatalogRecovery', () => ({ productLocalCatalogRecovery: {
  runUnsyncedCatalogRecovery: mocks.runRecovery
} }));
vi.mock('../productCloudRepository', () => ({ productCloudRepository: {
  pullCatalogSnapshot: mocks.pullCatalogSnapshot,
  negotiateSnapshotProtocol: mocks.negotiateSnapshotProtocol
} }));
vi.mock('../productEvents', () => ({ notifyProductsChanged: vi.fn() }));

import { buildProductsMigratedMetaKey, PRODUCT_CATALOG_LAST_SEQ_KEY } from '../productConstants';
import { productMigrationService } from '../productMigrationService';

const licenseKey = 'CUTOVER';
const migratedKey = buildProductsMigratedMetaKey(licenseKey);

describe('product migration FREE to PRO coordination', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getMeta.mockResolvedValue(false);
    mocks.setMeta.mockResolvedValue(true);
    mocks.advanceMeta.mockResolvedValue(18);
    mocks.runRecovery.mockResolvedValue({ success: true, recovered: 1 });
    mocks.negotiateSnapshotProtocol.mockResolvedValue({ supported: false, reason: 'snapshot_capability_not_advertised' });
    mocks.pullCatalogSnapshot.mockResolvedValue({ success: true, latest_change_seq: 18 });
    mocks.applyCloudCatalog.mockResolvedValue({ categories: 0, products: 0, batches: 0, rejected: [] });
  });

  it('reconciles an existing migration once when the versioned snapshot contract becomes available', async () => {
    mocks.getMeta.mockImplementation(async (key, fallback = null) => key === migratedKey ? true : fallback);
    mocks.negotiateSnapshotProtocol.mockResolvedValue({ supported: true, tenantId: 'tenant-cutover' });
    mocks.pullCatalogSnapshot.mockResolvedValue({
      success: true,
      snapshot_contract: 'keyset_reference_v1',
      snapshot_contract_version: 1,
      snapshot_reference_change_seq: 18,
      safe_change_seq: 18,
      categories: [], products: [], batches: [],
      has_more: false, snapshot_complete: true, next_page_cursor: null
    });

    await expect(productMigrationService.runInitialMigrationIfNeeded({ licenseKey }))
      .resolves.toMatchObject({ success: true, consistent: true, recoveryPending: true,
        snapshotReferenceChangeSeq: 18, recovery: { recovered: 1 } });
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledOnce();
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      snapshotReferenceChangeSeq: null, pageCursor: null
    }));
  });

  it.each([false, true])('reconciles before hydration with prior migration marker %s', async (migrated) => {
    mocks.getMeta.mockResolvedValue(migrated);
    const result = await productMigrationService.runInitialMigrationIfNeeded({ licenseKey });
    expect(result).toMatchObject({ success: true, recovery: { recovered: 1 } });

    expect(mocks.runRecovery.mock.invocationCallOrder[0])
      .toBeLessThan((migrated ? mocks.negotiateSnapshotProtocol : mocks.pullCatalogSnapshot).mock.invocationCallOrder[0]);
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledTimes(migrated ? 0 : 3);
    if (!migrated) {
      expect(mocks.setMeta).toHaveBeenCalledWith(migratedKey, true, { licenseKey });
    } else {
      expect(result).toMatchObject({ skipped: true, alreadyMigrated: true, consistent: false, legacyFallback: true });
    }
  });

  it('coalesces concurrent startup and retries without marking partial recovery complete', async () => {
    mocks.runRecovery.mockResolvedValueOnce({ success: false, blocked: true, recovered: 23 });
    const attempts = await Promise.all([
      productMigrationService.runInitialMigrationIfNeeded({ licenseKey }),
      productMigrationService.runInitialMigrationIfNeeded({ licenseKey })
    ]);
    for (const result of attempts) expect(result).toMatchObject({ success: false, blocked: true });
    expect(mocks.runRecovery).toHaveBeenCalledOnce();
    expect(mocks.setMeta).not.toHaveBeenCalled();
    expect(mocks.pullCatalogSnapshot).not.toHaveBeenCalled();

    await expect(productMigrationService.runInitialMigrationIfNeeded({ licenseKey }))
      .resolves.toMatchObject({ success: true });
    expect(mocks.setMeta).toHaveBeenCalledWith(migratedKey, true, { licenseKey });
  });

  it('protects pending local records on direct read-only snapshots and retains the cursor', async () => {
    mocks.applyCloudCatalog.mockResolvedValue({ categories: 0, products: 0, batches: 0, deferredCatalog: 1 });
    await expect(productMigrationService.pullFullSnapshot({ licenseKey }))
      .resolves.toMatchObject({ success: false, blocked: true, reason: 'local_catalog_pending' });
    expect(mocks.runRecovery).not.toHaveBeenCalled();
    expect(mocks.applyCloudCatalog).toHaveBeenCalledWith(expect.anything(), { protectLocalChanges: true });
    expect(mocks.setMeta).not.toHaveBeenCalledWith(PRODUCT_CATALOG_LAST_SEQ_KEY, expect.anything(), expect.anything());
  });

  it('preserves the migration marker on interrupted hydration', async () => {
    mocks.pullCatalogSnapshot.mockRejectedValueOnce(new Error('response lost'));
    await expect(productMigrationService.runInitialMigrationIfNeeded({ licenseKey }))
      .rejects.toThrow('response lost');
    expect(mocks.setMeta).not.toHaveBeenCalled();
    await expect(productMigrationService.runInitialMigrationIfNeeded({ licenseKey }))
      .resolves.toMatchObject({ success: true });
  });
});
