// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createEcommerceCatalogSyncService } from '../ecommerceCatalogSyncService';

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

const publishedProduct = (index) => ({
  id: `published-product-${index}`,
  localProductRef: `product-${index}`,
  publicName: `Producto ${index}`,
  isPublished: true,
  syncConfig: {
    name: 'source',
    description: 'manual',
    category: 'source',
    price: 'source',
    image: 'manual'
  }
});

const localProduct = (index) => ({
  id: `product-${index}`,
  name: `Producto local ${index}`,
  description: 'Descripción local',
  categoryId: 'category-1',
  price: 25,
  imageUrl: 'https://example.com/product.jpg',
  trackStock: true,
  stock: 5,
  committedStock: 0,
  isActive: true,
  updatedAt: '2026-07-12T12:00:00.000Z'
});

const successResult = (catalogRevision) => ({
  success: true,
  updatedCount: 1,
  skippedCount: 0,
  reviewCount: 0,
  staleCount: 0,
  conflictCount: 0,
  catalogRevision
});

const waitForCondition = async (predicate) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error('Expected async condition was not reached');
};

describe('ecommerceCatalogSyncService retry outbox drain', () => {
  it('retries only refs left after a transient failure in the second chunk', async () => {
    const products = Array.from({ length: 201 }, (_, index) => publishedProduct(index));
    const productsById = new Map(
      products.map((product, index) => [product.localProductRef, localProduct(index)])
    );
    let queuedRefs = products.map((product) => product.localProductRef);
    let queuedEntries = queuedRefs.map((productRef) => ({ key: `queued:${productRef}` }));

    const outbox = {
      rememberPortal: vi.fn().mockResolvedValue(true),
      getRememberedPortal: vi.fn().mockResolvedValue(null),
      enqueue: vi.fn().mockResolvedValue(1),
      list: vi.fn(async () => ({
        entries: queuedEntries,
        productRefs: queuedRefs,
        fullReconcile: false
      })),
      acknowledge: vi.fn().mockResolvedValue(0),
      replacePending: vi.fn(async ({ productRefs }) => {
        queuedRefs = [...productRefs];
        queuedEntries = queuedRefs.map((productRef) => ({ key: `queued:${productRef}` }));
        return queuedRefs.length;
      }),
      cleanup: vi.fn().mockResolvedValue(0)
    };

    const localSource = {
      getProductsByIds: vi.fn(async (refs) => new Map(
        refs.map((ref) => [ref, productsById.get(ref)]).filter(([, product]) => product)
      )),
      getCategoriesByIds: vi.fn().mockResolvedValue(new Map([
        ['category-1', { id: 'category-1', name: 'General' }]
      ])),
      getBatchesByProductIds: vi.fn().mockResolvedValue(new Map())
    };

    const syncBatch = vi.fn()
      .mockResolvedValueOnce(successResult(5))
      .mockResolvedValueOnce({ success: false, status: 503, code: 'PGRST503' })
      .mockResolvedValueOnce(successResult(6));
    const scheduledTimers = [];

    const service = createEcommerceCatalogSyncService({
      getState: adminState,
      getPortal: vi.fn().mockResolvedValue(portalResult()),
      getPublishedProducts: vi.fn().mockResolvedValue({ success: true, products }),
      syncBatch,
      localSource,
      outbox,
      random: () => 0.5,
      setTimeoutFn: (callback, delay) => {
        scheduledTimers.push({ callback, delay });
        return scheduledTimers.length;
      },
      clearTimeoutFn: vi.fn()
    });

    const firstResult = await service.syncNow({ fullReconcile: false });

    expect(firstResult.state).toBe('pending');
    expect(syncBatch).toHaveBeenCalledTimes(2);
    expect(outbox.replacePending).toHaveBeenCalledWith(expect.objectContaining({
      productRefs: ['product-200'],
      fullReconcile: false
    }));
    expect(scheduledTimers).toHaveLength(1);

    scheduledTimers[0].callback();
    await waitForCondition(() => syncBatch.mock.calls.length === 3);

    const retryProjection = syncBatch.mock.calls[2][0].projections;
    expect(retryProjection).toHaveLength(1);
    expect(retryProjection[0].localProductRef).toBe('product-200');
    expect(outbox.acknowledge).toHaveBeenCalledWith(expect.objectContaining({
      entries: [{ key: 'queued:product-200' }]
    }));
  });
});
