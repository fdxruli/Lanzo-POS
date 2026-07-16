// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
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
  portal: { id: 'portal-1', catalogRevision: 4 }
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

const successResult = (catalogRevision = 5) => ({
  success: true,
  updatedCount: 1,
  skippedCount: 0,
  reviewCount: 0,
  staleCount: 0,
  conflictCount: 0,
  catalogRevision
});

const ingredient = ({ id, name, unit, stock, updatedAt }) => ({
  id,
  name,
  trackStock: true,
  stock,
  committedStock: 0,
  isActive: true,
  batchManagement: { enabled: true, selectionStrategy: 'fefo' },
  bulkData: { purchase: { unit } },
  updatedAt
});

const batch = ({ id, productId, stock, updatedAt }) => ({
  id,
  productId,
  stock,
  committedStock: 0,
  isActive: true,
  status: 'active',
  updatedAt
});

const createRecipeFixture = () => {
  const potato = ingredient({
    id: 'ingredient-potato',
    name: 'Papa blanca',
    unit: 'kg',
    stock: 15,
    updatedAt: '2026-07-15T10:00:00.000Z'
  });
  const sauce = ingredient({
    id: 'ingredient-sauce',
    name: 'Salsa verde',
    unit: 'lt',
    stock: 5.97,
    updatedAt: '2026-07-15T10:01:00.000Z'
  });
  const product = {
    id: 'recipe-fries',
    name: 'Papas a la francesa',
    description: 'Producto preparado por receta',
    categoryId: 'food',
    price: 55,
    trackStock: false,
    stock: 0,
    committedStock: 0,
    isActive: true,
    serverVersion: 1,
    updatedAt: '2026-07-04T05:46:48.272Z',
    recipe: [{
      ingredientId: potato.id,
      name: potato.name,
      quantity: 0.25,
      unit: 'kg'
    }, {
      ingredientId: sauce.id,
      name: sauce.name,
      quantity: 0.02,
      unit: 'lt'
    }],
    modifiers: [{
      id: 'extras',
      name: 'Extras',
      required: false,
      options: [{
        id: 'extra-cheese',
        name: 'Queso extra',
        price: 12,
        ingredientId: 'ingredient-cheese',
        ingredientQuantity: 0.05,
        ingredientUnit: 'kg',
        tracksInventory: true,
        sourceAvailable: false
      }]
    }],
    batchManagement: { enabled: false },
    [INGREDIENTS_KEY]: [potato, sauce]
  };
  const potatoBatch = batch({
    id: 'batch-potato',
    productId: potato.id,
    stock: 15,
    updatedAt: '2026-07-16T07:00:00.000Z'
  });
  const sauceBatch = batch({
    id: 'batch-sauce',
    productId: sauce.id,
    stock: 5.97,
    updatedAt: '2026-07-16T07:01:00.000Z'
  });
  return { product, potato, sauce, potatoBatch, sauceBatch };
};

const createServiceHarness = (fixture) => {
  const publishedProduct = {
    id: 'published-recipe-fries',
    localProductRef: fixture.product.id,
    isPublished: true
  };
  const localSource = {
    getProductsByIds: vi.fn().mockImplementation(async () => new Map([
      [fixture.product.id, fixture.product],
      [fixture.potato.id, fixture.potato],
      [fixture.sauce.id, fixture.sauce]
    ])),
    getCategoriesByIds: vi.fn().mockResolvedValue(new Map([
      ['food', { id: 'food', name: 'Comida' }]
    ])),
    getBatchesByProductIds: vi.fn().mockImplementation(async () => new Map([
      [fixture.product.id, [fixture.potatoBatch, fixture.sauceBatch]]
    ]))
  };
  const syncBatch = vi.fn().mockResolvedValue(successResult());
  const service = createEcommerceCatalogSyncService({
    getState: adminState,
    getPortal: vi.fn().mockResolvedValue(portalResult()),
    getPublishedProducts: vi.fn().mockResolvedValue({
      success: true,
      products: [publishedProduct]
    }),
    syncBatch,
    localSource,
    outbox: createOutbox()
  });
  return { service, syncBatch, localSource };
};

describe('catalog sync recipe inventory dependencies', () => {
  it('loads ingredient batches for a recipe parent without direct batch management', async () => {
    const fixture = createRecipeFixture();
    const { service, syncBatch, localSource } = createServiceHarness(fixture);

    await service.syncNow({ fullReconcile: true, reason: 'manual' });

    expect(localSource.getBatchesByProductIds).toHaveBeenCalledWith([fixture.product.id]);
    const [projection] = syncBatch.mock.calls[0][0].projections;
    expect(projection).toMatchObject({
      sourceState: 'in_stock',
      sourceAvailable: true,
      stockSnapshot: 60,
      configuration: {
        type: 'configurable',
        hasRecipe: true,
        availabilitySource: 'recipe'
      }
    });
    expect(projection.configuration.optionGroups[0].options[0].sourceAvailable).toBe(false);
    expect(projection.sourceRevision).toBe(`version:${Date.parse(fixture.sauceBatch.updatedAt)}`);
    expect(projection.configurationSourceRevision).toBe(projection.sourceRevision);
  });

  it('keeps the parent available when only an optional extra is unavailable', async () => {
    const fixture = createRecipeFixture();
    const { service, syncBatch } = createServiceHarness(fixture);

    await service.syncNow({ fullReconcile: true, reason: 'manual' });

    const [projection] = syncBatch.mock.calls[0][0].projections;
    expect(projection.sourceAvailable).toBe(true);
    expect(projection.configuration.optionGroups[0]).toMatchObject({
      required: false,
      minSelect: 0
    });
    expect(projection.configuration.optionGroups[0].options[0].sourceAvailable).toBe(false);
  });

  it('marks the recipe out of stock when a required ingredient batch is exhausted', async () => {
    const fixture = createRecipeFixture();
    fixture.potatoBatch.stock = 0;
    fixture.potatoBatch.updatedAt = '2026-07-16T08:00:00.000Z';
    const { service, syncBatch } = createServiceHarness(fixture);

    await service.syncNow({ fullReconcile: true, reason: 'manual' });

    const [projection] = syncBatch.mock.calls[0][0].projections;
    expect(projection).toMatchObject({
      sourceState: 'out_of_stock',
      sourceAvailable: false,
      stockSnapshot: 0,
      configuration: {
        availabilityReasonCode: 'RECIPE_CAPACITY_ZERO',
        limitingSource: {
          productId: fixture.potato.id,
          name: fixture.potato.name
        }
      }
    });
  });

  it('changes source revision and idempotency key after a batch-only update', async () => {
    const fixture = createRecipeFixture();
    const { service, syncBatch } = createServiceHarness(fixture);

    await service.syncNow({ fullReconcile: true, reason: 'manual' });
    fixture.sauceBatch.updatedAt = '2026-07-16T09:30:00.000Z';
    await service.syncNow({ fullReconcile: true, reason: 'manual' });

    const first = syncBatch.mock.calls[0][0];
    const second = syncBatch.mock.calls[1][0];
    expect(second.projections[0].sourceRevision).toBe(
      `version:${Date.parse(fixture.sauceBatch.updatedAt)}`
    );
    expect(second.projections[0].sourceRevision).not.toBe(first.projections[0].sourceRevision);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
