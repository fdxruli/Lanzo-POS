import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRestaurantActiveTables } from '../restaurantActiveTables';
import { recoverRestaurantFalseTerminalMarker } from '../restaurantTerminalStateRecovery';

const SALE_ID = 'table-a';
const PARENT_ID = 'cloud-parent-a';
const LICENSE = 'license-a';
const TENANT = 'tenant-a';
const TIME_2 = '2026-10-05T11:00:00.000Z';
const TIME_3 = '2026-10-05T12:00:00.000Z';

const sale = (overrides = {}) => ({
  id: SALE_ID,
  localOrderId: SALE_ID,
  status: 'open',
  paymentStatus: 'unpaid',
  licenseKey: LICENSE,
  tenantOpaqueId: TENANT,
  restaurantOrderId: PARENT_ID,
  cloudRestaurantOrderUpdatedAt: TIME_2,
  cloudRestaurantOrderServerVersion: 2,
  restaurantCloudTerminalState: 'terminal',
  restaurantCloudTerminalPaymentStatus: 'unpaid',
  cloudRestaurantTerminalUpdatedAt: TIME_2,
  cloudRestaurantTerminalServerVersion: 2,
  total: '42.50',
  subtotal: '42.50',
  saleId: 'sale-id-a',
  items: [{ id: 'product-a', lineId: 'line-a', price: '42.50', quantity: 1 }],
  reservations: [{ batchId: 'batch-a', quantity: 2 }],
  ...overrides
});

const cloud = (overrides = {}) => ({
  id: PARENT_ID,
  localOrderId: SALE_ID,
  saleId: SALE_ID,
  licenseKey: LICENSE,
  restaurantCloudLicenseKey: LICENSE,
  tenantOpaqueId: TENANT,
  restaurantCloudTenantId: TENANT,
  status: 'delivered',
  fulfillmentStatus: 'delivered',
  paymentStatus: 'unpaid',
  serverVersion: 3,
  updatedAt: TIME_3,
  ...overrides
});

describe('safe recovery of legacy false restaurant terminal markers', () => {
  let database;
  let actorHandle;
  let repository;
  let current;

  beforeEach(async () => {
    current = true;
    database = new Dexie(`restaurant-terminal-recovery-${crypto.randomUUID()}`);
    database.version(1).stores({ sales: 'id', menu: 'id', batches: 'id' });
    await database.open();
    await database.table('menu').put({ id: 'product-a', stock: 20, committedStock: 4 });
    await database.table('batches').put({ id: 'batch-a', stock: 10, committedStock: 2 });
    actorHandle = {
      tenant: { opaqueId: TENANT, databaseName: 'tenant_db_a', generation: 4 },
      actorKey: 'owner:actor-a',
      sessionId: 'session-a',
      assertCurrent: () => {
        if (!current) throw Object.assign(new Error('actor changed'), { code: 'ACTOR_CONTEXT_STALE' });
      }
    };
    repository = { getRestaurantOrderByLocalOrder: vi.fn(async () => ({
      success: true, found: true, order: cloud()
    })) };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.delete();
  });

  const recover = (overrides = {}) => recoverRestaurantFalseTerminalMarker({
    licenseKey: LICENSE,
    localOrderId: SALE_ID,
    actorHandle,
    repository,
    database,
    stores: { SALES: 'sales' },
    ...overrides
  });

  it('recovers a delivered unpaid sale atomically and leaves all sale and reservation data intact', async () => {
    const original = sale();
    await database.table('sales').put(original);

    const result = await recover();

    expect(result).toMatchObject({ success: true, recovered: true, code: 'RECOVERED' });
    const persisted = await database.table('sales').get(SALE_ID);
    for (const field of ['restaurantCloudTerminalState', 'restaurantCloudTerminalPaymentStatus',
      'cloudRestaurantTerminalUpdatedAt', 'cloudRestaurantTerminalServerVersion']) {
      expect(persisted[field]).toBeUndefined();
    }
    expect(persisted).toMatchObject({
      id: SALE_ID, localOrderId: SALE_ID, status: 'open', paymentStatus: 'unpaid',
      saleId: 'sale-id-a', items: original.items, total: original.total, subtotal: original.subtotal,
      reservations: original.reservations, cloudRestaurantOrderServerVersion: 2,
      cloudRestaurantOrderUpdatedAt: TIME_2
    });
    expect(repository.getRestaurantOrderByLocalOrder).toHaveBeenCalledExactlyOnceWith({
      licenseKey: LICENSE, localOrderId: SALE_ID, force: true
    });
    expect(await database.table('menu').get('product-a')).toEqual({ id: 'product-a', stock: 20, committedStock: 4 });
    expect(await database.table('batches').get('batch-a')).toEqual({ id: 'batch-a', stock: 10, committedStock: 2 });
    expect(buildRestaurantActiveTables({ localSales: [persisted], cloudOrders: [cloud()], cloudEnabled: true }))
      .toMatchObject([{ id: SALE_ID, paymentStatus: 'unpaid', fulfillmentStatus: 'delivered' }]);
  });

  it('is idempotent and the second recovery performs no network request or write', async () => {
    await database.table('sales').put(sale());
    expect((await recover()).recovered).toBe(true);
    const writeSpy = vi.spyOn(database.table('sales'), 'put');
    expect(await recover()).toMatchObject({ success: true, recovered: false, code: 'NO_OP' });
    expect(repository.getRestaurantOrderByLocalOrder).toHaveBeenCalledOnce();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['paid status', { paymentStatus: 'paid' }],
    ['paid timestamp', { paidAt: TIME_3 }],
    ['paid sale id', { paidSaleId: 'paid-sale' }],
    ['checkout close', { checkoutClosedAt: TIME_3 }],
    ['archived', { archivedAt: TIME_3 }],
    ['deleted', { deletedAt: TIME_3 }],
    ['POS cancellation', { status: 'cancelled', metadata: { cancelledFromPos: true } }]
  ])('never recovers a %s snapshot', async (_label, updates) => {
    const original = sale();
    await database.table('sales').put(original);
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: cloud(updates)
    });

    const result = await recover();

    expect(result.success).toBe(false);
    expect(await database.table('sales').get(SALE_ID)).toEqual(original);
    expect(await database.table('menu').get('product-a')).toMatchObject({ committedStock: 4 });
  });

  it('does not recover a kitchen-rejected order as a POS cancellation', async () => {
    const original = sale();
    await database.table('sales').put(original);
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: cloud({ status: 'cancelled', fulfillmentStatus: 'cancelled' })
    });
    expect(await recover()).toMatchObject({ success: false, code: 'CLOUD_TABLE_RECOVERY_BLOCKED' });
    expect(await database.table('sales').get(SALE_ID)).toEqual(original);
  });

  it('rejects a Cloud snapshot older than the durable terminal marker', async () => {
    const original = sale();
    await database.table('sales').put(original);
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: cloud({ serverVersion: 1, updatedAt: '2026-10-05T10:00:00Z' })
    });
    expect(await recover()).toMatchObject({ success: false, code: 'CLOUD_TABLE_STALE_SNAPSHOT' });
    expect(await database.table('sales').get(SALE_ID)).toEqual(original);
  });

  it('preserves the block if Cloud cannot verify the parent while offline or unavailable', async () => {
    const original = sale();
    await database.table('sales').put(original);
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: false, found: false, code: 'OFFLINE', message: 'Sin conexión'
    });
    expect(await recover()).toMatchObject({ success: false, code: 'CLOUD_TABLE_RECOVERY_UNVERIFIED' });
    expect(await database.table('sales').get(SALE_ID)).toEqual(original);
  });

  it('aborts after actor or tenant authority changes during the Cloud lookup', async () => {
    const original = sale();
    await database.table('sales').put(original);
    repository.getRestaurantOrderByLocalOrder.mockImplementation(async () => {
      current = false;
      return { success: true, found: true, order: cloud() };
    });
    expect(await recover()).toMatchObject({ success: false, code: 'ACTOR_CONTEXT_STALE' });
    expect(await database.table('sales').get(SALE_ID)).toEqual(original);
  });

  it('rolls back the marker cleanup if actor authority changes during the Dexie transaction', async () => {
    const original = sale();
    await database.table('sales').put(original);
    database.table('sales').hook('updating', () => { current = false; });

    expect(await recover()).toMatchObject({ success: false, code: 'ACTOR_CONTEXT_STALE' });
    expect(await database.table('sales').get(SALE_ID)).toEqual(original);
    expect(await database.table('batches').get('batch-a')).toMatchObject({ committedStock: 2 });
  });

  it('rechecks durable local identity and settlement evidence inside the transaction', async () => {
    const original = sale();
    await database.table('sales').put(original);
    const runTransaction = database.transaction.bind(database);
    vi.spyOn(database, 'transaction').mockImplementation(async (...args) => {
      await database.table('sales').update(SALE_ID, {
        restaurantCloudTerminalPaymentStatus: 'paid', paidSaleId: 'settled-sale'
      });
      return runTransaction(...args);
    });

    expect(await recover()).toMatchObject({ success: false, code: 'CLOUD_TABLE_RECOVERY_BLOCKED' });
    expect(await database.table('sales').get(SALE_ID)).toMatchObject({
      restaurantCloudTerminalState: 'terminal', restaurantCloudTerminalPaymentStatus: 'paid',
      paidSaleId: 'settled-sale'
    });
  });

  it('blocks foreign tenant/license identity, mismatched Cloud parents, and durable cancellation cleanup', async () => {
    const foreign = sale({ restaurantCloudTenantId: 'tenant-b' });
    await database.table('sales').put(foreign);
    expect(await recover()).toMatchObject({ success: false });
    expect(repository.getRestaurantOrderByLocalOrder).not.toHaveBeenCalled();

    await database.table('sales').put(sale());
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: cloud({ id: 'another-parent' })
    });
    expect(await recover()).toMatchObject({ success: false, code: 'CLOUD_TABLE_SNAPSHOT_INCOMPLETE' });

    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: cloud()
    });
    await database.table('sales').put(sale({ restaurantCancellationCleanupPending: { receipt: { status: 'cancelled' } } }));
    expect(await recover()).toMatchObject({ success: false, code: 'CLOUD_TABLE_RECOVERY_BLOCKED' });
  });

  it('no-ops when the durable row has already been recovered or removed', async () => {
    expect(await recover()).toMatchObject({ success: true, recovered: false, code: 'NO_OP' });
    expect(repository.getRestaurantOrderByLocalOrder).not.toHaveBeenCalled();
  });
});
