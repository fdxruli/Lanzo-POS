import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: null,
  setState: vi.fn(),
  updateOrderItems: vi.fn(),
  saveOrderAsOpen: vi.fn(),
  pauseOrder: vi.fn(),
  closeOrder: vi.fn(),
  lockOrderForCheckout: vi.fn(),
  unlockOrder: vi.fn(),
  removeOrder: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: {
    getState: () => mocks.state,
    setState: (updates) => {
      mocks.setState(updates);
      mocks.state = { ...mocks.state, ...updates };
    }
  }
}));

import {
  ecommercePosActiveOrderGuardsInternals,
  installEcommercePosActiveOrderGuards
} from '../installEcommercePosActiveOrderGuards';
import {
  ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
} from '../ecommercePosDraftGuards';

const ecommerceOrder = {
  id: 'ecom-order',
  origin: 'ecommerce',
  items: [{ id: 'product-1', quantity: 1, price: 20 }]
};

beforeEach(() => {
  vi.clearAllMocks();
  ecommercePosActiveOrderGuardsInternals.resetForTests();
  mocks.updateOrderItems.mockReturnValue(true);
  mocks.saveOrderAsOpen.mockResolvedValue({ success: true, id: 'normal' });
  mocks.pauseOrder.mockResolvedValue({ success: true });
  mocks.closeOrder.mockResolvedValue({ success: true });
  mocks.lockOrderForCheckout.mockResolvedValue({ success: true });
  mocks.unlockOrder.mockResolvedValue({ success: true });
  mocks.removeOrder.mockResolvedValue({ success: true });
  mocks.state = {
    currentOrderId: ecommerceOrder.id,
    activeOrders: new Map([[ecommerceOrder.id, ecommerceOrder]]),
    updateOrderItems: mocks.updateOrderItems,
    saveOrderAsOpen: mocks.saveOrderAsOpen,
    pauseOrder: mocks.pauseOrder,
    closeOrder: mocks.closeOrder,
    lockOrderForCheckout: mocks.lockOrderForCheckout,
    unlockOrder: mocks.unlockOrder,
    removeOrder: mocks.removeOrder
  };
});

describe('installEcommercePosActiveOrderGuards', () => {
  it('blocks item editing, open-sale persistence, pause, close and unauthorized checkout for ecommerce orders', async () => {
    installEcommercePosActiveOrderGuards();

    const edit = mocks.state.updateOrderItems(ecommerceOrder.id, vi.fn());
    const save = await mocks.state.saveOrderAsOpen(ecommerceOrder.id, ecommerceOrder);
    const pause = await mocks.state.pauseOrder(ecommerceOrder.id);
    const close = await mocks.state.closeOrder(ecommerceOrder.id, { paymentMethod: 'efectivo' });
    const lock = await mocks.state.lockOrderForCheckout(ecommerceOrder.id);

    expect(edit).toBe(false);
    expect(save).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(pause).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(close).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(lock).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(mocks.updateOrderItems).not.toHaveBeenCalled();
    expect(mocks.saveOrderAsOpen).not.toHaveBeenCalled();
    expect(mocks.pauseOrder).not.toHaveBeenCalled();
    expect(mocks.closeOrder).not.toHaveBeenCalled();
    expect(mocks.lockOrderForCheckout).not.toHaveBeenCalled();
  });

  it('delegates all operations for a normal POS order', async () => {
    const normalOrder = { ...ecommerceOrder, id: 'normal', origin: undefined };
    mocks.state.currentOrderId = normalOrder.id;
    mocks.state.activeOrders = new Map([[normalOrder.id, normalOrder]]);
    installEcommercePosActiveOrderGuards();

    const updater = vi.fn();
    mocks.state.updateOrderItems(normalOrder.id, updater);
    await mocks.state.saveOrderAsOpen(normalOrder.id, normalOrder);
    await mocks.state.pauseOrder(normalOrder.id);
    await mocks.state.closeOrder(normalOrder.id, { paymentMethod: 'tarjeta' });
    await mocks.state.lockOrderForCheckout(normalOrder.id);

    expect(mocks.updateOrderItems).toHaveBeenCalledWith(normalOrder.id, updater);
    expect(mocks.saveOrderAsOpen).toHaveBeenCalledWith(normalOrder.id, normalOrder);
    expect(mocks.pauseOrder).toHaveBeenCalledWith(normalOrder.id);
    expect(mocks.closeOrder).toHaveBeenCalledWith(normalOrder.id, { paymentMethod: 'tarjeta' });
    expect(mocks.lockOrderForCheckout).toHaveBeenCalledWith(normalOrder.id);
  });
});
