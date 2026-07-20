// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEcommercePublicCatalogCache,
  createEcommercePublicCatalogDatabase
} from '../ecommercePublicCatalogCache';
import { createEcommercePublicService } from '../ecommercePublicService';
import { createDefaultEcommerceSiteDocument } from '../../../utils/ecommerceSiteDocument';

const databases = [];

const siteResponse = ({ versionId, versionNumber, documentMode, document, templateCode = 'classic' }) => ({
  success: true,
  portal: {
    slug: 'mi-tienda',
    name: 'Mi tienda',
    templateCode,
    maxOrderItems: 30,
    maxItemQuantity: 99
  },
  hours: { weekly: [], exceptions: [] },
  features: { orderInbox: true },
  catalogRevision: 41,
  site: {
    schemaVersion: 1,
    versionId,
    versionNumber,
    documentMode,
    document
  },
  cachePolicy: { schemaVersion: 1, freshSeconds: 300, maxStaleSeconds: 86400 }
});

const createService = (rpc, name) => {
  const database = createEcommercePublicCatalogDatabase(name);
  databases.push(database);
  const cache = createEcommercePublicCatalogCache({ database });
  return { database, service: createEcommercePublicService({ rpc }, { cache }) };
};

const waitForCachedPortal = async (database) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await database.table('portals').count()) > 0) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error('Portal was not cached');
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe('public site version identity and cache', () => {
  it('preserves version id, number, mode and the exact document in network and cache results', async () => {
    const v1Document = createDefaultEcommerceSiteDocument({ templateCode: 'classic' });
    v1Document.sections[1].props.showSearch = false;
    let online = true;
    const rpc = vi.fn(async (name) => {
      if (name !== 'ecommerce_get_portal_by_slug') throw new Error(`Unexpected RPC ${name}`);
      if (!online) return { data: null, error: { code: 'NETWORK' } };
      return {
        data: siteResponse({
          versionId: '11111111-1111-4111-8111-111111111111',
          versionNumber: 1,
          documentMode: 'custom',
          document: v1Document,
          templateCode: 'compact'
        }),
        error: null
      };
    });
    const { database, service } = createService(rpc, 'public-site-version-v1');

    const network = await service.getPublicPortalBySlug('mi-tienda');
    expect(network.catalogRevision).toBe(41);
    expect(network.site).toEqual({
      schemaVersion: 1,
      versionId: '11111111-1111-4111-8111-111111111111',
      versionNumber: 1,
      documentMode: 'custom',
      document: v1Document
    });

    await waitForCachedPortal(database);
    online = false;
    const cached = await service.getPublicPortalBySlug('mi-tienda');
    expect(cached.offline).toBe(true);
    expect(cached.catalogRevision).toBe(41);
    expect(cached.site).toEqual(network.site);
  });

  it('updates the site version without coupling it to catalogRevision', async () => {
    const v1Document = createDefaultEcommerceSiteDocument({ templateCode: 'classic' });
    v1Document.sections[1].props.showCategories = false;
    const v2Document = createDefaultEcommerceSiteDocument({ templateCode: 'classic' });
    let current = siteResponse({
      versionId: '11111111-1111-4111-8111-111111111111',
      versionNumber: 1,
      documentMode: 'custom',
      document: v1Document
    });
    const rpc = vi.fn(async () => ({ data: current, error: null }));
    const { service } = createService(rpc, 'public-site-version-v2');

    const v1 = await service.getPublicPortalBySlug('mi-tienda');
    current = siteResponse({
      versionId: '22222222-2222-4222-8222-222222222222',
      versionNumber: 2,
      documentMode: 'default',
      document: v2Document
    });
    const v2 = await service.getPublicPortalBySlug('mi-tienda');

    expect(v1.catalogRevision).toBe(41);
    expect(v2.catalogRevision).toBe(41);
    expect(v2.site.versionId).not.toBe(v1.site.versionId);
    expect(v2.site.versionNumber).toBe(2);
    expect(v2.site.documentMode).toBe('default');
    expect(v2.site.document).toEqual(v2Document);
  });
});
