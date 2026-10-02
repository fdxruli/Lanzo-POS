// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  database: null, appState: null, cloudStock: new Map(), failBeforeCommit: false, cloudMode: true,
  transport: vi.fn(), postEffects: vi.fn(), storage: new Map(),
  actorHandle: { assertCurrent: vi.fn() }
}));

vi.mock('../../../services/db/dexie', () => ({
  STORES: { SALES: 'sales', MENU: 'menu', CATEGORIES: 'categories', PRODUCT_BATCHES: 'product_batches',
    CUSTOMERS: 'customers', SYNC_CACHE: 'sync_cache', TRANSACTION_LOG: 'transaction_log',
    INVENTORY_EVENTS: 'inventory_events', SEQUENCES: 'sequences', COMPANY: 'company' },
  db: {
    table: (name) => runtime.database.table(name),
    transaction: (...args) => runtime.database.transaction(...args),
    isOpen: () => runtime.database.isOpen(), open: () => runtime.database.open()
  }
}));
vi.mock('../../../services/db', async () => await import('../../../services/db/dexie'));
vi.mock('../../../services/database', () => ({
  createProductWithInitialInventorySafe: vi.fn(), loadData: vi.fn(), loadDataPaginated: vi.fn(),
  saveBatchAndSyncProductSafe: vi.fn(), saveImageToDB: vi.fn(), softDeleteWithCascadeSafe: vi.fn(), updateProductSafe: vi.fn()
}));
vi.mock('../../../services/db/general', () => ({ categoriesRepository: {} }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector(runtime.appState), {
    getState: () => runtime.appState, subscribe: () => () => {}
  })
}));
vi.mock('../../../services/tenant/localTenantPolicy', () => ({
  canAccessTenantOwnedRuntimeCache: () => true,
  localTenantAccessController: { subscribe: () => () => {} }
}));
vi.mock('../../../services/tenant/tenantScopedStorage', () => ({
  tenantScopedZustandStorage: {
    getItem: (key) => runtime.storage.get(key) || null,
    setItem: (key, value) => runtime.storage.set(key, value),
    removeItem: (key) => runtime.storage.delete(key)
  },
  registerTenantStorageHydrator: vi.fn(), suspendTenantStorageWrites: vi.fn()
}));
vi.mock('../../../services/supabase', () => ({ getStableDeviceId: async () => 'device-a' }));
vi.mock('../../../services/auth/refundsActorAuthorization', () => ({
  captureRefundsActorHandle: () => runtime.actorHandle
}));
vi.mock('../../../services/auth/actorRuntimeController', () => ({
  actorRuntimeController: { capture: () => runtime.actorHandle, subscribe: () => () => {} }
}));
vi.mock('../../../services/utils', () => ({
  generateID: () => `sal-${crypto.randomUUID()}`, safeLocalStorageSet: vi.fn(),
  generateIDForTransaction: () => crypto.randomUUID(),
  showMessageModal: vi.fn(), showConfirmModal: vi.fn(async () => true),
  roundCurrency: (value) => Math.round(Number(value) * 100) / 100
}));
vi.mock('../../../components/common/InputPromptModal', () => ({ showInputPromptModal: vi.fn() }));
vi.mock('../../../services/Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), time: vi.fn(), timeEnd: vi.fn() }
}));
vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({ releaseEcommerceOrderPosDraft: vi.fn() }));
vi.mock('../../../services/db/layaways', () => ({ layawayRepository: {} }));
vi.mock('../../../services/products/productSyncHandler', () => ({ pullCatalogChanges: vi.fn(async () => {}) }));
vi.mock('../../../services/cash/cashRepository', () => ({
  cashRepository: { getCurrentCashSession: async () => ({
    success: true, cashSession: { id: 'cash-session', estado: 'abierta' }
  }) }
}));
vi.mock('../../../services/sync/syncConstants', async (importOriginal) => ({
  ...await importOriginal(),
  getLicenseKeyFromDetails: () => runtime.cloudMode ? 'fixture-license' : null,
  isRestaurantOrdersCloudEnabled: () => runtime.cloudMode,
  isCloudSalesCashierEnabled: () => runtime.cloudMode, isCloudSalesCreditEnabled: () => runtime.cloudMode,
  isCloudSalesInventoryEnabled: () => runtime.cloudMode
}));
vi.mock('../../restaurant/useRestaurantOrderCloudStatus', () => ({
  getRestaurantOrderCloudStatusSnapshot: async () => ({ skipped: true })
}));
vi.mock('../../../services/restaurant/restaurantOrdersRepository', () => ({
  restaurantOrdersRepository: { getRestaurantOrderByLocalOrder: async ({ localOrderId }) => {
    const sale = await runtime.database.table('sales').get(localOrderId);
    const { buildRestaurantOrderPayloadFromOpenSale } = await import('../../../services/restaurant/restaurantOrderMapper');
    const payload = buildRestaurantOrderPayloadFromOpenSale({ sale });
    return { success: true, found: true, order: {
      ...payload.order, id: `restaurant-${localOrderId}`, status: 'delivered', fulfillmentStatus: 'delivered', paymentStatus: 'unpaid',
      updatedAt: sale.updatedAt, items: payload.items.map((item) => ({ ...item, status: 'delivered' }))
    } };
  } }
}));
vi.mock('../../../services/salesCloud/salesCloudRepository', () => ({
  salesCloudRepository: { createCloudSplitTableSale: (...args) => runtime.transport(...args) }
}));
vi.mock('../../../services/salesCloud/salesCloudShadowService', () => ({
  salesCloudShadowService: { syncSaleShadowAfterLocalCommit: vi.fn(async () => ({ skipped: true })) }
}));
vi.mock('../../../services/sales/postSaleEffects', () => ({
  runPostSaleEffects: vi.fn(), runPostSaleEffectsForCloudCommittedSale: (...args) => runtime.postEffects(...args)
}));
vi.mock('../../../services/salesService', () => ({
  splitOpenTableOrder: async (params) => {
    const { splitOpenTableOrderCore } = await import('../../../services/sales/splitOrderService');
    const { STORES } = await import('../../../services/db/dexie');
    const Logger = (await import('../../../services/Logger')).default;
    const { salesRepository } = await import('../../../services/db/sales');
    return splitOpenTableOrderCore(params, {
      loadData: (store, id) => runtime.database.table(store).get(id),
      loadMultipleData: (store) => runtime.database.table(store).toArray(), STORES, Logger,
      executeSplitOpenTableOrderTransactionSafe: (args) => salesRepository.executeSplitOpenTableOrderTransaction(args),
      roundCurrency: (value) => Math.round(Number(value) * 100) / 100
    });
  }
}));

import { useTableManagement } from '../useTableManagement';
import { useActiveOrders } from '../useActiveOrders';
import { db, STORES } from '../../../services/db/dexie';
import * as inventoryFlow from '../../../services/sales/inventoryFlow';
import { salesCloudLocalRepository } from '../../../services/salesCloud/salesCloudLocalRepository';
import { salesRepository } from '../../../services/db/sales';
import { productLocalRepository } from '../../../services/products/productLocalRepository';
import { useActiveTablesCount } from '../useActiveTablesCount';

const makeItem = (id = 'burger', price = 300) => ({
  id, lineId: `line-${id}`, name: id === 'burger' ? 'Hamburguesa QA' : id,
  quantity: 1, price, unitPrice: price, selectedModifiers: []
});
const seedTable = async (id, items = [makeItem()]) => {
  const reservedItems = await inventoryFlow.commitStock(items, { db, STORES });
  const sale = { id, items: reservedItems, status: 'open', fulfillmentStatus: 'open',
    orderType: 'table', tableData: `Mesa ${id}`, currency: 'MXN',
    total: items.reduce((total, item) => total + item.price * item.quantity, 0),
    timestamp: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-29T10:01:00.000Z' };
  await db.table(STORES.SALES).put(sale);
  const activeOrders = new Map(useActiveOrders.getState().activeOrders);
  activeOrders.set(id, { ...sale, isSaved: true });
  useActiveOrders.setState({ activeOrders, currentOrderId: id });
  return sale;
};
const payload = (amounts = [150, 150], splitIntent = 'equal_payment') => ({
  splitIntent, tickets: amounts.map((amount, index) => ({
    label: `T${index + 1}`, amountCents: amount * 100,
    paymentData: { paymentMethod: 'efectivo', amountPaid: String(amount) }, lines: []
  }))
});
const confirm = async (splitPayload = payload(), overrides = {}) => {
  const deps = { openModal: vi.fn(), closeModal: vi.fn(), refreshData: vi.fn(),
    fetchActiveTablesCount: vi.fn(), features: { hasTables: true },
    cajaActual: { id: 'cash-session', estado: 'abierta' }, ...overrides };
  const hook = renderHook(() => useTableManagement(deps));
  let response;
  await act(async () => { response = await hook.result.current.handleConfirmSplitBill(splitPayload); });
  return { response, deps };
};

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubEnv('VITE_ENABLE_CLOUD_CASHIER_SALES', 'true');
  runtime.storage.clear();
  runtime.cloudStock = new Map([['burger', 10], ['pizza', 10], ['drink', 10]]);
  runtime.failBeforeCommit = false;
  runtime.cloudMode = true;
  runtime.postEffects.mockResolvedValue(undefined);
  runtime.appState = { enableMultipleOrders: true, companyProfile: { name: 'Lanzo' },
    verifySessionIntegrity: async () => true, licenseDetails: { valid: true, license_key: 'fixture-license' } };
  const database = new Dexie(`split-reservations-${crypto.randomUUID()}`);
  database.version(1).stores({ sales: 'id,status', menu: 'id', categories: 'id', product_batches: 'id,productId',
    customers: 'id', sync_cache: 'key', transaction_log: 'id',
    inventory_events: 'id,[saleId+productId]', sequences: 'id', company: 'id' });
  await database.open();
  runtime.database = database;
  await database.table('menu').bulkPut(['burger', 'pizza', 'drink'].map((id) => ({
    id, name: id === 'burger' ? 'Hamburguesa QA' : id, stock: 10, committedStock: 0,
    trackStock: true, price: 300, cost: 30
  })));
  useActiveOrders.setState({ activeOrders: new Map(), currentOrderId: null,
    isLoading: false, isCurrentOrderLocked: false, pendingInventoryResolutions: new Map() });
  // Only the remote transport is simulated; core, cashier projection,
  // repository reconciliation, inventory and runtime cleanup run unchanged.
  runtime.transport.mockImplementation(async ({ split, project, actorHandle }) => {
    if (runtime.failBeforeCommit) throw new Error('CLOUD_PRECOMMIT_FAILED');
    const children = split.children.map((child, index) => {
      child.local_items.forEach((item) => runtime.cloudStock.set(item.id,
        runtime.cloudStock.get(item.id) - Number(item.quantity)));
      return { sale: { ...child.sale, id: `cloud-${index}`, local_sale_id: child.sale.local_sale_id,
        status: 'closed', effects_status: 'payment_recorded', inventory_effect_status: 'applied' },
      items: [], payments: child.payments };
    });
    const responsePayload = { success: true, children };
    const result = await project({ requestPayload: split, responsePayload, actorHandle });
    return { ...responsePayload, projection: { outcome: 'projection_applied', result } };
  });
});

describe('Mini-phase 3A.1 catalog desync and cancellation', () => {
  it('repairs a persisted table with committedStock=0 before real cancellation', async () => {
    await seedTable('A');
    await db.table('menu').update('burger', { committedStock: 0 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(errors).not.toHaveBeenCalled();
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
    expect(await db.table('sales').get('A')).toMatchObject({ status: 'cancelled' });
  });

  it.each(['applyCloudProduct', 'applyCloudCatalog'])('%s preserves one reservation and cancellation releases exactly once', async (method) => {
    await seedTable('A');
    const cloud = { id: 'burger', name: 'Hamburguesa QA', stock: 10, committed_stock: 0, track_stock: true };
    await productLocalRepository[method](method === 'applyCloudCatalog' ? { products: [cloud] } : cloud);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(errors).not.toHaveBeenCalled();
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
  });

  it('pull with two tables keeps B unchanged when A cancels, then releases B', async () => {
    await seedTable('A');
    const other = await seedTable('B');
    await productLocalRepository.applyCloudCatalog({ products: [{ id: 'burger', stock: 10, committed_stock: 0 }] });
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 2 });
    await useActiveOrders.getState().cancelOrder('A');
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 1 });
    expect(await db.table('sales').get('B')).toEqual(other);
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 0 });
  });

  it.each([1, 2])('badge with %s table(s) updates immediately after cancellation', async (count) => {
    await seedTable('A');
    if (count === 2) await seedTable('B');
    const hook = renderHook(() => useActiveTablesCount(true));
    await waitFor(() => expect(hook.result.current.activeTablesCount).toBe(count));
    await act(async () => { await useActiveOrders.getState().cancelOrder('A'); });
    await waitFor(() => expect(hook.result.current.activeTablesCount).toBe(count - 1));
  });

  it('a failed cancellation rolls back stock, retains the table and keeps badge=1', async () => {
    const parent = await seedTable('A');
    const hook = renderHook(() => useActiveTablesCount(true));
    await waitFor(() => expect(hook.result.current.activeTablesCount).toBe(1));
    vi.spyOn(runtime.database.table('sales'), 'update').mockRejectedValueOnce(new Error('DB_CANCEL_FAILED'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(useActiveOrders.getState().cancelCurrentOrder()).rejects.toThrow('DB_CANCEL_FAILED');
    expect(await db.table('sales').get('A')).toEqual(parent);
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 1 });
    expect(useActiveOrders.getState().activeOrders.has('A')).toBe(true);
    expect(hook.result.current.activeTablesCount).toBe(1);
    expect(errors).toHaveBeenCalled();
  });

  it.each(['applyCloudBatch', 'applyCloudCatalog'])('%s preserves batches and their parent for two tables', async (method) => {
    await db.table('menu').update('burger', { batchManagement: { enabled: true } });
    await db.table('product_batches').put({ id: 'batch-burger', productId: 'burger', stock: 10, committedStock: 0, cost: 30 });
    await seedTable('A');
    const other = await seedTable('B');
    const batch = { id: 'batch-burger', product_id: 'burger', stock: 10, committed_stock: 0 };
    await productLocalRepository[method](method === 'applyCloudCatalog'
      ? { products: [{ id: 'burger', stock: 10, committed_stock: 0 }], batches: [batch] } : batch);
    expect(await db.table('product_batches').get('batch-burger')).toMatchObject({ committedStock: 2 });
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 2 });
    await useActiveOrders.getState().cancelOrder('A');
    expect(await db.table('product_batches').get('batch-burger')).toMatchObject({ committedStock: 1 });
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 1 });
    expect(await db.table('sales').get('B')).toEqual(other);
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(await db.table('product_batches').get('batch-burger')).toMatchObject({ committedStock: 0 });
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 0 });
  });

  it.each([false, true])('recipe ingredients survive pull and cancellation (mixed batches=%s)', async (mixed) => {
    await db.table('menu').bulkPut([
      { id: 'bread', stock: 10, committedStock: 0, trackStock: true, batchManagement: { enabled: mixed } },
      { id: 'meat', stock: 10, committedStock: 0, trackStock: true }
    ]);
    if (mixed) await db.table('product_batches').put({ id: 'batch-bread', productId: 'bread', stock: 10, committedStock: 0 });
    await db.table('menu').update('burger', { trackStock: false, recipe: [
      { ingredientId: 'bread', quantity: 1 }, { ingredientId: 'meat', quantity: 1 }
    ] });
    const other = await seedTable('B');
    await seedTable('A');
    await productLocalRepository.applyCloudCatalog({
      products: ['burger', 'bread', 'meat'].map((id) => ({ id, stock: 10, committed_stock: 0 })),
      batches: mixed ? [{ id: 'batch-bread', product_id: 'bread', stock: 10, committed_stock: 0 }] : []
    });
    for (const id of ['bread', 'meat']) expect(await db.table('menu').get(id)).toMatchObject({ committedStock: 2 });
    await useActiveOrders.getState().cancelOrder('A');
    for (const id of ['bread', 'meat']) expect(await db.table('menu').get(id)).toMatchObject({ committedStock: 1 });
    expect(await db.table('sales').get('B')).toEqual(other);
    await useActiveOrders.getState().cancelCurrentOrder();
    for (const id of ['bread', 'meat']) expect(await db.table('menu').get(id)).toMatchObject({ committedStock: 0 });
  });

  it('pull after Cloud settlement does not restore A and still preserves B', async () => {
    await seedTable('A');
    await seedTable('B');
    useActiveOrders.setState({ currentOrderId: 'A' });
    expect((await confirm()).response.success).toBe(true);
    await productLocalRepository.applyCloudCatalog({ products: [{ id: 'burger', stock: 9, committed_stock: 0 }] });
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 9, committedStock: 1 });
    await useActiveOrders.getState().cancelCurrentOrder();
    await productLocalRepository.applyCloudProduct({ id: 'burger', stock: 9, committed_stock: 0 });
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 9, committedStock: 0 });
  });

  it('rebuilds both known holds during pull when the old local value is already zero', async () => {
    await seedTable('A');
    await seedTable('B');
    await db.table('menu').update('burger', { committedStock: 0 });
    await productLocalRepository.applyCloudProduct({ id: 'burger', stock: 10, committed_stock: 0 });
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 2 });
    await useActiveOrders.getState().cancelOrder('A');
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 1 });
  });

  it('a catalog pull concurrent with cancellation cannot restore the cancelled hold', async () => {
    await seedTable('A');
    await seedTable('B');
    await Promise.all([
      useActiveOrders.getState().cancelOrder('A'),
      productLocalRepository.applyCloudProduct({ id: 'burger', stock: 10, committed_stock: 0 })
    ]);
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 1 });
    expect(await db.table('sales').get('A')).toMatchObject({ status: 'cancelled' });
  });

  it('missing reserved batch aborts cancellation and preserves the open order', async () => {
    await db.table('menu').update('burger', { batchManagement: { enabled: true } });
    await db.table('product_batches').put({ id: 'batch-burger', productId: 'burger', stock: 10, committedStock: 0 });
    const parent = await seedTable('A');
    await db.table('product_batches').delete('batch-burger');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(useActiveOrders.getState().cancelOrder('A')).rejects.toThrow('CRITICAL_BATCH_NOT_FOUND');
    expect(await db.table('sales').get('A')).toEqual(parent);
    expect(useActiveOrders.getState().activeOrders.has('A')).toBe(true);
  });

  it('a genuine duplicate batch release still throws CRITICAL_COMMITTED_UNDERFLOW', async () => {
    await db.table('menu').update('burger', { batchManagement: { enabled: true } });
    await db.table('product_batches').put({ id: 'batch-burger', productId: 'burger', stock: 10, committedStock: 0 });
    const parent = await seedTable('A');
    await useActiveOrders.getState().cancelCurrentOrder();
    await expect(inventoryFlow.releaseCommittedStock(parent.items, { db, STORES })).rejects.toThrow('CRITICAL_COMMITTED_UNDERFLOW');
  });

  it.each([false, true])('legacy recipes without committedProducts retain their ingredient holds (mixed=%s)', async (mixed) => {
    runtime.cloudMode = false;
    await db.table('menu').bulkPut([
      { id: 'bread', stock: 10, committedStock: 0, trackStock: true, batchManagement: { enabled: mixed } },
      { id: 'meat', stock: 10, committedStock: 0, trackStock: true }
    ]);
    if (mixed) await db.table('product_batches').put({ id: 'batch-bread', productId: 'bread', stock: 10, committedStock: 0 });
    await db.table('menu').update('burger', { trackStock: false, recipe: [
      { ingredientId: 'bread', quantity: 1 }, { ingredientId: 'meat', quantity: 1 }
    ] });
    const sale = await seedTable('A');
    delete sale.items[0].inventoryReservation.committedProducts;
    await db.table('sales').put(sale);
    await db.table('menu').update('meat', { committedStock: 0 });
    await useActiveOrders.getState().cancelCurrentOrder();
    for (const id of ['bread', 'meat']) expect(await db.table('menu').get(id)).toMatchObject({ committedStock: 0 });
    expect(runtime.transport).not.toHaveBeenCalled();
  });

  it('recipe snapshots survive a recipe edit in the Cloud catalog before cancellation', async () => {
    await db.table('menu').put({ id: 'bread', stock: 10, committedStock: 0, trackStock: true });
    await db.table('menu').update('burger', { trackStock: false, recipe: [{ ingredientId: 'bread', quantity: 1 }] });
    await seedTable('A');
    await productLocalRepository.applyCloudProduct({ id: 'burger', stock: 10, recipe: [], track_stock: false });
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(await db.table('menu').get('bread')).toMatchObject({ committedStock: 0 });
  });

  it('Cloud settlement reconciles recipe components once and pull does not resurrect them', async () => {
    await db.table('menu').put({ id: 'bread', stock: 10, committedStock: 0, trackStock: true });
    await db.table('menu').update('burger', { trackStock: false, recipe: [{ ingredientId: 'bread', quantity: 1 }] });
    await seedTable('B');
    await seedTable('A');
    expect((await confirm()).response.success).toBe(true);
    expect(await db.table('menu').get('bread')).toMatchObject({ committedStock: 1 });
    await productLocalRepository.applyCloudProduct({ id: 'bread', stock: 9, committed_stock: 0 });
    expect(await db.table('menu').get('bread')).toMatchObject({ committedStock: 1 });
    await salesCloudLocalRepository.markLocalSplitParentSettled({ parentOrderId: 'A' });
    expect(await db.table('menu').get('bread')).toMatchObject({ committedStock: 1 });
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(await db.table('menu').get('bread')).toMatchObject({ committedStock: 0 });
  });
});

describe('Free/local inventory regressions', () => {
  it('real table cancellation still releases one reservation without a sale', async () => {
    runtime.appState.licenseDetails = { valid: true, plan: 'free' };
    runtime.cloudMode = false;
    await seedTable('A');
    const release = vi.spyOn(inventoryFlow, 'releaseCommittedStock');
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(release).toHaveBeenCalledTimes(1);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
    expect(await db.table('sales').where('status').equals('closed').count()).toBe(0);
    expect(runtime.transport).not.toHaveBeenCalled();
  });

  it('local Split Bill settles through the hook and cleans runtime without releasing the other table', async () => {
    runtime.appState.licenseDetails = { valid: true, plan: 'free' };
    runtime.cloudMode = false;
    const other = await seedTable('B');
    const parent = await seedTable('A', [{ ...makeItem('burger', 150), quantity: 2 }]);
    const release = vi.spyOn(inventoryFlow, 'releaseCommittedStock');
    const { response } = await confirm({
      splitIntent: 'by_items',
      tickets: ['T1', 'T2'].map((label) => ({ label,
        lines: [{ lineIndex: 0, quantity: 1 }], paymentData: { paymentMethod: 'tarjeta', amountPaid: '150' }
      }))
    });
    expect(response.success, response.message).toBe(true);
    expect(response.childSales).toHaveLength(2);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 8, committedStock: 1 });
    expect(await db.table('sales').get('A')).toMatchObject({ status: 'cancelled', cancelReason: 'split_settled' });
    expect(await db.table('sales').get('B')).toEqual(other);
    expect(useActiveOrders.getState().activeOrders.has(parent.id)).toBe(false);
    expect(useActiveOrders.getState().currentOrderId).toBe('B');
    expect(release).not.toHaveBeenCalled();
    expect(runtime.transport).not.toHaveBeenCalled();
  });

  it('normal local checkout and close remove the tab without another inventory effect', async () => {
    runtime.appState.licenseDetails = { valid: true, plan: 'free' };
    runtime.cloudMode = false;
    const parent = await seedTable('A');
    const { processedItems, batchesToDeduct } = inventoryFlow.buildProcessedItemsAndDeductions({
      itemsToProcess: parent.items, allProducts: await db.table('menu').toArray(),
      batchesMap: new Map(), roundCurrency: (value) => Math.round(Number(value) * 100) / 100
    });
    const release = vi.spyOn(inventoryFlow, 'releaseCommittedStock');
    expect(await salesRepository.executeSaleTransaction({ ...parent, items: processedItems,
      status: 'closed', paymentMethod: 'tarjeta', abono: '300', saldoPendiente: '0' }, batchesToDeduct))
      .toMatchObject({ success: true });
    await useActiveOrders.getState().closeOrder('A', { paymentMethod: 'tarjeta' });
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 9, committedStock: 0 });
    expect(useActiveOrders.getState().activeOrders.has('A')).toBe(false);
    expect(await db.table('sales').get('A')).toMatchObject({ status: 'closed' });
    expect(release).not.toHaveBeenCalled();
    expect(runtime.transport).not.toHaveBeenCalled();
  });
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await runtime.database.delete(); });

describe('Cloud Split Bill reservation isolation', () => {
  it('QA-07: reconciles once and cleans runtime without CRITICAL_COMMITTED_UNDERFLOW', async () => {
    const parent = await seedTable('A');
    const release = vi.spyOn(inventoryFlow, 'releaseCommittedStock');
    const cancel = vi.spyOn(useActiveOrders.getState(), 'cancelCurrentOrder');
    const { response, deps } = await confirm();
    expect(response.success, response.message).toBe(true);
    expect(runtime.cloudStock.get('burger')).toBe(9);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
    expect(release).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(useActiveOrders.getState().activeOrders.has('A')).toBe(false);
    expect(useActiveOrders.getState().activeOrders.get(useActiveOrders.getState().currentOrderId).items).toEqual([]);
    expect(deps.closeModal).toHaveBeenCalledWith('split');
    expect(await db.table('sales').get('A')).toMatchObject({ status: 'cancelled', fulfillmentStatus: 'completed',
      splitSettlementSource: 'cloud_committed', splitReservationReconcileStatus: 'completed', syncStatus: 'SYNCED' });
    // The diagnostic still rejects a genuinely invalid second release.
    await expect(inventoryFlow.releaseCommittedStock(parent.items, { db, STORES }))
      .rejects.toThrow('CRITICAL_COMMITTED_UNDERFLOW: El producto Hamburguesa QA intenta liberar 1, pero solo tiene 0 comprometido.');
    // Catalog authority is applied separately; cleanup never deducts physical stock.
    await db.table('menu').update('burger', { stock: runtime.cloudStock.get('burger') });
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 9, committedStock: 0 });
  });

  it('two tables sharing a product keep Mesa B reservation through settlement, cleanup and reload', async () => {
    await seedTable('A');
    const other = await seedTable('B');
    useActiveOrders.setState({ currentOrderId: 'A' });
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 2 });
    const release = vi.spyOn(inventoryFlow, 'releaseCommittedStock');
    const { response } = await confirm();
    expect(response.success, response.message).toBe(true);
    expect(runtime.cloudStock.get('burger')).toBe(9);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
    expect(release).not.toHaveBeenCalled();
    expect(await db.table('sales').get('B')).toEqual(other);
    expect(useActiveOrders.getState().currentOrderId).toBe('B');
    expect(useActiveOrders.getState().activeOrders.get('B').items[0].inventoryReservation.committedQuantity).toBe(1);
    const persisted = runtime.storage.get('lanzo-active-orders-storage');
    useActiveOrders.setState({ activeOrders: new Map(), currentOrderId: null });
    runtime.storage.set('lanzo-active-orders-storage', persisted);
    await useActiveOrders.persist.rehydrate();
    await useActiveOrders.getState().loadOrdersFromDB();
    expect(useActiveOrders.getState().activeOrders.has('A')).toBe(false);
    expect(useActiveOrders.getState().activeOrders.has('B')).toBe(true);
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 1 });
  });

  it('manual cancellation before any sale releases exactly once and preserves physical stock', async () => {
    await seedTable('A');
    const release = vi.spyOn(inventoryFlow, 'releaseCommittedStock');
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(release).toHaveBeenCalledTimes(1);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
    expect(await db.table('sales').get('A')).toMatchObject({ status: 'cancelled', fulfillmentStatus: 'cancelled' });
    expect(await db.table('sales').where('status').equals('closed').count()).toBe(0);
    expect(runtime.transport).not.toHaveBeenCalled();
  });

  it('precommit failure retains the table and its reservation for a successful retry', async () => {
    const parent = await seedTable('A');
    runtime.failBeforeCommit = true;
    const release = vi.spyOn(inventoryFlow, 'releaseCommittedStock');
    const { response, deps } = await confirm();
    expect(response.success).toBe(false);
    expect(await db.table('sales').get('A')).toEqual(parent);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
    expect(useActiveOrders.getState().activeOrders.has('A')).toBe(true);
    expect(deps.closeModal).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    runtime.failBeforeCommit = false;
    expect((await confirm()).response.success).toBe(true);
  });

  it.each(['postEffects', 'refreshData', 'closeModal', 'fetchActiveTablesCount'])(
  'keeps a confirmed sale when %s fails, without recobro or cancellation', async (stage) => {
    await seedTable('A');
    const failure = vi.fn().mockRejectedValue(new Error('CACHE_UI_FAILURE'));
    const overrides = {};
    if (stage === 'postEffects') runtime.postEffects.mockRejectedValue(new Error('RECEIPT_FAILURE'));
    else if (stage === 'closeModal') overrides.closeModal = vi.fn(() => { throw new Error('MODAL_FAILURE'); });
    else overrides[stage] = failure;
    const { response } = await confirm(payload(), overrides);
    expect(response).toMatchObject({ success: true, cloudCommitted: true });
    expect(runtime.transport).toHaveBeenCalledTimes(1);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
    expect(useActiveOrders.getState().activeOrders.has('A')).toBe(false);
    expect(await db.table('sales').where('status').equals('closed').count()).toBe(1);
    expect(await db.table('sales').get('A')).toMatchObject({ splitSettlementSource: 'cloud_committed', fulfillmentStatus: 'completed' });
  });

  it('BY_ITEMS reconciles a multi-product parent once and preserves another table', async () => {
    await seedTable('B');
    await seedTable('A', [makeItem(), makeItem('drink', 50)]);
    const { response } = await confirm({ splitIntent: 'by_items', tickets: [
      { label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }], paymentData: { paymentMethod: 'efectivo', amountPaid: '300' } },
      { label: 'T2', lines: [{ lineIndex: 1, quantity: 1 }], paymentData: { paymentMethod: 'tarjeta', amountPaid: '50' } }
    ] });
    expect(response.success, response.message).toBe(true);
    expect(response.childSales).toHaveLength(2);
    expect(runtime.cloudStock.get('burger')).toBe(9);
    expect(runtime.cloudStock.get('drink')).toBe(9);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
    expect(await db.table('menu').get('drink')).toMatchObject({ stock: 10, committedStock: 0 });
    expect(useActiveOrders.getState().activeOrders.has('B')).toBe(true);
  });

  it.each([
    ['equal_payment', 'pizza', 300, [150, 150]],
    ['custom_payment', 'burger', 1000, [300, 350, 350]]
  ])('%s uses one commercial sale and one parent reconciliation', async (intent, productId, price, amounts) => {
    await seedTable('A', [makeItem(productId, price)]);
    const { response } = await confirm(payload(amounts, intent));
    expect(response.success, response.message).toBe(true);
    expect(response.childSales).toHaveLength(1);
    expect(runtime.cloudStock.get(productId)).toBe(9);
    expect(await db.table('menu').get(productId)).toMatchObject({ stock: 10, committedStock: 0 });
  });

  it('repeated and concurrent reconciliation returns the same state with no new writes', async () => {
    await seedTable('A');
    await seedTable('B');
    const args = { parentOrderId: 'A', splitGroupId: 'group', childSaleIds: ['child'] };
    const [first, concurrent] = await Promise.all([
      salesCloudLocalRepository.markLocalSplitParentSettled(args),
      salesCloudLocalRepository.markLocalSplitParentSettled(args)
    ]);
    expect(concurrent).toEqual(first);
    const products = await db.table('menu').toArray();
    expect(await salesCloudLocalRepository.markLocalSplitParentSettled(args)).toEqual(first);
    expect(await db.table('menu').toArray()).toEqual(products);
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
  });

  it('reconciles batch reservations once and keeps the other table and parent aggregate intact', async () => {
    await db.table('menu').update('burger', { batchManagement: { enabled: true, selectionStrategy: 'fifo' } });
    await db.table('product_batches').put({ id: 'batch-burger', productId: 'burger',
      stock: 10, committedStock: 0, cost: 30, isActive: true, createdAt: '2026-09-01T00:00:00Z' });
    const other = await seedTable('B');
    await seedTable('A');
    expect(await db.table('product_batches').get('batch-burger')).toMatchObject({ committedStock: 2 });
    const { response } = await confirm();
    expect(response.success, response.message).toBe(true);
    expect(await db.table('product_batches').get('batch-burger')).toMatchObject({ stock: 10, committedStock: 1 });
    expect(await db.table('menu').get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
    expect(await db.table('sales').get('B')).toEqual(other);
    await salesCloudLocalRepository.markLocalSplitParentSettled({ parentOrderId: 'A' });
    expect(await db.table('product_batches').get('batch-burger')).toMatchObject({ stock: 10, committedStock: 1 });
  });

  it.each(['cancelCurrentOrder', 'cancelOrder'])('a stale %s on a reconciled parent only removes runtime', async (method) => {
    await seedTable('A');
    await seedTable('B');
    useActiveOrders.setState({ currentOrderId: 'A' });
    const settled = await salesCloudLocalRepository.markLocalSplitParentSettled({ parentOrderId: 'A' });
    const release = vi.spyOn(inventoryFlow, 'releaseCommittedStock');
    await useActiveOrders.getState()[method]('A');
    expect(release).not.toHaveBeenCalled();
    expect(await db.table('sales').get('A')).toEqual(settled);
    expect(await db.table('menu').get('burger')).toMatchObject({ committedStock: 1 });
    expect(useActiveOrders.getState().currentOrderId).toBe('B');
  });
});
