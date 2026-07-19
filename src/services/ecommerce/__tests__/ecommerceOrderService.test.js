// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  buildPosSyncAuthContext: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn()
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: mocks.rpc }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: mocks.buildPosSyncAuthContext
}));

vi.mock('../../Logger', () => ({
  default: { error: mocks.loggerError, warn: mocks.loggerWarn }
}));

import {
  acceptEcommerceOrder,
  claimEcommerceOrderPosDraft,
  confirmEcommerceOrderPosDraft,
  getEcommerceOrder,
  getEcommerceOrderErrorMessage,
  ecommerceOrderServiceInternals,
  listEcommerceOrders,
  markEcommerceOrderSeen,
  rejectEcommerceOrder,
  releaseEcommerceOrderPosDraft
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
  items: [{ id: 'item', sourceProductId: 'local-product', publishedProductId: 'published-product', productName: 'Producto', unitPrice: '20', quantity: '1', lineTotal: '20' }],
  events: [{ eventType: 'order_created', actorType: 'public_customer', actorLabel: 'Cliente', message: 'Pedido creado', payload: {} }],
  contact: { whatsappUrl: 'https://wa.me/529610000000' }
};

beforeEach(() => {
  vi.clearAllMocks();
  ecommerceOrderServiceInternals.setReadRpcRetryWaitForTests(() => Promise.resolve());
  mocks.buildPosSyncAuthContext.mockResolvedValue({
    licenseKey: 'license-fixture',
    deviceFingerprint: 'device-fixture',
    securityToken: 'security-fixture',
    staffSessionToken: null
  });
});

describe('ecommerceOrderService', () => {
  it('retries a temporary list network failure once and recovers without a final error log', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch', code: null } })
      .mockResolvedValueOnce({
        data: { success: true, orders: [], counts: { total: 1 }, pagination: { limit: 50, offset: 0 } },
        error: null
      });

    const result = await listEcommerceOrders({ licenseDetails });

    expect(result).toMatchObject({ success: true, counts: { total: 1 } });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      '[ecommerceOrderService] Read RPC network failure',
      { rpcName: 'ecommerce_admin_list_orders', code: 'ECOMMERCE_ORDERS_NETWORK_UNAVAILABLE', attempt: 1 }
    );
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('returns a safe network code after the only list retry also fails without logging credentials', async () => {
    mocks.buildPosSyncAuthContext.mockResolvedValue({
      licenseKey: 'license-fixture',
      deviceFingerprint: 'device-fixture',
      securityToken: 'security-fixture',
      staffSessionToken: 'staff-token-fixture'
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'ERR_CONNECTION_CLOSED', code: null } });

    const result = await listEcommerceOrders({ licenseDetails });

    expect(result).toMatchObject({ success: false, code: 'ECOMMERCE_ORDERS_NETWORK_UNAVAILABLE' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...mocks.loggerWarn.mock.calls, ...mocks.loggerError.mock.calls])).not.toMatch(
      /license-fixture|device-fixture|security-fixture|staff-token-fixture|p_license_key|p_security_token|p_staff_session_token/
    );
  });

  it('does not retry functional errors with a PostgREST code', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });

    const result = await listEcommerceOrders({ licenseDetails });

    expect(result.code).toBe('ECOMMERCE_ORDERS_RPC_ACCESS_DENIED');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  });

  it('retries detail reads once but never retries mark-seen, accept, or reject mutations', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed', code: null } })
      .mockResolvedValueOnce({ data: { success: true, order: orderDetail }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Load failed', code: null } })
      .mockResolvedValueOnce({ data: null, error: { message: 'Load failed', code: null } })
      .mockResolvedValueOnce({ data: null, error: { message: 'Load failed', code: null } });

    const detail = await getEcommerceOrder({ licenseDetails, orderId: orderDetail.id });
    const seen = await markEcommerceOrderSeen({ licenseDetails, orderId: orderDetail.id });
    const accepted = await acceptEcommerceOrder({ licenseDetails, orderId: orderDetail.id });
    const rejected = await rejectEcommerceOrder({ licenseDetails, orderId: orderDetail.id, reason: 'Sin existencia' });

    expect(detail.success).toBe(true);
    expect(seen.code).toBe('ECOMMERCE_ORDERS_NETWORK_UNAVAILABLE');
    expect(accepted.code).toBe('ECOMMERCE_ORDERS_NETWORK_UNAVAILABLE');
    expect(rejected.code).toBe('ECOMMERCE_ORDERS_NETWORK_UNAVAILABLE');
    expect(mocks.rpc).toHaveBeenCalledTimes(5);
    expect(mocks.rpc.mock.calls.map(([rpcName]) => rpcName)).toEqual([
      'ecommerce_admin_get_order',
      'ecommerce_admin_get_order',
      'ecommerce_admin_mark_order_seen',
      'ecommerce_admin_accept_order',
      'ecommerce_admin_reject_order'
    ]);
  });

  it('normalizes a successful RPC made through the public Supabase client', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        success: true,
        orders: [{
          id: orderDetail.id,
          code: orderDetail.code,
          status: 'new',
          customerName: 'Cliente',
          itemCount: '2',
          total: '20.50',
          currency: 'MXN'
        }],
        counts: { new: '1', total: '1' },
        pagination: { limit: '50', offset: '0', hasMore: false }
      },
      error: null
    });

    const result = await listEcommerceOrders({ licenseDetails });

    expect(result).toMatchObject({
      success: true,
      orders: [{
        id: orderDetail.id,
        code: orderDetail.code,
        itemCount: 2,
        total: 20.5
      }],
      counts: { new: 1, total: 1 }
    });
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('sends the exact admin auth context with a null staff token', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        success: true,
        orders: [],
        counts: {},
        pagination: { limit: 50, offset: 0, hasMore: false }
      },
      error: null
    });

    await listEcommerceOrders({ licenseDetails, status: 'pending', limit: 500, offset: -10 });

    expect(mocks.rpc).toHaveBeenCalledWith('ecommerce_admin_list_orders', {
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
    mocks.buildPosSyncAuthContext.mockResolvedValue({
      licenseKey: 'license-fixture',
      deviceFingerprint: 'device-fixture',
      securityToken: 'security-fixture',
      staffSessionToken: 'staff-token-fixture'
    });
    mocks.rpc.mockResolvedValue({ data: { success: true, changed: true, order: orderDetail }, error: null });

    await markEcommerceOrderSeen({ licenseDetails, orderId: orderDetail.id });
    await acceptEcommerceOrder({ licenseDetails, orderId: orderDetail.id });
    await rejectEcommerceOrder({ licenseDetails, orderId: orderDetail.id, reason: 'Sin existencia' });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'ecommerce_admin_mark_order_seen', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_order_id: orderDetail.id
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'ecommerce_admin_accept_order', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_order_id: orderDetail.id
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'ecommerce_admin_reject_order', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_order_id: orderDetail.id,
      p_reason: 'Sin existencia'
    }));
  });

  it('normalizes list and detail values without leaking unknown fields', async () => {
    mocks.rpc
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
      sourceProductId: 'local-product',
      publishedProductId: 'published-product',
      quantity: 1,
      unitPrice: 20,
      lineTotal: 20
    }));
    expect(detailResult.order.contact.whatsappUrl).toBe('https://wa.me/529610000000');
  });

  it('uses exact auth-only RPC contracts for claim, confirm and release', async () => {
    mocks.rpc.mockResolvedValue({
      data: { success: true, changed: true, order: { ...orderDetail, posDraft: { status: 'claimed', claimToken: 'claim-token' } } },
      error: null
    });

    await claimEcommerceOrderPosDraft({ licenseDetails, orderId: orderDetail.id, requestKey: 'request-1' });
    await confirmEcommerceOrderPosDraft({ licenseDetails, orderId: orderDetail.id, claimToken: 'claim-token', draftId: `ecom-${orderDetail.id}` });
    await releaseEcommerceOrderPosDraft({ licenseDetails, orderId: orderDetail.id, claimToken: 'claim-token', reason: 'abandoned' });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'ecommerce_admin_claim_pos_draft', expect.objectContaining({
      p_order_id: orderDetail.id,
      p_request_key: 'request-1'
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'ecommerce_admin_confirm_pos_draft', expect.objectContaining({
      p_order_id: orderDetail.id,
      p_claim_token: 'claim-token',
      p_draft_id: `ecom-${orderDetail.id}`
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'ecommerce_admin_release_pos_draft', expect.objectContaining({
      p_order_id: orderDetail.id,
      p_claim_token: 'claim-token',
      p_reason: 'abandoned'
    }));
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain('claim-token');
  });

  it('maps conversion review to a safe message without exposing reservation internals', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        success: false,
        code: 'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
        message: 'attemptId=internal conversionKey=internal claimToken=internal'
      },
      error: null
    });

    const result = await releaseEcommerceOrderPosDraft({
      licenseDetails,
      orderId: orderDetail.id,
      claimToken: 'claim-token',
      reason: 'admin_release'
    });

    expect(result).toEqual({
      success: false,
      code: 'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
      message: 'Este pedido tiene un cobro en revisión y no puede liberarse todavía. Verifica la venta antes de continuar.'
    });
    expect(getEcommerceOrderErrorMessage({ code: result.code })).toBe(result.message);
    expect(JSON.stringify(result)).not.toContain('attemptId');
    expect(JSON.stringify(result)).not.toContain('conversionKey');
    expect(JSON.stringify(result)).not.toContain('claimToken');
  });

  it('accepts only https://wa.me links in normalized detail', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { success: true, order: { ...orderDetail, contact: { whatsappUrl: 'http://wa.me/529610000000' } } },
        error: null
      })
      .mockResolvedValueOnce({
        data: { success: true, order: { ...orderDetail, contact: { whatsappUrl: 'https://example.com/529610000000' } } },
        error: null
      });

    const insecure = await getEcommerceOrder({ licenseDetails, orderId: orderDetail.id });
    const foreignHost = await getEcommerceOrder({ licenseDetails, orderId: orderDetail.id });

    expect(insecure.order.contact.whatsappUrl).toBeNull();
    expect(foreignHost.order.contact.whatsappUrl).toBeNull();
  });

  it('maps PostgREST 42501 to a safe access error and logs no auth arguments', async () => {
    mocks.buildPosSyncAuthContext.mockResolvedValue({
      licenseKey: 'license-fixture',
      deviceFingerprint: 'device-fixture',
      securityToken: 'security-fixture',
      staffSessionToken: 'staff-token-fixture'
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'permission denied for function ecommerce_admin_list_orders',
        details: 'role anon cannot execute function',
        hint: 'grant execute'
      }
    });

    const result = await listEcommerceOrders({ licenseDetails });

    expect(result).toEqual({
      success: false,
      code: 'ECOMMERCE_ORDERS_RPC_ACCESS_DENIED',
      message: 'No se pudo autorizar el acceso a los pedidos online. Actualiza la aplicación e intenta nuevamente.'
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[ecommerceOrderService] RPC failed',
      {
        rpcName: 'ecommerce_admin_list_orders',
        code: '42501',
        message: 'permission denied for function ecommerce_admin_list_orders',
        details: 'role anon cannot execute function'
      }
    );

    const serializedLogs = JSON.stringify(mocks.loggerError.mock.calls);
    expect(serializedLogs).not.toContain('license-fixture');
    expect(serializedLogs).not.toContain('device-fixture');
    expect(serializedLogs).not.toContain('security-fixture');
    expect(serializedLogs).not.toContain('staff-token-fixture');
    expect(serializedLogs).not.toContain('p_license_key');
    expect(serializedLogs).not.toContain('p_security_token');
    expect(serializedLogs).not.toContain('p_staff_session_token');
  });

  it('maps safe server codes and never exposes raw PostgREST messages', async () => {
    mocks.rpc
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
        error: {
          code: 'XX000',
          message: 'relation private.secret_table does not exist',
          details: 'internal failure'
        }
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
      code: 'ECOMMERCE_ORDER_ACTION_FAILED',
      message: 'No se pudo completar la acción sobre el pedido.'
    });
    expect(JSON.stringify(failed)).not.toContain('secret_table');
  });
});
