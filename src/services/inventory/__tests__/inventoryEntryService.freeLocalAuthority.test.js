import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, STORES } from '../../db/dexie';
import { POS_SYNC_STORES } from '../../sync/syncConstants';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';

const mocks = vi.hoisted(() => {
  class TestActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }

  return {
    TestActorRuntimeError,
    actorCapture: vi.fn(),
    state: null
  };
});

vi.mock('../../auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_ERROR_CODES: {
    CONTEXT_LOCKED: 'ACTOR_CONTEXT_LOCKED',
    CONTEXT_STALE: 'ACTOR_CONTEXT_STALE'
  },
  ActorRuntimeError: mocks.TestActorRuntimeError,
  actorRuntimeController: {
    capture: mocks.actorCapture,
    assertGranted: vi.fn(() => { throw new mocks.TestActorRuntimeError('ACTOR_CONTEXT_LOCKED'); })
  }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => mocks.state }
}));

import { addInventoryEntry } from '../inventoryEntryService';

const freeLicense = () => ({
  license_key: 'LANZO-FREE-INVENTORY',
  valid: true,
  plan_code: 'free_trial',
  max_devices: 1,
  device_role: 'admin',
  features: {
    cloud_pos_sync: false,
    cloud_products_sync: false,
    staff_roles: false
  }
});

const strictProduct = () => ({
  id: 'product-free-strict',
  name: 'Producto con caducidad',
  stock: 0,
  cost: 10,
  price: 25,
  trackStock: true,
  isActive: true,
  expirationMode: 'STRICT',
  batchManagement: { enabled: true }
});

describe('inventoryEntryService FREE/local authority', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.state = {
      appStatus: 'ready',
      licenseDetails: freeLicense(),
      currentDeviceRole: 'admin',
      currentAdminUser: null,
      currentStaffUser: null
    };
    mocks.actorCapture.mockImplementation(() => {
      throw new mocks.TestActorRuntimeError('ACTOR_CONTEXT_LOCKED');
    });
    await openTestTenantRuntime();
  });

  afterEach(() => {
    closeTestTenantRuntime();
  });

  it('applies and deduplicates a STRICT FREE inventory entry without actor-bound outbox', async () => {
    await db.table(STORES.MENU).put(strictProduct());

    const request = {
      operationId: 'free-local-entry-strict',
      productId: 'product-free-strict',
      quantity: 5,
      baseQuantity: 5,
      unitCost: 11,
      manufacturerBatchId: 'FAB-FREE-001',
      expiryDate: '2027-01-31'
    };

    const first = await addInventoryEntry(request);
    const retry = await addInventoryEntry(request);

    expect(first).toMatchObject({ success: true, pending: false, previousStock: 0, newStock: 5 });
    expect(retry).toMatchObject({ success: true, pending: false, duplicate: true, newStock: 5 });
    expect((await db.table(STORES.MENU).get('product-free-strict')).stock).toBe(5);

    const batches = await db.table(STORES.PRODUCT_BATCHES).where('productId').equals('product-free-strict').toArray();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      stock: 5,
      manufacturerBatchId: 'FAB-FREE-001',
      expiryDate: '2027-01-31'
    });

    const event = await db.table(STORES.INVENTORY_EVENTS).get('inventory-entry:free-local-entry-strict');
    expect(event).toMatchObject({
      synced: true,
      syncDisposition: 'local_only',
      result: { pending: false, newStock: 5 }
    });
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(0);
    expect(mocks.actorCapture).not.toHaveBeenCalled();
  });
});
