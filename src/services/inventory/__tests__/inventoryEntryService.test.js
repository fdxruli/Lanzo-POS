import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, STORES } from '../../db/dexie';
import { POS_SYNC_STORES } from '../../sync/syncConstants';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { addInventoryEntry } from '../inventoryEntryService';
vi.mock('../../auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: {
    LOCKED: 'locked', AUTHENTICATING: 'authenticating', HANDOFF_CHECK: 'handoff_check', GRANTED: 'granted'
  },
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
    getState: vi.fn(() => ({
      status: 'granted', actorType: 'admin', actorId: 'admin-test',
      actorKey: 'admin:admin-test', generation: 1
    })),
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


const medicine = (overrides = {}) => product({
  stock: 0, expirationMode: 'STRICT', batchManagement: { enabled: true },
  metadata: { pharmacy: { version: 1, kind: 'medicine', fraction: 'IV', status: 'confirmed', antibiotic: true } },
  ...overrides
});

const pharmacyEntry = ({ operationId, batchId = null, quantity, invoice, manufacturerBatchId = null, expiryDate = null }) => ({
  operationId, productId: 'product-1', batchId, quantity, baseQuantity: quantity,
  inputUnit: 'caja', baseUnit: 'caja', supplier: 'Distribuidora QA',
  manufacturerBatchId, expiryDate, occurredAt: '2026-11-11T14:00:00.000Z',
  metadata: {
    pharmacyReceipt: {
      version: 1, supplier: 'Distribuidora QA', documentType: 'factura',
      documentReference: invoice, receivedAt: '2026-11-11T14:00:00.000Z'
    }
  }
});

describe('pharmacy stage 2 - local reception', () => {
  beforeEach(async () => { await openTestTenantRuntime(); });
  afterEach(() => { closeTestTenantRuntime(); });

  it('stores separate documentary evidence for two receipts of the same lot and no duplicate on retry', async () => {
    await db.table(STORES.MENU).put(medicine());
    const first = pharmacyEntry({
      operationId: 'pharma-first', quantity: 10, invoice: 'FAC-QA-001',
      manufacturerBatchId: 'AMX-QA-2026-A', expiryDate: '2027-10-31'
    });
    const received = await addInventoryEntry(first);
    const second = pharmacyEntry({
      operationId: 'pharma-second', batchId: received.batch.id, quantity: 5, invoice: 'FAC-QA-002'
    });
    await addInventoryEntry(second);
    const retry = await addInventoryEntry(second);
    expect(retry.duplicate).toBe(true);

    const currentBatch = await db.table(STORES.PRODUCT_BATCHES).get(received.batch.id);
    expect(currentBatch.stock).toBe(15);
    expect(currentBatch.manufacturerBatchId).toBe('AMX-QA-2026-A');
    expect((await db.table(STORES.MENU).get('product-1')).stock).toBe(15);
    const events = await db.table(STORES.INVENTORY_EVENTS).where('productId').equals('product-1').toArray();
    expect(events).toHaveLength(2);
    expect(events.map((item) => item.metadata.pharmacyReceipt.documentReference).sort())
      .toEqual(['FAC-QA-001', 'FAC-QA-002']);
    expect(events.every((item) => item.supplier === 'Distribuidora QA' && item.originActor)).toBe(true);
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(2);
    const outbox = await db.table(POS_SYNC_STORES.OUTBOX).toArray();
    expect(outbox.map((item) => JSON.stringify(item)).join(' ')).toContain('FAC-QA-002');
  });

  it('projects independent batches and preserves the earlier expiry date', async () => {
    await db.table(STORES.MENU).put(medicine());
    const first = await addInventoryEntry(pharmacyEntry({
      operationId: 'pharma-a', quantity: 10, invoice: 'FAC-QA-001',
      manufacturerBatchId: 'AMX-QA-2026-A', expiryDate: '2027-10-31'
    }));
    const second = await addInventoryEntry(pharmacyEntry({
      operationId: 'pharma-b', quantity: 8, invoice: 'FAC-QA-003',
      manufacturerBatchId: 'AMX-QA-2026-B', expiryDate: '2027-04-30'
    }));
    expect(first.batch.id).not.toBe(second.batch.id);
    expect((await db.table(STORES.MENU).get('product-1')).stock).toBe(18);
    expect((await db.table(STORES.PRODUCT_BATCHES).get(second.batch.id)).expiryDate).toBe('2027-04-30');
  });

  it('rejects missing evidence, expired lots and duplicate manufacturer identities', async () => {
    await db.table(STORES.MENU).put(medicine());
    const entry = pharmacyEntry({
      operationId: 'pharma-check', quantity: 10, invoice: 'FAC-QA-001',
      manufacturerBatchId: 'AMX-QA-2026-A', expiryDate: '2027-10-31'
    });
    await expect(addInventoryEntry({ ...entry, metadata: {} }))
      .rejects.toMatchObject({ code: 'PHARMACY_PROVENANCE_REQUIRED' });
    await expect(addInventoryEntry({ ...entry, expiryDate: '2020-01-01' }))
      .rejects.toMatchObject({ code: 'PHARMACY_EXPIRED_BATCH' });
    await addInventoryEntry(entry);
    await expect(addInventoryEntry({ ...entry, operationId: 'pharma-duplicate', metadata: {
      pharmacyReceipt: { ...entry.metadata.pharmacyReceipt, documentReference: 'FAC-QA-002' }
    } })).rejects.toMatchObject({ code: 'PHARMACY_EXISTING_BATCH_REQUIRED' });
    expect((await db.table(STORES.MENU).get('product-1')).stock).toBe(10);
  });

  it('rejects unsupported special fractions and medicine without batch management', async () => {
    const entry = pharmacyEntry({
      operationId: 'pharma-special', quantity: 1, invoice: 'FAC-QA-001',
      manufacturerBatchId: 'AMX-QA-2026-A', expiryDate: '2027-10-31'
    });
    await db.table(STORES.MENU).put(medicine({
      metadata: { pharmacy: { kind: 'medicine', fraction: 'II', status: 'confirmed', antibiotic: false } }
    }));
    await expect(addInventoryEntry(entry)).rejects.toMatchObject({
      code: 'PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE'
    });
    await db.table(STORES.MENU).put(medicine({ batchManagement: { enabled: false } }));
    await expect(addInventoryEntry(entry)).rejects.toMatchObject({ code: 'PHARMACY_BATCHES_REQUIRED' });
  });

  it('adds concurrent local receipts without lost updates', async () => {
    await db.table(STORES.MENU).put(medicine());
    const first = await addInventoryEntry(pharmacyEntry({
      operationId: 'pharma-create', quantity: 10, invoice: 'FAC-QA-001',
      manufacturerBatchId: 'AMX-QA-2026-A', expiryDate: '2027-10-31'
    }));
    await Promise.all([
      addInventoryEntry(pharmacyEntry({
        operationId: 'pharma-concurrent-a', batchId: first.batch.id, quantity: 5, invoice: 'FAC-QA-002'
      })),
      addInventoryEntry(pharmacyEntry({
        operationId: 'pharma-concurrent-b', batchId: first.batch.id, quantity: 3, invoice: 'FAC-QA-003'
      }))
    ]);
    expect((await db.table(STORES.PRODUCT_BATCHES).get(first.batch.id)).stock).toBe(18);
    expect((await db.table(STORES.MENU).get('product-1')).stock).toBe(18);
  });
});
