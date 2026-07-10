// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEcommercePublicService,
  EcommercePublicError,
} from '../ecommercePublicService';

const orderResponse = (overrides = {}) => ({
  success: true,
  idempotent: false,
  order: {
    id: 'order-uuid',
    code: 'PED-1001',
    status: 'new',
    total: '100.00',
    currency: 'MXN',
    fulfillmentMethod: 'pickup',
    createdAt: '2026-07-10T12:00:00.000Z',
  },
  whatsapp: {
    phone: '529610000000',
    message: 'Pedido preparado',
    url: 'https://wa.me/529610000000?text=Pedido%20preparado',
  },
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ecommercePublicService', () => {
  it('uses the public portal and catalog RPC contracts and normalizes features', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: {
          success: true,
          portal: { slug: 'mi-negocio', name: 'Mi negocio', maxOrderItems: 30, maxItemQuantity: 99 },
          hours: { weekly: [], exceptions: [] },
          features: { stockVisibility: false, orderInbox: true, whatsappCheckout: true },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          items: [{
            id: 'product-1',
            name: 'Producto',
            price: '50.00',
            isAvailable: true,
            stock: { mode: 'hidden', status: null, quantity: null },
          }],
          pagination: { limit: 100, offset: 0, hasMore: false },
        },
        error: null,
      });
    const service = createEcommercePublicService({ rpc });

    const portal = await service.getPublicPortalBySlug('mi-negocio');
    const catalog = await service.getPublicCatalog('mi-negocio', { limit: 100, offset: 0 });

    expect(portal.portal.name).toBe('Mi negocio');
    expect(portal.features).toMatchObject({ orderInbox: true, whatsappCheckout: true });
    expect(catalog.items[0]).toMatchObject({ price: 50, currency: 'MXN' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'ecommerce_get_portal_by_slug', { p_slug: 'mi-negocio' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'ecommerce_get_catalog', {
      p_slug: 'mi-negocio',
      p_limit: 100,
      p_offset: 0,
    });
  });

  it('creates an order with exact RPC parameters and never sends prices or totals', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: orderResponse(), error: null });
    const service = createEcommercePublicService({ rpc });

    const result = await service.createPublicOrder(' mi-negocio ', {
      customer: {
        name: ' Cliente ',
        phone: ' 961 000 0000 ',
        address: 'No debe enviarse en pickup',
        notes: ' Sin cebolla ',
        fulfillmentMethod: 'pickup',
        licenseId: 'private',
      },
      items: [{
        productId: 'product-1',
        quantity: 2,
        price: 999,
        total: 1998,
        name: 'Manipulado',
        stock: 100,
      }],
      idempotencyKey: ' web-secure-key ',
    });

    expect(rpc).toHaveBeenCalledWith('ecommerce_create_order', {
      p_slug: 'mi-negocio',
      p_customer: {
        name: 'Cliente',
        phone: '961 000 0000',
        address: '',
        notes: 'Sin cebolla',
        fulfillmentMethod: 'pickup',
      },
      p_items: [{ productId: 'product-1', quantity: 2 }],
      p_idempotency_key: 'web-secure-key',
    });
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain('999');
    expect(result).toMatchObject({
      success: true,
      idempotent: false,
      order: { code: 'PED-1001', total: 100 },
    });
  });

  it('normalizes an idempotent success and keeps the server order', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: orderResponse({ idempotent: true }),
      error: null,
    });
    const service = createEcommercePublicService({ rpc });

    const result = await service.createPublicOrder('mi-negocio', {
      customer: { name: 'Cliente', phone: '9610000000', fulfillmentMethod: 'pickup' },
      items: [{ productId: 'product-1', quantity: 1 }],
      idempotencyKey: 'web-key',
    });

    expect(result.idempotent).toBe(true);
    expect(result.order).toMatchObject({ code: 'PED-1001', total: 100 });
  });

  it('rejects a WhatsApp URL outside https://wa.me without losing confirmation', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: orderResponse({
        whatsapp: { phone: '529610000000', message: 'Pedido', url: 'https://evil.example/steal' },
      }),
      error: null,
    });
    const service = createEcommercePublicService({ rpc });

    const result = await service.createPublicOrder('mi-negocio', {
      customer: { name: 'Cliente', phone: '9610000000', fulfillmentMethod: 'pickup' },
      items: [{ productId: 'product-1', quantity: 1 }],
      idempotencyKey: 'web-key',
    });

    expect(result.order.code).toBe('PED-1001');
    expect(result.whatsapp.url).toBe('');
  });

  it('maps checkout error codes and never exposes the raw PostgREST message', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        error: { code: 'ECOMMERCE_DUPLICATE_PRODUCT', message: 'relation and secret internals' },
      },
      error: null,
    });
    const service = createEcommercePublicService({ rpc });

    await expect(service.createPublicOrder('mi-negocio', {
      customer: {},
      items: [],
      idempotencyKey: 'web-key',
    })).rejects.toMatchObject({
      code: 'ECOMMERCE_DUPLICATE_PRODUCT',
      message: 'El carrito contiene productos repetidos. Actualízalo e intenta nuevamente.',
    });
  });

  it('uses a checkout-specific safe message for network errors', async () => {
    const service = createEcommercePublicService({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'database secret' } }),
    });

    await expect(service.createPublicOrder('mi-negocio', {
      customer: {},
      items: [],
      idempotencyKey: 'web-key',
    })).rejects.toMatchObject({
      code: 'ECOMMERCE_PUBLIC_NETWORK_ERROR',
      message: 'No se pudo confirmar el pedido. Revisa tu conexión e intenta nuevamente.',
    });
  });

  it('uses a checkout-specific safe message for timeout', async () => {
    vi.useFakeTimers();
    const service = createEcommercePublicService({
      rpc: vi.fn(() => new Promise(() => {})),
    });

    const request = service.createPublicOrder('mi-negocio', {
      customer: {},
      items: [],
      idempotencyKey: 'web-key',
    });
    await vi.advanceTimersByTimeAsync(12_001);

    await expect(request).rejects.toMatchObject({
      code: 'ECOMMERCE_PUBLIC_TIMEOUT',
      message: 'No se pudo confirmar el pedido. Revisa tu conexión e intenta nuevamente.',
    });
  });

  it('keeps hidden stock hidden and normalizes exact stock as an integer', async () => {
    const service = createEcommercePublicService({
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          items: [
            { id: 'hidden', name: 'Oculto', price: 50, stock: { mode: 'hidden', quantity: 999 } },
            { id: 'exact', name: 'Exacto', price: 50, stock: { mode: 'exact', quantity: 3.8 } },
          ],
          pagination: {},
        },
        error: null,
      }),
    });

    const result = await service.getPublicCatalog('mi-negocio');
    expect(result.items[0].stock).toEqual({ mode: 'hidden', status: null, quantity: null });
    expect(result.items[1].stock).toEqual({ mode: 'exact', status: null, quantity: 3 });
  });

  it('maps an unavailable portal to a safe public error', async () => {
    const service = createEcommercePublicService({
      rpc: vi.fn().mockResolvedValue({
        data: { success: false, error: { code: 'ECOMMERCE_PORTAL_NOT_FOUND', message: 'detalle interno' } },
        error: null,
      }),
    });

    await expect(service.getPublicPortalBySlug('missing')).rejects.toEqual(
      expect.objectContaining({
        name: 'EcommercePublicError',
        code: 'ECOMMERCE_PORTAL_NOT_FOUND',
        message: 'Esta tienda no está disponible.',
      })
    );
  });

  it('does not expose Supabase network details while loading the store', async () => {
    const service = createEcommercePublicService({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation ecommerce_portals does not exist' },
      }),
    });

    try {
      await service.getPublicCatalog('mi-negocio');
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EcommercePublicError);
      expect(error.message).toBe('No se pudo cargar la tienda. Revisa tu conexión e intenta nuevamente.');
      expect(error.message).not.toContain('relation');
    }
  });
});
