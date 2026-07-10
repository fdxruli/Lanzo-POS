// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createEcommercePublicService,
  EcommercePublicError,
} from '../ecommercePublicService';

describe('ecommercePublicService', () => {
  it('uses only the public portal and catalog RPC contracts', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: {
          success: true,
          portal: {
            slug: 'mi-negocio',
            name: 'Mi negocio',
            maxOrderItems: 30,
            maxItemQuantity: 99,
          },
          hours: { weekly: [], exceptions: [] },
          features: { stockVisibility: false },
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
    expect(catalog.items[0]).toMatchObject({ price: 50, currency: 'MXN' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'ecommerce_get_portal_by_slug', {
      p_slug: 'mi-negocio',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'ecommerce_get_catalog', {
      p_slug: 'mi-negocio',
      p_limit: 100,
      p_offset: 0,
    });
    expect(rpc.mock.calls.flat().join(' ')).not.toContain('ecommerce_create_order');
  });

  it('keeps hidden stock hidden and normalizes exact stock as an integer', async () => {
    const service = createEcommercePublicService({
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          items: [
            {
              id: 'hidden',
              name: 'Oculto',
              price: 50,
              stock: { mode: 'hidden', status: null, quantity: 999 },
            },
            {
              id: 'exact',
              name: 'Exacto',
              price: 50,
              stock: { mode: 'exact', status: null, quantity: 3.8 },
            },
            {
              id: 'zero',
              name: 'Cero',
              price: 50,
              stock: { mode: 'exact', status: null, quantity: 0 },
            },
          ],
          pagination: {},
        },
        error: null,
      }),
    });

    const result = await service.getPublicCatalog('mi-negocio');
    expect(result.items[0].stock).toEqual({ mode: 'hidden', status: null, quantity: null });
    expect(result.items[1].stock).toEqual({ mode: 'exact', status: null, quantity: 3 });
    expect(result.items[2].stock).toEqual({ mode: 'exact', status: null, quantity: 0 });
  });

  it('maps an unavailable portal to a safe public error', async () => {
    const service = createEcommercePublicService({
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: false,
          error: { code: 'ECOMMERCE_PORTAL_NOT_FOUND', message: 'detalle interno' },
        },
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

  it('does not expose Supabase network details', async () => {
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
