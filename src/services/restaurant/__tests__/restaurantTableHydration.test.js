import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRestaurantOrderPayloadFromOpenSale } from '../restaurantOrderMapper';
import { preflightCloudRestaurantOrderSplit } from '../restaurantSplitCloudPreflight';

const actorController = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: actorController }));
vi.mock('../../db/dexie', () => ({ db: {}, STORES: { SALES: 'sales' } }));
vi.mock('../restaurantOrdersRepository', () => ({ restaurantOrdersRepository: {} }));

import { hydrateRestaurantCloudOrderToLocalOpenSale } from '../restaurantTableHydration';

const VERSION = '2026-09-28T16:05:05.123456789Z';
const buildSale = (overrides = {}) => ({
  id: 'sale-table-1',
  status: 'open',
  tableData: 'Mesa 5',
  orderType: 'table',
  subtotal: '60',
  discountTotal: '0',
  total: '60',
  currency: 'MXN',
  items: [{
    id: 'product-1',
    productId: 'product-1',
    lineId: 'line-1',
    name: 'Producto histórico',
    quantity: 2,
    unitPrice: '30.00',
    price: '30.00',
    lineTotal: '60.00',
    discountAmount: '0',
    selectedModifiers: [],
    batchId: 'batch-1',
    isVariant: true
  }],
  ...overrides
});

const buildCloudOrder = (sale = buildSale(), overrides = {}) => {
  const payload = buildRestaurantOrderPayloadFromOpenSale({ sale });
  return {
    ...payload.order,
    id: 'restaurant-order-1',
    status: 'pending',
    fulfillmentStatus: 'pending',
    paymentStatus: 'unpaid',
    archivedAt: null,
    checkoutClosedAt: null,
    createdAt: '2026-09-28T16:00:00.987654321Z',
    updatedAt: VERSION,
    serverVersion: 'opaque:version:001',
    items: payload.items.map((item) => ({ ...item, status: 'pending' })),
    ...overrides
  };
};

describe('hydrateRestaurantCloudOrderToLocalOpenSale', () => {
  let database;
  let handle;
  let stale;
  let repository;

  beforeEach(async () => {
    vi.clearAllMocks();
    stale = false;
    database = new Dexie(`restaurant-hydration-${crypto.randomUUID()}`);
    database.version(1).stores({ sales: 'id', menu: 'id', batches: 'id' });
    await database.open();
    await database.table('menu').put({ id: 'product-1', price: 999, stock: 7, committedStock: 3 });
    await database.table('batches').put({ id: 'batch-1', price: 777, stock: 4, committedStock: 2 });
    handle = {
      actorKey: 'staff:staff-1',
      actorType: 'staff',
      actorId: 'staff-1',
      sessionId: 'session-1',
      generation: 4,
      deviceRef: 'device-2',
      tenant: { opaqueId: 'tenant-1', databaseName: database.name, generation: 2 },
      assertCurrent: vi.fn(() => {
        if (stale) throw Object.assign(new Error('stale'), { code: 'ACTOR_CONTEXT_STALE' });
        return handle;
      })
    };
    actorController.capture.mockReturnValue(handle);
    repository = { getRestaurantOrderByLocalOrder: vi.fn(async () => ({
      success: true, found: true, order: buildCloudOrder()
    })) };
  });

  afterEach(async () => {
    await database.delete();
  });

  const hydrate = (overrides = {}) => hydrateRestaurantCloudOrderToLocalOpenSale({
    licenseKey: 'license-1', localOrderId: 'sale-table-1',
    expectedCloudOrderId: 'restaurant-order-1', database, repository,
    ...overrides
  });

  it('hydrates device B from a complete cloud snapshot without using catalogue prices or reserving inventory', async () => {
    const transactionSpy = vi.spyOn(database, 'transaction');
    const result = await hydrate();
    expect(result).toMatchObject({
      success: true, hydrated: true, localOrderId: 'sale-table-1',
      sale: {
        id: 'sale-table-1', status: 'open', restaurantCloudHydrated: true,
        reservationAuthority: 'cloud', restaurantOrderId: 'restaurant-order-1',
        cloudRestaurantOrderId: 'restaurant-order-1', cloudRestaurantOrderServerVersion: 'opaque:version:001',
        updatedAt: VERSION, cloudUpdatedAt: VERSION, serverVersion: 'opaque:version:001',
        restaurantCloudLicenseKey: 'license-1', restaurantCloudTenantId: 'tenant-1',
        actorKey: 'staff:staff-1', tenantOpaqueId: 'tenant-1',
        items: [{ price: '30', quantity: '2', lineTotal: '60', batchId: 'batch-1', isVariant: true }]
      }
    });
    expect(repository.getRestaurantOrderByLocalOrder).toHaveBeenCalledExactlyOnceWith({
      licenseKey: 'license-1', localOrderId: 'sale-table-1', force: true
    });
    expect(actorController.capture).toHaveBeenCalledOnce();
    expect(await database.table('sales').get('sale-table-1')).toEqual(result.sale);
    expect(transactionSpy).toHaveBeenCalledWith('rw', [database.table('sales')], expect.any(Function));
    expect(await database.table('menu').get('product-1')).toEqual({ id: 'product-1', price: 999, stock: 7, committedStock: 3 });
    expect(await database.table('batches').get('batch-1')).toEqual({ id: 'batch-1', price: 777, stock: 4, committedStock: 2 });
    await expect(preflightCloudRestaurantOrderSplit({
      licenseKey: 'license-1', parentOrderId: result.sale.id, parentSale: result.sale, repository
    })).resolves.toMatchObject({ success: true, parentExpectedVersion: VERSION });
  });

  it('repeated loading keeps one original localOrderId and refreshes the cloud shadow', async () => {
    await expect(hydrate()).resolves.toMatchObject({ success: true });
    const nextVersion = '2026-09-28T16:06:05.999999999Z';
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(buildSale(), {
        status: 'ready', fulfillmentStatus: 'ready', updatedAt: nextVersion
      })
    });
    await expect(hydrate()).resolves.toMatchObject({ success: true, sale: { updatedAt: nextVersion } });
    expect(await database.table('sales').count()).toBe(1);
    expect((await database.table('sales').get('sale-table-1')).id).toBe('sale-table-1');
  });

  it('restores discounts and modifiers from their canonical snapshot for split preflight', async () => {
    const sale = buildSale({
      discountTotal: '15', total: '45',
      saleDiscount: { type: 'amount', value: '5', amount: '5', scope: 'sale', reason: 'Promoción' },
      saleDiscountAmount: '5', lineDiscountTotal: '10',
      subtotalAfterLineDiscounts: '50',
      items: [{
        ...buildSale().items[0],
        discount: { type: 'amount', value: '10', amount: '10', scope: 'line', reason: 'Cortesía' },
        discountAmount: '10', discountReason: 'Cortesía', lineTotal: '50',
        selectedModifiers: [{ id: 'modifier-1', price: 2, quantity: 1, name: 'Extra' }]
      }]
    });
    const order = buildCloudOrder(sale);
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({ success: true, found: true, order });
    const result = await hydrate();
    expect(result).toMatchObject({ success: true, sale: {
      total: order.total, discountTotal: '15', saleDiscount: { type: 'amount', value: '5', amount: '5' },
      items: [{ discountAmount: '10', lineTotal: '50', selectedModifiers: sale.items[0].selectedModifiers }]
    } });
    await expect(preflightCloudRestaurantOrderSplit({
      licenseKey: 'license-1', parentOrderId: result.sale.id, parentSale: result.sale, repository
    })).resolves.toMatchObject({ success: true });
  });

  it('does not downgrade a newer cloud shadow when refresh responses arrive out of order', async () => {
    await hydrate();
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(buildSale(), {
        updatedAt: '2026-09-28T16:05:05.123456788Z'
      })
    });
    await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'CLOUD_TABLE_STALE_SNAPSHOT' });
    expect((await database.table('sales').get('sale-table-1')).updatedAt).toBe(VERSION);
  });

  it('preserves absent financial aliases instead of inventing zero totals', async () => {
    const sale = {
      id: 'sale-table-1', status: 'open', orderType: 'table', total: '60',
      items: [{ id: 'product-1', lineId: 'line-1', quantity: 2, price: '30' }]
    };
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(sale)
    });
    const result = await hydrate();
    expect(result.success).toBe(true);
    expect(result.sale).not.toHaveProperty('subtotal');
    expect(result.sale).not.toHaveProperty('discountTotal');
    expect(result.sale.items[0]).not.toHaveProperty('unitPrice');
    expect(result.sale.items[0]).not.toHaveProperty('lineTotal');
    expect(result.sale.items[0]).not.toHaveProperty('discountAmount');
    expect(result.sale.items[0]).not.toHaveProperty('selectedModifiers');
  });

  it('accepts explicit zero prices and totals without confusing them with missing amounts', async () => {
    const sale = buildSale({ subtotal: '0', total: '0', items: [{
      ...buildSale().items[0], price: '0', unitPrice: '0', lineTotal: '0'
    }] });
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(sale)
    });
    await expect(hydrate()).resolves.toMatchObject({ success: true, sale: {
      total: 0, items: [{ price: '0', lineTotal: '0' }]
    } });
  });

  it.each([
    ['missing commercial snapshot', (order) => { delete order.metadata.restaurantSplitCommercialSnapshot; }],
    ['missing line snapshot', (order) => { delete order.items[0].metadata.restaurantSplitCommercialSnapshot; }],
    ['unsupported snapshot version', (order) => { order.metadata.restaurantSplitCommercialSnapshot.version = 2; }],
    ['null unit price', (order) => { order.items[0].unitPrice = null; }],
    ['null price alias despite a numeric alternate', (order) => { order.items[0].unit_price = 30; order.items[0].unitPrice = null; }],
    ['conflicting wire line-total aliases', (order) => { order.items[0].line_total = 999; }],
    ['blank line total', (order) => { order.items[0].lineTotal = ''; }],
    ['null total', (order) => { order.total = null; }],
    ['inconsistent unadjusted total', (order) => { order.total = 999; }],
    ['missing quantity', (order) => { delete order.items[0].quantity; }],
    ['missing modifiers', (order) => { delete order.items[0].selectedModifiers; }],
    ['modifiers differ from the captured account', (order) => { order.items[0].selectedModifiers = [{ id: 'uncaptured', price: 10 }]; }],
    ['null captured line discount amount', (order) => { order.items[0].metadata.restaurantSplitCommercialSnapshot.discounts.discountAmount = { state: 'null' }; }],
    ['contradictory price', (order) => { order.items[0].unitPrice = 99; }],
    ['missing price authority', (order) => { order.items[0].metadata.restaurantSplitCommercialSnapshot.amounts.price = { state: 'absent' }; }],
    ['missing exact version', (order) => { order.updatedAt = null; }],
    ['duplicate line identity', (order) => { order.items.push({ ...order.items[0] }); }]
  ])('fails closed for %s without writing a sale', async (_label, change) => {
    const order = buildCloudOrder();
    change(order);
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({ success: true, found: true, order });
    await expect(hydrate()).resolves.toMatchObject({
      success: false, code: 'CLOUD_TABLE_SNAPSHOT_INCOMPLETE',
      message: 'Esta mesa necesita actualizarse antes de poder cargarse en este dispositivo.'
    });
    expect(await database.table('sales').count()).toBe(0);
  });

  it.each([
    { paymentStatus: 'paid' }, { status: 'cancelled' }, { archivedAt: VERSION },
    { checkoutClosedAt: VERSION }, { paidAt: VERSION }, { status: 'closed' }
  ])('does not resurrect a terminal cloud order (%j)', async (updates) => {
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(buildSale(), updates)
    });
    const result = await hydrate();
    expect(result.success).toBe(false);
    expect(await database.table('sales').count()).toBe(0);
  });

  it('blocks a cloud-cancelled line even when the order remains unpaid', async () => {
    const order = buildCloudOrder();
    order.items[0].status = 'cancelled';
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({ success: true, found: true, order });
    expect((await hydrate()).success).toBe(false);
    expect(await database.table('sales').count()).toBe(0);
  });

  it('tells the cashier the table was already paid', async () => {
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(buildSale(), { paymentStatus: 'paid' })
    });
    await expect(hydrate()).resolves.toMatchObject({ success: false, message: 'La mesa ya fue cobrada.' });
  });

  it('tells the cashier when the cloud table was cancelled', async () => {
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(buildSale(), { status: 'cancelled' })
    });
    await expect(hydrate()).resolves.toMatchObject({ success: false, message: expect.stringContaining('cancelada') });
  });

  it('preserves an original local sale without overwriting its stock ownership or prices', async () => {
    const original = buildSale({ localField: 'keep', items: [{ ...buildSale().items[0], price: '20' }] });
    await database.table('sales').put(original);
    await expect(hydrate()).resolves.toMatchObject({ success: true, hydrated: false, sale: original });
    expect(await database.table('sales').get(original.id)).toEqual(original);
  });

  it.each([{ status: 'closed' }, { status: 'cancelled' }, { dirty: true }, { isDirty: true },
    { syncStatus: 'pending' }, { isLockedForCheckout: true }, { tableTabCleanup: { status: 'pending' } }])(
    'never overwrites a local sale with conflicting state (%j)', async (updates) => {
      const original = { ...buildSale(), ...updates };
      await database.table('sales').put(original);
      expect((await hydrate()).success).toBe(false);
      expect(await database.table('sales').get(original.id)).toEqual(original);
    }
  );

  it('blocks a shadow with another tenant binding', async () => {
    await hydrate();
    await database.table('sales').update('sale-table-1', { tenantOpaqueId: 'tenant-other' });
    await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'CLOUD_TABLE_LOCAL_CONFLICT' });
    expect((await database.table('sales').get('sale-table-1')).tenantOpaqueId).toBe('tenant-other');
  });

  it.each([{ restaurantCloudHydrated: true }, { reservationAuthority: 'cloud' }])(
    'does not treat an incomplete cloud ownership marker as a local original (%j)', async (marker) => {
      const original = { ...buildSale(), ...marker };
      await database.table('sales').put(original);
      await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'CLOUD_TABLE_LOCAL_CONFLICT' });
      expect(await database.table('sales').get(original.id)).toEqual(original);
    }
  );

  it('never resurrects a locally remembered cloud terminal state from an older active lookup', async () => {
    await hydrate();
    const marker = {
      restaurantCloudTerminalState: 'terminal', restaurantCloudTerminalPaymentStatus: 'paid',
      cloudRestaurantTerminalUpdatedAt: '2026-09-28T16:10:00.123456789Z',
      cloudRestaurantTerminalServerVersion: 'opaque:version:002'
    };
    await database.table('sales').update('sale-table-1', marker);
    const original = await database.table('sales').get('sale-table-1');
    await expect(hydrate()).resolves.toMatchObject({
      success: false, code: 'CLOUD_TABLE_TERMINAL', message: 'La mesa ya fue cobrada.'
    });
    expect(await database.table('sales').get('sale-table-1')).toEqual(original);
  });

  it('rechecks terminal evidence written concurrently before a refresh transaction', async () => {
    await hydrate();
    const runTransaction = database.transaction.bind(database);
    vi.spyOn(database, 'transaction').mockImplementation(async (...args) => {
      await database.table('sales').update('sale-table-1', {
        restaurantCloudTerminalState: 'terminal', restaurantCloudTerminalPaymentStatus: 'paid',
        cloudRestaurantTerminalUpdatedAt: '2026-09-28T16:10:00.123456789Z'
      });
      return runTransaction(...args);
    });
    await expect(hydrate()).resolves.toMatchObject({
      success: false, code: 'CLOUD_TABLE_TERMINAL', message: 'La mesa ya fue cobrada.'
    });
    expect((await database.table('sales').get('sale-table-1')).restaurantCloudTerminalState).toBe('terminal');
  });

  it('rechecks the durable sale inside the transaction and preserves a concurrent local close', async () => {
    const closed = buildSale({ status: 'closed', localField: 'settled-on-device-A' });
    const runTransaction = database.transaction.bind(database);
    vi.spyOn(database, 'transaction').mockImplementation(async (...args) => {
      await database.table('sales').put(closed);
      return runTransaction(...args);
    });
    await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'CLOUD_TABLE_LOCAL_CONFLICT' });
    expect(await database.table('sales').get(closed.id)).toEqual(closed);
  });

  it('blocks cloud order identity mismatch', async () => {
    await expect(hydrate({ expectedCloudOrderId: 'another-cloud-order' })).resolves.toMatchObject({
      success: false, code: 'CLOUD_TABLE_SNAPSHOT_INCOMPLETE'
    });
    expect(await database.table('sales').count()).toBe(0);
  });

  it('blocks an explicit cloud license mismatch', async () => {
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(buildSale(), { licenseKey: 'license-other' })
    });
    await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'CLOUD_TABLE_SNAPSHOT_INCOMPLETE' });
    expect(await database.table('sales').count()).toBe(0);
  });

  it.each([
    ['tenantOpaqueId', 'tenant-other'],
    ['restaurantCloudTenantId', 'tenant-other'],
    ['restaurantCloudLicenseKey', 'license-other']
  ])('rejects an explicitly foreign lookup %s before any local write', async (field, value) => {
    repository.getRestaurantOrderByLocalOrder.mockResolvedValue({
      success: true, found: true, order: buildCloudOrder(buildSale(), { [field]: value })
    });
    const putSpy = vi.spyOn(database.table('sales'), 'put');
    const transactionSpy = vi.spyOn(database, 'transaction');
    await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'CLOUD_TABLE_SNAPSHOT_INCOMPLETE' });
    expect(repository.getRestaurantOrderByLocalOrder).toHaveBeenCalledExactlyOnceWith({
      licenseKey: 'license-1', localOrderId: 'sale-table-1', force: true
    });
    expect(putSpy).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(await database.table('sales').count()).toBe(0);
    expect(await database.table('menu').get('product-1')).toEqual({ id: 'product-1', price: 999, stock: 7, committedStock: 3 });
    expect(await database.table('batches').get('batch-1')).toEqual({ id: 'batch-1', price: 777, stock: 4, committedStock: 2 });
  });

  it('discards an in-flight response after actor or tenant changes', async () => {
    repository.getRestaurantOrderByLocalOrder.mockImplementation(async () => {
      stale = true;
      return { success: true, found: true, order: buildCloudOrder() };
    });
    await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'ACTOR_CONTEXT_STALE' });
    expect(await database.table('sales').count()).toBe(0);
  });

  it('does not request or write a cloud account without granted actor authority', async () => {
    actorController.capture.mockImplementation(() => {
      throw Object.assign(new Error('locked'), { code: 'ACTOR_CONTEXT_LOCKED' });
    });
    await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'ACTOR_CONTEXT_LOCKED' });
    expect(repository.getRestaurantOrderByLocalOrder).not.toHaveBeenCalled();
    expect(await database.table('sales').count()).toBe(0);
  });

  it('rolls back SALES when actor authority changes immediately after put', async () => {
    const table = database.table('sales');
    const originalPut = table.put.bind(table);
    vi.spyOn(table, 'put').mockImplementation(async (...args) => {
      const result = await originalPut(...args);
      stale = true;
      return result;
    });
    await expect(hydrate()).resolves.toMatchObject({ success: false, code: 'ACTOR_CONTEXT_STALE' });
    expect(await table.count()).toBe(0);
  });

  it.each([
    ['offline', async () => ({ success: false, found: false, code: 'OFFLINE' })],
    ['not found', async () => ({ success: true, found: false, order: null })],
    ['timeout', async () => { throw new Error('timeout'); }]
  ])('does not hydrate from an unavailable lookup (%s)', async (_label, lookup) => {
    repository.getRestaurantOrderByLocalOrder.mockImplementation(lookup);
    expect((await hydrate()).success).toBe(false);
    expect(await database.table('sales').count()).toBe(0);
  });
});
