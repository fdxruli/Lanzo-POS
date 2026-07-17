import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ecommerceCatalogHydrationInternals,
  hydrateEcommerceCatalogSnapshot,
  syncEcommerceCatalogAfterHydration
} from '../ecommerceCatalogHydration';

describe('ecommerce catalog hydration', () => {
  beforeEach(() => {
    ecommerceCatalogHydrationInternals.clear();
    vi.restoreAllMocks();
  });

  it('waits for the full cloud snapshot before reconciling ecommerce', async () => {
    let resolveSnapshot;
    const migrationService = {
      pullFullSnapshot: vi.fn().mockReturnValue(new Promise((resolve) => {
        resolveSnapshot = resolve;
      }))
    };
    const syncService = { syncNow: vi.fn().mockResolvedValue({ success: true }) };

    const pending = syncEcommerceCatalogAfterHydration({
      licenseKey: 'PRO-LICENSE',
      request: { reason: 'runtime-context-ready' },
      forceHydration: true,
      migrationService,
      syncService
    });

    expect(syncService.syncNow).not.toHaveBeenCalled();
    resolveSnapshot({ success: true, applied: 12 });
    await pending;

    expect(migrationService.pullFullSnapshot).toHaveBeenCalledWith({
      licenseKey: 'PRO-LICENSE'
    });
    expect(syncService.syncNow).toHaveBeenCalledWith({
      reason: 'runtime-context-ready',
      fullReconcile: true
    });
  });

  it('skips the cloud product snapshot when cloud products sync is disabled', async () => {
    const migrationService = {
      pullFullSnapshot: vi.fn()
    };

    const result = await hydrateEcommerceCatalogSnapshot({
      licenseKey: 'FREE-LICENSE',
      force: true,
      hydrateCloudCatalog: false,
      migrationService
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      reason: 'cloud_products_sync_disabled'
    });
    expect(migrationService.pullFullSnapshot).not.toHaveBeenCalled();
  });

  it('reconciles ecommerce from the local catalog when cloud hydration is disabled', async () => {
    const migrationService = {
      pullFullSnapshot: vi.fn()
    };
    const syncService = {
      syncNow: vi.fn().mockResolvedValue({ success: true, source: 'indexeddb' })
    };

    const result = await syncEcommerceCatalogAfterHydration({
      licenseKey: 'FREE-LICENSE',
      request: { reason: 'runtime-context-ready' },
      forceHydration: true,
      hydrateCloudCatalog: false,
      migrationService,
      syncService
    });

    expect(migrationService.pullFullSnapshot).not.toHaveBeenCalled();
    expect(syncService.syncNow).toHaveBeenCalledWith({
      reason: 'runtime-context-ready',
      fullReconcile: true
    });
    expect(result).toMatchObject({ success: true, source: 'indexeddb' });
  });

  it('deduplicates concurrent hydration for the same license', async () => {
    const migrationService = {
      pullFullSnapshot: vi.fn().mockResolvedValue({ success: true, applied: 4 })
    };

    const [left, right] = await Promise.all([
      hydrateEcommerceCatalogSnapshot({
        licenseKey: 'PRO-LICENSE',
        force: true,
        migrationService
      }),
      hydrateEcommerceCatalogSnapshot({
        licenseKey: 'PRO-LICENSE',
        force: true,
        migrationService
      })
    ]);

    expect(left.success).toBe(true);
    expect(right.success).toBe(true);
    expect(migrationService.pullFullSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile stale local data when hydration fails', async () => {
    const migrationService = {
      pullFullSnapshot: vi.fn().mockResolvedValue({
        success: false,
        code: 'PRODUCT_SNAPSHOT_FAILED'
      })
    };
    const syncService = { syncNow: vi.fn() };

    const result = await syncEcommerceCatalogAfterHydration({
      licenseKey: 'PRO-LICENSE',
      forceHydration: true,
      migrationService,
      syncService
    });

    expect(result).toMatchObject({
      success: false,
      code: 'PRODUCT_SNAPSHOT_FAILED',
      retryable: true
    });
    expect(syncService.syncNow).not.toHaveBeenCalled();
  });

  it('skips reconciliation when the runtime context changes during hydration', async () => {
    const migrationService = {
      pullFullSnapshot: vi.fn().mockResolvedValue({ success: true })
    };
    const syncService = { syncNow: vi.fn() };

    const result = await syncEcommerceCatalogAfterHydration({
      licenseKey: 'PRO-LICENSE',
      forceHydration: true,
      shouldContinue: () => false,
      migrationService,
      syncService
    });

    expect(result).toMatchObject({ skipped: true, reason: 'context_changed' });
    expect(syncService.syncNow).not.toHaveBeenCalled();
  });
});
