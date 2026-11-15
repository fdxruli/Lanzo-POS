// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  database: null, appState: null, cloudOrder: null, storage: new Map(),
  cloudLookup: vi.fn(), cloudStatus: vi.fn(), splitSale: vi.fn(), processSale: vi.fn(),
  financialTransport: vi.fn(), currentCash: vi.fn(), cloudSplitCapability: vi.fn(),
  showMessage: vi.fn(), showConfirm: vi.fn(), onSalePut: null
}));

vi.mock('../../../services/db/dexie', () => ({
  STORES: { SALES: 'sales', MENU: 'menu', PRODUCT_BATCHES: 'product_batches',
    CUSTOMERS: 'customers', CUSTOMER_LEDGER: 'customer_ledger', COMPANY: 'company', CATEGORIES: 'categories',
    CAJAS: 'cajas', MOVIMIENTOS_CAJA: 'movimientos_caja', DELETED_SALES: 'deleted_sales',
    WASTE: 'waste_logs', TRANSACTION_LOG: 'transaction_log', INVENTORY_EVENTS: 'inventory_events', SEQUENCES: 'sequences' },
  db: {
    table: (name) => {
      const table = fixture.database.table(name);
      if (name !== 'sales' || typeof fixture.onSalePut !== 'function') return table;
      const put = table.put.bind(table);
      table.put = async (record) => {
        const result = await put(record);
        fixture.onSalePut(record);
        return result;
      };
      return table;
    },
    transaction: (...args) => fixture.database.transaction(...args),
    isOpen: () => fixture.database.isOpen(), open: () => fixture.database.open()
  }
}));
vi.mock('../../../services/db', async () => await import('../../../services/db/dexie'));
vi.mock('../../../services/db/tenantRuntimeRouter', () => ({
  isTenantRuntimeError: () => false,
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: {
    opaqueId: 'tenant-a', databaseName: fixture.database?.name || 'multidevice', generation: 1
  } })
}));
vi.mock('../../../services/tenant/localTenantGuard', () => ({ isLocalTenantAccessError: () => false }));
vi.mock('../../../services/database', () => ({
  createProductWithInitialInventorySafe: vi.fn(), loadData: vi.fn(), loadDataPaginated: vi.fn(),
  saveBatchAndSyncProductSafe: vi.fn(), saveImageToDB: vi.fn(), softDeleteWithCascadeSafe: vi.fn(), updateProductSafe: vi.fn()
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector(fixture.appState), {
    getState: () => fixture.appState, subscribe: () => () => {}
  })
}));
vi.mock('../../../services/tenant/localTenantPolicy', () => ({
  canAccessTenantOwnedRuntimeCache: () => true,
  localTenantAccessController: { subscribe: () => () => {} }
}));
vi.mock('../../../services/tenant/tenantScopedStorage', () => ({
  tenantScopedZustandStorage: {
    getItem: (key) => fixture.storage.get(key) || null,
    setItem: (key, value) => fixture.storage.set(key, value),
    removeItem: (key) => fixture.storage.delete(key)
  },
  registerTenantStorageHydrator: vi.fn(), suspendTenantStorageWrites: vi.fn()
}));
vi.mock('../../../services/supabase', () => ({ getStableDeviceId: async () => 'device-b' }));
vi.mock('../../../services/utils', () => ({
  generateID: () => `sal-${crypto.randomUUID()}`, safeLocalStorageSet: vi.fn(),
  generateIDForTransaction: () => crypto.randomUUID(),
  showMessageModal: (...args) => fixture.showMessage(...args),
  showConfirmModal: (...args) => fixture.showConfirm(...args),
  roundCurrency: (value) => Math.round(Number(value) * 100) / 100
}));
vi.mock('../../../components/common/InputPromptModal', () => ({ showInputPromptModal: vi.fn() }));
vi.mock('../../../services/Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), time: vi.fn(), timeEnd: vi.fn() }
}));
vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({ releaseEcommerceOrderPosDraft: vi.fn() }));
vi.mock('../../../services/db/layaways', () => ({ layawayRepository: {} }));
vi.mock('../../../services/cash/cashRepository', () => ({
  cashRepository: { getCurrentCashSession: (...args) => fixture.currentCash(...args) }
}));
vi.mock('../../../services/salesCloud/salesCloudCashierService', () => ({
  salesCloudCashierService: { canUseCloudSplitTableSale: (...args) => fixture.cloudSplitCapability(...args) }
}));
vi.mock('../../../services/sales/postSaleEffects', () => ({
  runPostSaleEffects: vi.fn(async () => undefined),
  runPostSaleEffectsForCloudCommittedSale: vi.fn(async () => undefined)
}));
vi.mock('../../../services/salesCloud/salesCloudShadowService', () => ({
  salesCloudShadowService: { syncSaleShadowAfterLocalCommit: vi.fn(async () => ({ skipped: true })) }
}));
vi.mock('../../../services/salesCloud/salesCloudRepository', () => ({
  salesCloudRepository: { createCloudSplitTableSale: (...args) => fixture.financialTransport(...args) }
}));
vi.mock('../../../services/salesService', () => ({
  splitOpenTableOrder: (...args) => fixture.splitSale(...args),
  processSale: (...args) => fixture.processSale(...args)
}));
vi.mock('../../../services/sync/syncConstants', async (importOriginal) => ({
  ...await importOriginal(), getLicenseKeyFromDetails: () => 'license-a',
  isRestaurantOrdersCloudEnabled: () => true, isCloudSalesCashierEnabled: () => true,
  isCloudSalesCreditEnabled: () => true, isCloudSalesInventoryEnabled: () => true
}));
vi.mock('../../restaurant/useRestaurantOrderCloudStatus', () => ({
  getRestaurantOrderCloudStatusSnapshot: (...args) => fixture.cloudStatus(...args)
}));
vi.mock('../../../services/restaurant/restaurantOrdersRepository', () => ({
  restaurantOrdersRepository: { getRestaurantOrderByLocalOrder: (...args) => fixture.cloudLookup(...args) }
}));
vi.mock('../../../services/restaurant/restaurantOrderCheckoutClose', () => ({
  closeRestaurantCloudOrderAfterSuccessfulPayment: vi.fn(),
  closeRestaurantCloudOrderAfterSuccessfulSplitPayment: vi.fn(),
  retryPendingRestaurantCloudOrderCloses: vi.fn(async () => ({ skipped: true }))
}));
vi.mock('../../../services/sales/fefoSaleValidation', () => ({
  validateFefoSelectionBeforeCheckout: vi.fn(async () => ({ blocked: false }))
}));
vi.mock('../../../services/customerMessaging', () => ({
  prepareCustomerMessageOutbox: vi.fn(), showCustomerMessageOutboxModal: vi.fn()
}));
vi.mock('../../../services/auth/actorAuthorityRecovery', () => ({
  getActorAuthorityRecoverySnapshot: () => null, reportActorAuthorityError: vi.fn(() => false)
}));

import { db, STORES } from '../../../services/db/dexie';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { splitOpenTableOrderCore } from '../../../services/sales/splitOrderService';
import { salesRepository } from '../../../services/db/sales';
import Logger from '../../../services/Logger';
import {
  getPendingActorOperations, installActorOperationalHandoffGuards, registerActorOperationalActiveOrders
} from '../../../services/auth/actorOperationalHandoff';
import { buildRestaurantOrderPayloadFromOpenSale } from '../../../services/restaurant/restaurantOrderMapper';
import { useActiveOrders, selectCurrentOrder } from '../useActiveOrders';
import { useTableManagement } from '../useTableManagement';
import { usePosCheckout } from '../usePosCheckout';
import { ensureOrderDiscountRuntime } from '../useOrderDiscountRuntime';
import { loadCashSessionProjection } from '../../../services/cajaProjection';

const LOCAL_ORDER_ID = 'sale-created-on-device-a';
const VERSION_A = '2026-09-28T16:05:05.123456789Z';

const sourceSale = (overrides = {}) => ({
  id: LOCAL_ORDER_ID, status: 'open', orderType: 'table', tableData: 'Mesa A',
  currency: 'MXN', subtotal: '600', discountTotal: '85', total: '515',
  lineDiscountTotal: '50', subtotalAfterLineDiscounts: '550', saleDiscountAmount: '35',
  saleDiscount: { type: 'amount', scope: 'sale', value: '35', amount: '35', reason: 'Promoción histórica' },
  items: [{
    id: 'burger', productId: 'burger', lineId: 'burger-line', name: 'Hamburguesa histórica',
    quantity: 2, price: '150', unitPrice: '150', lineTotal: '270',
    discount: { type: 'amount', scope: 'line', value: '30', amount: '30', reason: 'Cortesía' },
    discountAmount: '30', discountReason: 'Cortesía',
    selectedModifiers: [{ id: 'extra-cheese', name: 'Queso extra', price: 20, quantity: 1 }],
    batchId: 'burger-batch', isVariant: true
  }, {
    id: 'coffee', productId: 'coffee', lineId: 'coffee-line', name: 'Café histórico',
    quantity: 1, price: '300', unitPrice: '300', lineTotal: '280',
    discount: { type: 'amount', scope: 'line', value: '20', amount: '20', reason: 'Promoción' },
    discountAmount: '20', discountReason: 'Promoción', selectedModifiers: []
  }],
  ...overrides
});

const fixtureCloud = (sale = sourceSale(), overrides = {}) => {
  const payload = buildRestaurantOrderPayloadFromOpenSale({ sale });
  return {
    ...payload.order, id: 'restaurant-created-on-device-a', licenseKey: 'license-a',
    status: 'ready', fulfillmentStatus: 'ready', paymentStatus: 'unpaid',
    createdAt: '2026-09-28T16:00:00.987654321Z', updatedAt: VERSION_A, serverVersion: 'opaque:version:a',
    items: payload.items.map((item) => ({ ...item, status: 'ready' })),
    ...overrides
  };
};

const tableDeps = () => ({
  openModal: vi.fn(), closeModal: vi.fn(), refreshData: vi.fn(),
  fetchActiveTablesCount: vi.fn(), features: { hasTables: true },
  handleInitiateCheckout: vi.fn(), cajaActual: { id: 'cash-b', estado: 'abierta' },
  asegurarCajaAbierta: vi.fn()
});

const checkoutDeps = () => ({
  pos: { activeOrderId: useActiveOrders.getState().currentOrderId,
    order: selectCurrentOrder(useActiveOrders.getState())?.items || [],
    verifySessionIntegrity: vi.fn(async () => true), abrirCaja: vi.fn(), asegurarCajaAbierta: vi.fn() },
  posSearch: { menuVisual: [], refreshOutOfStock: vi.fn() },
  modal: { openModal: vi.fn(), closeModal: vi.fn() }, mobileCart: { closeCart: vi.fn() },
  prescription: { setTempPrescriptionData: vi.fn(), setPrescriptionItems: vi.fn() },
  features: { hasTables: true }, fetchActiveTablesCount: vi.fn()
});

const expectNoFinancialEffects = (deps) => {
  expect(fixture.splitSale).not.toHaveBeenCalled();
  expect(fixture.processSale).not.toHaveBeenCalled();
  expect(fixture.financialTransport).not.toHaveBeenCalled();
  expect(fixture.currentCash).not.toHaveBeenCalled();
  expect(fixture.cloudSplitCapability).not.toHaveBeenCalled();
  expect(deps?.asegurarCajaAbierta).not.toHaveBeenCalled();
};

beforeEach(async () => {
  vi.clearAllMocks();
  fixture.onSalePut = null;
  fixture.storage.clear();
  fixture.appState = { enableMultipleOrders: true, companyProfile: { name: 'Lanzo' },
    verifySessionIntegrity: vi.fn(async () => true), licenseDetails: { valid: true } };
  fixture.database = new Dexie(`table-device-b-${crypto.randomUUID()}`);
  fixture.database.version(1).stores({
    sales: 'id,status,timestamp,customerId,fulfillmentStatus,cash_session_id,[customerId+timestamp],[cash_session_id+timestamp]',
    menu: 'id,barcode,name_lower,categoryId,sku',
    product_batches: 'id,productId,sku,expiryDate,[productId+isActive],[productId+isActive+createdAt]',
    customers: 'id,phone', customer_ledger: 'id,customerId,type,timestamp,[customerId+timestamp]',
    company: 'id', cajas: 'id,estado,fecha_apertura', movimientos_caja: 'id,caja_id,cash_session_id,fecha',
    deleted_sales: 'id,deletedAt,cash_session_id', waste_logs: 'id,timestamp', transaction_log: 'id,status,timestamp',
    inventory_events: 'id,saleId,productId,[saleId+productId]', sequences: 'id'
  });
  await fixture.database.open();
  await db.table(STORES.MENU).bulkPut([
    { id: 'burger', name: 'Hamburguesa catálogo B', price: 999, stock: 10, committedStock: 4, trackStock: true },
    { id: 'coffee', name: 'Café catálogo B', price: 888, stock: 9, committedStock: 3, trackStock: true }
  ]);
  await db.table(STORES.PRODUCT_BATCHES).put({
    id: 'burger-batch', productId: 'burger', price: 777, stock: 8, committedStock: 2
  });
  useActiveOrders.setState({ activeOrders: new Map(), currentOrderId: null,
    isLoading: false, isCurrentOrderLocked: false, pendingInventoryResolutions: new Map() });
  actorRuntimeController.lock('test_device_b');
  actorRuntimeController.beginAuthentication({ actorType: 'admin', deviceRef: 'device-b' });
  actorRuntimeController.grant({ actorType: 'admin', actorId: 'owner-a',
    sessionId: crypto.randomUUID(), deviceRef: 'device-b',
    authorizationExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  registerActorOperationalActiveOrders({ useActiveOrders, db, STORES });
  await installActorOperationalHandoffGuards();
  ensureOrderDiscountRuntime();
  fixture.cloudOrder = fixtureCloud();
  fixture.cloudLookup.mockImplementation(async () => ({
    success: true, found: true, order: structuredClone(fixture.cloudOrder)
  }));
  fixture.cloudStatus.mockImplementation(async () => ({
    success: true, found: true, order: structuredClone(fixture.cloudOrder),
    summary: { hasCancelledItems: false, isReady: true, items: fixture.cloudOrder.items }
  }));
  fixture.showConfirm.mockResolvedValue(true);
  fixture.cloudSplitCapability.mockResolvedValue(true);
  fixture.currentCash.mockResolvedValue({ success: true, cashSession: { id: 'cash-b', estado: 'abierta' } });
  fixture.splitSale.mockResolvedValue({ success: false, code: 'UNEXPECTED_FINANCIAL_CALL' });
});

afterEach(async () => {
  expect(getPendingActorOperations()).toEqual([]);
  cleanup();
  fixture.database.close();
  await fixture.database.delete();
});

describe('Mini-phase 3D multi-device table recovery', () => {
  it('hydrates SALES on device B and activates exactly one original order with the complete historical account', async () => {
    const inventoryBefore = await db.table(STORES.MENU).toArray();
    const batchesBefore = await db.table(STORES.PRODUCT_BATCHES).toArray();
    expect(await db.table(STORES.SALES).count()).toBe(0);
    const deps = tableDeps();
    const hook = renderHook(() => useTableManagement(deps));
    let loaded;
    await act(async () => { loaded = await hook.result.current.handleLoadOpenOrder(LOCAL_ORDER_ID); });
    expect(loaded, JSON.stringify(loaded)).toMatchObject({ success: true });
    const shadow = await db.table(STORES.SALES).get(LOCAL_ORDER_ID);
    const state = useActiveOrders.getState();
    const active = selectCurrentOrder(state);
    expect(await db.table(STORES.SALES).count()).toBe(1);
    expect([...state.activeOrders.keys()]).toEqual([LOCAL_ORDER_ID]);
    expect(state.currentOrderId).toBe(LOCAL_ORDER_ID);
    expect(active).toMatchObject({
      id: LOCAL_ORDER_ID, localOrderId: LOCAL_ORDER_ID, isSaved: true,
      restaurantCloudHydrated: true, reservationAuthority: 'cloud',
      restaurantOrderId: 'restaurant-created-on-device-a', tableData: 'Mesa A',
      total: fixture.cloudOrder.total, subtotal: '600', discountTotal: '85',
      lineDiscountTotal: '50', saleDiscountAmount: '35', subtotalAfterLineDiscounts: '550',
      updatedAt: VERSION_A, cloudUpdatedAt: VERSION_A, restaurantCloudExpectedVersion: VERSION_A,
      saleDiscount: { type: 'amount', scope: 'sale', amount: '35', value: '35', reason: 'Promoción histórica' }
    });
    expect(active.items).toEqual(shadow.items);
    expect(active.items).toMatchObject([
      { id: 'burger', productId: 'burger', lineId: 'burger-line', price: 150, unitPrice: '150',
        quantity: '2', lineTotal: '270', discountAmount: '30', discountReason: 'Cortesía',
        discount: { type: 'amount', scope: 'line', amount: '30', value: '30', reason: 'Cortesía' },
        selectedModifiers: fixture.cloudOrder.items[0].selectedModifiers, batchId: 'burger-batch', isVariant: true },
      { id: 'coffee', productId: 'coffee', lineId: 'coffee-line', price: 300, unitPrice: '300',
        quantity: '1', lineTotal: '280', discountAmount: '20', selectedModifiers: [] }
    ]);
    expect(fixture.cloudLookup).toHaveBeenCalledExactlyOnceWith({
      licenseKey: 'license-a', localOrderId: LOCAL_ORDER_ID, force: true
    });
    await act(async () => { await useActiveOrders.getState().loadOpenOrder(LOCAL_ORDER_ID); });
    expect([...useActiveOrders.getState().activeOrders.keys()]).toEqual([LOCAL_ORDER_ID]);
    expect(selectCurrentOrder(useActiveOrders.getState())).toEqual(active);
    expect(await db.table(STORES.MENU).toArray()).toEqual(inventoryBefore);
    expect(await db.table(STORES.PRODUCT_BATCHES).toArray()).toEqual(batchesBefore);
    expectNoFinancialEffects(deps);
  });

  it('preserves an explicit zero cloud total after a complete account discount', async () => {
    fixture.cloudOrder = fixtureCloud(sourceSale({
      subtotal: '600', discountTotal: '600', total: '0', saleDiscountAmount: '550',
      saleDiscount: { type: 'amount', scope: 'sale', value: '550', amount: '550', reason: 'Cortesía total' }
    }));
    const hook = renderHook(() => useTableManagement(tableDeps()));
    let loaded;
    await act(async () => { loaded = await hook.result.current.handleLoadOpenOrder(LOCAL_ORDER_ID); });
    expect(loaded, JSON.stringify(loaded)).toMatchObject({ success: true });
    const shadow = await db.table(STORES.SALES).get(LOCAL_ORDER_ID);
    expect(shadow.total).toBe(0);
    expect(selectCurrentOrder(useActiveOrders.getState()).total).toBe(0);
    expect(selectCurrentOrder(useActiveOrders.getState()).items).toEqual(shadow.items);
    expectNoFinancialEffects(tableDeps());
  });

  it('allows remote checkout entry while keeping cloud-owned cancellation read-only', async () => {
    const deps = tableDeps();
    const hook = renderHook(() => useTableManagement(deps));
    await act(async () => { await hook.result.current.handleLoadOpenOrder(LOCAL_ORDER_ID); });
    const saleBefore = await db.table(STORES.SALES).get(LOCAL_ORDER_ID);
    const activeBefore = structuredClone(selectCurrentOrder(useActiveOrders.getState()));
    const inventoryBefore = await db.table(STORES.MENU).toArray();
    const batchesBefore = await db.table(STORES.PRODUCT_BATCHES).toArray();
    const normalDeps = checkoutDeps();
    useActiveOrders.setState({ activeOrders: new Map(), currentOrderId: null, isCurrentOrderLocked: false });
    const checkout = renderHook(() => usePosCheckout(normalDeps));
    await act(async () => {
      await hook.result.current.handleQuickTableAction(activeBefore, 'checkout');
      await expect(hook.result.current.handleOpenSplitBill()).resolves.toBeUndefined();
      await hook.result.current.handleQuickTableAction(activeBefore, 'split');
      await expect(checkout.result.current.handleInitiateCheckout()).resolves.toMatchObject({ success: true });
      await expect(hook.result.current.handleAnnulKitchenRejectedOrder(activeBefore)).resolves.toMatchObject({
        success: false, code: 'CLOUD_TABLE_READ_ONLY'
      });
      await expect(useActiveOrders.getState().cancelCurrentOrder()).rejects.toMatchObject({ code: 'CLOUD_TABLE_READ_ONLY' });
    });
    expect(normalDeps.modal.openModal).toHaveBeenCalledWith('payment');
    expect(normalDeps.pos.asegurarCajaAbierta).not.toHaveBeenCalled();
    expect(deps.handleInitiateCheckout).toHaveBeenCalled();
    expect(deps.openModal).toHaveBeenCalledWith('split');
    expect(fixture.cloudStatus).toHaveBeenCalled();
    expect(fixture.appState.verifySessionIntegrity).not.toHaveBeenCalled();
    expect(fixture.showConfirm).not.toHaveBeenCalled();
    expect(useActiveOrders.getState().isCurrentOrderLocked).toBe(true);
    expect(selectCurrentOrder(useActiveOrders.getState())).toMatchObject({
      id: activeBefore.id, items: activeBefore.items, restaurantCloudHydrated: true,
      reservationAuthority: 'cloud', isLockedForCheckout: true
    });
    expect(await db.table(STORES.SALES).get(LOCAL_ORDER_ID)).toMatchObject({
      ...saleBefore, status: saleBefore.status, total: saleBefore.total, items: saleBefore.items,
      isLockedForCheckout: true
    });
    expect(await db.table(STORES.MENU).toArray()).toEqual(inventoryBefore);
    expect(await db.table(STORES.PRODUCT_BATCHES).toArray()).toEqual(batchesBefore);
    expectNoFinancialEffects(deps);
  });

  it('routes remote split through Cloud and preserves the parent on a server conflict', async () => {
    const deps = tableDeps();
    const hook = renderHook(() => useTableManagement(deps));
    await act(async () => { await hook.result.current.handleLoadOpenOrder(LOCAL_ORDER_ID); });
    const saleBefore = await db.table(STORES.SALES).get(LOCAL_ORDER_ID);
    const activeBefore = structuredClone(selectCurrentOrder(useActiveOrders.getState()));
    const inventoryBefore = await db.table(STORES.MENU).toArray();
    const batchesBefore = await db.table(STORES.PRODUCT_BATCHES).toArray();
    fixture.splitSale.mockResolvedValue({ success: false, code: 'RESTAURANT_ORDER_VERSION_CONFLICT' });
    let result;
    await act(async () => {
      result = await hook.result.current.handleConfirmSplitBill({
        splitIntent: 'by_items', tickets: [
          { label: 'A', items: [activeBefore.items[0]], paymentData: { paymentMethod: 'cash' } },
          { label: 'B', items: [activeBefore.items[1]], paymentData: { paymentMethod: 'cash' } }
        ]
      });
    });
    expect(result).toMatchObject({ success: false, code: 'RESTAURANT_ORDER_VERSION_CONFLICT' });
    expect(fixture.cloudSplitCapability).toHaveBeenCalled();
    expect(fixture.splitSale).toHaveBeenCalledWith(expect.objectContaining({ cloudSpecialFlows: true }));
    expect(fixture.cloudStatus).toHaveBeenCalled();
    expect(fixture.appState.verifySessionIntegrity).toHaveBeenCalled();
    expect(selectCurrentOrder(useActiveOrders.getState())).toEqual(activeBefore);
    expect(await db.table(STORES.SALES).get(LOCAL_ORDER_ID)).toEqual(saleBefore);
    expect(await db.table(STORES.MENU).toArray()).toEqual(inventoryBefore);
    expect(await db.table(STORES.PRODUCT_BATCHES).toArray()).toEqual(batchesBefore);
    expect(await db.table(STORES.SALES).count()).toBe(1);
    expect(fixture.financialTransport).not.toHaveBeenCalled();
    expect(fixture.currentCash).toHaveBeenCalled();
    expect(deps.asegurarCajaAbierta).not.toHaveBeenCalled();
  });

  it('reproduces the former missing-actor rejection against the real Dexie split transaction', async () => {
    const actorKey = actorRuntimeController.getState().actorKey;
    const localStationKey = 'local:device:device-b';
    const parent = {
      id: 'split-repro-parent', status: 'open', orderType: 'table', total: '20',
      timestamp: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:01:00.000Z', items: []
    };
    const cashSession = {
      id: 'cash-repro-current', estado: 'abierta', actorKey,
      localStationKey, fecha_apertura: '2026-10-01T09:00:00.000Z'
    };
    const child = (id, label) => ({
      id, total: '10', paymentMethod: 'efectivo',
      payments: [{ method: 'cash', amount: '10' }], abono: '10', saldoPendiente: '0',
      splitLabel: label, splitParentId: parent.id, status: 'closed', items: []
    });
    await db.table(STORES.SALES).put(parent);
    await db.table(STORES.CAJAS).put(cashSession);

    await expect(salesRepository.executeSplitOpenTableOrderTransaction({
      parentOrderId: parent.id,
      parentExpectedVersion: parent.updatedAt,
      splitGroupId: 'split-repro-without-actor',
      childPayloads: [
        { sale: child('split-repro-a', 'A'), deductions: [] },
        { sale: child('split-repro-b', 'B'), deductions: [] }
      ]
    }, { assertAuthorized: () => true })).rejects.toMatchObject({
      name: 'DatabaseError',
      message: expect.stringContaining('CASH_ACTOR_CONTEXT_REQUIRED')
    });

    expect(await db.table(STORES.SALES).get(parent.id)).toMatchObject({ status: 'open' });
    expect(await db.table(STORES.SALES).get('split-repro-a')).toBeUndefined();
    expect(await db.table(STORES.SALES).get('split-repro-b')).toBeUndefined();
    expect(await db.table(STORES.TRANSACTION_LOG).count()).toBe(0);
  });

  it('confirma el split local con la sesión y estación frescas y sin duplicar al reintentar', async () => {
    fixture.appState.licenseDetails = { valid: false };
    fixture.cloudStatus.mockResolvedValue({ skipped: true });
    const actor = actorRuntimeController.getState();
    const actorKey = actor.actorKey;
    const localStationKey = 'local:device:device-b';
    const cashSession = {
      id: 'cash-current-device-b', estado: 'abierta', actorKey,
      localStationKey, fecha_apertura: '2026-10-01T09:00:00.000Z'
    };
    const parent = {
      id: 'split-local-parent', status: 'open', orderType: 'table', tableData: 'Mesa 4',
      subtotal: '20', total: '20', timestamp: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:01:00.000Z', cashOriginActorKey: 'admin:historical',
      cash_session_id: 'cash-historical', localStationKey: 'local:device:old',
      items: [{
        id: 'burger', name: 'Hamburguesa', lineId: 'burger-line', quantity: 2,
        price: 10, unitPrice: 10,
        inventoryReservation: { source: 'table', committedQuantity: 2, committedBatches: [] }
      }]
    };
    await db.table(STORES.SALES).put(parent);
    await db.table(STORES.MENU).put({
      id: 'burger', name: 'Hamburguesa', trackStock: true, stock: 10, committedStock: 2
    });
    await db.table(STORES.CAJAS).put(cashSession);
    useActiveOrders.setState({
      activeOrders: new Map([[parent.id, { ...structuredClone(parent), isSaved: true }]]),
      currentOrderId: parent.id,
      isLoading: false,
      isCurrentOrderLocked: false,
      pendingInventoryResolutions: new Map()
    });
    fixture.currentCash.mockResolvedValue({
      success: true,
      cashSession,
      actor: { actorKey },
      financialStatus: 'OWN_SESSION_OPEN',
      financialState: { status: 'OWN_SESSION_OPEN', stateKnown: true, cashSession },
      stateKnown: true,
      readOnly: false,
      localStationKey
    });
    fixture.splitSale.mockImplementation((params) => splitOpenTableOrderCore(params, {
      loadData: (store, id) => db.table(store).get(id),
      loadMultipleData: (store, ids) => db.table(store).bulkGet(ids),
      STORES,
      executeSplitOpenTableOrderTransactionSafe: async (payload, options) => {
        const result = await salesRepository.executeSplitOpenTableOrderTransaction(payload, options);
        return { success: true, ...result };
      },
      useStatsStore: { getState: () => ({}) },
      roundCurrency: (value) => Math.round(Number(value) * 100) / 100,
      sendReceiptWhatsApp: vi.fn(async () => true),
      Logger
    }));

    const deps = tableDeps();
    deps.cajaActual = { id: 'stale-react-cash', estado: 'abierta', actorKey: 'admin:other' };
    const hook = renderHook(() => useTableManagement(deps));
    let result;
    await act(async () => {
      result = await hook.result.current.handleConfirmSplitBill({
        splitIntent: 'by_items',
        tickets: [
          { label: 'A', lines: [{ lineIndex: 0, quantity: 1 }], paymentData: { paymentMethod: 'efectivo', amountPaid: '10' } },
          { label: 'B', lines: [{ lineIndex: 0, quantity: 1 }], paymentData: { paymentMethod: 'efectivo', amountPaid: '10' } }
        ]
      });
    });

    expect(result.success, result.message).toBe(true);
    expect(fixture.currentCash).toHaveBeenCalledWith({ force: true });
    expect(deps.asegurarCajaAbierta).not.toHaveBeenCalled();
    expect(fixture.splitSale).toHaveBeenCalledWith(expect.objectContaining({
      actorContext: expect.objectContaining({ actorKey, generation: actor.generation }),
      cashSessionId: cashSession.id,
      localStationKey,
      cloudSpecialFlows: false
    }));

    const childSales = await db.table(STORES.SALES).bulkGet(result.childSaleIds);
    expect(childSales).toHaveLength(2);
    expect(childSales).toEqual(expect.arrayContaining([
      expect.objectContaining({
        total: '10', cashOriginActorKey: actorKey, cashOriginActorGeneration: actor.generation,
        cash_session_id: cashSession.id, localStationKey,
        payments: [expect.objectContaining({ method: 'cash', amount: '10' })]
      }),
      expect.objectContaining({
        total: '10', cashOriginActorKey: actorKey, cashOriginActorGeneration: actor.generation,
        cash_session_id: cashSession.id, localStationKey,
        payments: [expect.objectContaining({ method: 'cash', amount: '10' })]
      })
    ]));
    expect(childSales.reduce((sum, sale) => sum + Number(sale.total), 0)).toBe(20);
    expect(await db.table(STORES.SALES).get(parent.id)).toMatchObject({
      status: 'cancelled', cancelReason: 'split_settled', splitChildIds: result.childSaleIds
    });
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 8, committedStock: 0 });
    const logsBeforeRetry = await db.table(STORES.TRANSACTION_LOG).toArray();
    expect(logsBeforeRetry.filter((entry) => entry.type === 'SPLIT_CHILD')).toHaveLength(2);
    expect(logsBeforeRetry.filter((entry) => entry.type === 'SPLIT_PARENT_CANCEL')).toHaveLength(1);

    const retry = await salesRepository.executeSplitOpenTableOrderTransaction({
      parentOrderId: parent.id,
      parentExpectedVersion: parent.updatedAt,
      splitGroupId: result.splitGroupId,
      splitIntent: 'by_items',
      childPayloads: result.childSales.map((sale) => ({ sale, deductions: [] }))
    }, { assertAuthorized: () => true });
    expect(retry).toMatchObject({ success: false, isConcurrencyError: true });
    expect(await db.table(STORES.SALES).bulkGet(result.childSaleIds)).toHaveLength(2);
    expect(await db.table(STORES.TRANSACTION_LOG).toArray()).toHaveLength(logsBeforeRetry.length);
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 8, committedStock: 0 });
    const cashProjection = await loadCashSessionProjection(db, cashSession);
    expect(cashProjection.totals).toMatchObject({ ventasContado: '20', abonosFiado: '0' });
    expect(cashProjection.movements.filter((movement) => movement.tipo === 'venta').map((movement) => movement.monto))
      .toEqual(['10', '10']);
  });

  it('revocar al actor después de escribir el primer ticket aborta todo el split Dexie', async () => {
    const actorKey = actorRuntimeController.getState().actorKey;
    const localStationKey = 'local:device:device-b';
    const parent = {
      id: 'split-revoked-parent', status: 'open', orderType: 'table', total: '20',
      timestamp: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:01:00.000Z', items: []
    };
    const cashSession = { id: 'cash-revoked-test', estado: 'abierta', actorKey, localStationKey };
    const child = (id, label, withActor = true) => ({
      id, total: '10', paymentMethod: 'cash', payments: [{ method: 'cash', amount: '10' }],
      abono: '10', saldoPendiente: '0', cash_session_id: cashSession.id, localStationKey,
      ...(withActor ? { cashOriginActorKey: actorKey, cashOriginActorGeneration: actorRuntimeController.getState().generation } : {}),
      splitLabel: label, splitParentId: parent.id, status: 'closed', items: []
    });
    await db.table(STORES.SALES).put(parent);
    await db.table(STORES.CAJAS).put(cashSession);

    let authorized = true;
    let authorityListener = null;
    const assertAuthorized = () => {
      if (!authorized) throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
    };
    fixture.onSalePut = (record) => {
      if (record.id !== 'split-revoked-child-a') return;
      authorized = false;
      authorityListener?.();
    };

    await expect(salesRepository.executeSplitOpenTableOrderTransaction({
      parentOrderId: parent.id,
      parentExpectedVersion: parent.updatedAt,
      splitGroupId: 'split-revoked-during-write',
      childPayloads: [
        { sale: child('split-revoked-child-a', 'A'), deductions: [] },
        { sale: child('split-revoked-child-b', 'B', false), deductions: [] }
      ]
    }, {
      assertAuthorized,
      subscribeAuthority: (listener) => {
        authorityListener = listener;
        return () => { authorityListener = null; };
      }
    })).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });

    expect(await db.table(STORES.SALES).get(parent.id)).toMatchObject({ status: 'open' });
    expect(await db.table(STORES.SALES).get('split-revoked-child-a')).toBeUndefined();
    expect(await db.table(STORES.SALES).get('split-revoked-child-b')).toBeUndefined();
    expect(await db.table(STORES.TRANSACTION_LOG).count()).toBe(0);
  });

  it.each([
    {
      intent: 'equal_payment',
      tickets: [
        { label: 'T1', amountCents: 1000, paymentData: { paymentMethod: 'efectivo', amountPaid: '10' }, lines: [] },
        { label: 'T2', amountCents: 1000, paymentData: { paymentMethod: 'tarjeta', amountPaid: '10' }, lines: [] }
      ],
      paymentMethods: ['cash', 'card'],
      balance: '0',
      debt: '0',
      hasCashPayment: true,
      cashSales: '10',
      creditDeposits: '0',
      expectedMovementTypes: ['venta', 'venta_tarjeta']
    },
    {
      intent: 'custom_payment',
      tickets: [
        { label: 'T1', amountCents: 800, paymentData: { paymentMethod: 'tarjeta', amountPaid: '8' }, lines: [] },
        { label: 'T2', amountCents: 1200, paymentData: {
          paymentMethod: 'fiado', amountPaid: '2', receivedAmount: '3',
          initialPaymentMethod: 'efectivo', customerId: 'split-credit-customer'
        }, lines: [] }
      ],
      paymentMethods: ['card', 'cash'],
      balance: '10',
      debt: '10',
      hasCashPayment: true,
      cashSales: '0',
      creditDeposits: '2',
      expectedMovementTypes: ['abono', 'venta_tarjeta']
    },
    {
      intent: 'custom_payment',
      tickets: [
        { label: 'T1', amountCents: 500, paymentData: {
          paymentMethod: 'fiado', amountPaid: '0', customerId: 'split-credit-customer'
        }, lines: [] },
        { label: 'T2', amountCents: 1500, paymentData: { paymentMethod: 'tarjeta', amountPaid: '15' }, lines: [] }
      ],
      paymentMethods: ['card'],
      balance: '5',
      debt: '5',
      hasCashPayment: false,
      cashSales: '0',
      creditDeposits: '0',
      expectedMovementTypes: ['venta_tarjeta']
    }
  ])('persiste $intent con pagos y caja atribuidos en Dexie', async ({ intent, tickets, paymentMethods, balance, debt, hasCashPayment, cashSales, creditDeposits, expectedMovementTypes }) => {
    const actor = actorRuntimeController.capture('pos');
    const localStationKey = 'local:device:device-b';
    const parent = {
      id: `split-${intent}-parent`, status: 'open', orderType: 'table', tableData: 'Mesa 8',
      subtotal: '20', total: '20', timestamp: '2026-10-02T10:00:00.000Z',
      updatedAt: '2026-10-02T10:01:00.000Z',
      items: [{
        id: 'burger', name: 'Hamburguesa', lineId: 'burger-line', quantity: 2,
        price: 10, unitPrice: 10,
        inventoryReservation: { source: 'table', committedQuantity: 2, committedBatches: [] }
      }]
    };
    const cashSession = {
      id: `cash-${intent}`, estado: 'abierta', actorKey: actor.actorKey, localStationKey,
      fecha_apertura: '2026-10-02T09:00:00.000Z'
    };
    await db.table(STORES.SALES).put(parent);
    await db.table(STORES.MENU).put({ id: 'burger', name: 'Hamburguesa', trackStock: true, stock: 10, committedStock: 2 });
    await db.table(STORES.CAJAS).put(cashSession);
    await db.table(STORES.CUSTOMERS).put({ id: 'split-credit-customer', debt: '0', creditLimit: '100' });

    const result = await splitOpenTableOrderCore({
      parentOrderId: parent.id,
      orderSnapshot: structuredClone(parent.items),
      splitIntent: intent,
      tickets,
      features: { hasKDS: false },
      companyName: 'Lanzo',
      actorContext: actor,
      cashSessionId: cashSession.id,
      localStationKey
    }, {
      loadData: (store, id) => db.table(store).get(id),
      loadMultipleData: (store, ids) => db.table(store).bulkGet(ids),
      STORES,
      executeSplitOpenTableOrderTransactionSafe: async (payload, options) => {
        const transactionResult = await salesRepository.executeSplitOpenTableOrderTransaction(payload, options);
        return { success: true, ...transactionResult };
      },
      useStatsStore: { getState: () => ({}) },
      roundCurrency: (value) => Math.round(Number(value) * 100) / 100,
      sendReceiptWhatsApp: vi.fn(async () => true),
      Logger
    });

    expect(result.success, result.message).toBe(true);
    expect(result.childSaleIds).toHaveLength(1);
    const [sale] = await db.table(STORES.SALES).bulkGet(result.childSaleIds);
    expect(sale).toMatchObject({
      total: '20', cashOriginActorKey: actor.actorKey,
      cashOriginActorGeneration: actor.generation, cash_session_id: cashSession.id, localStationKey,
      saldoPendiente: balance
    });
    expect(sale.payments.map((payment) => payment.method)).toEqual(paymentMethods);
    expect(sale.payments.some((payment) => payment.method === 'cash' && Number(payment.amount) > 0)).toBe(hasCashPayment);
    expect(sale.payments.some((payment) => payment.method === 'credit')).toBe(false);
    expect(await db.table(STORES.CUSTOMERS).get('split-credit-customer')).toMatchObject({ debt });
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 8, committedStock: 0 });
    expect(await db.table(STORES.SALES).get(parent.id)).toMatchObject({ status: 'cancelled', cancelReason: 'split_settled' });
    expect(await db.table(STORES.TRANSACTION_LOG).count()).toBe(2);
    const cashProjection = await loadCashSessionProjection(db, cashSession);
    expect(cashProjection.totals).toMatchObject({ ventasContado: cashSales, abonosFiado: creditDeposits });
    const splitSaleMovements = cashProjection.movements.filter((movement) => movement.referenceType === 'sale');
    expect(splitSaleMovements.map((movement) => movement.tipo).sort()).toEqual(expectedMovementTypes.sort());
    expect(new Set(splitSaleMovements.map((movement) => `${movement.referenceId}:${movement.tipo}`)).size)
      .toBe(splitSaleMovements.length);
  });

  it('un error en el segundo ticket revierte venta, pagos, inventario y cierre de la mesa', async () => {
    const actor = actorRuntimeController.getState();
    const localStationKey = 'local:device:device-b';
    const parent = {
      id: 'split-ticket-error-parent', status: 'open', orderType: 'table', total: '20',
      timestamp: '2026-10-03T10:00:00.000Z', updatedAt: '2026-10-03T10:01:00.000Z', items: []
    };
    const cashSession = { id: 'cash-ticket-error', estado: 'abierta', actorKey: actor.actorKey, localStationKey };
    await db.table(STORES.SALES).put(parent);
    await db.table(STORES.CAJAS).put(cashSession);
    await db.table(STORES.MENU).put({ id: 'burger', name: 'Hamburguesa', trackStock: true, stock: 10, committedStock: 2 });
    const child = (id, actorIdentity = true) => ({
      id, total: '10', paymentMethod: 'cash', payments: [{ method: 'cash', amount: '10' }],
      abono: '10', saldoPendiente: '0', cash_session_id: cashSession.id, localStationKey,
      ...(actorIdentity ? { cashOriginActorKey: actor.actorKey, cashOriginActorGeneration: actor.generation } : {}),
      status: 'closed', splitParentId: parent.id, items: [{
        id: 'burger', quantity: 1, price: 10, stockDeducted: 1, batchesUsed: [],
        inventoryReservation: { source: 'table', committedQuantity: 1, committedBatches: [] }
      }]
    });

    await expect(salesRepository.executeSplitOpenTableOrderTransaction({
      parentOrderId: parent.id,
      parentExpectedVersion: parent.updatedAt,
      splitGroupId: 'split-second-ticket-failure',
      childPayloads: [
        { sale: child('split-ticket-error-a'), deductions: [] },
        { sale: child('split-ticket-error-b', false), deductions: [] }
      ]
    }, { assertAuthorized: () => true })).rejects.toMatchObject({
      name: 'DatabaseError',
      message: expect.stringContaining('CASH_ACTOR_CONTEXT_REQUIRED')
    });

    expect(await db.table(STORES.SALES).get(parent.id)).toMatchObject({ status: 'open' });
    expect(await db.table(STORES.SALES).get('split-ticket-error-a')).toBeUndefined();
    expect(await db.table(STORES.SALES).get('split-ticket-error-b')).toBeUndefined();
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 2 });
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
    expect(await db.table(STORES.TRANSACTION_LOG).count()).toBe(0);
  });
});
