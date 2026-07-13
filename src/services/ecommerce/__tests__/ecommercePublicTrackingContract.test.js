// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createEcommercePublicService } from '../ecommercePublicService';

const token = `trk1_${'A'.repeat(43)}`;

describe('checkout tracking contract', () => {
  it('keeps the same tracking link on an idempotent response', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        idempotent: true,
        order: {
          id: 'order-1',
          code: 'EC-1',
          status: 'new',
          total: '100.00',
          currency: 'MXN',
          fulfillmentMethod: 'pickup',
          createdAt: '2026-07-12T12:00:00.000Z',
          trackingToken: token,
          trackingPath: `/tienda/mi-tienda/pedido/${token}`,
          trackingVersion: 1
        },
        whatsapp: {}
      },
      error: null
    });
    const service = createEcommercePublicService({ rpc });

    const result = await service.createPublicOrder('mi-tienda', {
      customer: { name: 'Cliente', phone: '9610000000', fulfillmentMethod: 'pickup' },
      items: [{ productId: 'product-1', quantity: 1 }],
      idempotencyKey: 'same-order-key'
    });

    expect(result).toMatchObject({
      idempotent: true,
      order: {
        trackingToken: token,
        trackingPath: `/tienda/mi-tienda/pedido/${token}`,
        trackingVersion: 1
      }
    });
  });
});
