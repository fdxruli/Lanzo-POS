import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ database: null, cloud: true, storage: new Map(),
  lookup: vi.fn(), cancel: vi.fn(), actor: { tenant: { opaqueId: 'tenant-a' }, assertCurrent: vi.fn() } }));
vi.mock('../../../services/db/dexie', () => ({
  STORES: { SALES: 'sales', MENU: 'menu', PRODUCT_BATCHES: 'product_batches' },
  db: { table: (name) => runtime.database.table(name), transaction: (...args) => runtime.database.transaction(...args) }
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: {
  getState: () => ({ enableMultipleOrders: true, licenseDetails: { valid: true, license_key: 'license-a' } }), subscribe: () => () => {}
} }));
vi.mock('../../../services/sync/syncConstants', () => ({
  getLicenseKeyFromDetails: () => 'license-a', isRestaurantOrdersCloudEnabled: () => runtime.cloud
}));
vi.mock('../../../services/sync/idempotency', () => ({ generateIdempotencyKey: () => 'cancel-key' }));
vi.mock('../../../services/restaurant/restaurantOrdersRepository', () => ({ restaurantOrdersRepository: {
  getRestaurantOrderByLocalOrder: (...args) => runtime.lookup(...args),
  cancelRestaurantOrderFromPos: (...args) => runtime.cancel(...args)
} }));
vi.mock('../../../services/auth/refundsActorAuthorization', () => ({ captureRefundsActorHandle: () => runtime.actor }));
vi.mock('../../../services/auth/actorRuntimeController', async (original) => ({ ...await original(),
  actorRuntimeController: { capture: () => runtime.actor, getState: () => ({ status: 'granted' }), subscribe: () => () => {} }
}));
vi.mock('../../../services/tenant/localTenantPolicy', () => ({ canAccessTenantOwnedRuntimeCache: () => true,
  localTenantAccessController: { subscribe: () => () => {} } }));
vi.mock('../../../services/tenant/tenantScopedStorage', () => ({
  tenantScopedZustandStorage: { getItem: (key) => runtime.storage.get(key) || null,
    setItem: (key, value) => runtime.storage.set(key, value), removeItem: (key) => runtime.storage.delete(key) },
  registerTenantStorageHydrator: vi.fn(), suspendTenantStorageWrites: vi.fn()
}));
vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({ releaseEcommerceOrderPosDraft: vi.fn() }));
vi.mock('../../../services/utils', () => ({ generateID: () => `cart-${crypto.randomUUID()}`, safeLocalStorageSet: vi.fn(),
  showMessageModal: vi.fn(), roundCurrency: (value) => Math.round(Number(value) * 100) / 100 }));
import { useActiveOrders } from '../useActiveOrders';
import { db, STORES } from '../../../services/db/dexie';
import { commitStock } from '../../../services/sales/inventoryFlow';

const version = '2026-10-07T10:00:00.000Z';
const receipt = { success: true, localOrderId: 'A', status: 'cancelled', serverVersion: 2,
  updatedAt: '2026-10-07T10:01:00.000Z', cancelledAt: '2026-10-07T10:01:00.000Z' };
const seed = async (id = 'A') => {
  const items = await commitStock([{ id: 'pizza', lineId: 'pizza-line', quantity: 1, price: 50, selectedModifiers: [] }], { db, STORES });
  const sale = { id, items, total: 50, status: 'open', orderType: 'table', tableData: `Mesa ${id}`,
    cloudRestaurantOrderUpdatedAt: runtime.cloud ? version : null, updatedAt: version, timestamp: version };
  await db.table('sales').put(sale);
  await useActiveOrders.getState().loadOpenOrder(id);
  return sale;
};
beforeEach(async () => {
  vi.clearAllMocks();
  runtime.actor.assertCurrent.mockReset();
  vi.stubGlobal('navigator', { onLine: true });
  runtime.cloud = true;
  runtime.storage.clear();
  runtime.database = new Dexie(`origin-cancel-${crypto.randomUUID()}`);
  runtime.database.version(1).stores({ sales: 'id,status', menu: 'id', product_batches: 'id,productId' });
  await runtime.database.open();
  await db.table('menu').put({ id: 'pizza', name: 'Pizza', stock: 10, committedStock: 0, trackStock: true, price: 50 });
  useActiveOrders.setState({ activeOrders: new Map(), currentOrderId: null, isLoading: false,
    pendingInventoryResolutions: new Map(), isCurrentOrderLocked: false });
  runtime.lookup.mockResolvedValue({ success: true, found: true, order: { localOrderId: 'A', updatedAt: version, paymentStatus: 'unpaid', status: 'pending' } });
  runtime.cancel.mockResolvedValue(receipt);
});
afterEach(async () => { vi.unstubAllGlobals(); await runtime.database.delete(); });

describe('3D.1.3 origin cancellation and discard', () => {
  it.each(['add', 'quantity', 'remove'])('discards %s edit without touching durable snapshot or reservations', async (kind) => {
    const baseline = await seed();
    const store = useActiveOrders.getState();
    if (kind === 'add') store.updateCurrentOrderItems((items) => [...items, { id: 'drink', quantity: 1, price: 20 }]);
    if (kind === 'quantity') store.updateCurrentOrderItems((items) => items.map((item) => ({ ...item, quantity: 3 })));
    if (kind === 'remove') store.updateCurrentOrderItems([]);
    await store.discardTableEditSession('A');
    expect(await db.table('sales').get('A')).toEqual(baseline);
    expect((await db.table('menu').get('pizza')).committedStock).toBe(1);
    expect(useActiveOrders.getState().activeOrders.has('A')).toBe(false);
    await store.loadOpenOrder('A');
    expect(useActiveOrders.getState().activeOrders.get('A').items).toEqual(baseline.items);
    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(runtime.lookup).not.toHaveBeenCalled();
  });
  it('uses the latest explicit save as baseline', async () => {
    await seed();
    useActiveOrders.getState().updateCurrentOrderItems((items) => items.map((item) => ({ ...item, quantity: 2 })));
    expect((await useActiveOrders.getState().saveOrderAsOpen('A')).success).toBe(true);
    const saved = await db.table('sales').get('A');
    useActiveOrders.getState().updateCurrentOrderItems([]);
    await useActiveOrders.getState().discardTableEditSession('A');
    await useActiveOrders.getState().loadOpenOrder('A');
    expect(useActiveOrders.getState().activeOrders.get('A').items).toEqual(saved.items);
    expect((await db.table('menu').get('pizza')).committedStock).toBe(2);
  });
  it('waits for Cloud, releases A once, and preserves B with the same product', async () => {
    await seed('B');
    const other = await db.table('sales').get('B');
    await seed('A');
    let resolve;
    runtime.cancel.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const cancel = useActiveOrders.getState().cancelCurrentOrder();
    await vi.waitFor(() => expect(runtime.cancel).toHaveBeenCalledOnce());
    expect((await db.table('sales').get('A')).status).toBe('open');
    expect((await db.table('menu').get('pizza')).committedStock).toBe(2);
    resolve(receipt);
    await cancel;
    expect((await db.table('sales').get('A')).status).toBe('cancelled');
    expect(await db.table('sales').get('B')).toEqual(other);
    expect((await db.table('menu').get('pizza')).committedStock).toBe(1);
    expect(await db.table('sales').count()).toBe(2);
    await useActiveOrders.getState().recoverRestaurantCancellationCleanup();
    expect((await db.table('menu').get('pizza')).committedStock).toBe(1);
    expect(runtime.cancel).toHaveBeenCalledOnce();
  });
  it.each(['failure', 'stale', 'offline', 'ambiguous'])('preserves local OPEN and reserves on %s', async (kind) => {
    const baseline = await seed();
    if (kind === 'offline') navigator.onLine = false;
    if (kind === 'stale') runtime.lookup.mockResolvedValue({ success: true, found: true, order: { updatedAt: 'changed' } });
    if (kind === 'failure') runtime.cancel.mockRejectedValue(new Error('SERVER_FAILURE'));
    if (kind === 'ambiguous') runtime.cancel.mockResolvedValue({ success: true, status: 'cancelled' });
    await expect(useActiveOrders.getState().cancelCurrentOrder()).rejects.toThrow();
    expect(await db.table('sales').get('A')).toEqual(baseline);
    expect((await db.table('menu').get('pizza')).committedStock).toBe(1);
  });
  it('resolves a lost response using an authoritative POS cancellation snapshot without replay', async () => {
    await seed();
    runtime.cancel.mockRejectedValue(new Error('timeout'));
    runtime.lookup.mockResolvedValueOnce({ success: true, found: true, order: { updatedAt: version } })
      .mockResolvedValueOnce({ success: true, found: true, order: { ...receipt, metadata: { cancelledFromPos: true }, paymentStatus: 'unpaid' } });
    await useActiveOrders.getState().cancelCurrentOrder();
    expect((await db.table('sales').get('A')).status).toBe('cancelled');
    expect(runtime.cancel).toHaveBeenCalledOnce();
  });
  it('retains durable receipt after inventory failure and recovers only local cleanup', async () => {
    await seed();
    await db.table('menu').delete('pizza');
    await expect(useActiveOrders.getState().cancelCurrentOrder()).rejects.toMatchObject({ code: 'RESTAURANT_CANCEL_CLEANUP_PENDING' });
    expect((await db.table('sales').get('A')).restaurantCancellationCleanupPending.receipt).toEqual(receipt);
    expect(() => useActiveOrders.getState().updateCurrentOrderItems([])).toThrow();
    await db.table('menu').put({ id: 'pizza', name: 'Pizza', stock: 10, committedStock: 1, trackStock: true });
    await useActiveOrders.getState().recoverRestaurantCancellationCleanup();
    expect((await db.table('sales').get('A')).status).toBe('cancelled');
    expect((await db.table('menu').get('pizza')).committedStock).toBe(0);
    expect(runtime.cancel).toHaveBeenCalledOnce();
  });
  it('adopts refreshed POS cancellation after a crash and blocks runtime while cleanup fails', async () => {
    await seed();
    await db.table('menu').delete('pizza');
    await useActiveOrders.getState().recoverRestaurantCancellationCleanup([
      { ...receipt, metadata: { cancelledFromPos: true }, paymentStatus: 'unpaid' }
    ]);
    expect((await db.table('sales').get('A')).restaurantCancellationCleanupPending.receipt).toEqual(receipt);
    expect(() => useActiveOrders.getState().updateCurrentOrderItems([])).toThrow();
    expect(runtime.cancel).not.toHaveBeenCalled();
    await db.table('menu').put({ id: 'pizza', name: 'Pizza', stock: 10, committedStock: 1, trackStock: true });
    await useActiveOrders.getState().loadOrdersFromDB();
    expect((await db.table('sales').get('A')).status).toBe('cancelled');
    expect((await db.table('menu').get('pizza')).committedStock).toBe(0);
    expect(runtime.cancel).not.toHaveBeenCalled();
  });
  it('keeps Free cancellation independent of connectivity', async () => {
    runtime.cloud = false;
    navigator.onLine = false;
    await seed();
    await useActiveOrders.getState().cancelCurrentOrder();
    expect((await db.table('sales').get('A')).status).toBe('cancelled');
    expect(runtime.lookup).not.toHaveBeenCalled();
    expect(runtime.cancel).not.toHaveBeenCalled();
  });
  it('rejects a stale actor before Cloud and local effects', async () => {
    const baseline = await seed();
    runtime.actor.assertCurrent.mockImplementation(() => { throw Object.assign(new Error('stale'), { code: 'ACTOR_CONTEXT_STALE' }); });
    await expect(useActiveOrders.getState().cancelCurrentOrder()).rejects.toThrow('stale');
    expect(await db.table('sales').get('A')).toEqual(baseline);
    expect(runtime.cancel).not.toHaveBeenCalled();
  });
});
