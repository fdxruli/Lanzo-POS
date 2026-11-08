import { beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  saveSnapshot: vi.fn()
}));

vi.mock('../reportsCacheService', () => ({ reportsCacheService: cache }));

import { withCacheFallback } from '../reportsRepository';

describe('reportsRepository cache fallback', () => {
  beforeEach(() => {
    cache.getSnapshot.mockReset().mockResolvedValue(null);
    cache.saveSnapshot.mockReset().mockResolvedValue(null);
  });

  it('does not cache an explicit RPC failure or expose its zero values', async () => {
    const result = await withCacheFallback({
      reportType: 'overview',
      reportMode: { online: true },
      loader: async () => ({ success: false, overview: { net_sales_total: 0 } }),
      mapper: (payload) => ({ ...payload, success: payload.success !== false }),
      localFallback: async () => ({ success: true, overview: { net_sales_total: 12 } })
    });

    expect(cache.saveSnapshot).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      overview: { net_sales_total: 12 },
      source: { mode: 'mixed' }
    });
  });

  it('ignores an explicitly failed cached snapshot before using local fallback', async () => {
    cache.getSnapshot.mockResolvedValue({
      payload: { success: false, overview: { net_sales_total: 0 } }
    });

    const result = await withCacheFallback({
      reportType: 'overview',
      reportMode: { online: false },
      mapper: (payload) => ({ ...payload, success: payload.success !== false }),
      localFallback: async () => ({ success: true, overview: { net_sales_total: 0 } })
    });

    expect(result).toMatchObject({
      success: true,
      overview: { net_sales_total: 0 },
      source: { mode: 'local', stale: false }
    });
  });

  it('does not substitute local sales for a Cloud history request when no authorized snapshot is available', async () => {
    const localFallback = vi.fn(async () => ({ rows: [{ id: 'local-only-sale' }] }));

    await expect(withCacheFallback({
      reportType: 'sales_final_history',
      cacheEnabled: false,
      allowLocalFallback: false,
      reportMode: { online: true },
      loader: async () => { throw new Error('CLOUD_UNAVAILABLE'); },
      mapper: (payload) => payload,
      localFallback
    })).rejects.toThrow('CLOUD_UNAVAILABLE');

    expect(localFallback).not.toHaveBeenCalled();
  });

  it('reports an unavailable scoped snapshot offline instead of showing local sales under Cloud scope', async () => {
    const localFallback = vi.fn(async () => ({ rows: [{ id: 'local-only-sale' }] }));

    await expect(withCacheFallback({
      reportType: 'sales_final_history',
      cacheEnabled: false,
      allowLocalFallback: false,
      reportMode: { online: false },
      mapper: (payload) => payload,
      localFallback
    })).rejects.toThrow('REPORT_CACHE_UNAVAILABLE');

    expect(localFallback).not.toHaveBeenCalled();
  });
});
