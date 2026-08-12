import { describe, expect, it } from 'vitest';
import { LOCAL_TENANT_STATUS } from '../../services/tenant/localTenantPolicy';
import { isUnsafeTenantStatePatch } from '../tenantSafeState';

const guardState = (status) => ({ enabled: true, status });

describe('tenant-safe Zustand state boundary', () => {
  it('rejects a stale profile response that tries to reopen the app while locked', () => {
    expect(isUnsafeTenantStatePatch(
      { appStatus: 'ready', companyProfile: { id: 'company-a' } },
      guardState(LOCAL_TENANT_STATUS.LOCKED),
      { appStatus: 'unauthenticated' }
    )).toBe(true);
  });

  it('keeps mismatch terminal until the guard is explicitly locked by the exit action', () => {
    expect(isUnsafeTenantStatePatch(
      { appStatus: 'staff_login_required' },
      guardState(LOCAL_TENANT_STATUS.MISMATCH),
      { appStatus: 'local_tenant_mismatch' }
    )).toBe(true);

    expect(isUnsafeTenantStatePatch(
      { appStatus: 'unauthenticated' },
      guardState(LOCAL_TENANT_STATUS.LOCKED),
      { appStatus: 'local_tenant_mismatch' }
    )).toBe(false);
  });

  it('allows tenant-visible state only while access is granted', () => {
    expect(isUnsafeTenantStatePatch(
      { appStatus: 'ready', companyProfile: { id: 'company-a' } },
      guardState(LOCAL_TENANT_STATUS.GRANTED),
      { appStatus: 'loading' }
    )).toBe(false);
  });

  it('keeps actor-login screens closed to late tenant state while cleanup still has access', () => {
    expect(isUnsafeTenantStatePatch(
      {
        appStatus: 'ready',
        companyProfile: { id: 'company-a' },
        driveAccessToken: 'synthetic-token',
        cashOpeningPolicy: 'automatic'
      },
      guardState(LOCAL_TENANT_STATUS.GRANTED),
      { appStatus: 'admin_login_required', currentAdminUser: null }
    )).toBe(true);

    expect(isUnsafeTenantStatePatch(
      { appStatus: 'ready', companyProfile: { id: 'company-a' } },
      guardState(LOCAL_TENANT_STATUS.GRANTED),
      { appStatus: 'admin_login_required', currentAdminUser: { id: 'admin-a' } }
    )).toBe(false);
  });

  it('rejects late ready/profile state throughout full logout cleanup', () => {
    expect(isUnsafeTenantStatePatch(
      { appStatus: 'ready', companyProfile: { id: 'company-a' } },
      guardState(LOCAL_TENANT_STATUS.GRANTED),
      { appStatus: 'loading', _isLoggingOut: true }
    )).toBe(true);
  });

  it('keeps the actor logout boundary durable even if a stale callback changes appStatus', () => {
    expect(isUnsafeTenantStatePatch(
      { appStatus: 'loading' },
      guardState(LOCAL_TENANT_STATUS.GRANTED),
      { appStatus: 'admin_login_required', currentAdminUser: null, _isLoggingOut: true }
    )).toBe(false);

    expect(isUnsafeTenantStatePatch(
      { appStatus: 'ready', currentAdminUser: { id: 'stale-admin' } },
      guardState(LOCAL_TENANT_STATUS.GRANTED),
      { appStatus: 'loading', currentAdminUser: null, _isLoggingOut: true }
    )).toBe(true);
  });

  it('rejects late ecommerce list, detail and aggregate state while locked', () => {
    expect(isUnsafeTenantStatePatch(
      {
        ecommerceOrders: [{ id: 'order-a' }],
        ecommerceOrderCounts: { total: 1 },
        ecommerceOrdersLicenseIdentity: 'license-a'
      },
      guardState(LOCAL_TENANT_STATUS.LOCKED),
      { appStatus: 'unauthenticated' }
    )).toBe(true);

    expect(isUnsafeTenantStatePatch(
      { selectedEcommerceOrder: { id: 'order-a' } },
      guardState(LOCAL_TENANT_STATUS.MISMATCH),
      { appStatus: 'local_tenant_mismatch' }
    )).toBe(true);

    expect(isUnsafeTenantStatePatch(
      { ecommerceOrders: [], selectedEcommerceOrder: null, ecommerceOrderCounts: {} },
      guardState(LOCAL_TENANT_STATUS.LOCKED),
      { appStatus: 'unauthenticated' }
    )).toBe(false);
  });
});
