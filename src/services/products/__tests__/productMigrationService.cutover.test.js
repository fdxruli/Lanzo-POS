import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMeta: vi.fn(),
  setMeta: vi.fn(),
  saveConflict: vi.fn(),
  getLocalCatalogForMigration: vi.fn(),
  applyCloudCatalog: vi.fn(),
  migrateLocalCatalog: vi.fn(),
  completePharmacyInventoryCutover: vi.fn(),
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
  completePharmacyInventoryCutover: mocks.completePharmacyInventoryCutover,
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

const successfulMigrationResponse = ({ categories = [], products = [], batches = [] } = {}) => ({
  success: true,
  results: {
    categories: categories.map((category) => ({ success: true, category })),
    products: products.map((product) => ({ success: true, product })),
    batches: batches.map((batch) => ({ success: true, batch }))
  }
});

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
  mocks.completePharmacyInventoryCutover.mockResolvedValue({ success: true, closed: true });
  mocks.migrateLocalCatalog.mockImplementation(async ({ categories = [], products = [], batches = [] }) => (
    successfulMigrationResponse({ categories, products, batches })
  ));

  mocks.runRecovery.mockImplementation(async () => {
    mocks.events.push('recovery');
    return { success: true, recovered: 1 };
  });
  });

  it('keeps the first FREE to PRO bootstrap as local migration followed by snapshot', async () => {
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

  it('reuses historical import batch root after retry and closes cutover after verified snapshot', async () => {
    const pharma = {
      categories: [],
      products: [{
        id: 'pharma-1', name: 'Amoxicilina test', stock: 2, price: 10, cost: 5,
        batchManagement: { enabled: true }, expirationMode: 'STRICT',
        metadata: { pharmacy: { kind: 'medicine', status: 'confirmed', fraction: 'IV', antibiotic: true } }
      }],
      batches: [{
        id: 'batch-pharma-1', productId: 'pharma-1', stock: 2,
        manufacturerBatchId: 'AMX-QA-001', expiryDate: '2027-10-31T00:00:00Z'
      }]
    };
    const meta = new Map();
    mocks.getLocalCatalogForMigration.mockResolvedValue(pharma);
    mocks.getMeta.mockImplementation(async (key) => meta.get(key) ?? false);
    mocks.setMeta.mockImplementation(async (key, value) => { meta.set(key, value); });
    mocks.migrateLocalCatalog.mockResolvedValueOnce({ success: false, code: 'TEMPORARY_FAILURE' });
    mocks.migrateLocalCatalog.mockImplementation(async ({ categories = [], products = [], batches = [] }) =>
      successfulMigrationResponse({ categories, products, batches })
    );

    await expect(productMigrationService.runInitialMigrationIfNeeded({ licenseKey: 'PHARMA-RETRY' }))
      .resolves.toMatchObject({ success: false, blocked: true });
    const firstBatch = mocks.migrateLocalCatalog.mock.calls[0][0].batchId;
    expect(mocks.completePharmacyInventoryCutover).not.toHaveBeenCalled();
    expect(meta.get(buildProductsMigratedMetaKey('PHARMA-RETRY'))).not.toBe(true);

    await expect(productMigrationService.runInitialMigrationIfNeeded({ licenseKey: 'PHARMA-RETRY' }))
      .resolves.toMatchObject({ success: true, migrated: 2 });
    const retriedBatch = mocks.migrateLocalCatalog.mock.calls[1][0].batchId;
    expect(retriedBatch).toBe(firstBatch);
    expect(mocks.completePharmacyInventoryCutover).toHaveBeenCalledTimes(1);
    expect(mocks.completePharmacyInventoryCutover).toHaveBeenCalledWith({
      licenseKey: 'PHARMA-RETRY',
      batchRoot: firstBatch.replace(/-products-0$/, '')
    });
    expect(meta.get(buildProductsMigratedMetaKey('PHARMA-RETRY'))).toBe(true);
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
    mocks.migrateLocalCatalog.mockResolvedValueOnce({ success: false, code: 'CLOUD_BOOTSTRAP_FAILED' });

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

  it('blocks initial migration when a nested product result fails despite outer success', async () => {
    mocks.migrateLocalCatalog
      .mockResolvedValueOnce(successfulMigrationResponse({ categories: localCatalog.categories }))
      .mockResolvedValueOnce({
        success: true,
        results: {
          categories: [],
          products: [{
            success: false,
            code: 'DUPLICATE_BARCODE',
            message: 'Duplicate barcode',
            product: { id: 'product-1' },
            server_version: 7
          }],
          batches: []
        }
      });

    await expect(productMigrationService.runInitialMigrationIfNeeded({
      licenseKey: 'CUTOVER-NESTED-FAILURE'
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
      issues: [expect.objectContaining({
        entityType: 'product',
        entityId: 'product-1',
        code: 'DUPLICATE_BARCODE',
        serverVersion: 7
      })]
    });

    expect(mocks.pullCatalogSnapshot).not.toHaveBeenCalled();
    expect(mocks.setMeta).not.toHaveBeenCalledWith(
      buildProductsMigratedMetaKey('CUTOVER-NESTED-FAILURE'),
      true,
      expect.anything()
    );
    expect(mocks.applyCloudCatalog).toHaveBeenCalledTimes(1);
  });

  it('sets the marker only after all category, product, and batch nested results succeed', async () => {
    const fullCatalog = {
      categories: [{ id: 'category-full', name: 'Full category' }],
      products: [{ id: 'product-full', name: 'Full product', price: 10, cost: 5, stock: 1 }],
      batches: [{ id: 'batch-full', productId: 'product-full', stock: 1 }]
    };
    mocks.getLocalCatalogForMigration.mockResolvedValueOnce(fullCatalog);

    await expect(productMigrationService.runInitialMigrationIfNeeded({
      licenseKey: 'CUTOVER-NESTED-SUCCESS'
    })).resolves.toMatchObject({ success: true, migrated: 3 });

    expect(mocks.migrateLocalCatalog).toHaveBeenCalledTimes(3);
    expect(mocks.setMeta).toHaveBeenCalledWith(
      buildProductsMigratedMetaKey('CUTOVER-NESTED-SUCCESS'),
      true,
      { licenseKey: 'CUTOVER-NESTED-SUCCESS' }
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
