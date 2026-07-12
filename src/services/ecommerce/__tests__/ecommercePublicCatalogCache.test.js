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

const portalResult = (slug = 'tienda') => ({
  portal: {
    slug,
    name: 'Tienda pública',
    headline: 'Compra en línea',
    description: 'Descripción pública',
    templateCode: 'classic',
    customizationLevel: 'basic',
    theme: { primaryColor: '#111111', token: 'discard-me' },
    logoUrl: 'https://example.com/logo.png',
    coverImageUrl: 'https://example.com/cover.png',
    whatsappPhone: '529610000000',
    address: 'Calle pública 1',
    businessType: ['restaurant'],
    orderingEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: false,
    scheduledOrdersEnabled: true,
    minOrderTotal: 100,
    maxOrderItems: 20,
    maxItemQuantity: 5,
    stockMode: 'hidden',
    settings: {
      currency: 'MXN',
      orderLeadMinutes: 20,
      customerPhone: 'discard-me',
      token: 'discard-me'
    }
  },
  hours: {
    weekly: [{
      weekday: 1,
      isOpen: true,
      opensAt: '09:00',
      closesAt: '18:00',
      staff: 'discard-me'
    }],
    exceptions: [{
      date: '2026-12-25',
      isOpen: false,
      opensAt: null,
      closesAt: null,
      reason: 'Navidad',
      customer: 'discard-me'
    }]
  },
  features: {
    whatsappCheckout: true,
    orderInbox: true,
    customSlug: true,
    brandingCustomization: 'advanced',
    layoutCustomization: 'full',
    businessHours: true,
    deliveryPickupSettings: 'advanced',
    stockVisibility: true,
    realtimeOrders: true,
    license: 'discard-me'
  },
  catalogRevision: 4,
  cachePolicy: ECOMMERCE_PUBLIC_CACHE_POLICY,
  checkout: {
    customer: 'Private customer',
    phone: '9610000000',
    address: 'Private address',
    idempotencyKey: 'private-key'
  }
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

  it('uses an explicit product/options allowlist and removes checkout data', async () => {
    const cache = createCache('public-cache-private-data');
    const valid = await cache.putPage({
      slug: 'tienda',
      catalogRevision: 2,
      offset: 0,
      limit: 100,
      page: {
        ...page(2),
        checkout: { customer: 'Private customer' },
        items: [{
          ...page(2).items[0],
          customer: 'Private customer',
          cost: 20,
          options: {
            publicLabel: 'Grande',
            priceDelta: 10,
            required: true,
            groups: [{
              id: 'size',
              name: 'Tamaño',
              options: [{ id: 'large', label: 'Grande', priceDelta: 10 }]
            }],
            customerPhone: '9610000000',
            idempotencyKey: 'secret-key',
            token: 'secret-token',
            supplier: 'secret-supplier'
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
    expect(cached.page.items[0].options).toEqual({
      publicLabel: 'Grande',
      priceDelta: 10,
      required: true,
      groups: [{
        id: 'size',
        name: 'Tamaño',
        options: [{ id: 'large', label: 'Grande', priceDelta: 10 }]
      }]
    });
    expect(JSON.stringify(cached.page)).not.toMatch(
      /9610000000|secret-key|secret-token|secret-supplier|Private customer|"cost"/
    );

    expect(await cache.putPage({
      slug: 'tienda',
      catalogRevision: 2,
      offset: 100,
      limit: 100,
      page: { catalogRevision: 2, items: [{ name: 'Sin id' }], pagination: {} }
    })).toBe(false);
  });

  it('preserves required public portal fields offline while excluding PII and credentials', async () => {
    const cache = createCache('public-cache-portal-allowlist');
    expect(await cache.putPortal({ slug: 'tienda', result: portalResult() })).toBe(true);

    const cached = await cache.getPortal({ slug: 'tienda' });
    expect(cached.portal).toMatchObject({
      slug: 'tienda',
      whatsappPhone: '529610000000',
      address: 'Calle pública 1',
      orderingEnabled: true,
      scheduledOrdersEnabled: true,
      maxOrderItems: 20,
      maxItemQuantity: 5
    });
    expect(cached.features).toMatchObject({
      whatsappCheckout: true,
      orderInbox: true,
      stockVisibility: true,
      realtimeOrders: true
    });
    expect(cached.hours.weekly[0]).toEqual({
      weekday: 1,
      isOpen: true,
      opensAt: '09:00',
      closesAt: '18:00'
    });
    expect(cached.hours.exceptions[0]).toEqual({
      date: '2026-12-25',
      isOpen: false,
      opensAt: null,
      closesAt: null,
      reason: 'Navidad'
    });

    const serialized = JSON.stringify(cached);
    expect(serialized).not.toMatch(
      /Private customer|9610000000|Private address|private-key|discard-me|customerPhone|token|license|staff/
    );
    expect(cached).not.toHaveProperty('checkout');
  });

  it('rejects malformed portals and does not cross slugs', async () => {
    const cache = createCache('public-cache-portal-isolation');
    expect(await cache.putPortal({
      slug: 'tienda-a',
      result: portalResult('tienda-a')
    })).toBe(true);
    expect(await cache.getPortal({ slug: 'tienda-b' })).toBeNull();
    expect(await cache.putPortal({
      slug: 'tienda',
      result: { portal: { name: 'Sin slug' }, catalogRevision: 1 }
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
