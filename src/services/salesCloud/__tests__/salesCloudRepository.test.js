import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeNewFinancialIntent: vi.fn(),
  invalidateCloudCacheAfterSaleMutation: vi.fn(),
  rpc: vi.fn(),
  buildPosSyncAuthContext: vi.fn()
}));

vi.mock('../../financial/financialIntentLedger', () => ({
  executeNewFinancialIntent: mocks.executeNewFinancialIntent
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: mocks.rpc }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: mocks.buildPosSyncAuthContext
}));

vi.mock('../../sync/syncConstants', () => ({
  isCloudSalesBaseSyncEnabled: vi.fn(() => true),
  isCloudSalesCancellationEnabled: vi.fn(() => true),
  isCloudSalesCashierEnabled: vi.fn(() => true),
  isCloudSalesCreditEnabled: vi.fn(() => true),
  isCloudSalesInventoryEnabled: vi.fn(() => true),
  isCloudLayawaysEnabled: vi.fn(() => true),
  SYNC_LIMITS: { DEFAULT_PULL_LIMIT: 100, MAX_PULL_LIMIT: 500 }
}));

vi.mock('../../cloud', () => ({
  CLOUD_REQUEST_COOLDOWN: { SNAPSHOT: 1, VERY_SHORT: 1 },
  CLOUD_REQUEST_TAGS: { SALES: 'sales' },
  CLOUD_REQUEST_TTL: { MEDIUM: 1, VERY_SHORT: 1 },
  buildBaseRpcContextFromArgs: vi.fn(() => ({})),
  buildRpcRequestKey: vi.fn(() => 'request-key'),
  cloudRequestManager: { request: vi.fn(({ fn }) => fn()) },
  cloudRequestTags: { license: vi.fn(() => 'license'), rpc: vi.fn(() => 'rpc') },
  invalidateCloudCacheAfterSaleMutation: mocks.invalidateCloudCacheAfterSaleMutation
}));

import { salesCloudRepository } from '../salesCloudRepository';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeNewFinancialIntent.mockResolvedValue({
    intentId: 'intent-1',
    response: { success: true, sale: { id: 'cloud-sale-1' }, layaway: { id: 'layaway-1' } },
    projection: { outcome: 'projection_applied', result: { localSale: { id: 'sale-1' } } }
  });
  mocks.buildPosSyncAuthContext.mockResolvedValue({
    licenseKey: 'license-1',
    deviceFingerprint: 'device-1',
    securityToken: 'security-1',
    staffSessionToken: 'staff-1'
  });
  mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
});

describe('salesCloudRepository projection callback transport', () => {
  it.each([
    ['createCloudCashierSale', 'sale.cashier'],
    ['createCloudCashierInventorySale', 'sale.cashier_inventory'],
    ['createCloudCreditSale', 'sale.credit']
  ])('passes the lease-owned projection callback for %s', async (method, operationType) => {
    const project = vi.fn();
    const result = await salesCloudRepository[method]({
      licenseKey: 'license-1',
      sale: { id: 'sale-1' },
      items: [],
      payments: [],
      cashSessionId: 'session-1',
      customerId: 'customer-1',
      idempotencyKey: 'sale-key',
      actorHandle: { actorKey: 'actor-1' },
      project
    });

    expect(mocks.executeNewFinancialIntent).toHaveBeenCalledWith(expect.objectContaining({
      operationType,
      project
    }));
    expect(result).toMatchObject({
      financialIntentId: 'intent-1',
      projection: { outcome: 'projection_applied' },
      success: true
    });
  });

  it.each([
    ['createCloudLayaway', 'layaway.create'],
    ['addCloudLayawayPayment', 'layaway.payment'],
    ['cancelCloudLayaway', 'layaway.cancel']
  ])('sends %s through the shared financial intent ledger', async (method, operationType) => {
    const project = vi.fn();
    const args = method === 'createCloudLayaway'
      ? {
        licenseKey: 'license-1',
        layaway: { id: 'layaway-1', total_amount: '100', items: [] },
        initialPayment: { id: 'payment-1', amount: 25, method: 'cash' },
        cashSessionId: 'session-1',
        idempotencyKey: 'layaway-key',
        actorHandle: { actorKey: 'actor-1' },
        project
      }
      : method === 'addCloudLayawayPayment'
        ? {
          licenseKey: 'license-1',
          layawayId: 'layaway-1',
          payment: { id: 'payment-2', amount: 25, method: 'cash' },
          cashSessionId: 'session-1',
          idempotencyKey: 'layaway-payment-key',
          actorHandle: { actorKey: 'actor-1' },
          project
        }
        : {
          licenseKey: 'license-1',
          layawayId: 'layaway-1',
          reason: 'Cliente',
          retainMoney: false,
          refundId: 'refund-1',
          cashSessionId: 'session-1',
          idempotencyKey: 'layaway-cancel-key',
          actorHandle: { actorKey: 'actor-1' },
          project
        };

    const result = await salesCloudRepository[method](args);

    expect(mocks.executeNewFinancialIntent).toHaveBeenCalledWith(expect.objectContaining({
      operationType,
      licenseKey: 'license-1',
      cashSessionId: 'session-1',
      idempotencyKey: args.idempotencyKey,
      actorHandle: args.actorHandle,
      project,
      request: expect.not.objectContaining({ cash_station_id: expect.anything() })
    }));
    expect(result).toMatchObject({
      financialIntentId: 'intent-1',
      success: true,
      projection: { outcome: 'projection_applied' }
    });
  });

  it('reads a layaway through the authenticated cache-managed RPC', async () => {
    const result = await salesCloudRepository.getLayaway({
      licenseKey: 'license-1',
      layawayId: 'layaway-1',
      force: true
    });

    expect(mocks.rpc).toHaveBeenCalledWith('pos_get_layaway', expect.objectContaining({
      p_license_key: 'license-1',
      p_device_fingerprint: 'device-1',
      p_security_token: 'security-1',
      p_staff_session_token: 'staff-1',
      p_layaway_id: 'layaway-1'
    }));
    expect(result).toEqual({ success: true });
  });
});
