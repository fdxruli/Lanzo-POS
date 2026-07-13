// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: vi.fn()
}));

import { buildPosSyncAuthContext } from '../../sync/posSyncClient';
import {
  getEcommerceFulfillmentActions,
  getEcommerceOrderFulfillment,
  updateEcommerceOrderFulfillment
} from '../ecommerceOrderFulfillmentService';

beforeEach(() => {
  buildPosSyncAuthContext.mockResolvedValue({
    licenseKey: 'license-key',
    deviceFingerprint: 'device-fingerprint',
    securityToken: 'security-token',
    staffSessionToken: 'staff-session'
  });
});

describe('ecommerce fulfillment controls', () => {
  it('shows pickup transitions without En camino', () => {
    const actions = getEcommerceFulfillmentActions({
      status: 'accepted',
      fulfillmentMethod: 'pickup',
      fulfillment: { internalStatus: 'ready' }
    });
    expect(actions.map((action) => action.transition)).toEqual(['completed', 'cancelled']);
    expect(actions.some((action) => action.transition === 'out_for_delivery')).toBe(false);
  });

  it('shows delivery transitions with En camino', () => {
    const actions = getEcommerceFulfillmentActions({
      status: 'accepted',
      fulfillmentMethod: 'delivery',
      fulfillment: { internalStatus: 'ready' }
    });
    expect(actions.map((action) => action.transition)).toEqual(['out_for_delivery', 'cancelled']);
  });

  it('does not expose controls for terminal or unaccepted orders', () => {
    expect(getEcommerceFulfillmentActions({
      status: 'accepted',
      fulfillmentMethod: 'delivery',
      fulfillment: { internalStatus: 'completed' }
    })).toEqual([]);
    expect(getEcommerceFulfillmentActions({
      status: 'new',
      fulfillmentMethod: 'pickup',
      fulfillment: { internalStatus: null }
    })).toEqual([]);
  });

  it('reads fulfillment independently from the canonical order normalizer', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          order: {
            id: 'order-1',
            code: 'EC-1',
            status: 'accepted',
            fulfillmentMethod: 'delivery',
            fulfillment: {
              status: 'preparing',
              internalStatus: 'preparing',
              version: 2,
              updatedAt: '2026-07-12T12:00:00.000Z',
              publicMessage: 'En cocina',
              paymentRegistered: true
            }
          }
        },
        error: null
      })
    };

    const result = await getEcommerceOrderFulfillment({
      licenseDetails: { license_key: 'license-key' },
      orderId: 'order-1',
      client
    });

    expect(result).toMatchObject({
      success: true,
      order: {
        id: 'order-1',
        fulfillmentMethod: 'delivery',
        fulfillment: { internalStatus: 'preparing', version: 2 }
      }
    });
  });

  it('sends expected version and idempotency key to the administrative RPC', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          changed: true,
          idempotent: false,
          order: {
            id: 'order-1',
            code: 'EC-1',
            status: 'accepted',
            fulfillment: { internalStatus: 'preparing', version: 2 }
          }
        },
        error: null
      })
    };

    const result = await updateEcommerceOrderFulfillment({
      licenseDetails: { license_key: 'license-key' },
      orderId: 'order-1',
      transition: 'preparing',
      expectedVersion: 1,
      idempotencyKey: 'transition-key',
      publicMessage: 'En preparación',
      client
    });

    expect(client.rpc).toHaveBeenCalledWith('ecommerce_admin_update_order_fulfillment', {
      p_license_key: 'license-key',
      p_device_fingerprint: 'device-fingerprint',
      p_security_token: 'security-token',
      p_staff_session_token: 'staff-session',
      p_order_id: 'order-1',
      p_transition: 'preparing',
      p_expected_version: 1,
      p_idempotency_key: 'transition-key',
      p_public_message: 'En preparación'
    });
    expect(result).toMatchObject({ success: true, changed: true });
  });

  it('fails closed when the staff/device context cannot be built', async () => {
    buildPosSyncAuthContext.mockResolvedValueOnce({});

    const result = await updateEcommerceOrderFulfillment({
      licenseDetails: { license_key: 'license-key' },
      orderId: 'order-1',
      transition: 'preparing',
      expectedVersion: 1,
      idempotencyKey: 'transition-key',
      client: { rpc: vi.fn() }
    });

    expect(result).toMatchObject({ success: false, code: 'ECOMMERCE_ORDERS_ACCESS_DENIED' });
  });
});
