import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  valid: true, generation: 1, state: {},
  setState: vi.fn(), get: vi.fn(), update: vi.fn(), save: vi.fn(),
  pause: vi.fn(), load: vi.fn(), loadAll: vi.fn(), checkout: vi.fn(),
  registerGuards: vi.fn()
}));
vi.mock('../../../services/auth/actorOperationalHandoff', () => ({
  registerActorOperationalActiveOrders: mocks.registerGuards
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ canAccess: () => true }) } }));
vi.mock('../useActiveOrders', () => ({ useActiveOrders: {
  getState: () => mocks.state,
  setState: mocks.setState
} }));
vi.mock('../../../services/db/dexie', () => ({
  db: { table: () => ({ get: mocks.get, update: mocks.update }) }, STORES: { SALES: 'sales' }
}));
vi.mock('../../../services/auth/actorRuntimeController', () => ({ actorRuntimeController: {
  capture: () => {
    if (!mocks.valid) throw Object.assign(new Error('ACTOR_CONTEXT_LOCKED'), { code: 'ACTOR_CONTEXT_LOCKED' });
    const generation = mocks.generation;
    return { assertCurrent: () => {
      if (!mocks.valid || generation !== mocks.generation) {
        throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
      }
    } };
  }
} }));

const order = () => ({ id: 'qa-table', items: [{ id: 'burger', price: 10, quantity: 1 }], total: 999 });

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.valid = true;
  mocks.generation = 1;
  mocks.state = {
    activeOrders: new Map([['qa-table', order()]]), currentOrderId: 'qa-table',
    getTotalPrice: vi.fn(), updateOrderItems: vi.fn(), updateOrder: vi.fn(),
    saveOrderAsOpen: mocks.save, pauseOrder: mocks.pause, loadOpenOrder: mocks.load,
    loadOrdersFromDB: mocks.loadAll, lockOrderForCheckout: mocks.checkout, closeOrder: vi.fn()
  };
  mocks.setState.mockImplementation((patch) => Object.assign(mocks.state, patch));
  mocks.save.mockResolvedValue({ success: true, id: 'qa-table' });
  mocks.load.mockResolvedValue({ success: true });
  mocks.pause.mockResolvedValue({ success: true });
  mocks.get.mockResolvedValue(null);
  mocks.update.mockResolvedValue(1);
  const { ensureOrderDiscountRuntime } = await import('../useOrderDiscountRuntime');
  ensureOrderDiscountRuntime();
  mocks.setState.mockClear();
});

describe('discount runtime authority boundaries', () => {
  it('preserves remote commercial totals through load, total display and tab detach', async () => {
    const remote = { ...order(), restaurantCloudHydrated: true, reservationAuthority: 'cloud', updatedAt: '2026-10-05T12:00:00.123456Z' };
    mocks.state.activeOrders.set(remote.id, remote);
    mocks.get.mockResolvedValue(remote);
    const { syncOrderTotalsNow } = await import('../useOrderDiscountRuntime');
    syncOrderTotalsNow(remote.id);
    expect(mocks.state.getTotalPrice()).toBe(999);
    await mocks.state.loadOpenOrder(remote.id);
    await mocks.state.pauseOrder(remote.id);
    expect(mocks.state.activeOrders.get(remote.id)).toEqual(remote);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it('blocks every direct discount mutation on a remote table', () => {
    const remote = { ...order(), restaurantCloudHydrated: true, reservationAuthority: 'cloud' };
    mocks.state.activeOrders.set(remote.id, remote);
    expect(() => mocks.state.applyLineDiscount('burger', { type: 'fixed', value: '1' })).toThrow('otro dispositivo');
    expect(() => mocks.state.removeLineDiscount('burger')).toThrow('otro dispositivo');
    expect(() => mocks.state.applySaleDiscount({ type: 'fixed', value: '1' })).toThrow('otro dispositivo');
    expect(() => mocks.state.removeSaleDiscount()).toThrow('otro dispositivo');
    expect(mocks.state.activeOrders.get(remote.id)).toEqual(remote);
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it('registers the completed wrappers so handoff tracks their post-save work', () => {
    expect(mocks.registerGuards).toHaveBeenCalledTimes(1);
    expect(mocks.registerGuards).toHaveBeenCalledWith(expect.objectContaining({
      useActiveOrders: expect.objectContaining({ getState: expect.any(Function) }),
      STORES: { SALES: 'sales' }
    }));
  });

  it('keeps the discount patch and its operational registration idempotent', async () => {
    const previousSave = mocks.state.saveOrderAsOpen;
    const { ensureOrderDiscountRuntime } = await import('../useOrderDiscountRuntime');
    ensureOrderDiscountRuntime();
    expect(mocks.state.saveOrderAsOpen).toBe(previousSave);
    expect(mocks.registerGuards).toHaveBeenCalledTimes(1);
  });
  it('does not normalize the cart before a locked checkout is rejected', async () => {
    mocks.valid = false;
    await expect(mocks.state.lockOrderForCheckout('qa-table')).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_LOCKED' });
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.state.activeOrders.get('qa-table').total).toBe(999);
  });

  it.each(['saveOrderAsOpen', 'pauseOrder'])('does not persist financial totals after authority changes during %s', async (action) => {
    const original = action === 'saveOrderAsOpen' ? mocks.save : mocks.pause;
    original.mockImplementationOnce(async () => {
      mocks.valid = false;
      return { success: true, id: 'qa-table' };
    });
    await expect(mocks.state[action]('qa-table', order())).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not merge a late loaded sale into the cart after the actor changes', async () => {
    let resolveRead;
    const read = new Promise((resolve) => { resolveRead = resolve; });
    mocks.get.mockReturnValueOnce(read);
    const loading = mocks.state.loadOpenOrder('qa-table');
    await Promise.resolve();
    mocks.valid = false;
    resolveRead({ id: 'qa-table', items: [{ id: 'foreign', price: 50, quantity: 2 }], total: 100 });
    await expect(loading).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_STALE' });
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.state.activeOrders.get('qa-table').items[0].id).toBe('burger');
  });

  it('forwards the durable table cleanup options without changing the financial calculation', async () => {
    const options = { tableTabCleanup: { status: 'pending', actorKey: 'admin:qa' } };
    await expect(mocks.state.saveOrderAsOpen('qa-table', order(), options)).resolves.toMatchObject({ success: true });
    expect(mocks.save).toHaveBeenCalledWith('qa-table', expect.objectContaining({ total: 10 }), options);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
