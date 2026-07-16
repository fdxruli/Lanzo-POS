// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPublicProductConfigurationCacheKey,
  dedupePublicProductConfigurationRequest,
  deleteObsoletePublicProductConfigurations,
  getCachedPublicProductConfiguration,
  putCachedPublicProductConfiguration
} from '../ecommercePublicConfigurationCache';

beforeEach(() => { sessionStorage.clear(); });

describe('ecommercePublicConfigurationCache', () => {
  it('keys configuration by slug, product, catalog revision and configuration version', () => {
    expect(buildPublicProductConfigurationCacheKey({ slug: ' Mi Tienda ', productId: 'p1', catalogRevision: 3, configurationVersion: 7 }))
      .toContain('mi%20tienda:p1:3:7');
  });

  it('stores a clone and returns fresh cached configuration', () => {
    const key = buildPublicProductConfigurationCacheKey({ slug: 'store', productId: 'p1', catalogRevision: 3, configurationVersion: 7 });
    const value = { product: { id: 'p1' } };
    expect(putCachedPublicProductConfiguration(key, value, 1000)).toBe(true);
    value.product.id = 'mutated';
    expect(getCachedPublicProductConfiguration(key, { now: 1100 }).value.product.id).toBe('p1');
  });

  it('does not serve stale detail as fresh', () => {
    const key = buildPublicProductConfigurationCacheKey({ slug: 'store', productId: 'p1', catalogRevision: 3, configurationVersion: 7 });
    putCachedPublicProductConfiguration(key, { product: { id: 'p1' } }, 1000);
    expect(getCachedPublicProductConfiguration(key, { now: 1000 + 301000 })).toBeNull();
  });

  it('deduplicates concurrent requests', async () => {
    const factory = vi.fn(async () => 'ok');
    const [left, right] = await Promise.all([
      dedupePublicProductConfigurationRequest('same', factory),
      dedupePublicProductConfigurationRequest('same', factory)
    ]);
    expect([left, right]).toEqual(['ok', 'ok']);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('invalidates obsolete revisions and versions', () => {
    const oldKey = buildPublicProductConfigurationCacheKey({ slug: 'store', productId: 'p1', catalogRevision: 2, configurationVersion: 6 });
    const keepKey = buildPublicProductConfigurationCacheKey({ slug: 'store', productId: 'p1', catalogRevision: 3, configurationVersion: 7 });
    putCachedPublicProductConfiguration(oldKey, { old: true });
    putCachedPublicProductConfiguration(keepKey, { keep: true });
    deleteObsoletePublicProductConfigurations({ slug: 'store', productId: 'p1', keepCatalogRevision: 3, keepConfigurationVersion: 7 });
    expect(getCachedPublicProductConfiguration(oldKey, { allowStale: true })).toBeNull();
    expect(getCachedPublicProductConfiguration(keepKey, { allowStale: true })?.value).toEqual({ keep: true });
  });
});
