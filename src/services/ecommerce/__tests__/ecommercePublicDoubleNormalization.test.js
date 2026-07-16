// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createEcommercePublicService } from '../ecommercePublicService';

const REVISION = 'a'.repeat(64);

const orderResponse = {
  success: true,
  idempotent: false,
  order: {
    id: 'order-1',
    code: 'PED-1',
    status: 'new',
    total: 48,
    currency: 'MXN',
    fulfillmentMethod: 'pickup',
    createdAt: '2026-07-16T00:00:00Z'
  },
  whatsapp: { phone: '', message: '', url: '' }
};

describe('ecommerce public configured checkout normalization', () => {
  it('preserves configuration when PublicStorePage already normalized the cart line', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: orderResponse, error: null });
    const service = createEcommercePublicService({ rpc }, { cache: null });

    await service.createPublicOrder('store', {
      customer: {
        name: 'Cliente',
        phone: '9610000000',
        fulfillmentMethod: 'pickup'
      },
      items: [{
        productId: 'product-1',
        quantity: 2,
        variantId: null,
        selections: [{ groupId: 'group-1', optionIds: ['option-2', 'option-1'] }],
        configurationVersion: 3,
        configurationRevision: REVISION
      }],
      idempotencyKey: 'web-double-normalization'
    });

    expect(rpc).toHaveBeenCalledWith('ecommerce_create_order', expect.objectContaining({
      p_items: [{
        productId: 'product-1',
        quantity: 2,
        selections: [{ groupId: 'group-1', optionIds: ['option-1', 'option-2'] }],
        configurationVersion: 3,
        configurationRevision: REVISION
      }]
    }));
  });
});
