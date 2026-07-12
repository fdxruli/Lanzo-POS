// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEcommercePublicCatalogCache,
  createEcommercePublicCatalogDatabase
} from '../ecommercePublicCatalogCache';
import { createEcommercePublicService } from '../ecommercePublicService';

const databases = [];

const portalResponse = (revision) => ({
  success: true,
  portal: {
    slug: 'mi-tienda',
    name: 'Mi tienda',
    maxOrderItems: 30,
    maxItemQuantity: 99
  },
  hours: { weekly: [], exceptions: [] },
  features: { orderInbox: true },
  catalogRevision: revision,
  cachePolicy: { schemaVersion: 1, freshSeconds: 300, maxStaleSeconds: 86400 }
});

const catalogResponse = (revision, offset = 0) => ({
  success: true,
  catalogRevision: revision,
  items: [{
    id: `product-${offset}`,
    name: 'Producto',
    price: 50,
    isAvailable: true,
    stock: { mode: 'hidden', status: null, quantity: null }
  }],
  pagination: { limit: 100, offset, hasMore: false }
});

const createService = (rpc, name) => {
  const database = createEcommercePublicCatalogDatabase(name);
  databases.push(database);
  const cache = createEcommercePublicCatalogCache({ database });
  return {
    database,
    service: createEcommercePublicService({ rpc }, { cache })
  };
};

const waitForCachedPage = async (database) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await database.table('pages').count()) > 0) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error('Catalog page was not cached');
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('ecommercePublicService catalog cache', () => {
  it('uses one portal rpc and zero catalog rpcs on the second visit with the same revision', async () => {
    const rpc = vi.fn(async (name) => {
      if (name === 'ecommerce_get_portal_by_slug') return { data: portalResponse(7), error: null };
      if (name === 'ecommerce_get_catalog') return { data: catalogResponse(7), error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    const { database, service } = createService(rpc, 'public-service-same-revision');

    const firstPortal = await service.getPublicPortalBySlug('mi-tienda');
    const firstCatalog = await service.getPublicCatalog('mi-tienda', {
      catalogRevision: firstPortal.catalogRevision,
      cachePolicy: firstPortal.cachePolicy
    });
    await waitForCachedPage(database);

    const secondPortal = await service.getPublicPortalBySlug('mi-tienda');
    const secondCatalog = await service.getPublicCatalog('mi-tienda', {
      catalogRevision: secondPortal.catalogRevision,
      cachePolicy: secondPortal.cachePolicy
    });

    expect(firstCatalog.source).toBe('network');
    expect(secondCatalog.source).toBe('cache');
    expect(rpc.mock.calls.filter(([name]) => name === 'ecommerce_get_portal_by_slug')).toHaveLength(2);
    expect(rpc.mock.calls.filter(([name]) => name === 'ecommerce_get_catalog')).toHaveLength(1);
  });

  it('never reuses a previous revision and sends the expected revision to the rpc', async () => {
    let revision = 2;
    const rpc = vi.fn(async (name, params) => {
      if (name === 'ecommerce_get_portal_by_slug') return { data: portalResponse(revision), error: null };
      if (name === 'ecommerce_get_catalog') {
        return { data: catalogResponse(params.p_catalog_revision, params.p_offset), error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const { database, service } = createService(rpc, 'public-service-new-revision');

    const firstPortal = await service.getPublicPortalBySlug('mi-tienda');
    await service.getPublicCatalog('mi-tienda', {
      catalogRevision: firstPortal.catalogRevision,
      cachePolicy: firstPortal.cachePolicy
    });
    await waitForCachedPage(database);
    revision = 3;

    const secondPortal = await service.getPublicPortalBySlug('mi-tienda');
    const secondCatalog = await service.getPublicCatalog('mi-tienda', {
      catalogRevision: secondPortal.catalogRevision,
      cachePolicy: secondPortal.cachePolicy
    });

    expect(secondCatalog.catalogRevision).toBe(3);
    expect(secondCatalog.source).toBe('network');
    expect(rpc).toHaveBeenLastCalledWith('ecommerce_get_catalog', {
      p_slug: 'mi-tienda',
      p_limit: 100,
      p_offset: 0,
      p_catalog_revision: 3
    });
  });

  it('returns a cached page as read-only when the network fails', async () => {
    let online = true;
    const rpc = vi.fn(async (name) => {
      if (!online) return { data: null, error: { code: 'NETWORK', message: 'private detail' } };
      if (name === 'ecommerce_get_portal_by_slug') return { data: portalResponse(5), error: null };
      return { data: catalogResponse(5), error: null };
    });
    const { database, service } = createService(rpc, 'public-service-offline');

    const portal = await service.getPublicPortalBySlug('mi-tienda');
    await service.getPublicCatalog('mi-tienda', {
      catalogRevision: portal.catalogRevision,
      cachePolicy: portal.cachePolicy
    });
    await waitForCachedPage(database);
    for (let attempt = 0; attempt < 20 && (await database.table('portals').count()) === 0; attempt += 1) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }
    online = false;

    const offlinePortal = await service.getPublicPortalBySlug('mi-tienda');
    const offlineCatalog = await service.getPublicCatalog('mi-tienda', {
      catalogRevision: offlinePortal.catalogRevision,
      cachePolicy: offlinePortal.cachePolicy,
      offline: true
    });

    expect(offlinePortal.offline).toBe(true);
    expect(offlineCatalog).toMatchObject({ source: 'cache', offline: true });
  });
});
