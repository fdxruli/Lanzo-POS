import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Only replace the tenant DB boundary: queries, FEFO selection, stock helpers,
// cart actions and the final stock validator run their production code.
vi.mock('../../../services/db/dexie', async () => {
  const { default: Dexie } = await import('dexie');
  const db = new Dexie('batch-cart-integration');
  db.version(1).stores({ menu: 'id', product_batches: 'id,productId', sales: 'id,status' });
  return { db, STORES: { MENU: 'menu', PRODUCT_BATCHES: 'product_batches', SALES: 'sales' } };
});
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ enableMultipleOrders: true }) } }));
vi.mock('../../../store/usePosCatalogStore', () => ({ usePosCatalogStore: { getState: () => ({ items: [] }) } }));
vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({ releaseEcommerceOrderPosDraft: vi.fn() }));
vi.mock('../../../services/utils', () => ({
  generateID: () => crypto.randomUUID(), safeLocalStorageSet: vi.fn(),
  roundCurrency: (value) => Math.round(Number(value) * 100) / 100,
  showMessageModal: vi.fn(), showConfirmModal: vi.fn()
}));

import { db, STORES } from '../../../services/db/dexie';
import { actorRuntimeController, createActorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { useActiveOrders } from '../useActiveOrders';
import { processSaleCore } from '../../../services/sales/processSaleCore';
import { salesCloudCashierService } from '../../../services/salesCloud/salesCloudCashierService';

const product = {
  id: 'milk', name: 'Leche', price: 20, cost: 8, stock: 5, committedStock: 2,
  trackStock: true, saleType: 'unit', hasVariants: false,
  batchManagement: { enabled: true, selectionStrategy: 'fifo' }
};
const batch = {
  id: 'lot-1', productId: 'milk', stock: 5, committedStock: 2,
  price: 20, cost: 8, isActive: true, createdAt: '2026-01-01T00:00:00.000Z'
};
const order = (id) => ({ id, items: [], total: 0, isSaved: false, actorKey: 'staff:one', tableData: `Venta ${id}` });
const state = () => useActiveOrders.getState();
const items = (id) => state().activeOrders.get(id).items;
let scopedActor;
let tenantAuthority;

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.table(STORES.MENU).put(product);
  await db.table(STORES.PRODUCT_BATCHES).put(batch);
  tenantAuthority = { opaqueId: 'tenant-test', databaseName: 'batch-cart-integration', generation: 1 };
  scopedActor = createActorRuntimeController({ getTenantAuthority: () => tenantAuthority });
  scopedActor.beginAuthentication({ actorType: 'staff' });
  scopedActor.grant({ actorType: 'staff', actorId: 'one', sessionId: 's1', tenantOpaqueId: 'tenant-test', permissions: ['pos'] });
  vi.spyOn(actorRuntimeController, 'capture').mockImplementation((permission) => scopedActor.capture(permission));
  vi.spyOn(actorRuntimeController, 'getState').mockImplementation(() => scopedActor.getState());
  useActiveOrders.setState({ activeOrders: new Map([['A', order('A')], ['B', order('B')]]),
    currentOrderId: 'A', pendingInventoryResolutions: new Map(), inventoryConflictNotice: null });
});
afterAll(async () => { vi.restoreAllMocks(); await db.delete(); });

describe('selected-batch availability through real cart actions and Dexie', () => {
  it('allows exactly 5 - 2 = 3 units across A/B, then releases a provisional unit', async () => {
    expect(await state().addSmartItem(product, 'A')).toMatchObject({ success: true });
    expect(await state().addSmartItem(product, 'A')).toMatchObject({ success: true });
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: true });
    expect(items('A')[0]).toMatchObject({ batchId: batch.id, stock: 3, quantity: 2, price: 20 });
    expect(items('B')[0].quantity).toBe(1);
    const before = state().activeOrders;
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: false, code: 'LOCAL_INVENTORY_NOT_TRANSFERABLE' });
    expect(state().activeOrders).toBe(before);
    expect(state().inventoryConflictNotice).toMatchObject({ availableBeforeCarts: 3, provisionalInOtherCarts: 2, freeInThisCart: 0 });
    expect(await state().updateItemQuantity(items('A')[0].lineId, 1, 'A')).toMatchObject({ success: true });
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: true });
    expect(items('B')[0].quantity).toBe(2);
    expect(await db.table(STORES.MENU).get(product.id)).toEqual(product);
    expect(await db.table(STORES.PRODUCT_BATCHES).get(batch.id)).toEqual(batch);
  });

  it('allows two uncommitted units, blocks a duplicate claim and reuses a released unit', async () => {
    const uncommitted = { ...product, stock: 2, committedStock: 0 };
    await db.table(STORES.MENU).put(uncommitted);
    await db.table(STORES.PRODUCT_BATCHES).update(batch.id, { stock: 2, committedStock: 0 });
    expect(await state().addSmartItem(uncommitted, 'A')).toMatchObject({ success: true });
    expect(await state().updateItemQuantity(items('A')[0].lineId, 2, 'A')).toMatchObject({ success: true });
    expect(await state().addSmartItem(uncommitted, 'B')).toMatchObject({ success: false });
    expect(state().inventoryConflictNotice).toMatchObject({ availableBeforeCarts: 2, provisionalInOtherCarts: 2, freeInThisCart: 0 });
    await state().removeItem(items('A')[0].lineId, 'A');
    expect(await state().addSmartItem(uncommitted, 'B')).toMatchObject({ success: true });
    expect(await db.table(STORES.PRODUCT_BATCHES).get(batch.id)).toMatchObject({ stock: 2, committedStock: 0 });
  });

  it('keeps different physical lots separate in one cart and never borrows their stock or commitments', async () => {
    await db.table(STORES.MENU).update(product.id, { stock: 11, committedStock: 7 });
    const otherBatch = { ...batch, id: 'lot-2', stock: 6, committedStock: 5, cost: 9 };
    await db.table(STORES.PRODUCT_BATCHES).put(otherBatch);
    expect(await state().addSmartItem({ ...product, stock: 11, committedStock: 7 }, 'A')).toMatchObject({ success: true });
    expect(await state().updateItemQuantity(items('A')[0].lineId, 3, 'A')).toMatchObject({ success: true });
    const selectedOther = { ...product, batchId: otherBatch.id, stock: 99, committedStock: 7, cost: 9 };
    expect(await state().addItem(selectedOther, 'A')).toMatchObject({ success: true });
    expect(items('A').map(({ batchId, quantity }) => [batchId, quantity])).toEqual([['lot-1', 3], ['lot-2', 1]]);
    const before = state().activeOrders;
    expect(await state().addItem(selectedOther, 'A')).toMatchObject({ success: false });
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: false });
    expect(state().activeOrders).toBe(before);
    expect(state().inventoryConflictNotice).toMatchObject({ availableBeforeCarts: 3, provisionalInOtherCarts: 3, freeInThisCart: 0 });
    await state().updateItemQuantity(items('A')[0].lineId, 2, 'A');
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: true });
    expect(items('B')[0]).toMatchObject({ batchId: 'lot-1', quantity: 1 });
  });

  it('refreshes stale existing lines and scanner snapshots before every increase', async () => {
    await state().addSmartItem(product, 'A');
    const lineId = items('A')[0].lineId;
    // A restored draft retains stock=3; the current lot has only 2 free now.
    const restored = JSON.parse(JSON.stringify(state().activeOrders.get('A')));
    useActiveOrders.setState({ activeOrders: new Map([['A', restored], ['B', order('B')]]) });
    await db.table(STORES.PRODUCT_BATCHES).update(batch.id, { committedStock: 3 });
    expect(await state().updateItemQuantity(lineId, 2, 'A')).toMatchObject({ success: true });
    expect(items('A')[0]).toMatchObject({ quantity: 2, stock: 2, exceedsStock: false });
    const before = state().activeOrders;
    expect(await state().addScannedProduct({ ...product, batchId: batch.id, stock: 999 }, 'B'))
      .toMatchObject({ success: false, action: null, item: null });
    expect(state().activeOrders).toBe(before);
    await state().updateItemQuantity(lineId, 1, 'A');
    expect(await state().addScannedProduct({ ...product, batchId: batch.id, stock: 999 }, 'B'))
      .toMatchObject({ success: true, action: 'added' });
    expect(items('B')[0]).toMatchObject({ quantity: 1, stock: 2, exceedsStock: false });
  });

  it('checks a multi-scan atomically and aggregates only within the same lot', async () => {
    await db.table(STORES.PRODUCT_BATCHES).put({ ...batch, id: 'lot-2', stock: 1, committedStock: 0 });
    const scanned = { ...product, batchId: batch.id, stock: 99 };
    expect(await state().addMultipleScannedProducts([{ ...scanned, quantity: 3 }], 'A'))
      .toMatchObject({ success: true, addedCount: 3 });
    const before = state().activeOrders;
    expect(await state().addMultipleScannedProducts([scanned, { ...scanned, batchId: 'lot-2' }], 'B'))
      .toMatchObject({ success: false, addedCount: 0, incrementedCount: 0 });
    expect(state().activeOrders).toBe(before);
    expect(await state().addMultipleScannedProducts([{ ...scanned, batchId: 'lot-2' }], 'A'))
      .toMatchObject({ success: true });
    expect(items('A').map(({ batchId, quantity }) => [batchId, quantity])).toEqual([['lot-1', 3], ['lot-2', 1]]);
  });

  it.each([
    ['missing stock', { stock: undefined }], ['NaN stock', { stock: NaN }],
    ['infinite stock', { stock: Infinity }], ['negative stock', { stock: -1 }],
    ['invalid commitments', { committedStock: NaN }], ['negative commitments', { committedStock: -1 }],
    ['overcommitted', { committedStock: 6 }], ['inactive', { isActive: false }],
    ['wrong product', { productId: 'different-product' }]
  ])('fails closed for %s without trusting the parent or a scanner snapshot', async (_name, changes) => {
    await db.table(STORES.PRODUCT_BATCHES).put({ ...batch, ...changes });
    const before = state().activeOrders;
    expect(await state().addItem({ ...product, batchId: batch.id, stock: 999, committedStock: 0 }, 'A'))
      .toMatchObject({ success: false, code: 'LOCAL_INVENTORY_NOT_TRANSFERABLE' });
    expect(state().activeOrders).toBe(before);
    expect(state().inventoryConflictNotice).toMatchObject({ availableBeforeCarts: null, freeInThisCart: null });
  });

  it('rejects missing lots, failed reads and unresolved batch-managed parents', async () => {
    await db.table(STORES.PRODUCT_BATCHES).delete(batch.id);
    const before = state().activeOrders;
    expect(await state().addSmartItem(product, 'A')).toMatchObject({ success: false });
    expect(await state().addItem({ ...product, batchId: batch.id }, 'A')).toMatchObject({ success: false });
    await db.table(STORES.PRODUCT_BATCHES).put(batch);
    vi.spyOn(db.table(STORES.PRODUCT_BATCHES), 'bulkGet').mockRejectedValueOnce(new Error('read unavailable'));
    expect(await state().addSmartItem(product, 'A')).toMatchObject({ success: false });
    expect(state().activeOrders).toBe(before);
    expect(state().pendingInventoryResolutions.size).toBe(0);
  });

  it('does not count a saved order twice when its units are formally committed', async () => {
    const saved = { ...order('saved'), isSaved: true, items: [{ ...product, batchId: batch.id, quantity: 2,
      inventoryReservation: { source: 'table', committedQuantity: 2, committedBatches: [{ batchId: batch.id, quantity: 2 }] } }] };
    useActiveOrders.setState({ activeOrders: new Map([...state().activeOrders, ['saved', saved]]) });
    await state().addSmartItem(product, 'A');
    expect(await state().updateItemQuantity(items('A')[0].lineId, 3, 'A')).toMatchObject({ success: true });
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: false });
    expect(state().activeOrders.get('saved')).toBe(saved);
    expect(state().inventoryConflictNotice).toMatchObject({ availableBeforeCarts: 3, provisionalInOtherCarts: 3 });
  });

  it('counts provisional claims across operators without offering unauthorized navigation', async () => {
    await state().addSmartItem(product, 'A');
    await state().updateItemQuantity(items('A')[0].lineId, 3, 'A');
    scopedActor.lock();
    scopedActor.beginAuthentication({ actorType: 'staff' });
    scopedActor.grant({ actorType: 'staff', actorId: 'two', sessionId: 's2', tenantOpaqueId: 'tenant-test', permissions: ['pos'] });
    const b = { ...order('B'), actorKey: 'staff:two' };
    useActiveOrders.setState({ activeOrders: new Map([...state().activeOrders, ['B', b]]), currentOrderId: 'B' });
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: false });
    expect(state().inventoryConflictNotice).toMatchObject({ provisionalInOtherCarts: 3, sourceOrderId: null, singleSourceLabel: null });
    expect(state().openInventoryConflictSource()).toBe(false);
    expect(state().activeOrders.get('B')).toBe(b);
  });

  it.each(['operator', 'tenant'])('rejects an in-flight increase after a %s handoff', async (handoff) => {
    let releaseRead;
    let startedRead;
    const readStarted = new Promise((resolve) => { startedRead = resolve; });
    const table = db.table(STORES.PRODUCT_BATCHES);
    const realBulkGet = table.bulkGet.bind(table);
    vi.spyOn(table, 'bulkGet').mockImplementationOnce(async (ids) => {
      const rows = await realBulkGet(ids);
      startedRead();
      await new Promise((resolve) => { releaseRead = resolve; });
      return rows;
    });
    const before = state().activeOrders;
    const pending = state().addSmartItem(product, 'A');
    await readStarted;
    expect(state().pendingInventoryResolutions.get('A')).toBeGreaterThan(0);
    if (handoff === 'operator') scopedActor.lock();
    else tenantAuthority = { ...tenantAuthority, opaqueId: 'tenant-other', generation: 2 };
    // Mimic the handoff's session reset: cleanup must not touch this new map.
    const newPending = new Map([['new-tenant-order', 1]]);
    useActiveOrders.setState({ pendingInventoryResolutions: newPending });
    releaseRead();
    expect(await pending).toMatchObject({ success: false });
    expect(state().activeOrders).toBe(before);
    expect(state().pendingInventoryResolutions).toBe(newPending);
  });

  it('retains the contextual figures and only opens an authorized source on request', async () => {
    await state().addSmartItem(product, 'A');
    await state().updateItemQuantity(items('A')[0].lineId, 3, 'A');
    useActiveOrders.setState({ currentOrderId: 'B' });
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: false });
    expect(state().inventoryConflictNotice).toMatchObject({
      availableBeforeCarts: 3, provisionalInOtherCarts: 3, freeInThisCart: 0,
      sourceOrderId: 'A', singleSourceLabel: 'Venta A'
    });
    expect(state().currentOrderId).toBe('B');
    expect(state().openInventoryConflictSource()).toBe(true);
    expect(state().currentOrderId).toBe('A');
    expect(state().inventoryConflictNotice).toBeNull();
    expect(items('A')[0].quantity).toBe(3);
    expect(items('B')).toEqual([]);
  });

  it('never treats a negative restored line as extra capacity in another cart or the target', async () => {
    await state().addSmartItem(product, 'A');
    await state().updateItemQuantity(items('A')[0].lineId, 2, 'A');
    // Non-sellable legacy quantities must not offset positive claims.
    const corruptLine = { ...items('A')[0], quantity: -1, lineId: 'legacy-negative' };
    useActiveOrders.setState({ activeOrders: new Map([...state().activeOrders,
      ['legacy', { ...order('legacy'), items: [corruptLine] }]]) });
    await state().addSmartItem(product, 'B');
    const before = state().activeOrders;
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: false });
    expect(state().activeOrders).toBe(before);
    expect(state().inventoryConflictNotice).toMatchObject({ provisionalInOtherCarts: 2, freeInThisCart: 0 });
    useActiveOrders.setState({ activeOrders: new Map([...state().activeOrders,
      ['B', { ...state().activeOrders.get('B'), items: [...items('B'), corruptLine] }]]) });
    const beforeOwn = state().activeOrders;
    expect(await state().addSmartItem(product, 'B')).toMatchObject({ success: false });
    expect(state().activeOrders).toBe(beforeOwn);
  });

  it('revalidates competing asynchronous adds instead of oversubscribing or losing an increment', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      state().addSmartItem(product, index % 2 ? 'B' : 'A')));
    expect(results.filter((result) => result.success)).toHaveLength(3);
    expect(items('A').reduce((sum, item) => sum + item.quantity, 0)
      + items('B').reduce((sum, item) => sum + item.quantity, 0)).toBe(3);
    expect(state().pendingInventoryResolutions.size).toBe(0);
  });

  it('rechecks fresh inventory at checkout after the cart was accepted', async () => {
    expect(await state().addSmartItem(product, 'A')).toMatchObject({ success: true });
    await db.table(STORES.PRODUCT_BATCHES).update(batch.id, { committedStock: 5 });
    vi.spyOn(salesCloudCashierService, 'shouldUseCloudCashierSale').mockResolvedValue({ useCloud: false });
    const executeSaleTransactionSafe = vi.fn();
    const saveData = vi.fn();
    const result = await processSaleCore({
      order: structuredClone(items('A')), total: 20, allProducts: [product], features: {},
      paymentData: { paymentMethod: 'efectivo', amountPaid: 20, saldoPendiente: 0 }, ignoreStock: false
    }, {
      loadData: (store, id) => db.table(store).get(id),
      loadMultipleData: (store, ids) => db.table(store).bulkGet(ids),
      queryBatchesByProductIdAndActive: (id) => db.table(STORES.PRODUCT_BATCHES).where('productId').equals(id).toArray(),
      STORES, executeSaleTransactionSafe, saveData,
      Logger: { time: vi.fn(), timeEnd: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    expect(result).toMatchObject({ success: false, errorType: 'STOCK_WARNING' });
    expect(executeSaleTransactionSafe).not.toHaveBeenCalled();
    expect(saveData).not.toHaveBeenCalled();
    expect(await db.table(STORES.PRODUCT_BATCHES).get(batch.id)).toMatchObject({ stock: 5, committedStock: 5 });
  });
});

describe('Apartados Apparel: límite POS mediante tarjetas y escáner', () => {
  it('suma como máximo dos unidades libres tras comprometer tres de cinco en un único lote', async () => {
    await db.table(STORES.MENU).update(product.id, { committedStock: 3 });
    await db.table(STORES.PRODUCT_BATCHES).update(batch.id, { committedStock: 3 });
    const scanned = { ...product, batchId: batch.id, isVariant: true, parentId: product.id };
    expect(await state().addScannedProduct(scanned, 'A')).toMatchObject({ success: true });
    expect(await state().addScannedProduct(scanned, 'A')).toMatchObject({ success: true });
    const before = state().activeOrders;
    expect(await state().addScannedProduct(scanned, 'A')).toMatchObject({ success: false });
    expect(state().activeOrders).toBe(before);
    expect(items('A')[0].quantity).toBe(2);
    await db.table(STORES.PRODUCT_BATCHES).update(batch.id, { committedStock: 0 });
    expect(await state().addScannedProduct(scanned, 'A')).toMatchObject({ success: true });
    expect(items('A')[0].quantity).toBe(3);
  });
  it('nunca usa las tres unidades libres de M para vender una L totalmente comprometida', async () => {
    await db.table(STORES.PRODUCT_BATCHES).put({ ...batch, id: 'lot-L', stock: 4, committedStock: 4,
      attributes: { talla: 'L' } });
    const sizeL = { ...product, parentId: product.id, batchId: 'lot-L', isVariant: true, stock: 99 };
    const sizeM = { ...product, parentId: product.id, batchId: batch.id, isVariant: true, stock: 99 };
    const before = state().activeOrders;
    expect(await state().addItem(sizeL, 'A')).toMatchObject({ success: false });
    expect(state().activeOrders).toBe(before);
    expect(await state().addItem(sizeM, 'A')).toMatchObject({ success: true });
    expect(items('A')[0].batchId).toBe(batch.id);
  });
  it('impide añadir un tercer código directo y vuelve a aceptar tras liberarse el compromiso', async () => {
    const direct = { ...product, batchManagement: { enabled: false }, isVariant: false,
      stock: 5, committedStock: 3 };
    await db.table(STORES.MENU).put(direct);
    expect(await state().addSmartItem(direct, 'A')).toMatchObject({ success: true });
    expect(await state().addSmartItem(direct, 'A')).toMatchObject({ success: true });
    const before = state().activeOrders;
    expect(await state().addSmartItem(direct, 'A')).toMatchObject({ success: false, code: 'LOCAL_FORMAL_RESERVATION' });
    expect(state().activeOrders).toBe(before);
    await db.table(STORES.MENU).update(direct.id, { committedStock: 0 });
    expect(await state().addSmartItem({ ...direct, committedStock: 0 }, 'A')).toMatchObject({ success: true });
    expect(items('A')[0].quantity).toBe(3);
  });
});
