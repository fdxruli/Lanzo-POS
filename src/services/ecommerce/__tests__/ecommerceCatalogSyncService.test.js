// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEcommerceCatalogSyncService,
  ecommerceCatalogSyncServiceInternals
} from '../ecommerceCatalogSyncService';

const adminState = () => ({
  licenseDetails: { license_key: 'PRO-LICENSE' },
  currentDeviceRole: 'admin',
  currentStaffUser: null,
  deviceFingerprint: 'device-1'
});

const portalResult = (overrides = {}) => ({
  success: true,
  plan: { code: 'pro_monthly', name: 'Lanzo Nube' },
  features: { cloudCatalogSource: true },
  portal: { id: 'portal-1', catalogRevision: 4 },
  ...overrides
});

const published = (id = 'product-1') => ({
  id: `published-${id}`,
  localProductRef: id,
  publicName: `Public ${id}`,
  isPublished: true,
  syncConfig: {
    name: 'source',
    description: 'manual',
    category: 'source',
    price: 'source',
    image: 'manual'
  }
});

const local = (id = 'product-1', overrides = {}) => ({
  id,
  name: `Local ${id}`,
  description: 'Descripción local',
  categoryId: 'category-1',
  price: 25,
  imageUrl: 'https://example.com/product.jpg',
  trackStock: true,
  stock: 5,
  committedStock: 0,
  isActive: true,
  updatedAt: '2026-07-12T12:00:00.000Z',
  ...overrides
});

const outbox = () => ({
  rememberPortal: vi.fn().mockResolvedValue(true),
  getRememberedPortal: vi.fn().mockResolvedValue(null),
  enqueue: vi.fn().mockResolvedValue(1),
  list: vi.fn().mockResolvedValue({ entries: [], productRefs: [], fullReconcile: false }),
  acknowledge: vi.fn().mockResolvedValue(0),
  replacePending: vi.fn().mockResolvedValue(1),
  cleanup: vi.fn().mockResolvedValue(0)
});

const localSource = (productsById = new Map([['product-1', local()]])) => ({
  getProductsByIds: vi.fn().mockResolvedValue(productsById),
  getCategoriesByIds: vi.fn().mockResolvedValue(new Map([['category-1', { id: 'category-1', name: 'General' }]])),
  getBatchesByProductIds: vi.fn().mockResolvedValue(new Map())
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

const noTimer = () => ({
  setTimeoutFn: vi.fn().mockReturnValue(123),
  clearTimeoutFn: vi.fn(),
  random: () => 0.5
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const waitForCondition = async (predicate) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error('Expected async condition was not reached');
};

afterEach(() => {
  vi.useRealTimers();
});

describe('ecommerceCatalogSyncService', () => {
  it('does not execute cloud autosync for FREE', async () => {
    const syncBatch = vi.fn();
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult({
        plan: { code: 'free_trial', name: 'Plan Free' },
        features: { cloudCatalogSource: false }
      })),
      getPublishedProducts: vi.fn(),
      syncBatch,
      localSource: localSource(),
      outbox: outbox()
    });

    const result = await service.syncNow({ fullReconcile: true });
    expect(result.state).toBe('manual');
    expect(syncBatch).not.toHaveBeenCalled();
  });

  it('consolidates twenty rapid events into one batch execution', async () => {
    vi.useFakeTimers();
    const syncBatch = vi.fn().mockResolvedValue(successResult());
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: localSource(),
      outbox: outbox(),
      debounceMs: 100
    });

    for (let index = 0; index < 20; index += 1) {
      service.scheduleSync({ productIds: ['product-1'], reason: `event-${index}` });
    }
    await vi.advanceTimersByTimeAsync(101);
    await flush();

    expect(syncBatch).toHaveBeenCalledTimes(1);
    expect(syncBatch.mock.calls[0][0].projections).toHaveLength(1);
  });

  it('runs one consolidated repetition when an event arrives during single-flight', async () => {
    let resolveFirst;
    const firstResult = new Promise((resolve) => { resolveFirst = resolve; });
    const syncBatch = vi.fn()
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce(successResult(6));
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: localSource(),
      outbox: outbox()
    });

    const active = service.syncNow({ productIds: ['product-1'], fullReconcile: false });
    await waitForCondition(() => syncBatch.mock.calls.length === 1);
    service.scheduleSync({ productIds: ['product-1'], reason: 'during-flight' });
    resolveFirst(successResult());
    await active;

    expect(syncBatch).toHaveBeenCalledTimes(2);
  });

  it('coalesces duplicate ids and sends only public operational projections', async () => {
    const syncBatch = vi.fn().mockResolvedValue(successResult());
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: localSource(),
      outbox: outbox()
    });

    await service.syncNow({
      productIds: ['product-1', 'product-1', 'product-1'],
      fullReconcile: false
    });

    const [projection] = syncBatch.mock.calls[0][0].projections;
    expect(projection).toMatchObject({
      publishedProductId: 'published-product-1',
      localProductRef: 'product-1',
      sourceRevision: `timestamp:${Date.parse('2026-07-12T12:00:00.000Z')}`,
      sourceState: 'in_stock',
      sourceAvailable: true,
      fields: { name: 'Local product-1', category: 'General', price: 25 }
    });
    expect(JSON.stringify(projection)).not.toMatch(/cost|supplier|provider|customer|token|license/i);
  });

  it('does not send source_missing or change availability when product reads fail', async () => {
    const queue = outbox();
    const source = localSource();
    source.getProductsByIds.mockRejectedValue(new Error('IndexedDB unavailable'));
    const syncBatch = vi.fn();
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: source,
      outbox: queue,
      ...noTimer()
    });

    const result = await service.syncNow({ productIds: ['product-1'], fullReconcile: false });

    expect(result).toMatchObject({
      state: 'pending',
      code: 'ECOMMERCE_CATALOG_LOCAL_PRODUCTS_READ_FAILED'
    });
    expect(syncBatch).not.toHaveBeenCalled();
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      productRefs: ['product-1'],
      fullReconcile: false
    }));
  });

  it('keeps availability unchanged when a local cache read does not contain the product', async () => {
    const syncBatch = vi.fn().mockResolvedValue({ ...successResult(4), reviewCount: 1 });
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: localSource(new Map()),
      outbox: outbox()
    });

    await service.syncNow({ fullReconcile: true });
    expect(syncBatch.mock.calls[0][0].projections[0]).toMatchObject({
      publishedProductId: 'published-product-1',
      sourceRevision: null,
      sourceState: 'unverified',
      sourceAvailable: null,
      stockSnapshot: null,
      fields: {}
    });
  });

  it('does not erase a linked category when the category read fails', async () => {
    const source = localSource();
    source.getCategoriesByIds.mockRejectedValue(new Error('category db failed'));
    const syncBatch = vi.fn().mockResolvedValue(successResult());
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: source,
      outbox: outbox()
    });

    await service.syncNow({ fullReconcile: true });
    const fields = syncBatch.mock.calls[0][0].projections[0].fields;
    expect(fields).toMatchObject({ name: 'Local product-1', price: 25 });
    expect(fields).not.toHaveProperty('category');
  });

  it('keeps batch read failures as unverified without inventing stock zero', async () => {
    const source = localSource(new Map([['product-1', local('product-1', {
      batchManagement: { enabled: true },
      expirationMode: 'BATCH'
    })]]));
    source.getBatchesByProductIds.mockRejectedValue(new Error('batch db failed'));
    const syncBatch = vi.fn().mockResolvedValue({ ...successResult(4), reviewCount: 1 });
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: source,
      outbox: outbox()
    });

    await service.syncNow({ fullReconcile: true });
    expect(syncBatch.mock.calls[0][0].projections[0]).toMatchObject({
      sourceState: 'unverified',
      sourceAvailable: null,
      stockSnapshot: null
    });
  });

  it('queues a portal timeout even when navigator reports online', async () => {
    const queue = outbox();
    const timers = noTimer();
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue({
        success: false,
        code: 'ETIMEDOUT',
        message: 'request timed out'
      }),
      getPublishedProducts: vi.fn(),
      syncBatch: vi.fn(),
      localSource: localSource(),
      outbox: queue,
      ...timers
    });

    const result = await service.syncNow({ productIds: ['product-1'], fullReconcile: false });
    expect(result.state).toBe('pending');
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      portalId: null,
      productRefs: ['product-1']
    }));
    expect(timers.setTimeoutFn).toHaveBeenCalled();
  });

  it('queues a transient published-product list failure with the authorized portal', async () => {
    const queue = outbox();
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({
        success: false,
        status: 503,
        code: 'SERVICE_UNAVAILABLE'
      }),
      syncBatch: vi.fn(),
      localSource: localSource(),
      outbox: queue,
      ...noTimer()
    });

    await service.syncNow({ productIds: ['product-1'], fullReconcile: false });
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      portalId: 'portal-1',
      productRefs: ['product-1']
    }));
  });

  it('retains only unconfirmed refs after a transient failure in the second chunk', async () => {
    const products = Array.from({ length: 201 }, (_, index) => published(`product-${index}`));
    const localProducts = new Map(products.map((item, index) => [
      item.localProductRef,
      local(item.localProductRef, { updatedAt: `2026-07-12T12:${String(index % 60).padStart(2, '0')}:00.000Z` })
    ]));
    const queue = outbox();
    queue.list.mockResolvedValue({
      entries: [{ key: 'queued-all', scopeHash: 'scope', portalId: 'portal-1' }],
      productRefs: products.map((item) => item.localProductRef),
      fullReconcile: false
    });
    const syncBatch = vi.fn()
      .mockResolvedValueOnce(successResult(5))
      .mockResolvedValueOnce({ success: false, status: 503, code: 'PGRST503' });
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products }),
      syncBatch,
      localSource: localSource(localProducts),
      outbox: queue,
      ...noTimer()
    });

    await service.syncNow({ fullReconcile: false });

    expect(syncBatch).toHaveBeenCalledTimes(2);
    expect(queue.replacePending).toHaveBeenCalledWith(expect.objectContaining({
      productRefs: expect.any(Array),
      fullReconcile: false
    }));
    const remaining = queue.replacePending.mock.calls[0][0].productRefs;
    expect(remaining).toHaveLength(1);
    expect(queue.acknowledge).not.toHaveBeenCalled();
  });

  it('does not enqueue non-retryable failures into a loop', async () => {
    const queue = outbox();
    const timers = noTimer();
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch: vi.fn().mockResolvedValue({
        success: false,
        code: 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD'
      }),
      localSource: localSource(),
      outbox: queue,
      ...timers
    });

    const result = await service.syncNow({ fullReconcile: true });
    expect(result.state).toBe('error');
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.replacePending).not.toHaveBeenCalled();
    expect(timers.setTimeoutFn).not.toHaveBeenCalled();
    expect(queue.acknowledge).toHaveBeenCalledWith(expect.objectContaining({
      portalId: 'portal-1'
    }));
  });

  it('acknowledges queued entries only after every chunk succeeds', async () => {
    const queue = outbox();
    queue.list.mockResolvedValue({
      entries: [{ key: 'queued' }],
      productRefs: ['product-1'],
      fullReconcile: false
    });
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch: vi.fn().mockResolvedValue(successResult()),
      localSource: localSource(),
      outbox: queue
    });

    await service.syncNow({ fullReconcile: false });
    expect(queue.acknowledge).toHaveBeenCalledWith(expect.objectContaining({
      scopeIdentity: expect.any(String),
      portalId: 'portal-1',
      entries: [{ key: 'queued' }]
    }));
  });

  it('cancels retry backoff when the license/staff context changes', async () => {
    const queue = outbox();
    const timers = noTimer();
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue({ success: false, status: 504 }),
      getPublishedProducts: vi.fn(),
      syncBatch: vi.fn(),
      localSource: localSource(),
      outbox: queue,
      ...timers
    });

    await service.syncNow({ fullReconcile: true });
    service.invalidateContext();
    expect(timers.clearTimeoutFn).toHaveBeenCalledWith(123);
  });

  it('queues changes after a new runtime starts completely offline', async () => {
    const queue = outbox();
    queue.getRememberedPortal.mockResolvedValue('portal-1');
    const getPortal = vi.fn();
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal,
      getPublishedProducts: vi.fn(),
      syncBatch: vi.fn(),
      localSource: localSource(),
      outbox: queue,
      online: () => false,
      ...noTimer()
    });

    const result = await service.syncNow({
      productIds: ['product-1'],
      fullReconcile: false,
      reason: 'offline-after-reload'
    });

    expect(result.state).toBe('pending');
    expect(getPortal).not.toHaveBeenCalled();
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      portalId: 'portal-1',
      productRefs: ['product-1'],
      fullReconcile: false
    }));
  });
});

describe('catalog source revisions', () => {
  it('keeps large monotonic server versions comparable without losing integer precision', () => {
    expect(ecommerceCatalogSyncServiceInternals.normalizeSourceRevision(
      { serverVersion: '9007199254740993' },
      [{ serverVersion: '9007199254740994' }]
    )).toBe('version:9007199254740994');
  });
});

describe('catalog sync idempotency signature', () => {
  const projection = (overrides = {}) => ({
    publishedProductId: 'published-1',
    localProductRef: 'product-1',
    sourceRevision: 'version:10',
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
    ...overrides
  });

  it('changes the key when only stock changes', async () => {
    const first = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection()]
    });
    const second = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection({ stockSnapshot: 4 })]
    });
    expect(second).not.toBe(first);
  });

  it('changes the key when only price changes', async () => {
    const first = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection()]
    });
    const second = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection({ fields: { ...projection().fields, price: 55 } })]
    });
    expect(second).not.toBe(first);
  });

  it('keeps the same key for semantically identical objects with different property order', async () => {
    const reordered = {
      fields: {
        image: null,
        price: 50,
        category: 'General',
        description: null,
        name: 'Producto'
      },
      stockSnapshot: 5,
      sourceAvailable: true,
      sourceState: 'in_stock',
      sourceRevision: 'version:10',
      localProductRef: 'product-1',
      publishedProductId: 'published-1'
    };
    const first = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection()]
    });
    const second = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [reordered]
    });
    expect(second).toBe(first);
  });

  it('keeps identical batches idempotent regardless of product order', async () => {
    const secondProjection = projection({
      publishedProductId: 'published-2',
      localProductRef: 'product-2'
    });
    const first = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [projection(), secondProjection]
    });
    const second = await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
      portalId: 'portal-1',
      projections: [secondProjection, projection()]
    });
    expect(second).toBe(first);
  });
});
