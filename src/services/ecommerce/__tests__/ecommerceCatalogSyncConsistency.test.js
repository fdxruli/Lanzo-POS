// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEcommerceCatalogSyncService,
  ecommerceCatalogSyncDependencyInternals
} from '../ecommerceCatalogSyncService';

const INGREDIENTS_KEY = ecommerceCatalogSyncDependencyInternals.INGREDIENTS_KEY;

const adminState = () => ({
  licenseDetails: { license_key: 'PRO-LICENSE' },
  currentDeviceRole: 'admin',
  currentStaffUser: null,
  deviceFingerprint: 'device-1'
});

const portalResult = () => ({
  success: true,
  plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
  features: { cloudCatalogSource: true },
  portal: { id: 'portal-1', catalogRevision: 7 }
});

const createOutbox = () => ({
  rememberPortal: vi.fn().mockResolvedValue(true),
  getRememberedPortal: vi.fn().mockResolvedValue(null),
  enqueue: vi.fn().mockResolvedValue(1),
  list: vi.fn().mockResolvedValue({ entries: [], productRefs: [], fullReconcile: false }),
  acknowledge: vi.fn().mockResolvedValue(0),
  replacePending: vi.fn().mockResolvedValue(1),
  cleanup: vi.fn().mockResolvedValue(0)
});

const createFixture = ({ withBatch }) => {
  const ingredient = {
    id: 'ingredient-potato',
    name: 'Papa blanca',
    trackStock: true,
    stock: 5,
    committedStock: 0,
    isActive: true,
    batchManagement: { enabled: true, selectionStrategy: 'fefo' },
    bulkData: { purchase: { unit: 'kg' } },
    serverVersion: 8,
    updatedAt: '2026-07-16T09:00:00.000Z'
  };
  const product = {
    id: 'recipe-fries',
    name: 'Papas a la francesa',
    price: 45,
    trackStock: false,
    stock: 0,
    committedStock: 0,
    isActive: true,
    productType: 'sellable',
    serverVersion: 2,
    updatedAt: '2026-07-16T08:00:00.000Z',
    batchManagement: { enabled: false },
    recipe: [{
      ingredientId: ingredient.id,
      name: ingredient.name,
      quantity: 0.25,
      unit: 'kg'
    }],
    modifiers: [{
      id: 'size',
      name: 'Tamaño',
      required: true,
      options: [{ id: 'regular', name: 'Regular', price: 0 }]
    }],
    [INGREDIENTS_KEY]: [ingredient]
  };
  const batch = withBatch
    ? {
        id: 'batch-potato',
        productId: ingredient.id,
        stock: 5,
        committedStock: 0,
        isActive: true,
        status: 'active',
        serverVersion: 3,
        updatedAt: '2026-07-16T10:00:00.000Z'
      }
    : null;
  return { product, ingredient, batch };
};

const createHarness = (fixture) => {
  const syncBatch = vi.fn().mockResolvedValue({
    success: true,
    updatedCount: 1,
    skippedCount: 0,
    reviewCount: 0,
    staleCount: 0,
    conflictCount: 0,
    catalogRevision: 8
  });
  const localSource = {
    getProductsByIds: vi.fn().mockResolvedValue(new Map([
      [fixture.product.id, fixture.product],
      [fixture.ingredient.id, fixture.ingredient]
    ])),
    getCategoriesByIds: vi.fn().mockResolvedValue(new Map()),
    getBatchesByProductIds: vi.fn().mockResolvedValue(new Map([
      [fixture.product.id, fixture.batch ? [fixture.batch] : []]
    ]))
  };
  const service = createEcommerceCatalogSyncService({
    getState: adminState,
    getPortal: vi.fn().mockResolvedValue(portalResult()),
    getPublishedProducts: vi.fn().mockResolvedValue({
      success: true,
      products: [{
        id: 'published-fries',
        localProductRef: fixture.product.id,
        isPublished: true
      }]
    }),
    syncBatch,
    localSource,
    outbox: createOutbox()
  });
  return { service, syncBatch, localSource };
};

describe('ecommerce catalog consistency', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses unverified instead of false out of stock when a positive batch-managed ingredient is missing locally', async () => {
    const fixture = createFixture({ withBatch: false });
    const { service, syncBatch } = createHarness(fixture);

    await service.syncNow({ fullReconcile: true, reason: 'test' });

    const [projection] = syncBatch.mock.calls[0][0].projections;
    expect(projection).toMatchObject({
      sourceState: 'unverified',
      sourceAvailable: null,
      stockSnapshot: null,
      configurationSourceRevision: 'version:2'
    });
    expect(projection.configuration.availabilityReasonCode).toBe('RECIPE_STOCK_INVALID');
  });

  it('keeps inventory revision dependency-aware without inflating configuration revision', async () => {
    const fixture = createFixture({ withBatch: true });
    const { service, syncBatch, localSource } = createHarness(fixture);

    await service.syncNow({ fullReconcile: true, reason: 'test' });

    expect(localSource.getBatchesByProductIds).toHaveBeenCalledTimes(1);
    const [projection] = syncBatch.mock.calls[0][0].projections;
    expect(projection.sourceState).toBe('in_stock');
    expect(projection.stockSnapshot).toBe(20);
    expect(projection.sourceRevision).toBe(`version:${Date.parse(fixture.batch.updatedAt)}`);
    expect(projection.configurationSourceRevision).toBe('version:2');
  });

  it('marks only the missing ingredient snapshot and preserves other ingredient records', () => {
    const fixture = createFixture({ withBatch: false });
    const marked = ecommerceCatalogSyncDependencyInternals.markMissingBatchSnapshots(
      fixture.product,
      []
    );
    const [ingredient] = marked[INGREDIENTS_KEY];

    expect(ingredient.stock).toBeNull();
    expect(ingredient.batchManagement.enabled).toBe(false);
    expect(ingredient[ecommerceCatalogSyncDependencyInternals.MISSING_BATCH_SNAPSHOT_KEY]).toBe(true);
    expect(fixture.ingredient.stock).toBe(5);
  });
});
