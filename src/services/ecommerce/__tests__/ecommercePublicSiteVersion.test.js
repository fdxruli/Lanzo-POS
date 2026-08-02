// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEcommercePublicCatalogCache, createEcommercePublicCatalogDatabase } from '../ecommercePublicCatalogCache';
import { createEcommercePublicService } from '../ecommercePublicService';

const databases = [];

const createLegacyV1DocumentFixture = () => ({
  schemaVersion: 1,
  global: { themeSource: 'portal', contentWidth: 'standard', density: 'comfortable' },
  sections: [
    { id: 'header-main', type: 'header', enabled: true, layout: 'default', props: { contentSource: 'portal' } },
    { id: 'catalog-main', type: 'catalog', enabled: true, layout: 'grid', props: { showSearch: false, showCategories: true } },
    { id: 'footer-main', type: 'footer', enabled: true, layout: 'lanzo', props: { contentSource: 'lanzo' } }
  ]
});

const createV2DocumentFixture = () => ({
  schemaVersion: 2,
  global: {
    contentWidth: 'standard', density: 'compact',
    appearance: {
      templateCode: 'compact',
      theme: { primaryColor: '#112233', secondaryColor: '#445566', cornerStyle: 'soft', fontStyle: 'editorial' },
      branding: { logoUrl: 'https://cdn.example/logo.png', coverImageUrl: 'https://cdn.example/cover.png' }
    }
  },
  sections: [
    { id: 'header-main', type: 'header', enabled: true, layout: 'default', props: { contentSource: 'portal' } },
    { id: 'catalog-main', type: 'catalog', enabled: true, layout: 'compact', props: { showSearch: true, showCategories: false } },
    { id: 'footer-main', type: 'footer', enabled: true, layout: 'lanzo', props: { contentSource: 'lanzo' } }
  ]
});

const siteResponse = ({ schemaVersion, versionId, versionNumber, documentMode, document }) => ({
  success: true,
  portal: { slug: 'mi-tienda', name: 'Mi tienda', templateCode: 'compact', maxOrderItems: 30, maxItemQuantity: 99 },
  hours: { weekly: [], exceptions: [] }, features: { orderInbox: true }, catalogRevision: 41,
  site: { schemaVersion, versionId, versionNumber, documentMode, document },
  cachePolicy: { schemaVersion, freshSeconds: 300, maxStaleSeconds: 86400 }
});

const createService = (rpc, name, publicPortalRpcName = 'ecommerce_get_portal_by_slug_v2') => {
  const database = createEcommercePublicCatalogDatabase(name);
  databases.push(database);
  const cache = createEcommercePublicCatalogCache({ database });
  return { database, service: createEcommercePublicService({ rpc }, { cache, publicPortalRpcName }) };
};

const waitForCachedPortal = async (database) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await database.table('portals').count()) > 0) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error('Portal was not cached');
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => { database.close(); await database.delete(); }));
});

describe('public site version identity and cache', () => {
  it('keeps the explicit legacy v1 RPC contract and cache entry unchanged', async () => {
    const document = createLegacyV1DocumentFixture(); let online = true;
    const rpc = vi.fn(async (name) => {
      expect(name).toBe('ecommerce_get_portal_by_slug');
      return online ? { data: siteResponse({ schemaVersion: 1, versionId: '11111111-1111-4111-8111-111111111111', versionNumber: 1, documentMode: 'custom', document }), error: null } : { data: null, error: { code: 'NETWORK' } };
    });
    const { database, service } = createService(rpc, 'public-site-version-v1', 'ecommerce_get_portal_by_slug');
    const network = await service.getPublicPortalBySlug('mi-tienda');
    expect(network.site).toEqual({ schemaVersion: 1, versionId: '11111111-1111-4111-8111-111111111111', versionNumber: 1, documentMode: 'custom', document });
    await waitForCachedPortal(database); online = false;
    expect((await service.getPublicPortalBySlug('mi-tienda')).site).toEqual(network.site);
  });

  it('uses the v2 RPC and preserves visual identity, version and the exact cached document', async () => {
    const document = createV2DocumentFixture(); let online = true;
    const rpc = vi.fn(async (name) => {
      expect(name).toBe('ecommerce_get_portal_by_slug_v2');
      return online ? { data: siteResponse({ schemaVersion: 2, versionId: '22222222-2222-4222-8222-222222222222', versionNumber: 2, documentMode: 'custom', document }), error: null } : { data: null, error: { code: 'NETWORK' } };
    });
    const { database, service } = createService(rpc, 'public-site-version-v2');
    const network = await service.getPublicPortalBySlug('mi-tienda');
    expect(network.site).toEqual({ schemaVersion: 2, versionId: '22222222-2222-4222-8222-222222222222', versionNumber: 2, documentMode: 'custom', document });
    expect(network.site.document.global.appearance.branding.logoUrl).toBe('https://cdn.example/logo.png');
    await waitForCachedPortal(database); online = false;
    expect((await service.getPublicPortalBySlug('mi-tienda')).site).toEqual(network.site);
  });

  it('invalidates a changed site version without changing catalogRevision', async () => {
    let current = siteResponse({ schemaVersion: 2, versionId: '11111111-1111-4111-8111-111111111111', versionNumber: 1, documentMode: 'custom', document: createV2DocumentFixture() });
    const rpc = vi.fn(async () => ({ data: current, error: null }));
    const { service } = createService(rpc, 'public-site-version-change');
    const first = await service.getPublicPortalBySlug('mi-tienda');
    const nextDocument = createV2DocumentFixture(); nextDocument.global.appearance.branding.coverImageUrl = null;
    current = siteResponse({ schemaVersion: 2, versionId: '22222222-2222-4222-8222-222222222222', versionNumber: 2, documentMode: 'default', document: nextDocument });
    const second = await service.getPublicPortalBySlug('mi-tienda');
    expect(second.catalogRevision).toBe(first.catalogRevision);
    expect(second.site.versionId).not.toBe(first.site.versionId);
    expect(second.site.document).toEqual(nextDocument);
  });
});
