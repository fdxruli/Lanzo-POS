import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, STORES } from '../../db/dexie';
import { POS_SYNC_STORES } from '../../sync/syncConstants';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { addInventoryEntry } from '../inventoryEntryService';
vi.mock('../../auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_ERROR_CODES: { CONTEXT_STALE: 'ACTOR_CONTEXT_STALE' },
  ActorRuntimeError: class ActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  },
  actorRuntimeController: {
    subscribe: vi.fn(),
    capture: vi.fn(() => ({
      actorType: 'admin',
      actorId: 'admin-test',
      actorKey: 'admin:admin-test',
      generation: 1,
      assertCurrent: vi.fn()
    }))
  }
}));

const product = (overrides = {}) => ({
  id: 'product-1', name: 'Producto', stock: 10, cost: 4, price: 12,
  trackStock: true, isActive: true, batchManagement: { enabled: false }, ...overrides
});

describe('inventoryEntryService', () => {
  beforeEach(async () => {
    await openTestTenantRuntime();
  });

  afterEach(() => {
    closeTestTenantRuntime();
  });

  it('applies a non-batch delta once and writes one event and outbox row', async () => {
    await db.table(STORES.MENU).put(product());
    const first = await addInventoryEntry({ operationId: 'entry-non-batch', productId: 'product-1', quantity: 5, baseQuantity: 5 });
    const retry = await addInventoryEntry({ operationId: 'entry-non-batch', productId: 'product-1', quantity: 5, baseQuantity: 5 });

    expect(first.newStock).toBe(15);
    expect(retry.duplicate).toBe(true);
    expect((await db.table(STORES.MENU).get('product-1')).stock).toBe(15);
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(1);
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(1);
  });

  it('rejects a reused operation id with a different payload', async () => {
    await db.table(STORES.MENU).put(product());
    await addInventoryEntry({ operationId: 'entry-mismatch', productId: 'product-1', quantity: 5, baseQuantity: 5 });
    await expect(addInventoryEntry({ operationId: 'entry-mismatch', productId: 'product-1', quantity: 7, baseQuantity: 7 }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  });

  it('updates only the selected batch and recalculates the parent projection', async () => {
    await db.table(STORES.MENU).put(product({ stock: 15, batchManagement: { enabled: true } }));
    await db.table(STORES.PRODUCT_BATCHES).bulkPut([
      { id: 'batch-a', productId: 'product-1', stock: 10, cost: 4, isActive: true, status: 'active' },
      { id: 'batch-b', productId: 'product-1', stock: 5, cost: 6, isActive: true, status: 'active' }
    ]);

    await addInventoryEntry({ operationId: 'entry-batch', productId: 'product-1', batchId: 'batch-a', quantity: 4, baseQuantity: 4 });

    expect((await db.table(STORES.PRODUCT_BATCHES).get('batch-a')).stock).toBe(14);
    expect((await db.table(STORES.PRODUCT_BATCHES).get('batch-b')).stock).toBe(5);
    expect((await db.table(STORES.MENU).get('product-1')).stock).toBe(19);
  });

  it('rejects entries when stock tracking is disabled', async () => {
    await db.table(STORES.MENU).put(product({ trackStock: false }));

    await expect(addInventoryEntry({
      operationId: 'entry-tracking-disabled', productId: 'product-1', quantity: 1, baseQuantity: 1
    })).rejects.toMatchObject({ code: 'STOCK_TRACKING_DISABLED' });
  });

  it.each([0, -1])('rejects an invalid positive-only quantity: %s', async (quantity) => {
    await db.table(STORES.MENU).put(product());
    await expect(addInventoryEntry({ productId: 'product-1', quantity, baseQuantity: quantity }))
      .rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  });
});
