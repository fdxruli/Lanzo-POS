// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearTrackingCache,
  createEcommerceOrderTrackingService,
  readTrackingCache,
  writeTrackingCache
} from '../ecommerceOrderTrackingService';

const token = `trk1_${'A'.repeat(43)}`;
const topic = `ecom-track:${'a'.repeat(48)}`;

const publicPayload = (overrides = {}) => ({
  success: true,
  tracking: {
    orderCode: 'EC-00000123',
    status: 'received',
    fulfillmentMethod: 'pickup',
    createdAt: '2026-07-12T12:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    total: '100.00',
    currency: 'MXN',
    items: [{ name: 'Alitas', quantity: 2, internalId: 'hidden' }],
    publicMessage: 'Pedido recibido',
    version: 0,
    paymentRegistered: false,
    storefrontAvailable: true,
    realtime: { enabled: false, topic: null },
    license_id: 'must-not-survive',
    ...overrides
  }
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('ecommerceOrderTrackingService', () => {
  it('calls only the public tracking RPC and returns an allowlisted payload', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: publicPayload(), error: null });
    const service = createEcommerceOrderTrackingService({ rpc });

    const result = await service.getTracking(' Mi-Tienda ', token);

    expect(rpc).toHaveBeenCalledWith('ecommerce_get_order_tracking', {
      p_slug: 'mi-tienda',
      p_tracking_token: token
    });
    expect(result).toEqual({
      orderCode: 'EC-00000123',
      status: 'received',
      fulfillmentMethod: 'pickup',
      createdAt: '2026-07-12T12:00:00.000Z',
      updatedAt: '2026-07-12T12:00:00.000Z',
      total: 100,
      currency: 'MXN',
      items: [{ name: 'Alitas', quantity: 2 }],
      publicMessage: 'Pedido recibido',
      version: 0,
      paymentRegistered: false,
      storefrontAvailable: true,
      realtime: { enabled: false, topic: '' }
    });
    expect(JSON.stringify(result)).not.toContain('license_id');
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('keeps valid tracking available while marking an unpublished storefront unavailable', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: publicPayload({ storefrontAvailable: false, status: 'preparing' }),
      error: null
    });
    const service = createEcommerceOrderTrackingService({ rpc });

    await expect(service.getTracking('mi-tienda', token)).resolves.toMatchObject({
      status: 'preparing',
      storefrontAvailable: false
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('uses the same public not-found message for an invalid token response', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        error: {
          code: 'ECOMMERCE_TRACKING_NOT_FOUND',
          message: 'No se pudo encontrar este seguimiento.'
        }
      },
      error: null
    });
    const service = createEcommerceOrderTrackingService({ rpc });

    await expect(service.getTracking('mi-tienda', token)).rejects.toMatchObject({
      code: 'ECOMMERCE_TRACKING_NOT_FOUND',
      message: 'No se pudo encontrar este seguimiento.'
    });
  });

  it('treats realtime as a revalidation signal and ignores its payload', () => {
    const onSignal = vi.fn();
    const removeChannel = vi.fn();
    const subscribe = vi.fn().mockReturnValue({ id: 'channel' });
    const on = vi.fn((type, config, handler) => {
      expect(type).toBe('broadcast');
      expect(config).toEqual({ event: 'tracking_changed' });
      handler({ payload: { status: 'completed', order_id: 'untrusted' } });
      return { subscribe };
    });
    const client = {
      channel: vi.fn().mockReturnValue({ on }),
      removeChannel
    };
    const service = createEcommerceOrderTrackingService(client);

    const cleanup = service.subscribeToSignals({ topic, onSignal });
    cleanup();

    expect(client.channel).toHaveBeenCalledWith(topic, {
      config: { private: true, broadcast: { self: false } }
    });
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it('stores only an allowlisted payload under a hashed session key', async () => {
    await writeTrackingCache('mi-tienda', token, publicPayload().tracking);

    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(token);
    expect(sessionStorage.getItem(keys[0])).not.toContain(token);

    const cached = await readTrackingCache('mi-tienda', token);
    expect(cached.tracking).toMatchObject({
      orderCode: 'EC-00000123',
      status: 'received',
      storefrontAvailable: true
    });

    await clearTrackingCache('mi-tienda', token);
    expect(sessionStorage.length).toBe(0);
  });

  it('never writes the token to console output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = createEcommerceOrderTrackingService({
      rpc: vi.fn().mockResolvedValue({ data: publicPayload(), error: null })
    });

    await service.getTracking('mi-tienda', token);

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
