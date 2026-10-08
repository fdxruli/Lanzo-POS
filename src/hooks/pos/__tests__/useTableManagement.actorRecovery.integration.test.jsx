// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  database: null, appState: null, storage: new Map(), storageSuspended: false, cloudUpsert: vi.fn(),
  reportAuthority: vi.fn(), processSale: vi.fn(), showMessage: vi.fn()
}));
vi.mock('../../../services/db/dexie', () => ({
  STORES: { SALES: 'sales', MENU: 'menu', PRODUCT_BATCHES: 'product_batches',
    CUSTOMERS: 'customers', COMPANY: 'company', CATEGORIES: 'categories' },
  db: {
    table: (name) => fixture.database.table(name),
    transaction: (...args) => fixture.database.transaction(...args),
    isOpen: () => fixture.database.isOpen(), open: () => fixture.database.open()
  }
}));
vi.mock('../../../services/db', async () => await import('../../../services/db/dexie'));
vi.mock('../../../services/db/tenantRuntimeRouter', () => ({
  isTenantRuntimeError: () => false,
  getTenantRuntimeReadiness: () => ({ ready: true, runtime: {
    opaqueId: 'tenant-a', databaseName: 'actor-recovery', generation: 1
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
    setItem: (key, value) => { if (!fixture.storageSuspended) fixture.storage.set(key, value); },
    removeItem: (key) => fixture.storage.delete(key)
  },
  registerTenantStorageHydrator: vi.fn(), suspendTenantStorageWrites: () => { fixture.storageSuspended = true; }
}));
vi.mock('../../../services/supabase', () => ({ getStableDeviceId: async () => 'device-a' }));
vi.mock('../../../services/utils', () => ({
  generateID: () => `sal-${crypto.randomUUID()}`, safeLocalStorageSet: vi.fn(),
  generateIDForTransaction: () => crypto.randomUUID(),
  showMessageModal: (...args) => fixture.showMessage(...args), showConfirmModal: vi.fn(async () => true),
  roundCurrency: (value) => Math.round(Number(value) * 100) / 100
}));
vi.mock('../../../components/common/InputPromptModal', () => ({ showInputPromptModal: vi.fn() }));
vi.mock('../../../services/Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), time: vi.fn(), timeEnd: vi.fn() }
}));
vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({ releaseEcommerceOrderPosDraft: vi.fn() }));
vi.mock('../../../services/db/layaways', () => ({ layawayRepository: {} }));
vi.mock('../../../services/cash/cashRepository', () => ({ cashRepository: {} }));
vi.mock('../../../services/salesCloud/salesCloudCashierService', () => ({ salesCloudCashierService: {} }));
vi.mock('../../../services/salesService', () => ({
  splitOpenTableOrder: vi.fn(), processSale: (...args) => fixture.processSale(...args)
}));
vi.mock('../../../services/sync/syncConstants', async (importOriginal) => ({
  ...await importOriginal(), getLicenseKeyFromDetails: () => 'license-a',
  isRestaurantOrdersCloudEnabled: () => true, isCloudSalesCashierEnabled: () => false
}));
vi.mock('../../restaurant/useRestaurantOrderCloudStatus', () => ({
  getRestaurantOrderCloudStatusSnapshot: async () => ({ skipped: true })
}));
vi.mock('../../../services/restaurant/restaurantOrdersRepository', () => ({
  restaurantOrdersRepository: { upsertRestaurantOrderFromLocalSale: (...args) => fixture.cloudUpsert(...args),
    getRestaurantOrderByLocalOrder: vi.fn(async () => ({ success: true, found: false })) }
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
  getActorAuthorityRecoverySnapshot: () => ({ requiresReauthentication: true }),
  reportActorAuthorityError: (...args) => fixture.reportAuthority(...args)
}));

import { db, STORES } from '../../../services/db/dexie';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { getActorCheckoutOwnerships, getPendingActorOperations, installActorOperationalHandoffGuards, registerActorOperationalActiveOrders } from '../../../services/auth/actorOperationalHandoff';
import { useActiveOrders, selectCurrentOrder, resetAndHydrateActiveOrdersForTenant } from '../useActiveOrders';
import { useTableManagement } from '../useTableManagement';
import { usePosCheckout } from '../usePosCheckout';
import { ensureOrderDiscountRuntime } from '../useOrderDiscountRuntime';
import { showInputPromptModal } from '../../../components/common/InputPromptModal';

const grantActor = (actorId = 'owner-a') => {
  actorRuntimeController.lock('test_reauthenticate');
  actorRuntimeController.beginAuthentication({ actorType: 'admin', deviceRef: 'device-a' });
  actorRuntimeController.grant({ actorType: 'admin', actorId, sessionId: crypto.randomUUID(), deviceRef: 'device-a' });
};
const tableDeps = () => ({
  openModal: vi.fn(), closeModal: vi.fn(), refreshData: vi.fn(),
  fetchActiveTablesCount: vi.fn(), features: { hasTables: true }
});
const checkoutDeps = () => ({
  pos: { order: selectCurrentOrder(useActiveOrders.getState())?.items || [],
    verifySessionIntegrity: vi.fn(async () => true), abrirCaja: vi.fn(), asegurarCajaAbierta: vi.fn() },
  posSearch: { menuVisual: [], refreshOutOfStock: vi.fn() },
  modal: { openModal: vi.fn(), closeModal: vi.fn() },
  mobileCart: { closeCart: vi.fn() },
  prescription: { setTempPrescriptionData: vi.fn(), setPrescriptionItems: vi.fn() },
  features: { hasTables: false }, fetchActiveTablesCount: vi.fn()
});

beforeEach(async () => {
  vi.clearAllMocks();
  fixture.storage.clear();
  fixture.storageSuspended = false;
  fixture.appState = { enableMultipleOrders: true, companyProfile: { name: 'Lanzo' },
    verifySessionIntegrity: vi.fn(async () => true), licenseDetails: { valid: true } };
  fixture.database = new Dexie(`actor-table-recovery-${crypto.randomUUID()}`);
  fixture.database.version(1).stores({ sales: 'id,status', menu: 'id', product_batches: 'id,productId', customers: 'id' });
  await fixture.database.open();
  await db.table(STORES.MENU).put({ id: 'burger', name: 'Hamburguesa', stock: 10,
    committedStock: 0, trackStock: true, price: 300 });
  useActiveOrders.setState({ activeOrders: new Map([['table-a', {
    id: 'table-a', tableData: 'Mesa A', items: [{ id: 'burger', lineId: 'burger-line',
      quantity: 1, price: 300 }], createdAt: '2026-09-29T12:00:00.000Z', total: 300, isSaved: false
  }]]), currentOrderId: 'table-a', isLoading: false, isCurrentOrderLocked: false,
  pendingInventoryResolutions: new Map() });
  grantActor();
  registerActorOperationalActiveOrders({ useActiveOrders, db, STORES });
  await installActorOperationalHandoffGuards();
  ensureOrderDiscountRuntime();
  for (const action of ['saveOrderAsOpen', 'loadOpenOrder', 'removeOrder', 'cancelCurrentOrder', 'lockOrderForCheckout']) {
    expect(useActiveOrders.getState()[action].__lanzoActorOperationalGuard).toBe(true);
  }
  fixture.reportAuthority.mockImplementation((error) => ['ACTOR_CONTEXT_LOCKED', 'ACTOR_CONTEXT_STALE',
    'DEVICE_TOKEN_INVALID'].includes(error?.code));
  fixture.cloudUpsert.mockImplementation(async () => {
    actorRuntimeController.lock('DEVICE_TOKEN_INVALID');
    return { success: false, code: 'DEVICE_TOKEN_INVALID' };
  });
});
afterEach(async () => {
  expect(getPendingActorOperations()).toEqual([]);
  cleanup(); fixture.database.close(); await fixture.database.delete();
});

describe('Mini-phase 3B.0 saved table authority recovery', () => {
  it.each(['initial read', 'table prompt', 'cloud read', 'cloud response'])('rejects a late save %s before mutating the newly authenticated actor cart', async (phase) => {
    const fresh = { id: 'new-actor-cart', tableData: 'Mesa B', isSaved: false,
      items: [{ id: 'burger', lineId: 'fresh-burger', quantity: 2, price: 300 }], total: 600 };
    let changedActor = false;
    const replaceActorCart = () => {
      if (changedActor) return;
      changedActor = true;
      grantActor('owner-b');
      useActiveOrders.setState({ activeOrders: new Map([[fresh.id, fresh]]), currentOrderId: fresh.id });
    };
    const table = db.table(STORES.SALES);
    const getOriginal = table.get.bind(table);
    const read = vi.spyOn(table, 'get').mockImplementation(async (id) => {
      const result = await getOriginal(id);
      if (phase === 'initial read' || (phase === 'cloud read' && result?.tableTabCleanup?.status === 'pending')) replaceActorCart();
      return result;
    });
    if (phase === 'table prompt') {
      const order = selectCurrentOrder(useActiveOrders.getState());
      useActiveOrders.setState({ activeOrders: new Map([[order.id, { ...order, tableData: null }]]) });
      showInputPromptModal.mockImplementationOnce(async () => { replaceActorCart(); return 'Mesa A'; });
    }
    fixture.cloudUpsert.mockImplementation(async () => {
      if (phase === 'cloud response') replaceActorCart();
      return { success: true, order: { updatedAt: '2026-10-03T10:00:00.000Z' } };
    });
    const originalRemove = useActiveOrders.getState().removeOrder;
    const remove = vi.spyOn(useActiveOrders.getState(), 'removeOrder');
    const hook = renderHook(() => useTableManagement(tableDeps()));
    let result;
    await act(async () => { result = await hook.result.current.handleSaveAsOpen(); });
    expect(changedActor).toBe(true);
    expect(selectCurrentOrder(useActiveOrders.getState())).toEqual(fresh);
    expect(remove).not.toHaveBeenCalled();
    if (phase.startsWith('cloud')) {
      expect(result).toMatchObject({ success: true, id: 'table-a', cleanupPending: true });
      expect(await getOriginal('table-a')).toMatchObject({ tableTabCleanup: { status: 'pending' } });
      expect(fixture.cloudUpsert).toHaveBeenCalledTimes(phase === 'cloud response' ? 1 : 0);
      expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
    } else {
      expect(result).toMatchObject({ success: false, code: 'ACTOR_CONTEXT_STALE' });
      expect(await table.count()).toBe(0);
      expect(fixture.cloudUpsert).not.toHaveBeenCalled();
      expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
    }
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', actorId: 'owner-b' });
    read.mockRestore(); remove.mockRestore();
    useActiveOrders.setState({ removeOrder: originalRemove });
  });

  it('preserves one durable table, blocks duplicate save, and rehydrates an empty cart after same actor reauthentication', async () => {
    const deps = tableDeps();
    const hook = renderHook(() => useTableManagement(deps));
    let saved;
    await act(async () => { saved = await hook.result.current.handleSaveAsOpen(); });
    expect(saved).toMatchObject({ success: true, id: 'table-a', cleanupPending: true });
    expect(await db.table(STORES.SALES).get('table-a')).toMatchObject({
      status: 'open', total: 300, fulfillmentStatus: 'pending',
      tableTabCleanup: { status: 'pending', actorKey: 'admin:owner-a' }
    });
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
    await expect(hook.result.current.handleSaveAsOpen()).resolves.toMatchObject({ cleanupPending: true });
    expect(fixture.cloudUpsert).toHaveBeenCalledTimes(1);
    expect(await db.table(STORES.SALES).count()).toBe(1);
    grantActor();
    await expect(useActiveOrders.getState().saveOrderAsOpen()).resolves.toMatchObject({
      success: false, code: 'TABLE_RUNTIME_CLEANUP_PENDING'
    });
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ committedStock: 1 });
    actorRuntimeController.lock('test_reauthenticate');
    actorRuntimeController.beginAuthentication({ actorType: 'admin', deviceRef: 'device-a' });
    actorRuntimeController.beginHandoffCheck();
    await act(async () => {
      await resetAndHydrateActiveOrdersForTenant();
    });
    expect(actorRuntimeController.getState().status).toBe('handoff_check');
    expect(selectCurrentOrder(useActiveOrders.getState())?.items).toEqual([]);
    expect(useActiveOrders.getState().activeOrders.has('table-a')).toBe(false);
    actorRuntimeController.grant({ actorType: 'admin', actorId: 'owner-a', sessionId: crypto.randomUUID(), deviceRef: 'device-a' });
    await act(async () => { await useActiveOrders.getState().loadOrdersFromDB(); });
    expect(await db.table(STORES.SALES).get('table-a')).toMatchObject({ status: 'open' });
    await act(async () => { await hook.result.current.handleLoadOpenOrder('table-a'); });
    expect(selectCurrentOrder(useActiveOrders.getState())).toMatchObject({ id: 'table-a', isSaved: true });
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
  });

  it('catches a locked table load without activating the table or rejecting its UI promise', async () => {
    const deps = tableDeps();
    const hook = renderHook(() => useTableManagement(deps));
    actorRuntimeController.lock('DEVICE_TOKEN_INVALID');
    await expect(hook.result.current.handleLoadOpenOrder('table-b')).resolves.toMatchObject({
      success: false, code: 'ACTOR_CONTEXT_LOCKED', recoveryRequired: true
    });
    expect(useActiveOrders.getState().currentOrderId).toBe('table-a');
    expect(deps.closeModal).not.toHaveBeenCalled();
    expect(fixture.reportAuthority).toHaveBeenCalled();
  });

  it('catches a locked checkout before durable lock, modal, sale, or cash effects', async () => {
    const deps = checkoutDeps();
    const hook = renderHook(() => usePosCheckout(deps));
    const cartBefore = structuredClone(selectCurrentOrder(useActiveOrders.getState()));
    actorRuntimeController.lock('DEVICE_TOKEN_INVALID');
    await expect(hook.result.current.handleInitiateCheckout()).resolves.toMatchObject({
      success: false, code: 'ACTOR_CONTEXT_LOCKED', recoveryRequired: true
    });
    expect(await db.table(STORES.SALES).count()).toBe(0);
    expect(useActiveOrders.getState().isCurrentOrderLocked).toBe(false);
    expect(selectCurrentOrder(useActiveOrders.getState())).toEqual(cartBefore);
    expect(deps.modal.openModal).not.toHaveBeenCalled();
    expect(deps.pos.asegurarCajaAbierta).not.toHaveBeenCalled();
    expect(fixture.processSale).not.toHaveBeenCalled();
    expect(fixture.reportAuthority).toHaveBeenCalled();
    grantActor();
    await act(async () => { await hook.result.current.handleInitiateCheckout(); });
    expect(deps.modal.openModal).toHaveBeenCalledWith('payment');
    expect(useActiveOrders.getState().isCurrentOrderLocked).toBe(true);
    await act(async () => { await hook.result.current.handlePaymentModalClose(); });
    expect(fixture.processSale).not.toHaveBeenCalled();
  });

  it('cleans the tab after a healthy save and leaves one loadable durable table', async () => {
    fixture.cloudUpsert.mockResolvedValue({ success: true });
    const hook = renderHook(() => useTableManagement(tableDeps()));
    let saved;
    await act(async () => { saved = await hook.result.current.handleSaveAsOpen(); });
    expect(saved).toMatchObject({ success: true, id: 'table-a' });
    expect(await db.table(STORES.SALES).count()).toBe(1);
    expect(await db.table(STORES.SALES).get('table-a')).toMatchObject({ status: 'open', tableTabCleanup: null });
    expect(selectCurrentOrder(useActiveOrders.getState())?.items).toEqual([]);
    expect(useActiveOrders.getState().activeOrders.has('table-a')).toBe(false);
  });

  it('keeps locked cancellation side effect free and cancels exactly once after reauthentication', async () => {
    await useActiveOrders.getState().saveOrderAsOpen();
    const order = useActiveOrders.getState().activeOrders.get('table-a');
    useActiveOrders.setState({ activeOrders: new Map([['table-a', { ...order, isSaved: true }]]) });
    const durable = await db.table(STORES.SALES).get('table-a');
    actorRuntimeController.lock('DEVICE_TOKEN_INVALID');
    await expect(useActiveOrders.getState().cancelCurrentOrder()).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_LOCKED' });
    expect(await db.table(STORES.SALES).get('table-a')).toEqual(durable);
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 1 });
    expect(useActiveOrders.getState().activeOrders.has('table-a')).toBe(true);
    grantActor();
    await useActiveOrders.getState().cancelCurrentOrder();
    expect(await db.table(STORES.SALES).get('table-a')).toMatchObject({ status: 'cancelled' });
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
  });

  it('rejects a stale table read before replacing a freshly authenticated cart', async () => {
    await useActiveOrders.getState().saveOrderAsOpen();
    const table = db.table(STORES.SALES);
    const getOriginal = table.get.bind(table);
    const fresh = { id: 'new-actor-cart', items: [{ id: 'new-product', quantity: 1, price: 25 }], total: 25 };
    const read = vi.spyOn(table, 'get').mockImplementationOnce(async (id) => {
      const durable = await getOriginal(id);
      grantActor('owner-b');
      useActiveOrders.setState({ activeOrders: new Map([[fresh.id, fresh]]), currentOrderId: fresh.id });
      return durable;
    });
    await expect(useActiveOrders.getState().loadOpenOrder('table-a')).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(selectCurrentOrder(useActiveOrders.getState())).toEqual(fresh);
    expect(useActiveOrders.getState().activeOrders.has('table-a')).toBe(false);
    expect(actorRuntimeController.getState()).toMatchObject({ status: 'granted', actorId: 'owner-b' });
    read.mockRestore();
  });

  it('rolls back the table and reservation when authority expires before the save transaction commits', async () => {
    const table = db.table(STORES.SALES);
    const putOriginal = table.put.bind(table);
    const write = vi.spyOn(table, 'put').mockImplementationOnce(async (...args) => {
      const result = await putOriginal(...args);
      actorRuntimeController.lock('DEVICE_TOKEN_INVALID');
      return result;
    });
    const hook = renderHook(() => useTableManagement(tableDeps()));
    let result;
    await act(async () => { result = await hook.result.current.handleSaveAsOpen(); });
    expect(result).toMatchObject({ success: false, code: 'ACTOR_CONTEXT_STALE', recoveryRequired: true });
    expect(await db.table(STORES.SALES).count()).toBe(0);
    expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
    expect(fixture.cloudUpsert).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('compensates only its acquired checkout lock when authority expires before ownership is recorded', async () => {
    const unsubscribe = useActiveOrders.subscribe((state) => {
      if (state.isCurrentOrderLocked) actorRuntimeController.lock('DEVICE_TOKEN_INVALID');
    });
    try {
      await expect(useActiveOrders.getState().lockOrderForCheckout('table-a')).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
      expect(await db.table(STORES.SALES).count()).toBe(0);
      expect(useActiveOrders.getState().isCurrentOrderLocked).toBe(false);
      expect(getActorCheckoutOwnerships().find((owner) => owner.orderId === 'table-a')).toBeUndefined();
      expect(await db.table(STORES.MENU).get('burger')).toMatchObject({ stock: 10, committedStock: 0 });
    } finally { unsubscribe(); }
  });

  it('keeps discount persistence tracked after the inner save settles without accumulating guards across registration', async () => {
    const registration = { useActiveOrders, db, STORES };
    registerActorOperationalActiveOrders(registration);
    registerActorOperationalActiveOrders(registration);
    const table = db.table(STORES.SALES);
    const putOriginal = table.put.bind(table);
    const updateOriginal = table.update.bind(table);
    const pendingAtPut = [];
    const pendingAtFinancialUpdate = [];
    const pendingSaveCount = () => getPendingActorOperations().filter((operation) => operation.label === 'activeOrders.saveOrderAsOpen').length;
    const put = vi.spyOn(table, 'put').mockImplementation(async (...args) => {
      pendingAtPut.push(pendingSaveCount());
      return putOriginal(...args);
    });
    const update = vi.spyOn(table, 'update').mockImplementation(async (...args) => {
      pendingAtFinancialUpdate.push(pendingSaveCount());
      return updateOriginal(...args);
    });
    await expect(useActiveOrders.getState().saveOrderAsOpen('table-a')).resolves.toMatchObject({ success: true });
    expect(pendingAtPut).toEqual([2]);
    expect(pendingAtFinancialUpdate).toEqual([1]);
    expect(getPendingActorOperations()).toEqual([]);
    put.mockRestore(); update.mockRestore();
  });
});
