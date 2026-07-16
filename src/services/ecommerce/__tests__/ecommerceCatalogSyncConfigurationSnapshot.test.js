// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createEcommerceCatalogSyncService,
  ecommerceCatalogSyncServiceInternals
} from '../ecommerceCatalogSyncServiceBase';
import { createEcommerceAdminService } from '../ecommerceAdminService';

const clone = (value) => JSON.parse(JSON.stringify(value));
const SQL_AVAILABILITY_SOURCES = Object.freeze([
  'direct',
  'recipe',
  'variant_aggregate',
  'not_tracked',
  'manual',
  'unverified'
]);

const expectSqlCompatibleConfiguration = (configuration) => {
  expect(SQL_AVAILABILITY_SOURCES).toContain(configuration.availabilitySource);
  expect(configuration.availabilitySource).not.toBe('inventory');
};

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

const publishedProduct = {
  id: 'published-configurable',
  localProductRef: 'configurable-1',
  isPublished: true
};

const configurableProduct = (overrides = {}) => ({
  id: 'configurable-1',
  name: 'Hamburguesa configurable',
  description: 'Producto con variante y extras',
  categoryId: 'category-1',
  price: 120,
  imageUrl: 'https://example.com/hamburguesa.jpg',
  trackStock: true,
  stock: 8,
  committedStock: 1,
  isActive: true,
  serverVersion: 12,
  variants: [{
    sourceVariantRef: 'size-large',
    sourceProductId: 'sku-size-large',
    localProductRef: 'sku-size-large',
    sku: 'SIZE-LARGE',
    publicName: 'Grande',
    optionValues: { size: 'Grande' },
    priceMode: 'delta',
    priceValue: 20,
    stockMode: 'exact',
    stockSnapshot: 4,
    sourceAvailable: true,
    displayOrder: 0
  }],
  modifiers: [{
    sourceGroupRef: 'extras',
    name: 'Extras',
    selectionType: 'multiple',
    required: true,
    minSelect: 1,
    maxSelect: 2,
    displayOrder: 0,
    options: [{
      sourceOptionRef: 'cheese',
      name: 'Queso extra',
      priceDelta: 15,
      sourceIngredientId: 'ingredient-cheese',
      ingredientQuantity: 1,
      ingredientUnit: 'pza',
      tracksInventory: true,
      displayOrder: 0
    }, {
      sourceOptionRef: 'onion',
      name: 'Cebolla',
      priceDelta: 0,
      tracksInventory: false,
      displayOrder: 1
    }]
  }],
  ...overrides
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

const createOutbox = () => ({
  rememberPortal: vi.fn().mockResolvedValue(true),
  getRememberedPortal: vi.fn().mockResolvedValue(null),
  enqueue: vi.fn().mockResolvedValue(1),
  list: vi.fn().mockResolvedValue({ entries: [], productRefs: [], fullReconcile: false }),
  acknowledge: vi.fn().mockResolvedValue(0),
  replacePending: vi.fn().mockResolvedValue(1),
  cleanup: vi.fn().mockResolvedValue(0)
});

const createLocalSource = (product) => ({
  getProductsByIds: vi.fn().mockResolvedValue(new Map([[product.id, product]])),
  getCategoriesByIds: vi.fn().mockResolvedValue(new Map([
    ['category-1', { id: 'category-1', name: 'Comida' }]
  ])),
  getBatchesByProductIds: vi.fn().mockResolvedValue(new Map())
});

const createAdminTransport = (rpc) => createEcommerceAdminService({
  rpc,
  isConfigured: () => true,
  getLicenseDetails: () => ({ license_key: 'PRO-LICENSE' }),
  buildAuthContext: vi.fn().mockResolvedValue({
    licenseKey: 'PRO-LICENSE',
    deviceFingerprint: 'device-1',
    securityToken: 'security-token',
    staffSessionToken: null
  }),
  isOnline: () => true
});

const projection = (configuration, overrides = {}) => ({
  publishedProductId: 'published-1',
  localProductRef: 'product-1',
  sourceRevision: 'version:12',
  sourceState: 'in_stock',
  sourceAvailable: true,
  stockSnapshot: 5,
  fields: {
    name: 'Producto',
    description: null,
    category: 'General',
    price: 50,
    image: null
  },
  configuration,
  configurationSourceRevision: 'version:12',
  ...overrides
});

const canonicalConfiguration = () => ({
  type: 'configurable',
  version: 1,
  hasRecipe: false,
  variants: [],
  optionGroups: [{
    sourceGroupRef: 'extras',
    publicName: 'Extras',
    selectionType: 'multiple',
    required: true,
    minSelect: 1,
    maxSelect: 2,
    displayOrder: 0,
    options: [{
      sourceOptionRef: 'cheese',
      publicName: 'Queso',
      priceDelta: 15,
      sourceIngredientId: 'ingredient-cheese',
      ingredientQuantity: 1,
      ingredientUnit: 'pza',
      tracksInventory: true,
      manualAvailable: true,
      sourceAvailable: true,
      displayOrder: 0,
      metadata: {}
    }],
    metadata: {}
  }],
  availabilitySource: 'direct',
  availabilityReasonCode: 'SOURCE_STOCK_AVAILABLE',
  limitingSource: { productId: null, name: null }
});

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

describe('catalog configuration snapshot and idempotency', () => {
  it('builds, signs and transports the same complete projection from one local read', async () => {
    const product = configurableProduct();
    const localSource = createLocalSource(product);
    const rpc = vi.fn().mockResolvedValue({ data: successResult(), error: null });
    const adminService = createAdminTransport(rpc);
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({
        success: true,
        products: [publishedProduct]
      }),
      syncBatch: adminService.syncPublishedCatalog,
      localSource,
      outbox: createOutbox()
    });

    await service.syncNow({ fullReconcile: true });

    expect(localSource.getProductsByIds).toHaveBeenCalledTimes(1);
    const [rpcName, params] = rpc.mock.calls[0];
    expect(rpcName).toBe('ecommerce_admin_sync_published_catalog_v2');
    expect(params.p_idempotency_key).toMatch(/^ecom-catalog-sync:portal-1:/);
    expect(params.p_expected_catalog_revision).toBe(4);
    expect(params.p_projections).toHaveLength(1);

    const [sent] = params.p_projections;
    expect(sent).toMatchObject({
      sourceRevision: 'version:12',
      configurationSourceRevision: 'version:12',
      sourceState: 'in_stock',
      sourceAvailable: true,
      stockSnapshot: 7,
      configuration: {
        type: 'variant_parent',
        version: 1,
        hasRecipe: false,
        availabilitySource: 'variant_aggregate',
        availabilityReasonCode: 'SOURCE_STOCK_AVAILABLE'
      }
    });
    expect(sent.configuration.variants[0].optionValues).toEqual({ size: 'Grande' });
    expect(sent.configuration.optionGroups[0]).toMatchObject({
      required: true,
      minSelect: 1,
      maxSelect: 2
    });
    expect(sent.configuration.optionGroups[0].options).toHaveLength(2);
    expect(sent.configuration.optionGroups[0].options[0]).toMatchObject({
      priceDelta: 15,
      sourceIngredientId: 'ingredient-cheese',
      ingredientQuantity: 1
    });
    expectSqlCompatibleConfiguration(sent.configuration);

    const recomputedKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: params.p_projections
    });
    expect(recomputedKey).toBe(params.p_idempotency_key);
  });

  it('keeps configuration and both revisions on the original version when an external fixture changes', async () => {
    const externalProduct = configurableProduct();
    const snapshotV12 = clone(externalProduct);
    const localSource = createLocalSource(snapshotV12);
    localSource.getCategoriesByIds.mockImplementation(async () => {
      externalProduct.serverVersion = 13;
      externalProduct.variants[0].optionValues.size = 'Mediana';
      return new Map([['category-1', { id: 'category-1', name: 'Comida' }]]);
    });
    const syncBatch = vi.fn().mockResolvedValue(successResult());
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [publishedProduct] }),
      syncBatch,
      localSource,
      outbox: createOutbox()
    });

    await service.syncNow({ fullReconcile: true });

    const [sent] = syncBatch.mock.calls[0][0].projections;
    expect(localSource.getProductsByIds).toHaveBeenCalledTimes(1);
    expect(sent.sourceRevision).toBe('version:12');
    expect(sent.configurationSourceRevision).toBe('version:12');
    expect(sent.configuration.variants[0].optionValues.size).toBe('Grande');
    expect(externalProduct.serverVersion).toBe(13);
  });

  it('changes the key for configuration-only changes and keeps it for identical payloads', async () => {
    const baseConfiguration = canonicalConfiguration();
    const baseProjection = projection(baseConfiguration);
    const baseKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [baseProjection]
    });
    const identicalKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [clone(baseProjection)]
    });
    expect(identicalKey).toBe(baseKey);

    const cases = [
      (config) => { config.type = 'recipe'; config.hasRecipe = true; },
      (config) => { config.optionGroups[0].required = false; config.optionGroups[0].minSelect = 0; },
      (config) => { config.optionGroups[0].options[0].priceDelta = 20; },
      (config) => { config.optionGroups[0].options[0].sourceIngredientId = 'ingredient-bacon'; },
      (config) => { config.optionGroups[0].options[0].ingredientQuantity = 2; },
      (config) => { config.availabilityReasonCode = 'SOURCE_STOCK_ZERO'; },
      (config) => { config.limitingSource = { productId: 'ingredient-cheese', name: 'Queso' }; }
    ];

    for (const mutate of cases) {
      const changed = clone(baseConfiguration);
      mutate(changed);
      const changedKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
        portalId: 'portal-1',
        projections: [projection(changed)]
      });
      expect(changedKey).not.toBe(baseKey);
    }

    const changedRevisionKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection(baseConfiguration, { configurationSourceRevision: 'version:13' })]
    });
    expect(changedRevisionKey).not.toBe(baseKey);
  });

  it('normalizes object key order without losing significant array order', async () => {
    const firstConfiguration = canonicalConfiguration();
    const reorderedConfiguration = {
      limitingSource: { name: null, productId: null },
      availabilityReasonCode: 'SOURCE_STOCK_AVAILABLE',
      availabilitySource: 'direct',
      optionGroups: clone(firstConfiguration.optionGroups),
      variants: [],
      hasRecipe: false,
      version: 1,
      type: 'configurable'
    };
    const firstKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection(firstConfiguration)]
    });
    const secondKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection(reorderedConfiguration)]
    });
    expect(secondKey).toBe(firstKey);

    const arrayOrderChanged = clone(firstConfiguration);
    arrayOrderChanged.optionGroups[0].options.push({
      ...clone(arrayOrderChanged.optionGroups[0].options[0]),
      sourceOptionRef: 'bacon',
      publicName: 'Tocino',
      displayOrder: 1
    });
    const reversed = clone(arrayOrderChanged);
    reversed.optionGroups[0].options.reverse();
    const orderedKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection(arrayOrderChanged)]
    });
    const reversedKey = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection(reversed)]
    });
    expect(reversedKey).not.toBe(orderedKey);
  });

  it('builds a canonical stable simple configuration', async () => {
    const localProduct = configurableProduct({ variants: [], modifiers: [] });
    const args = {
      publishedProduct,
      localProduct,
      category: { name: 'Comida' },
      sourceRevision: 'version:12',
      evaluation: {
        status: 'in_stock',
        availableStock: 7,
        reasonCode: 'SOURCE_STOCK_AVAILABLE'
      }
    };

    const first = ecommerceCatalogSyncServiceInternals.buildProjection(args);
    const second = ecommerceCatalogSyncServiceInternals.buildProjection(clone(args));

    expect(first.configuration).toEqual({
      type: 'simple',
      version: 1,
      hasRecipe: false,
      variants: [],
      optionGroups: [],
      availabilitySource: 'direct',
      availabilityReasonCode: 'SOURCE_STOCK_AVAILABLE',
      limitingSource: { productId: null, name: null }
    });
    expect(await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1', projections: [first]
    })).toBe(await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1', projections: [second]
    }));
  });

  it('does not mutate local products, published products, configuration or projections', () => {
    const localProduct = deepFreeze(configurableProduct());
    const published = deepFreeze(clone(publishedProduct));
    const evaluation = deepFreeze({
      status: 'in_stock',
      availableStock: 7,
      reasonCode: 'SOURCE_STOCK_AVAILABLE',
      limitingIngredientId: null,
      limitingIngredientName: null
    });
    const localBefore = JSON.stringify(localProduct);
    const publishedBefore = JSON.stringify(published);

    const built = ecommerceCatalogSyncServiceInternals.buildProjection({
      publishedProduct: published,
      localProduct,
      category: deepFreeze({ name: 'Comida' }),
      sourceRevision: 'version:12',
      evaluation
    });
    const frozenProjection = deepFreeze(clone(built));
    const projectionBefore = JSON.stringify(frozenProjection);

    ecommerceCatalogSyncServiceInternals.normalizeProjectionForSignature(frozenProjection);

    expect(JSON.stringify(localProduct)).toBe(localBefore);
    expect(JSON.stringify(published)).toBe(publishedBefore);
    expect(JSON.stringify(frozenProjection)).toBe(projectionBefore);
  });

  it('reuses the same payload and key for an exact retry and creates a new key after reconstruction changes', async () => {
    const product = configurableProduct();
    const localSource = createLocalSource(product);
    const calls = [];
    const syncBatch = vi.fn(async (request) => {
      calls.push(clone(request));
      return calls.length === 1
        ? { success: false, status: 503, code: 'PGRST503' }
        : successResult(4 + calls.length);
    });
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [publishedProduct] }),
      syncBatch,
      localSource,
      outbox: createOutbox(),
      setTimeoutFn: vi.fn().mockReturnValue(1),
      clearTimeoutFn: vi.fn(),
      random: () => 0.5
    });

    await service.syncNow({ productIds: [product.id], fullReconcile: false });
    await service.syncNow({ productIds: [product.id], fullReconcile: false });

    expect(calls[1].projections).toEqual(calls[0].projections);
    expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);

    product.modifiers[0].options[0].priceDelta = 25;
    product.serverVersion = 13;
    await service.syncNow({ productIds: [product.id], fullReconcile: false });

    expect(calls[2].idempotencyKey).not.toBe(calls[1].idempotencyKey);
    expect(calls[2].projections[0].configuration.optionGroups[0].options[0].priceDelta).toBe(25);
    expect(calls[2].projections[0].configurationSourceRevision).toBe('version:13');
  });
});
