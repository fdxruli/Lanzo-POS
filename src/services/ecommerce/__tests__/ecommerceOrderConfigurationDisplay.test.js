import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrder: vi.fn()
}));

vi.mock('../ecommerceOrderServiceBase', () => ({
  getEcommerceOrder: mocks.getOrder
}));

import {
  decorateEcommerceOrderConfiguration,
  getEcommerceOrder
} from '../ecommerceOrderService';

const order = () => ({
  id: 'order-1',
  totals: { currency: 'MXN' },
  items: [{
    id: 'item-1',
    productName: 'Hamburguesa de pollo',
    options: {
      groups: [{
        id: 'preparation',
        name: 'Preparación',
        selectionType: 'single',
        options: [{ id: 'normal', name: 'Normal', priceDelta: 0 }]
      }]
    }
  }]
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrder.mockResolvedValue({ success: true, order: order() });
});

describe('ecommerceOrderService configuration display', () => {
  it('decorates order detail items from the persisted options snapshot', async () => {
    const result = await getEcommerceOrder({ orderId: 'order-1' });

    expect(mocks.getOrder).toHaveBeenCalledWith({ orderId: 'order-1' });
    expect(result.order.items[0]).toMatchObject({
      ecommerceBaseProductName: 'Hamburguesa de pollo',
      ecommerceConfigurationSummary: 'Preparación: Normal',
      productName: 'Hamburguesa de pollo — Preparación: Normal'
    });
  });

  it('does not alter simple lines or the original object', () => {
    const source = {
      id: 'order-2',
      totals: { currency: 'MXN' },
      items: [{ id: 'item-2', productName: 'Producto simple', options: {} }]
    };
    const decorated = decorateEcommerceOrderConfiguration(source);

    expect(decorated.items[0]).toBe(source.items[0]);
    expect(decorated.items[0].productName).toBe('Producto simple');
    expect(source.items[0]).not.toHaveProperty('ecommerceConfigurationSummary');
  });
});
