// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { grantTestActor } from '../../../services/auth/__tests__/actorAccessTestHarness';

vi.mock('../../../services/db/dexie', async () => {
  const { default: Dexie } = await import('dexie');
  const db = new Dexie('checkout-unmount-recovery');
  db.version(1).stores({ sales: 'id,status', menu: 'id', product_batches: 'id,productId' });
  return { db, STORES: { SALES: 'sales', MENU: 'menu', PRODUCT_BATCHES: 'product_batches' } };
});
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({
  licenseDetails: { valid: true }, enableMultipleOrders: true
}) } }));
vi.mock('../../../store/usePosCatalogStore', () => ({ usePosCatalogStore: { getState: () => ({ items: [] }) } }));
vi.mock('../../../services/ecommerce/ecommerceOrderService', () => ({ releaseEcommerceOrderPosDraft: vi.fn() }));
vi.mock('../../../services/utils', () => ({ generateID: () => crypto.randomUUID(),
  safeLocalStorageSet: vi.fn(), roundCurrency: value => Math.round(value * 100) / 100,
  showMessageModal: vi.fn(), showConfirmModal: vi.fn() }));
vi.mock('../../../services/sync/syncConstants', async importOriginal => ({ ...await importOriginal(),
  isCloudSalesCashierEnabled: () => false, isCloudSalesCreditEnabled: () => false,
  isRestaurantOrdersCloudEnabled: () => false }));

import { db } from '../../../services/db/dexie';
import { useActiveOrders } from '../useActiveOrders';
import { usePosCheckout } from '../usePosCheckout';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { getActorCheckoutOwnerships, registerActorOperationalActiveOrders, installActorOperationalHandoffGuards,
  configureActorOperationalPersistence, refreshPersistedActorCheckoutOwnership, forgetPrepaymentCheckout
} from '../../../services/auth/actorOperationalHandoff';

const order = { id: 'order-a', items: [{ id: 'p', quantity: 1, price: 20 }], total: 20,
  isSaved: true, createdAt: '2026-08-30T00:00:00.000Z' };
const mount = () => {
  const modal = { openModal: vi.fn(), closeModal: vi.fn() };
  return { modal, ...renderHook(() => usePosCheckout({
    pos: { activeOrderId: order.id, order: order.items, verifySessionIntegrity: async () => true },
    posSearch: { menuVisual: [], refreshOutOfStock: vi.fn() }, modal,
    mobileCart: { closeCart: vi.fn() }, prescription: { setTempPrescriptionData: vi.fn() }, features: {}, fetchActiveTablesCount: vi.fn()
  })) };
};
beforeEach(async () => {
  await db.table('sales').clear();
  await db.table('menu').put({ id: 'p', stock: 10, trackStock: false });
  await db.table('sales').put({ ...order, status: 'open' });
  grantTestActor({ permissions: ['pos'] });
  useActiveOrders.setState({ activeOrders: new Map([[order.id, { ...order }]]),
    currentOrderId: order.id, pendingInventoryResolutions: new Map(), isCurrentOrderLocked: false });
  configureActorOperationalPersistence({ db, salesStore: 'sales' });
  await refreshPersistedActorCheckoutOwnership({ tenant: actorRuntimeController.getState().tenant });
  await installActorOperationalHandoffGuards();
  registerActorOperationalActiveOrders({ useActiveOrders, db,
    STORES: { SALES: 'sales', MENU: 'menu', PRODUCT_BATCHES: 'product_batches' } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await db.delete(); });

it('recovers only cancellation of the same prepayment attempt after POS unmount', async () => {
  const first = mount();
  await act(async () => { expect(await first.result.current.handleInitiateCheckout()).toMatchObject({ success: true }); });
  expect(first.modal.openModal).toHaveBeenCalledWith('payment');
  const locked = await db.table('sales').get(order.id);
  expect(locked.isLockedForCheckout).toBe(true);
  expect(locked.checkoutAttemptId).toBeTruthy();
  first.unmount();
  expect(getActorCheckoutOwnerships()[0].actorKey).toBe('staff:staff-a');
  const second = mount();
  // Simulate a permission-only revocation, preserving the real session binding.
  // No production permission-refresh implementation is introduced in this scope.
  const capture = actorRuntimeController.capture.bind(actorRuntimeController);
  const denied = () => { throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' }); };
  const denial = vi.spyOn(actorRuntimeController, 'capture').mockImplementation(permission => {
    if (permission === 'pos') return denied();
    return capture(permission);
  });
  await act(async () => {
    expect(await second.result.current.handleInitiateCheckout()).toMatchObject({ success: false, code: 'ACTOR_PERMISSION_DENIED' });
    expect(await second.result.current.handleProcessOrder({ paymentMethod: 'card' })).toMatchObject({ success: false, code: 'ACTOR_PERMISSION_DENIED' });
    expect(await second.result.current.handlePaymentModalClose()).toMatchObject({ success: false, code: 'ACTOR_PERMISSION_DENIED' });
  });
  expect((await db.table('sales').get(order.id)).checkoutAttemptId).toBe(locked.checkoutAttemptId);
  expect((await db.table('sales').get(order.id)).isLockedForCheckout).toBe(true);
  // A valid verification would restore POS on this same binding. Its delivery
  // is simulated here; granting/revalidating Staff is explicitly out of scope.
  denial.mockRestore();
  await act(async () => {
    expect(await second.result.current.handleInitiateCheckout()).toMatchObject({ code: 'CHECKOUT_RECOVERY_CANCEL_REQUIRED' });
    expect(await second.result.current.handleProcessOrder({ paymentMethod: 'card' })).toMatchObject({ success: false });
  });
  expect(second.modal.openModal).toHaveBeenCalledWith('payment');
  expect((await db.table('sales').get(order.id)).checkoutAttemptId).toBe(locked.checkoutAttemptId);
  expect((await db.table('sales').get(order.id)).isLockedForCheckout).toBe(true);
  await act(async () => { expect(await second.result.current.handlePaymentModalClose({
    expectedOrderId: order.id, expectedCheckoutAttemptId: locked.checkoutAttemptId
  })).toMatchObject({ success: true, closed: true }); });
  expect((await db.table('sales').get(order.id)).isLockedForCheckout).toBe(false);
  expect(await db.table('menu').get('p')).toMatchObject({ stock: 10 });
  expect(await db.table('sales').count()).toBe(1);
  expect((await db.table('sales').get(order.id)).status).toBe('open');
  second.unmount();
});


it.each(['other-actor', 'other-session', 'other-attempt', 'other-persisted-owner'])(
  'does not release the prepayment lock for %s', async change => {
    const first = mount();
    await act(async () => { expect(await first.result.current.handleInitiateCheckout()).toMatchObject({ success: true }); });
    const locked = await db.table('sales').get(order.id);
    first.unmount();
    if (change === 'other-actor') grantTestActor({ actorId: 'staff-b', permissions: ['pos'] });
    if (change === 'other-session') grantTestActor({ sessionId: 'replacement-session', permissions: ['pos'] });
    if (change === 'other-persisted-owner') await db.table('sales').update(order.id, { checkoutActorKey: 'staff:staff-b' });
    const second = mount();
    await act(async () => {
      await second.result.current.handlePaymentModalClose({ expectedOrderId: order.id,
        expectedCheckoutAttemptId: change === 'other-attempt' ? 'foreign-attempt' : locked.checkoutAttemptId });
    });
    expect((await db.table('sales').get(order.id)).isLockedForCheckout).toBe(true);
    expect((await db.table('sales').get(order.id)).checkoutAttemptId).toBe(locked.checkoutAttemptId);
    expect((await db.table('sales').get(order.id)).status).toBe('open');
    expect(await db.table('sales').count()).toBe(1);
    expect((await db.table('menu').get('p')).stock).toBe(10);
    second.unmount();
  }
);


it('does not let an already recovered cancellation release an attempt after prepayment ends', async () => {
  const first = mount();
  await act(async () => { await first.result.current.handleInitiateCheckout(); });
  const locked = await db.table('sales').get(order.id);
  first.unmount();
  const second = mount();
  await act(async () => { expect(await second.result.current.handleInitiateCheckout())
    .toMatchObject({ code: 'CHECKOUT_RECOVERY_CANCEL_REQUIRED' }); });
  // Same phase transition used synchronously on entry to handleProcessOrder.
  forgetPrepaymentCheckout(order.id, locked.checkoutAttemptId);
  await act(async () => { expect(await second.result.current.handlePaymentModalClose())
    .toMatchObject({ success: false, released: false }); });
  expect((await db.table('sales').get(order.id)).isLockedForCheckout).toBe(true);
  expect((await db.table('sales').get(order.id)).status).toBe('open');
  second.unmount();
});
