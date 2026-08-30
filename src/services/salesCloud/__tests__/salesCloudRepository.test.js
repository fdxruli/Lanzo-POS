import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeNewFinancialIntent: vi.fn(),
  invalidateCloudCacheAfterSaleMutation: vi.fn()
}));

vi.mock('../../financial/financialIntentLedger', () => ({
  executeNewFinancialIntent: mocks.executeNewFinancialIntent
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: vi.fn() }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: vi.fn()
}));

vi.mock('../../sync/syncConstants', () => ({
  isCloudSalesBaseSyncEnabled: vi.fn(() => true),
  isCloudSalesCancellationEnabled: vi.fn(() => true),
  isCloudSalesCashierEnabled: vi.fn(() => true),
  isCloudSalesCreditEnabled: vi.fn(() => true),
  isCloudSalesInventoryEnabled: vi.fn(() => true),
  SYNC_LIMITS: { DEFAULT_PULL_LIMIT: 100, MAX_PULL_LIMIT: 500 }
}));

vi.mock('../../cloud', () => ({
  CLOUD_REQUEST_COOLDOWN: { SNAPSHOT: 1, VERY_SHORT: 1 },
  CLOUD_REQUEST_TAGS: { SALES: 'sales' },
  CLOUD_REQUEST_TTL: { MEDIUM: 1, VERY_SHORT: 1 },
  buildBaseRpcContextFromArgs: vi.fn(() => ({})),
  buildRpcRequestKey: vi.fn(() => 'request-key'),
  cloudRequestManager: { request: vi.fn() },
  cloudRequestTags: { license: vi.fn(() => 'license'), rpc: vi.fn(() => 'rpc') },
  invalidateCloudCacheAfterSaleMutation: mocks.invalidateCloudCacheAfterSaleMutation
}));

import { salesCloudRepository } from '../salesCloudRepository';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeNewFinancialIntent.mockResolvedValue({
    intentId: 'intent-1',
    response: { success: true, sale: { id: 'cloud-sale-1' } },
    projection: { outcome: 'projection_applied', result: { localSale: { id: 'sale-1' } } }
  });
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
});
