import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMeta: vi.fn(),
  setMeta: vi.fn(),
  saveConflict: vi.fn(),
  getLocalCatalogForMigration: vi.fn(),
  applyCloudCatalog: vi.fn(),
  migrateLocalCatalog: vi.fn(),
  pullCatalogSnapshot: vi.fn(),
  runRecovery: vi.fn(),
  events: []
}));

vi.mock('../../sync/syncMetaService', () => ({ syncMetaService: {
  getMeta: mocks.getMeta,
  setMeta: mocks.setMeta
} }));
vi.mock('../../sync/syncConflictService', () => ({ syncConflictService: {
  saveConflict: mocks.saveConflict
} }));
vi.mock('../productLocalRepository', () => ({ productLocalRepository: {
  getLocalCatalogForMigration: mocks.getLocalCatalogForMigration,
  applyCloudCatalog: mocks.applyCloudCatalog
} }));
vi.mock('../productLocalCatalogRecovery', () => ({ productLocalCatalogRecovery: {
  runUnsyncedCatalogRecovery: mocks.runRecovery
} }));
vi.mock('../productCloudRepository', () => ({ productCloudRepository: {
  migrateLocalCatalog: mocks.migrateLocalCatalog,
  pullCatalogSnapshot: mocks.pullCatalogSnapshot
} }));
vi.mock('../productMapper', () => ({
  batchToCloudPayload: (value) => value,
  categoryToCloudPayload: (value) => value,
  productToCloudPayload: (value) => value,
  normalizeBarcodeKey: (value) => String(value || '').trim().toLowerCase(),
  normalizeNameKey: (value) => String(value || '').trim().toLowerCase(),
  normalizeSkuKey: (value) => String(value || '').trim().toLowerCase()
}));
vi.mock('../../Logger', () => ({ default: {
  log: vi.fn(),
  warn: vi.fn()
} }));
vi.mock('../productEvents', () => ({ notifyProductsChanged: vi.fn() }));

import { buildProductsMigratedMetaKey } from '../productConstants';
import { productMigrationService } from '../productMigrationService';

const localCatalog = {
  categories: [{ id: 'category-1', name: 'Category' }],
  products: [{ id: 'product-1', name: 'Product', price: 10, cost: 5, stock: 2 }],
  batches: []
};

describe('product migration FREE to PRO coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  mocks.getMeta.mockResolvedValue(false);
    mocks.setMeta.mockResolvedValue(undefined);
    mocks.saveConflict.mockResolvedValue({ id: 'migration-conflict' });
  mocks.getLocalCatalogForMigration.mockResolvedValue(localCatalog);
  mocks.applyCloudCatalog.mockResolvedValue({ categories: 0, products: 0, batches: 0, rejected: [] });
  mocks.events.length = 0;
  mocks.pullCatalogSnapshot.mockImplementation(async () => {
    mocks.events.push('pull');
    return { success: true, has_more: false };
  });

  mocks.runRecovery.mockImplementation(async () => {
    mocks.events.push('recovery');
    return { success: true, recovered: 1 };
  });
  });

  it('keeps the first FREE to PRO bootstrap as local migration followed by snapshot', async () => {
    mocks.migrateLocalCatalog.mockResolvedValue({ success: true });

    await expect(productMigrationService.runInitialMigrationIfNeeded({
      licenseKey: 'CUTOVER-FIRST'
    })).resolves.toMatchObject({ success: true, migrated: 2 });

    expect(mocks.migrateLocalCatalog).toHaveBeenCalledTimes(2);
    expect(mocks.events.slice(-3)).toEqual(['pull', 'pull', 'pull']);
    expect(mocks.setMeta).toHaveBeenCalledWith(
      buildProductsMigratedMetaKey('CUTOVER-FIRST'),
      true,
      { licenseKey: 'CUTOVER-FIRST' }
    );
  });

  it('deduplicates concurrent bootstrap and keeps the marker unset after failure', async () => {
    mocks.migrateLocalCatalog.mockResolvedValueOnce({
      success: false,
      code: 'CLOUD_BOOTSTRAP_FAILED',
      message: 'forced test failure'
    });

    const [left, right] = await Promise.all([
      productMigrationService.runInitialMigrationIfNeeded({ licenseKey: 'CUTOVER-FAILURE' }),
      productMigrationService.runInitialMigrationIfNeeded({ licenseKey: 'CUTOVER-FAILURE' })
    ]);

    expect(left).toMatchObject({ success: false, blocked: true });
    expect(right).toEqual(left);
    expect(mocks.migrateLocalCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.setMeta).not.toHaveBeenCalledWith(
      buildProductsMigratedMetaKey('CUTOVER-FAILURE'),
      true,
      expect.anything()
    );
    expect(await mocks.getLocalCatalogForMigration()).toEqual(localCatalog);
  });

  it('can retry the same tenant after bootstrap failure and commits readiness only after hydration', async () => {
    mocks.migrateLocalCatalog
      .mockResolvedValueOnce({ success: false, code: 'CLOUD_BOOTSTRAP_FAILED' })
      .mockResolvedValueOnce({ success: true });

    await expect(productMigrationService.runInitialMigrationIfNeeded({
      licenseKey: 'CUTOVER-RETRY'
    })).resolves.toMatchObject({ success: false, blocked: true });

    await expect(productMigrationService.runInitialMigrationIfNeeded({
      licenseKey: 'CUTOVER-RETRY'
    })).resolves.toMatchObject({ success: true, migrated: 2 });

    expect(mocks.events.indexOf('pull')).toBeGreaterThanOrEqual(0);
    expect(mocks.migrateLocalCatalog.mock.invocationCallOrder[1])
      .toBeLessThan(mocks.pullCatalogSnapshot.mock.invocationCallOrder[0]);

    expect(mocks.setMeta).toHaveBeenCalledWith(
      buildProductsMigratedMetaKey('CUTOVER-RETRY'),
      true,
      { licenseKey: 'CUTOVER-RETRY' }
    );
  });

  it('reconciles a previously migrated tenant before the next authoritative snapshot', async () => {
    mocks.getMeta.mockResolvedValue(true);
    const result = await productMigrationService.runInitialMigrationIfNeeded({
      licenseKey: 'CUTOVER-REPEATED'
    });

    expect(result).toMatchObject({ success: true, recovery: { recovered: 1 } });
    expect(mocks.runRecovery).toHaveBeenCalledWith({
      licenseKey: 'CUTOVER-REPEATED',
      canMigrateProducts: true
    });
    expect(mocks.events[0]).toBe('recovery');
    expect(mocks.events.slice(1)).toEqual(['pull', 'pull', 'pull']);
  });

  it('blocks repeated cutover and never pulls when local reconciliation fails', async () => {
    mocks.getMeta.mockResolvedValue(true);
    mocks.runRecovery.mockResolvedValue({
      success: false,
      blocked: true,
      reason: 'rpc_failed'
    });

    await expect(productMigrationService.runInitialMigrationIfNeeded({
      licenseKey: 'CUTOVER-BLOCKED'
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
      recovery: { reason: 'rpc_failed' }
    });
    expect(mocks.pullCatalogSnapshot).not.toHaveBeenCalled();
  });

  it('guards direct snapshot callers with the same repeated-cutover reconciliation', async () => {
    mocks.getMeta.mockResolvedValue(true);

    await expect(productMigrationService.pullFullSnapshot({
      licenseKey: 'DIRECT-PULL-GUARD'
    })).resolves.toMatchObject({ success: true, applied: 0 });

    expect(mocks.events[0]).toBe('recovery');
    expect(mocks.events.slice(1)).toEqual(['pull', 'pull', 'pull']);
  });
});
