import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: null,
  setState: vi.fn(),
  saveOrderAsOpen: vi.fn(),
  closeOrder: vi.fn(),
  lockOrderForCheckout: vi.fn()
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
  mocks.saveOrderAsOpen.mockResolvedValue({ success: true, id: 'normal' });
  mocks.closeOrder.mockResolvedValue({ success: true });
  mocks.lockOrderForCheckout.mockResolvedValue({ success: true });
  mocks.state = {
    currentOrderId: ecommerceOrder.id,
    activeOrders: new Map([[ecommerceOrder.id, ecommerceOrder]]),
    saveOrderAsOpen: mocks.saveOrderAsOpen,
    closeOrder: mocks.closeOrder,
    lockOrderForCheckout: mocks.lockOrderForCheckout
  };
});

describe('installEcommercePosActiveOrderGuards', () => {
  it('blocks open-sale persistence, close and checkout lock for ecommerce orders', async () => {
    installEcommercePosActiveOrderGuards();

    const save = await mocks.state.saveOrderAsOpen(ecommerceOrder.id, ecommerceOrder);
    const close = await mocks.state.closeOrder(ecommerceOrder.id, { paymentMethod: 'efectivo' });
    const lock = await mocks.state.lockOrderForCheckout(ecommerceOrder.id);

    expect(save).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(close).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(lock).toMatchObject({ success: false, code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED });
    expect(mocks.saveOrderAsOpen).not.toHaveBeenCalled();
    expect(mocks.closeOrder).not.toHaveBeenCalled();
    expect(mocks.lockOrderForCheckout).not.toHaveBeenCalled();
  });

  it('delegates all operations for a normal POS order', async () => {
    const normalOrder = { ...ecommerceOrder, id: 'normal', origin: undefined };
    mocks.state.currentOrderId = normalOrder.id;
    mocks.state.activeOrders = new Map([[normalOrder.id, normalOrder]]);
    installEcommercePosActiveOrderGuards();

    await mocks.state.saveOrderAsOpen(normalOrder.id, normalOrder);
    await mocks.state.closeOrder(normalOrder.id, { paymentMethod: 'tarjeta' });
    await mocks.state.lockOrderForCheckout(normalOrder.id);

    expect(mocks.saveOrderAsOpen).toHaveBeenCalledWith(normalOrder.id, normalOrder);
    expect(mocks.closeOrder).toHaveBeenCalledWith(normalOrder.id, { paymentMethod: 'tarjeta' });
    expect(mocks.lockOrderForCheckout).toHaveBeenCalledWith(normalOrder.id);
  });
});
