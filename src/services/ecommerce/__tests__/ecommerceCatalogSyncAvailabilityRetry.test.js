// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createEcommerceCatalogSyncService,
  ecommerceCatalogSyncServiceInternals
} from '../ecommerceCatalogSyncServiceBase';
import {
  ECOMMERCE_AVAILABILITY_SOURCES,
  buildEcommerceProductConfigurationSyncPayload,
  serializeEcommerceProductConfigurationForSync
} from '../../../utils/ecommerceProductConfigurationSync';

const SQL_AVAILABILITY_SOURCES = Object.freeze([
  'direct',
  'recipe',
  'variant_aggregate',
  'not_tracked',
  'manual',
  'unverified'
]);

const baseProduct = (overrides = {}) => ({
  id: 'product-1',
  name: 'Producto',
  categoryId: 'category-1',
  price: 50,
  trackStock: true,
  stock: 5,
  committedStock: 0,
  isActive: true,
  updatedAt: '2026-07-15T12:00:00.000Z',
  ...overrides
});

const optionGroup = (overrides = {}) => ({
  sourceGroupRef: 'extras',
  name: 'Extras',
  selectionType: 'multiple',
  required: false,
  minSelect: 0,
  maxSelect: 2,
  options: [{ sourceOptionRef: 'onion', name: 'Cebolla', priceDelta: 0 }],
  ...overrides
});

const availabilityOf = (product) => (
  buildEcommerceProductConfigurationSyncPayload(product).availabilitySource
);

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

const published = {
  id: 'published-1',
  localProductRef: 'product-1',
  isPublished: true
};

const successResult = () => ({
  success: true,
  updatedCount: 1,
  skippedCount: 0,
  reviewCount: 0,
  staleCount: 0,
  conflictCount: 0,
  catalogRevision: 5
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
    ['category-1', { id: 'category-1', name: 'General' }]
  ])),
  getBatchesByProductIds: vi.fn().mockResolvedValue(new Map())
});

const createService = ({
  product,
  localSource = createLocalSource(product),
  outbox = createOutbox(),
  syncBatch = vi.fn().mockResolvedValue(successResult()),
  online = () => true,
  setTimeoutFn = vi.fn().mockReturnValue(123),
  clearTimeoutFn = vi.fn()
}) => ({
  localSource,
  outbox,
  syncBatch,
  setTimeoutFn,
  clearTimeoutFn,
  service: createEcommerceCatalogSyncService({
    getState: adminState,
    getPortal: vi.fn().mockResolvedValue(portalResult()),
    getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published] }),
    syncBatch,
    localSource,
    outbox,
    online,
    setTimeoutFn,
    clearTimeoutFn,
    random: () => 0.5
  })
});

const expectPermanentFailure = async ({ product, expectedCode }) => {
  const context = createService({ product });
  const result = await context.service.syncNow({ fullReconcile: true });

  expect(result).toMatchObject({
    state: 'error',
    pendingCount: 0,
    errorCount: 1,
    code: expectedCode
  });
  expect(context.syncBatch).not.toHaveBeenCalled();
  expect(context.outbox.enqueue).not.toHaveBeenCalled();
  expect(context.outbox.replacePending).not.toHaveBeenCalled();
  expect(context.setTimeoutFn).not.toHaveBeenCalled();
};

describe('official ecommerce availability sources', () => {
  it.each([
    ['simple tracked', baseProduct(), 'simple', 'direct'],
    ['simple not tracked', baseProduct({ trackStock: false }), 'simple', 'not_tracked'],
    ['recipe', baseProduct({ recipe: [{ ingredientId: 'flour', quantity: 1, unit: 'kg' }] }), 'recipe', 'recipe'],
    ['variant parent', baseProduct({ variants: [{ sourceProductId: 'sku-1', optionValues: { size: 'L' } }] }), 'variant_parent', 'variant_aggregate'],
    ['configurable recipe', baseProduct({
      recipe: [{ ingredientId: 'flour', quantity: 1, unit: 'kg' }],
      modifiers: [optionGroup()]
    }), 'configurable', 'recipe'],
    ['configurable tracked', baseProduct({ modifiers: [optionGroup()] }), 'configurable', 'direct'],
    ['configurable not tracked', baseProduct({ trackStock: false, modifiers: [optionGroup()] }), 'configurable', 'not_tracked']
  ])('%s uses the SQL contract', (_label, product, expectedType, expectedSource) => {
    const payload = buildEcommerceProductConfigurationSyncPayload(product);
    expect(payload.type).toBe(expectedType);
    expect(payload.availabilitySource).toBe(expectedSource);
    expect(SQL_AVAILABILITY_SOURCES).toContain(payload.availabilitySource);
    expect(payload.availabilitySource).not.toBe('inventory');
  });

  it('exposes only the SQL availability vocabulary', () => {
    expect(Object.values(ECOMMERCE_AVAILABILITY_SOURCES).sort()).toEqual(
      [...SQL_AVAILABILITY_SOURCES].sort()
    );
  });

  it('rejects unknown availability sources instead of coercing them to direct', () => {
    expect(() => serializeEcommerceProductConfigurationForSync({
      type: 'simple',
      version: 1,
      hasRecipe: false,
      variants: [],
      optionGroups: [],
      availabilitySource: 'unknown_value'
    })).toThrow('ECOMMERCE_CONFIGURATION_INVALID');

    expect(() => buildEcommerceProductConfigurationSyncPayload(
      baseProduct(),
      { availabilitySource: 'inventory' }
    )).toThrow('ECOMMERCE_CONFIGURATION_INVALID');
  });
});

describe('catalog projection retry policy', () => {
  it('persists and schedules a retry for a temporary local read failure', async () => {
    const product = baseProduct();
    const localSource = createLocalSource(product);
    localSource.getProductsByIds.mockRejectedValue(new Error('IndexedDB unavailable'));
    const context = createService({ product, localSource });

    const result = await context.service.syncNow({ fullReconcile: true });

    expect(result).toMatchObject({
      state: 'pending',
      code: 'ECOMMERCE_CATALOG_LOCAL_PRODUCTS_READ_FAILED'
    });
    expect(context.outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(context.setTimeoutFn).toHaveBeenCalledTimes(1);
  });

  it('does not retry ECOMMERCE_CONFIGURATION_INVALID', async () => {
    const product = baseProduct();
    Object.defineProperty(product, 'variants', {
      get() {
        throw new Error('ECOMMERCE_CONFIGURATION_INVALID');
      }
    });
    await expectPermanentFailure({
      product,
      expectedCode: 'ECOMMERCE_CONFIGURATION_INVALID'
    });
  });

  it('does not retry ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED', async () => {
    const options = Array.from({ length: 60 }, (_, index) => ({
      sourceOptionRef: `option-${index}`,
      name: `Opción ${index}`,
      priceDelta: 0
    }));
    const product = baseProduct({
      modifiers: [
        optionGroup({ sourceGroupRef: 'group-1', options }),
        optionGroup({ sourceGroupRef: 'group-2', options })
      ]
    });
    await expectPermanentFailure({
      product,
      expectedCode: 'ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED'
    });
  });

  it('does not assume an unknown projection error is retryable', async () => {
    const product = baseProduct();
    Object.defineProperty(product, 'variants', {
      get() {
        throw new Error('unexpected projection defect');
      }
    });
    await expectPermanentFailure({
      product,
      expectedCode: 'ECOMMERCE_CATALOG_SYNC_PROJECTION_FAILED'
    });
  });

  it('classifies network and offline failures as retryable', () => {
    expect(ecommerceCatalogSyncServiceInternals.isRetryableCatalogSyncError(
      { code: 'NETWORK_ERROR' },
      () => true
    )).toBe(true);
    expect(ecommerceCatalogSyncServiceInternals.isRetryableCatalogSyncError(
      { code: 'UNKNOWN' },
      () => false
    )).toBe(true);
  });

  it('keeps permanent configuration errors non-retryable even when marked retryable', () => {
    expect(ecommerceCatalogSyncServiceInternals.isRetryableCatalogSyncError({
      code: 'ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED',
      retryable: true,
      message: 'request timed out'
    }, () => true)).toBe(false);
  });

  it('allows a later event to synchronize after the product is corrected', async () => {
    let invalid = true;
    const product = baseProduct();
    Object.defineProperty(product, 'variants', {
      get() {
        if (invalid) throw new Error('ECOMMERCE_CONFIGURATION_INVALID');
        return [];
      }
    });
    const context = createService({ product });

    const first = await context.service.syncNow({ fullReconcile: true });
    expect(first.state).toBe('error');
    expect(context.syncBatch).not.toHaveBeenCalled();

    invalid = false;
    const second = await context.service.syncNow({ fullReconcile: true });
    expect(second.state).toBe('synced');
    expect(context.syncBatch).toHaveBeenCalledTimes(1);
  });
});
