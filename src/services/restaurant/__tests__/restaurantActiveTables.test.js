import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRestaurantActiveTables,
  countRestaurantActiveTables,
  fetchRestaurantTableDiscoveryOrders,
  getRestaurantCloudTableState,
  rememberRestaurantTableTerminalStates
} from '../restaurantActiveTables';
import { buildRestaurantCloudStatusSummary } from '../restaurantCloudStatusSummary';

const local = (id = 'order-a', overrides = {}) => ({
  id, status: 'open', tableData: 'Mesa origen', total: '42.50',
  updatedAt: '2026-10-05T10:00:00Z',
  items: [{ id: 'product-a', lineId: 'line-a', quantity: 1, price: '42.50' }],
  reservationAuthority: 'local',
  ...overrides
});
const cloud = (localOrderId = 'order-a', overrides = {}) => ({
  id: `cloud-${localOrderId}`, localOrderId, saleId: localOrderId,
  tableLabel: 'Mesa Multi 3D', status: 'pending', fulfillmentStatus: 'pending',
  paymentStatus: 'unpaid', subtotal: '42.50', total: '42.50', currency: 'MXN',
  createdAt: '2026-10-05T09:00:00Z', updatedAt: '2026-10-05T11:00:00Z', serverVersion: 2,
  items: [{ productId: 'product-a', localLineId: 'line-a', productName: 'Producto original',
    quantity: 1, unitPrice: '42.50', lineTotal: '42.50', status: 'pending', selectedModifiers: [] }],
  ...overrides
});
const project = (options = {}) => buildRestaurantActiveTables({ cloudEnabled: true, ...options });

describe('canonical active-table discovery across devices', () => {
  it('discovers the origin table on a second device with empty SALES and keeps its POS identity', () => {
    const order = cloud();
    expect(project({ cloudOrders: [order] })).toMatchObject([{
      id: 'order-a', localOrderId: 'order-a', cloudOrderId: 'cloud-order-a',
      tableData: 'Mesa Multi 3D', source: 'CLOUD_ONLY', localSale: null,
      cloudOrder: order, hydrationState: 'REQUIRED', reservationAuthority: 'cloud'
    }]);
  });

  it('counts three cloud tables when the second device has zero local tables', () => {
    const rows = project({ cloudOrders: [cloud('a'), cloud('b'), cloud('c')] });
    expect(countRestaurantActiveTables(rows)).toEqual({ active: 3, kitchenRejected: 0 });
  });

  it('deduplicates two shared tables by localOrderId and retains their local operational snapshots', () => {
    const locals = [local('a'), local('b')];
    const rows = project({ localSales: locals, cloudOrders: [cloud('a'), cloud('b')] });
    expect(rows).toHaveLength(2);
    expect(countRestaurantActiveTables(rows).active).toBe(2);
    expect(rows.find((row) => row.id === 'a')).toMatchObject({
      source: 'LOCAL_AND_CLOUD', localSale: locals[0], hydrationState: 'LOCAL'
    });
  });

  it('does not deduplicate unrelated POS orders by the cloud comanda ID', () => {
    const rows = project({ localSales: [local('cloud-comanda')],
      cloudOrders: [cloud('pos-order', { id: 'cloud-comanda' })] });
    expect(rows.map((row) => row.localOrderId).sort()).toEqual(['cloud-comanda', 'pos-order']);
  });

  it('ignores a cloud comanda missing canonical localOrderId instead of manufacturing an identity', () => {
    expect(project({ cloudOrders: [{ ...cloud(), localOrderId: null }] })).toEqual([]);
    expect(getRestaurantCloudTableState({ id: 'cloud-only-id' })).toBe('invalid');
  });

  it('preserves a local table absent from cloud as pending sync and deduplicates it once acknowledged', () => {
    const sale = local('pending');
    expect(project({ localSales: [sale] })).toMatchObject([{
      id: 'pending', source: 'LOCAL_ONLY', pendingSync: true, hydrationState: 'LOCAL'
    }]);
    expect(project({ localSales: [sale], cloudOrders: [cloud('pending')] })).toMatchObject([{
      id: 'pending', source: 'LOCAL_AND_CLOUD', pendingSync: false
    }]);
  });

  it('treats an already hydrated local shadow as requiring revalidation rather than pending original-device sync', () => {
    expect(project({ localSales: [local('shadow', {
      restaurantCloudHydrated: true, reservationAuthority: 'cloud'
    })] })).toMatchObject([{
      id: 'shadow', pendingSync: false, hydrationState: 'REVALIDATE'
    }]);
  });

  it('keeps local authority in Free mode and ignores cloud additions and terminal snapshots', () => {
    const sale = local();
    const rows = buildRestaurantActiveTables({ localSales: [sale],
      cloudOrders: [cloud('order-a', { paymentStatus: 'paid' }), cloud('remote')], cloudEnabled: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: sale.id, source: 'LOCAL_ONLY', pendingSync: false,
      tableData: sale.tableData, total: sale.total, items: sale.items });
  });

  it('uses cloud state, label and resolved updatedAt for a shared row without mutating local or cloud input', () => {
    const sale = local('a', { tableData: 'Etiqueta vieja', updatedAt: '2026-10-05T13:00:00Z' });
    const order = cloud('a', { tableLabel: 'Etiqueta compartida', fulfillmentStatus: 'ready',
      updatedAt: '2026-10-05T12:00:00Z' });
    const untouched = structuredClone({ sale, order });
    const [row] = project({ localSales: [sale], cloudOrders: [order] });
    expect(row).toMatchObject({ tableData: 'Etiqueta compartida', fulfillmentStatus: 'ready',
      updatedAt: order.updatedAt, serverVersion: order.serverVersion });
    expect({ sale, order }).toEqual(untouched);
  });

  it('resolves duplicate cloud versions by serverVersion even when an older revision has a later timestamp', () => {
    const older = cloud('a', { serverVersion: 2, updatedAt: '2026-10-05T13:00:00Z', tableLabel: 'Vieja' });
    const newer = cloud('a', { serverVersion: 3, updatedAt: '2026-10-05T12:00:00Z', tableLabel: 'Nueva' });
    for (const cloudOrders of [[newer, older], [older, newer]]) {
      expect(project({ cloudOrders })).toMatchObject([{ serverVersion: 3, tableData: 'Nueva' }]);
    }
  });

  it('uses updatedAt when cloud versions are absent or opaque and sorts newest resolved table first', () => {
    const rows = project({ cloudOrders: [
      cloud('a', { serverVersion: 'opaque-a', updatedAt: '2026-10-05T10:00:00Z' }),
      cloud('b', { serverVersion: null, updatedAt: '2026-10-05T12:00:00Z' }),
      cloud('a', { serverVersion: 'opaque-b', updatedAt: '2026-10-05T11:00:00Z', tableLabel: 'Última A' })
    ] });
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
    expect(rows[1].tableData).toBe('Última A');
  });

  it('keeps sort deterministic for equal timestamps', () => {
    expect(project({ cloudOrders: [cloud('b'), cloud('a')] }).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it.each([
    ['paid payment', { paymentStatus: 'paid' }],
    ['paid payment alias', { paymentStatus: null, payment_status: 'paid' }],
    ['closed order', { status: 'closed' }],
    ['archived order', { status: 'archived' }],
    ['delivered order', { fulfillmentStatus: 'delivered' }],
    ['completed order', { status: 'completed' }],
    ['archive timestamp', { archivedAt: '2026-10-05T11:00:00Z' }],
    ['archive metadata', { metadata: { archived: true } }]
  ])('hides an explicitly terminal %s even with a stale OPEN sale on the origin device', (_case, changes) => {
    const sale = local();
    const order = cloud('order-a', changes);
    expect(getRestaurantCloudTableState(order)).toBe('terminal');
    expect(project({ localSales: [sale], cloudOrders: [order] })).toEqual([]);
    expect(sale.status).toBe('open');
    expect(sale.items).toHaveLength(1);
  });

  it('never revives a locally remembered terminal table when cloud later fails or is absent offline', () => {
    const sale = local('paid', { restaurantCloudTerminalState: 'terminal',
      restaurantCloudTerminalPaymentStatus: 'paid' });
    expect(project({ localSales: [sale] })).toEqual([]);
    expect(buildRestaurantActiveTables({ localSales: [sale], cloudEnabled: false })).toEqual([]);
    expect(project({ localSales: [sale], cloudOrders: [cloud('paid')] })).toEqual([]);
  });

  it('separates kitchen cancellation from service and counts the table only once', () => {
    const rows = project({ localSales: [local('cancelled')], cloudOrders: [
      cloud('cancelled', { fulfillmentStatus: 'cancelled' }), cloud('active')
    ] });
    expect(rows.filter((row) => row.id === 'cancelled')).toHaveLength(1);
    expect(countRestaurantActiveTables(rows)).toEqual({ active: 1, kitchenRejected: 1 });
  });

  it('reuses kitchen item cancellation semantics without classifying a partly cancelled order twice', () => {
    const order = cloud('a', { items: [
      { ...cloud().items[0], status: 'cancelled' },
      { ...cloud().items[0], localLineId: 'line-b', status: 'preparing' }
    ] });
    const summary = buildRestaurantCloudStatusSummary(order);
    const [row] = project({ cloudOrders: [order] });
    expect(summary).toMatchObject({ hasCancelledItems: true, isCancelled: false, hasPreparingItems: true });
    expect(row.items.map((item) => item.status)).toEqual(['cancelled', 'preparing']);
    expect(countRestaurantActiveTables([row])).toEqual({ active: 1, kitchenRejected: 0 });
  });

  it('keeps an all-items-cancelled cloud order solely in the existing kitchen-cancelled section', () => {
    const order = cloud('a', { items: [{ ...cloud().items[0], status: 'cancelled' }] });
    expect(getRestaurantCloudTableState(order)).toBe('kitchen-cancelled');
    expect(countRestaurantActiveTables(project({ cloudOrders: [order] }))).toEqual({ active: 0, kitchenRejected: 1 });
  });

  it('filters explicitly foreign tenant and license local shadows and cloud rows', () => {
    const current = { restaurantCloudLicenseKey: 'license-a', restaurantCloudTenantId: 'tenant-a' };
    const rows = project({ licenseKey: 'license-a', tenantId: 'tenant-a',
      localSales: [local('original'), local('local-foreign', { ...current, restaurantCloudTenantId: 'tenant-b' }),
        local('local-wrong-license', { ...current, restaurantCloudLicenseKey: 'license-b' })],
      cloudOrders: [cloud('current', current), cloud('foreign', { ...current, restaurantCloudTenantId: 'tenant-b' }),
        cloud('wrong-license', { ...current, restaurantCloudLicenseKey: 'license-b' })]
    });
    expect(rows.map((row) => row.id).sort()).toEqual(['current', 'original']);
  });
});

describe('cloud discovery pagination under captured actor authority', () => {
  it('includes completed snapshots so a paid stale local table can be suppressed beyond the first page', async () => {
    const firstPage = Array.from({ length: 300 }, (_, index) => cloud(`page-${index}`));
    const paid = cloud('origin', { paymentStatus: 'paid' });
    const repository = { getRestaurantOrders: vi.fn()
      .mockResolvedValueOnce({ success: true, orders: firstPage })
      .mockResolvedValueOnce({ success: true, orders: [paid] }) };
    const actorHandle = { assertCurrent: vi.fn() };
    const result = await fetchRestaurantTableDiscoveryOrders({ repository, actorHandle, licenseKey: 'license-a' });
    expect(result).toMatchObject({ success: true });
    expect(result.orders).toHaveLength(301);
    expect(repository.getRestaurantOrders.mock.calls.map(([args]) => args)).toEqual([
      { licenseKey: 'license-a', includeCompleted: true, limit: 300, offset: 0, force: true },
      { licenseKey: 'license-a', includeCompleted: true, limit: 300, offset: 300, force: true }
    ]);
    expect(project({ localSales: [local('origin')], cloudOrders: result.orders })
      .some((row) => row.id === 'origin')).toBe(false);
  });

  it('preserves explicit caller force=false without creating a parallel API', async () => {
    const repository = { getRestaurantOrders: vi.fn(async () => ({ success: true, orders: [] })) };
    await fetchRestaurantTableDiscoveryOrders({ repository, licenseKey: 'license-a',
      actorHandle: { assertCurrent: vi.fn() }, force: false });
    expect(repository.getRestaurantOrders).toHaveBeenCalledWith(expect.objectContaining({ force: false }));
  });

  it('returns a later page failure without publishing a partial business-wide list', async () => {
    const failed = { success: false, code: 'NETWORK_ERROR', orders: [] };
    const repository = { getRestaurantOrders: vi.fn()
      .mockResolvedValueOnce({ success: true, orders: Array.from({ length: 300 }, (_, index) => cloud(String(index))) })
      .mockResolvedValueOnce(failed) };
    expect(await fetchRestaurantTableDiscoveryOrders({ repository, licenseKey: 'license-a',
      actorHandle: { assertCurrent: vi.fn() } })).toBe(failed);
  });

  it('rejects a response after an actor change and never requests the next tenant page', async () => {
    let actorChanged = false;
    const stale = Object.assign(new Error('stale actor'), { code: 'ACTOR_CONTEXT_STALE' });
    const repository = { getRestaurantOrders: vi.fn(async () => {
      actorChanged = true;
      return { success: true, orders: Array.from({ length: 300 }, (_, index) => cloud(String(index))) };
    }) };
    const actorHandle = { assertCurrent: () => { if (actorChanged) throw stale; } };
    await expect(fetchRestaurantTableDiscoveryOrders({ repository, licenseKey: 'license-a', actorHandle })).rejects.toBe(stale);
    expect(repository.getRestaurantOrders).toHaveBeenCalledOnce();
  });

  it('does not issue any RPC when its captured actor was already invalidated', async () => {
    const repository = { getRestaurantOrders: vi.fn() };
    await expect(fetchRestaurantTableDiscoveryOrders({ repository, licenseKey: 'license-a',
      actorHandle: { assertCurrent: () => { throw new Error('stale'); } } })).rejects.toThrow('stale');
    expect(repository.getRestaurantOrders).not.toHaveBeenCalled();
  });
});

describe('durable terminal discovery evidence preserves original sales and reservation ownership', () => {
  let database;
  beforeEach(async () => {
    database = new Dexie(`table-terminal-evidence-${crypto.randomUUID()}`);
    database.version(1).stores({ sales: 'id', menu: 'id', batches: 'id' });
    await database.open();
    await database.table('menu').put({ id: 'product-a', stock: 20, committedStock: 4 });
    await database.table('batches').put({ id: 'batch-a', stock: 10, committedStock: 2 });
  });
  afterEach(async () => { await database.delete(); });

  const remember = (localSales, cloudOrders, actorHandle = { assertCurrent: vi.fn() }) => (
    rememberRestaurantTableTerminalStates({ database, stores: { SALES: 'sales' }, localSales, cloudOrders, actorHandle })
  );

  it('marks a paid original OPEN sale without deleting, settling or releasing a single reservation', async () => {
    const sale = local('origin', { reservations: [{ batchId: 'batch-a', quantity: 2 }],
      pendingChanges: { notes: 'Revisar' }, isDirty: true });
    await database.table('sales').put(sale);
    await remember([sale], [cloud('origin', { paymentStatus: 'paid', serverVersion: 9 })]);
    const persisted = await database.table('sales').get(sale.id);
    expect(persisted).toMatchObject({ ...sale, restaurantCloudTerminalState: 'terminal',
      restaurantCloudTerminalPaymentStatus: 'paid', cloudRestaurantTerminalUpdatedAt: '2026-10-05T11:00:00Z',
      cloudRestaurantTerminalServerVersion: 9 });
    expect(await database.table('sales').count()).toBe(1);
    expect(await database.table('menu').get('product-a')).toEqual({ id: 'product-a', stock: 20, committedStock: 4 });
    expect(await database.table('batches').get('batch-a')).toEqual({ id: 'batch-a', stock: 10, committedStock: 2 });
    expect(project({ localSales: [persisted] })).toEqual([]);
  });

  it('does not mark an absent cloud table, an active table or a locally closed sale', async () => {
    const sales = [local('pending'), local('active'), local('closed', { status: 'completed' })];
    await database.table('sales').bulkPut(sales);
    await remember(sales, [cloud('active'), cloud('closed', { paymentStatus: 'paid' }), cloud('remote', { paymentStatus: 'paid' })]);
    expect(await database.table('sales').toArray()).toEqual(expect.arrayContaining(sales));
    expect((await database.table('sales').toArray()).every((sale) => !sale.restaurantCloudTerminalState)).toBe(true);
    expect(await database.table('sales').count()).toBe(3);
  });

  it.each([
    ['licenseKey', 'license-other'],
    ['license_key', 'license-other'],
    ['restaurantCloudLicenseKey', 'license-other'],
    ['tenantOpaqueId', 'tenant-other'],
    ['restaurantCloudTenantId', 'tenant-other']
  ])('never persists terminal evidence from an explicitly foreign %s', async (field, value) => {
    const sale = local('origin', { licenseKey: 'license-1', tenantOpaqueId: 'tenant-1' });
    await database.table('sales').put(sale);
    const updateSpy = vi.spyOn(database.table('sales'), 'update');
    const transactionSpy = vi.spyOn(database, 'transaction');
    await rememberRestaurantTableTerminalStates({ database, stores: { SALES: 'sales' },
      localSales: [sale], cloudOrders: [cloud('origin', { paymentStatus: 'paid', [field]: value })],
      actorHandle: { assertCurrent: vi.fn(), tenant: { opaqueId: 'tenant-1' } },
      licenseKey: 'license-1', tenantId: 'tenant-1' });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(await database.table('sales').get(sale.id)).toEqual(sale);
    expect(await database.table('menu').get('product-a')).toEqual({ id: 'product-a', stock: 20, committedStock: 4 });
    expect(await database.table('batches').get('batch-a')).toEqual({ id: 'batch-a', stock: 10, committedStock: 2 });
  });

  it('rechecks the durable local scope before persisting matching terminal evidence', async () => {
    const listedSale = local('origin', { licenseKey: 'license-1', tenantOpaqueId: 'tenant-1' });
    const durableSale = { ...listedSale, tenantOpaqueId: 'tenant-other' };
    await database.table('sales').put(durableSale);
    const updateSpy = vi.spyOn(database.table('sales'), 'update');
    await rememberRestaurantTableTerminalStates({ database, stores: { SALES: 'sales' },
      localSales: [listedSale], cloudOrders: [cloud('origin', { paymentStatus: 'paid' })],
      actorHandle: { assertCurrent: vi.fn(), tenant: { opaqueId: 'tenant-1' } },
      licenseKey: 'license-1' });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(await database.table('sales').get(durableSale.id)).toEqual(durableSale);
  });

  it('rolls back terminal metadata atomically if the actor becomes stale during persistence', async () => {
    const sale = local('origin');
    await database.table('sales').put(sale);
    let stale = false;
    database.table('sales').hook('updating', () => { stale = true; });
    const actorHandle = { assertCurrent: () => {
      if (stale) throw Object.assign(new Error('actor changed'), { code: 'ACTOR_CONTEXT_STALE' });
    } };
    await expect(remember([sale], [cloud('origin', { paymentStatus: 'paid' })], actorHandle)).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(await database.table('sales').get(sale.id)).toEqual(sale);
    expect(await database.table('menu').get('product-a')).toMatchObject({ committedStock: 4 });
  });
});
