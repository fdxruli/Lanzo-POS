// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildEcommerceConfiguredLineKey } from '../../../utils/ecommerceConfiguredProduct';
import { createEcommercePublicService } from '../ecommercePublicService';

const orderResponse = {
  success: true,
  idempotent: false,
  order: { id: 'order-1', code: 'PED-1', status: 'new', total: 165, currency: 'MXN', fulfillmentMethod: 'pickup', createdAt: '2026-07-16T00:00:00Z' },
  whatsapp: { phone: '', message: '', url: '' }
};

describe('ecommercePublicService configurable products', () => {
  it('loads and normalizes the safe product configuration RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: true, catalogRevision: 9,
        product: { id: 'p1', name: 'Hamburguesa', basePrice: 100, configurationType: 'configurable', configurationVersion: 2, requiresConfiguration: true, hasVariants: false, hasOptionGroups: true, isAvailable: true },
        variants: [],
        groups: [{ id: 'g1', publicName: 'Extras', selectionType: 'multiple', required: false, minSelect: 0, maxSelect: 3, options: [{ id: 'o1', publicName: 'Queso', priceDelta: 15, isAvailable: true }] }]
      },
      error: null
    });
    const configurationCache = {
      buildKey: vi.fn(() => 'key'), get: vi.fn(() => null), put: vi.fn(),
      deleteObsolete: vi.fn(), dedupe: vi.fn((key, factory) => factory())
    };
    const service = createEcommercePublicService({ rpc }, { cache: null, configurationCache });
    const result = await service.getPublicProductConfiguration('store', {
      productId: 'p1', catalogRevision: 9, configurationVersion: 2
    });
    expect(rpc).toHaveBeenCalledWith('ecommerce_get_product_configuration', { p_slug: 'store', p_product_id: 'p1' });
    expect(result.groups[0].options[0]).toMatchObject({ publicName: 'Queso', priceDelta: 15 });
    expect(JSON.stringify(result)).not.toContain('sourceIngredientId');
  });

  it('sends only productId, quantity, variantId and canonical selections', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: orderResponse, error: null });
    const service = createEcommercePublicService({ rpc }, { cache: null });
    const lineKey = buildEcommerceConfiguredLineKey({
      productId: 'p1', variantId: 'v1',
      selections: [{ groupId: 'g2', optionIds: ['o2', 'o1'] }]
    });
    await service.createPublicOrder('store', {
      customer: { name: 'Cliente', phone: '9610000000', fulfillmentMethod: 'pickup' },
      items: [{ productId: lineKey, quantity: 2, price: 1, total: 2, display: { private: true } }],
      idempotencyKey: 'web-key'
    });
    expect(rpc).toHaveBeenCalledWith('ecommerce_create_order', expect.objectContaining({
      p_items: [{ productId: 'p1', quantity: 2, variantId: 'v1', selections: [{ groupId: 'g2', optionIds: ['o1', 'o2'] }] }]
    }));
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain('price');
  });

  it('deduplicates concurrent detail requests through the configuration cache', async () => {
    let resolveRpc;
    const rpc = vi.fn(() => new Promise((resolve) => { resolveRpc = resolve; }));
    const pending = new Map();
    const configurationCache = {
      buildKey: () => 'key', get: () => null, put: vi.fn(), deleteObsolete: vi.fn(),
      dedupe: (key, factory) => {
        if (pending.has(key)) return pending.get(key);
        const request = factory().finally(() => pending.delete(key));
        pending.set(key, request);
        return request;
      }
    };
    const service = createEcommercePublicService({ rpc }, { cache: null, configurationCache });
    const first = service.getPublicProductConfiguration('store', { productId: 'p1' });
    const second = service.getPublicProductConfiguration('store', { productId: 'p1' });
    resolveRpc({ data: { success: true, product: { id: 'p1', isAvailable: true }, variants: [], groups: [] }, error: null });
    await Promise.all([first, second]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
