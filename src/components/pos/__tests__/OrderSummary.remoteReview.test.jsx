// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: null, actor: null, capture: vi.fn(), confirm: vi.fn(), message: vi.fn(),
  refunds: vi.fn(), table: vi.fn(), releaseStock: vi.fn(), cloudWrite: vi.fn()
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../hooks/useFeatureConfig', () => ({ useFeatureConfig: () => ({ hasLayaway: false }) }));
vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: Object.assign((selector) => selector(mocks.state), { getState: () => mocks.state })
}));
vi.mock('../../../services/auth/actorRuntimeController', () => ({ actorRuntimeController: { capture: mocks.capture } }));
vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({ useActorRuntimeSnapshot: () => mocks.actor }));
vi.mock('../../../services/auth/refundsActorAuthorization', () => ({ captureRefundsActorHandle: mocks.refunds }));
vi.mock('../../../hooks/pos/posActorAuthorityUi', () => ({ handlePosActorAuthorityError: () => true }));
vi.mock('../../../services/db/dexie', () => ({ db: { table: mocks.table }, STORES: { SALES: 'sales' } }));
vi.mock('../../../services/sales/inventoryFlow', () => ({ releaseCommittedStock: mocks.releaseStock }));
vi.mock('../../../services/restaurant/restaurantOrdersRepository', () => ({ restaurantOrdersRepository: { upsertRestaurantOrder: mocks.cloudWrite, cancelRestaurantOrder: mocks.cloudWrite } }));
vi.mock('../../../hooks/restaurant/useRestaurantOrderCloudStatus', () => ({
  useRestaurantOrderCloudStatus: () => ({ items: [], hasCancelledItems: false }),
  buildRestaurantCloudStatusSummary: vi.fn(), RESTAURANT_CLOUD_STATUS_EVENT: 'restaurant-status'
}));
vi.mock('../../../services/restaurant/restaurantOrderReconciliation', () => ({
  getRestaurantCloudItemLocalLineId: () => null,
  isCartItemCancelledByKitchen: () => false
}));
vi.mock('../../../services/restaurant/restaurantOrderAccountAdjustment', () => ({
  applyKitchenCancelledItemsAdjustment: () => ({ success: true, changed: false }),
  persistKitchenCancelledItemsAdjustment: vi.fn()
}));
vi.mock('../../../services/utils', () => ({ showConfirmModal: mocks.confirm, showMessageModal: mocks.message }));
vi.mock('../OrderDiscountPanel', () => ({ default: () => null }));
vi.mock('../EcommercePosDraftBanner', () => ({ default: () => null }));
import OrderSummary from '../OrderSummary';

const props = { showRestaurantActions: true, canSplitOrder: true, onOpenPayment: vi.fn(), onOpenSplit: vi.fn() };
const click = async () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cerrar revisión' })); });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor = { status: 'granted', actorType: 'staff', actorId: 'staff-1', sessionId: 'session-1', permissions: [] };
  mocks.capture.mockReturnValue({ tenant: { opaqueId: 'tenant-1' }, assertCurrent: vi.fn() });
  mocks.confirm.mockResolvedValue(true);
  const shadow = {
    id: 'QA-REMOTE-1', localOrderId: 'QA-REMOTE-1', isSaved: true,
    restaurantCloudHydrated: true, reservationAuthority: 'cloud',
    tenantOpaqueId: 'tenant-1', restaurantCloudTenantId: 'tenant-1',
    items: [{ id: 'pizza', name: 'Pizza', price: 50, quantity: 1 }]
  };
  mocks.state = {
    currentOrderId: shadow.id, activeOrders: new Map([[shadow.id, shadow]]),
    getTotalPrice: () => 50, updateItemQuantity: vi.fn(), removeItem: vi.fn(), setTableData: vi.fn(),
    removeOrder: vi.fn().mockResolvedValue({ success: true }), cancelCurrentOrder: vi.fn(), releaseEcommerceDraft: vi.fn()
  };
});
afterEach(cleanup);

describe('remote table review closure', () => {
  it('closes locally without refunds, cancellation, financial, inventory or database writes', async () => {
    render(<OrderSummary {...props} />);
    expect(screen.queryByRole('button', { name: 'Salir sin guardar' })).not.toBeInTheDocument();
    await click();
    expect(mocks.confirm).toHaveBeenCalledWith(
      'La mesa se quitará de este dispositivo, pero seguirá abierta y disponible en Mesas.',
      { title: 'Cerrar revisión', confirmButtonText: 'Cerrar revisión', cancelButtonText: 'Seguir revisando' }
    );
    expect(mocks.state.removeOrder).toHaveBeenCalledExactlyOnceWith('QA-REMOTE-1');
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith();
    for (const forbidden of [mocks.refunds, mocks.table, mocks.releaseStock, mocks.cloudWrite, mocks.state.cancelCurrentOrder]) {
      expect(forbidden).not.toHaveBeenCalled();
    }
  });
  it('keeps the shadow when confirmation is declined', async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<OrderSummary {...props} />);
    await click();
    expect(mocks.state.removeOrder).not.toHaveBeenCalled();
  });
  it('closes the mobile summary after removing the current shadow', async () => {
    const onClose = vi.fn();
    render(<OrderSummary {...props} isMobileModal onClose={onClose} />);
    await click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.state.removeOrder.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });
  it('removes only the captured shadow after switching tabs and leaves the new mobile view open', async () => {
    let resolve;
    mocks.confirm.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onClose = vi.fn();
    render(<OrderSummary {...props} isMobileModal onClose={onClose} />);
    await click();
    mocks.state.currentOrderId = 'local-order';
    mocks.state.activeOrders.set('local-order', { id: 'local-order', items: [] });
    await act(async () => resolve(true));
    expect(mocks.state.removeOrder).toHaveBeenCalledExactlyOnceWith('QA-REMOTE-1');
    expect(onClose).not.toHaveBeenCalled();
  });
  it.each(['actor', 'replacement', 'missing'])('ignores a stale confirmation after %s changes', async (change) => {
    let resolve;
    mocks.confirm.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<OrderSummary {...props} />);
    await click();
    if (change === 'actor') mocks.capture.mock.results[0].value.assertCurrent.mockImplementation(() => { throw new Error('stale'); });
    if (change === 'replacement') mocks.state.activeOrders.set('QA-REMOTE-1', { ...mocks.state.activeOrders.get('QA-REMOTE-1') });
    if (change === 'missing') mocks.state.activeOrders.delete('QA-REMOTE-1');
    await act(async () => resolve(true));
    expect(mocks.state.removeOrder).not.toHaveBeenCalled();
  });
  it('coalesces double click into one confirmation and one removal', async () => {
    let resolve;
    mocks.confirm.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<OrderSummary {...props} />);
    await act(async () => {
      const button = screen.getByRole('button', { name: 'Cerrar revisión' });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await act(async () => resolve(true));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.state.removeOrder).toHaveBeenCalledOnce();
  });
  it.each(['hydrated', 'authority', 'terminal', 'empty'])('recognizes the %s shadow contract, including terminal/empty reviews', async (kind) => {
    const shadow = mocks.state.activeOrders.get('QA-REMOTE-1');
    if (kind === 'hydrated') delete shadow.reservationAuthority;
    if (kind === 'authority') delete shadow.restaurantCloudHydrated;
    if (kind === 'terminal') shadow.restaurantCloudTerminalState = 'terminal';
    if (kind === 'empty') shadow.items = [];
    render(<OrderSummary {...props} />);
    await click();
    expect(mocks.state.removeOrder).toHaveBeenCalledOnce();
  });
  it('rejects a shadow from another tenant before prompting', async () => {
    mocks.state.activeOrders.get('QA-REMOTE-1').restaurantCloudTenantId = 'tenant-2';
    render(<OrderSummary {...props} />);
    await click();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.state.removeOrder).not.toHaveBeenCalled();
  });
  it('does not prompt or mutate when actor authority is locked', async () => {
    mocks.capture.mockImplementation(() => { throw new Error('locked'); });
    render(<OrderSummary {...props} />);
    await click();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.state.removeOrder).not.toHaveBeenCalled();
  });
  it('preserves origin table exit semantics and refund permission', async () => {
    const shadow = mocks.state.activeOrders.get('QA-REMOTE-1');
    delete shadow.restaurantCloudHydrated;
    delete shadow.reservationAuthority;
    mocks.actor.permissions = ['refunds'];
    render(<OrderSummary {...props} />);
    expect(screen.queryByRole('button', { name: 'Cerrar revisión' })).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' })));
    expect(mocks.state.cancelCurrentOrder).toHaveBeenCalledOnce();
    expect(mocks.state.removeOrder).not.toHaveBeenCalled();
  });
  it('keeps checkout and split callbacks available', () => {
    render(<OrderSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dividir Cuenta' }));
    expect(props.onOpenPayment).toHaveBeenCalledOnce();
    expect(props.onOpenSplit).toHaveBeenCalledOnce();
  });
});
