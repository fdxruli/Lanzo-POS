// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEcommerceCatalogSyncService } from '../ecommerceCatalogSyncService';

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
  enqueue: vi.fn().mockResolvedValue(1),
  list: vi.fn().mockResolvedValue({ entries: [], productRefs: [], fullReconcile: false }),
  acknowledge: vi.fn().mockResolvedValue(0),
  cleanup: vi.fn().mockResolvedValue(0)
});

const localSource = (productsById = new Map([['product-1', local()]])) => ({
  getProductsByIds: vi.fn().mockResolvedValue(productsById),
  getCategoriesByIds: vi.fn().mockResolvedValue(new Map([['category-1', { id: 'category-1', name: 'General' }]])),
  getBatchesByProductIds: vi.fn().mockResolvedValue(new Map())
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
    const syncBatch = vi.fn().mockResolvedValue({
      success: true,
      updatedCount: 1,
      skippedCount: 0,
      reviewCount: 0,
      catalogRevision: 5
    });
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
      .mockResolvedValueOnce({
        success: true,
        updatedCount: 1,
        skippedCount: 0,
        reviewCount: 0,
        catalogRevision: 6
      });
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
    expect(typeof resolveFirst).toBe('function');
    resolveFirst({
      success: true,
      updatedCount: 1,
      skippedCount: 0,
      reviewCount: 0,
      catalogRevision: 5
    });
    await active;

    expect(syncBatch).toHaveBeenCalledTimes(2);
  });

  it('coalesces duplicate ids and sends only public operational projections', async () => {
    const syncBatch = vi.fn().mockResolvedValue({
      success: true,
      updatedCount: 1,
      skippedCount: 0,
      reviewCount: 0,
      catalogRevision: 5
    });
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
      sourceState: 'in_stock',
      sourceAvailable: true,
      fields: { name: 'Local product-1', category: 'General', price: 25 }
    });
    expect(JSON.stringify(projection)).not.toMatch(/cost|supplier|provider|customer|token|license/i);
  });

  it('keeps source_missing as review input without deleting the publication', async () => {
    const syncBatch = vi.fn().mockResolvedValue({
      success: true,
      updatedCount: 1,
      skippedCount: 0,
      reviewCount: 1,
      catalogRevision: 4
    });
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
      sourceState: 'source_missing',
      sourceAvailable: false,
      stockSnapshot: null
    });
  });

  it('does not convert unverified recipe stock to zero', async () => {
    const syncBatch = vi.fn().mockResolvedValue({
      success: true,
      updatedCount: 1,
      skippedCount: 0,
      reviewCount: 1,
      catalogRevision: 4
    });
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: localSource(new Map([['product-1', local('product-1', {
        recipe: [{ ingredientId: 'ingredient-1', quantity: 1 }]
      })]])),
      outbox: outbox()
    });

    await service.syncNow({ fullReconcile: true });
    expect(syncBatch.mock.calls[0][0].projections[0]).toMatchObject({
      sourceState: 'unverified',
      sourceAvailable: null,
      stockSnapshot: null
    });
  });

  it('queues refs offline and retries them when online execution resumes', async () => {
    let connected = false;
    const queue = outbox();
    queue.list.mockResolvedValue({
      entries: [{ key: 'queued' }],
      productRefs: ['product-1'],
      fullReconcile: false
    });
    const syncBatch = vi.fn().mockResolvedValue({
      success: true,
      updatedCount: 1,
      skippedCount: 0,
      reviewCount: 0,
      catalogRevision: 5
    });
    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products: [published()] }),
      syncBatch,
      localSource: localSource(),
      outbox: queue,
      online: () => connected
    });

    connected = true;
    await service.syncNow({ fullReconcile: true });
    connected = false;
    await service.syncNow({ productIds: ['product-1'], fullReconcile: false });
    expect(queue.enqueue).toHaveBeenCalled();

    connected = true;
    await service.syncNow({ fullReconcile: false });
    expect(syncBatch).toHaveBeenCalledTimes(2);
    expect(queue.acknowledge).toHaveBeenCalled();
  });
});
