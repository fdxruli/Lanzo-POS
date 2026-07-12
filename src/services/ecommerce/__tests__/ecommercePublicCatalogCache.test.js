// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ECOMMERCE_PUBLIC_CACHE_POLICY,
  createEcommercePublicCatalogCache,
  createEcommercePublicCatalogDatabase
} from '../ecommercePublicCatalogCache';

const databases = [];

const createCache = (name, options = {}) => {
  const database = createEcommercePublicCatalogDatabase(name);
  databases.push(database);
  return createEcommercePublicCatalogCache({ database, ...options });
};

const page = (revision = 1, offset = 0) => ({
  catalogRevision: revision,
  items: [{
    id: `product-${offset}`,
    name: 'Producto público',
    description: 'Descripción',
    categoryName: 'General',
    price: 50,
    currency: 'MXN',
    imageUrl: 'https://example.com/product.jpg',
    isAvailable: true,
    displayOrder: offset,
    stock: { mode: 'hidden', status: null, quantity: null },
    options: {}
  }],
  pagination: { limit: 100, offset, hasMore: false }
});

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('ecommercePublicCatalogCache', () => {
  it('stores and reads a page isolated by slug, revision and offset', async () => {
    const cache = createCache('public-cache-isolation');
    await cache.putPage({
      slug: 'tienda-a',
      catalogRevision: 4,
      offset: 0,
      limit: 100,
      cachePolicy: ECOMMERCE_PUBLIC_CACHE_POLICY,
      page: page(4, 0)
    });

    expect((await cache.getPage({
      slug: 'tienda-a',
      catalogRevision: 4,
      offset: 0,
      limit: 100
    }))?.page.items[0].id).toBe('product-0');
    expect(await cache.getPage({
      slug: 'tienda-b',
      catalogRevision: 4,
      offset: 0,
      limit: 100
    })).toBeNull();
    expect(await cache.getPage({
      slug: 'tienda-a',
      catalogRevision: 5,
      offset: 0,
      limit: 100
    })).toBeNull();
  });

  it('discards expired pages and incompatible schema versions', async () => {
    let now = 10_000;
    const cache = createCache('public-cache-expiry', { now: () => now });
    await cache.putPage({
      slug: 'tienda',
      catalogRevision: 1,
      offset: 0,
      limit: 100,
      cachePolicy: { schemaVersion: 1, freshSeconds: 5, maxStaleSeconds: 10 },
      page: page(1)
    });

    now += 11_000;
    expect(await cache.getPage({
      slug: 'tienda',
      catalogRevision: 1,
      offset: 0,
      limit: 100,
      cachePolicy: { schemaVersion: 1, freshSeconds: 5, maxStaleSeconds: 10 }
    })).toBeNull();
    expect(await cache.getPage({
      slug: 'tienda',
      catalogRevision: 1,
      offset: 0,
      limit: 100,
      cachePolicy: { schemaVersion: 2, freshSeconds: 5, maxStaleSeconds: 10 }
    })).toBeNull();
  });

  it('rejects malformed products and removes forbidden private keys from options', async () => {
    const cache = createCache('public-cache-private-data');
    const valid = await cache.putPage({
      slug: 'tienda',
      catalogRevision: 2,
      offset: 0,
      limit: 100,
      page: {
        ...page(2),
        items: [{
          ...page(2).items[0],
          options: {
            publicLabel: 'Grande',
            customerPhone: '9610000000',
            idempotencyKey: 'secret-key',
            token: 'secret-token'
          }
        }]
      }
    });
    expect(valid).toBe(true);

    const cached = await cache.getPage({
      slug: 'tienda',
      catalogRevision: 2,
      offset: 0,
      limit: 100
    });
    expect(cached.page.items[0].options).toEqual({ publicLabel: 'Grande' });
    expect(JSON.stringify(cached.page)).not.toMatch(/9610000000|secret-key|secret-token/);

    expect(await cache.putPage({
      slug: 'tienda',
      catalogRevision: 2,
      offset: 100,
      limit: 100,
      page: { catalogRevision: 2, items: [{ name: 'Sin id' }], pagination: {} }
    })).toBe(false);
  });

  it('deletes pages from obsolete revisions without touching the current one', async () => {
    const cache = createCache('public-cache-clean-revisions');
    await cache.putPage({ slug: 'tienda', catalogRevision: 1, offset: 0, limit: 100, page: page(1) });
    await cache.putPage({ slug: 'tienda', catalogRevision: 2, offset: 0, limit: 100, page: page(2) });

    expect(await cache.deleteObsoleteRevisions({ slug: 'tienda', keepRevision: 2 })).toBe(1);
    expect(await cache.getPage({ slug: 'tienda', catalogRevision: 1, offset: 0, limit: 100 })).toBeNull();
    expect(await cache.getPage({ slug: 'tienda', catalogRevision: 2, offset: 0, limit: 100 })).not.toBeNull();
  });
});
