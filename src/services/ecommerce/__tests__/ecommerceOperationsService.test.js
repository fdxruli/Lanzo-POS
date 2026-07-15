import { describe, expect, it, vi } from 'vitest';
import { createEcommerceAdminService } from '../ecommerceAdminService';
import {
  createEcommercePublicService,
  ecommercePublicServiceInternals
} from '../ecommercePublicService';

const auth = {
  licenseKey: 'lic_test',
  deviceFingerprint: 'device_test',
  securityToken: 'security_test',
  staffSessionToken: 'staff_test'
};

describe('ECOM.OPERATIONS.1 services', () => {
  it('normalizes valid, invalid and legacy availability fail-closed', () => {
    const portal = { orderingEnabled: true };
    expect(ecommercePublicServiceInternals.normalizeAvailability({
      acceptingOrders: true,
      code: 'OPEN',
      timezone: 'America/Cancun',
      scheduleSource: 'weekly'
    }, portal, true)).toMatchObject({ acceptingOrders: true, legacy: false });
    expect(ecommercePublicServiceInternals.normalizeAvailability({ acceptingOrders: 'yes' }, portal, true))
      .toMatchObject({ acceptingOrders: false, code: 'SCHEDULE_NOT_CONFIGURED' });
    expect(ecommercePublicServiceInternals.normalizeAvailability(null, portal, false))
      .toMatchObject({ acceptingOrders: true, legacy: true });
  });

  it('sends normalized schedule and pause payloads with the current staff session', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    const service = createEcommerceAdminService({
      rpc,
      isConfigured: () => true,
      isOnline: () => true,
      getLicenseDetails: () => ({ licenseKey: auth.licenseKey }),
      buildAuthContext: vi.fn().mockResolvedValue(auth)
    });
    await service.saveOperatingSchedule({
      timezone: 'America/Cancun', businessHoursEnabled: true,
      weekly: [{ weekday: 1, isOpen: true, opensAt: '09:00', closesAt: '18:00' }],
      exceptions: []
    });
    await service.setOrderPause({ paused: true, reason: 'Alta demanda', resumeAt: '2026-07-15T04:00:00Z' });

    expect(rpc).toHaveBeenNthCalledWith(1, 'ecommerce_admin_save_operating_schedule', expect.objectContaining({
      p_staff_session_token: 'staff_test',
      p_timezone: 'America/Cancun',
      p_business_hours_enabled: true
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'ecommerce_admin_set_order_pause', expect.objectContaining({
      p_paused: true,
      p_reason: 'Alta demanda',
      p_resume_at: '2026-07-15T04:00:00Z'
    }));
  });

  it.each([
    ['ECOMMERCE_ORDERS_PAUSED', 'pausó'],
    ['ECOMMERCE_STORE_CLOSED', 'cerrado'],
    ['ECOMMERCE_SCHEDULE_NOT_CONFIGURED', 'no puede recibir']
  ])('maps %s without exposing SQL details', async (code, copy) => {
    const client = { rpc: vi.fn().mockResolvedValue({
      data: { success: false, error: { code, message: 'SQL secret detail' } }, error: null
    }) };
    const service = createEcommercePublicService(client, { cache: null });
    await expect(service.createPublicOrder('demo', {
      customer: {}, items: [], idempotencyKey: 'idem'
    })).rejects.toMatchObject({ code, message: expect.stringContaining(copy) });
  });
});
