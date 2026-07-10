// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const buildPosSyncAuthContext = vi.fn();

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext
}));

import {
  acceptEcommerceOrder,
  getEcommerceOrder,
  listEcommerceOrders,
  markEcommerceOrderSeen,
  rejectEcommerceOrder
} from '../ecommerceOrderService';

const licenseDetails = { license_key: 'license-fixture' };

const orderDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'EC-00000011',
  status: 'new',
  customer: {
    name: 'Cliente',
    phone: '9610000000',
    address: 'Dirección',
    notes: 'Notas'
  },
  totals: { subtotal: '20', total: '20', currency: 'MXN' },
  payment: { method: 'on_delivery', status: 'pending' },
  timestamps: { createdAt: '2026-07-10T12:00:00Z' },
  items: [{ id: 'item', productName: 'Producto', unitPrice: '20', quantity: '1', lineTotal: '20' }],
  events: [{ eventType: 'order_created', actorType: 'public_customer', actorLabel: 'Cliente', message: 'Pedido creado', payload: {} }],
  contact: { whatsappUrl: 'https://wa.me/529610000000' }
};

beforeEach(() => {
  rpc.mockReset();
  buildPosSyncAuthContext.mockReset();
  buildPosSyncAuthContext.mockResolvedValue({
    licenseKey: 'license-fixture',
    deviceFingerprint: 'device-fixture',
    securityToken: 'security-fixture',
    staffSessionToken: null
  });
});

describe('ecommerceOrderService', () => {
  it('sends the exact admin auth context with a null staff token', async () => {
    rpc.mockResolvedValue({
      data: {
        success: true,
        orders: [],
        counts: {},
        pagination: { limit: 50, offset: 0, hasMore: false }
      },
      error: null
    });

    await listEcommerceOrders({ licenseDetails, status: 'pending', limit: 500, offset: -10 });

    expect(rpc).toHaveBeenCalledWith('ecommerce_admin_list_orders', {
      p_license_key: 'license-fixture',
      p_device_fingerprint: 'device-fixture',
      p_security_token: 'security-fixture',
      p_staff_session_token: null,
      p_status: 'pending',
      p_limit: 100,
      p_offset: 0
    });
  });

  it('passes the current staff session token to every mutation', async () => {
    buildPosSyncAuthContext.mockResolvedValue({
      licenseKey: 'license-fixture',
      deviceFingerprint: 'device-fixture',
      securityToken: 'security-fixture',
      staffSessionToken: 'staff-token-fixture'
    });
    rpc.mockResolvedValue({ data: { success: true, changed: true, order: orderDetail }, error: null });

    await markEcommerceOrderSeen({ licenseDetails, orderId: orderDetail.id });
    await acceptEcommerceOrder({ licenseDetails, orderId: orderDetail.id });
    await rejectEcommerceOrder({ licenseDetails, orderId: orderDetail.id, reason: 'Sin existencia' });

    expect(rpc).toHaveBeenNthCalledWith(1, 'ecommerce_admin_mark_order_seen', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_order_id: orderDetail.id
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'ecommerce_admin_accept_order', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_order_id: orderDetail.id
    }));
    expect(rpc).toHaveBeenNthCalledWith(3, 'ecommerce_admin_reject_order', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_order_id: orderDetail.id,
      p_reason: 'Sin existencia'
    }));
  });

  it('normalizes list and detail values without leaking unknown fields', async () => {
    rpc
      .mockResolvedValueOnce({
        data: {
          success: true,
          orders: [{
            id: orderDetail.id,
            code: orderDetail.code,
            status: 'new',
            customerName: 'Cliente',
            itemCount: '2',
            total: '20.50',
            currency: 'MXN',
            secret: 'not-allowed'
          }],
          counts: { new: '1', total: '1' },
          pagination: { limit: '50', offset: '0', hasMore: false }
        },
        error: null
      })
      .mockResolvedValueOnce({ data: { success: true, order: { ...orderDetail, secret: 'not-allowed' } }, error: null });

    const listResult = await listEcommerceOrders({ licenseDetails });
    const detailResult = await getEcommerceOrder({ licenseDetails, orderId: orderDetail.id });

    expect(listResult.orders[0]).toEqual(expect.objectContaining({
      id: orderDetail.id,
      itemCount: 2,
      total: 20.5
    }));
    expect(listResult.orders[0]).not.toHaveProperty('secret');
    expect(detailResult.order).not.toHaveProperty('secret');
    expect(detailResult.order.items[0]).toEqual(expect.objectContaining({
      quantity: 1,
      unitPrice: 20,
      lineTotal: 20
    }));
    expect(detailResult.order.contact.whatsappUrl).toBe('https://wa.me/529610000000');
  });

  it('maps safe server codes and never exposes raw PostgREST messages', async () => {
    rpc
      .mockResolvedValueOnce({
        data: {
          success: false,
          code: 'ECOMMERCE_STAFF_PERMISSION_DENIED',
          message: 'internal SQL details'
        },
        error: null
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'relation private.secret_table does not exist' }
      });

    const denied = await listEcommerceOrders({ licenseDetails });
    const failed = await getEcommerceOrder({ licenseDetails, orderId: orderDetail.id });

    expect(denied).toMatchObject({
      success: false,
      code: 'ECOMMERCE_STAFF_PERMISSION_DENIED',
      message: 'Tu usuario no tiene permiso para administrar pedidos online.'
    });
    expect(JSON.stringify(denied)).not.toContain('internal SQL');
    expect(failed).toMatchObject({
      success: false,
      code: 'ECOMMERCE_ORDER_ACTION_FAILED'
    });
    expect(JSON.stringify(failed)).not.toContain('secret_table');
  });
});
