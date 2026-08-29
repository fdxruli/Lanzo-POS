import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  executeFinancialIntent: vi.fn(),
  invalidateCashCache: vi.fn()
}));

vi.mock('../financial/financialIntentLedger', () => ({
  executeNewFinancialIntent: (...args) => fixtures.executeFinancialIntent(...args)
}));
vi.mock('../supabase', () => ({ supabaseClient: {} }));
vi.mock('../cloud', () => ({
  CLOUD_REQUEST_COOLDOWN: { SHORT: 0, SNAPSHOT: 0 },
  CLOUD_REQUEST_TAGS: { CASH: 'cash' },
  CLOUD_REQUEST_TTL: { SHORT: 0, MEDIUM: 0 },
  buildBaseRpcContextFromArgs: vi.fn(),
  buildRpcRequestKey: vi.fn(),
  cloudRequestManager: { request: vi.fn() },
  cloudRequestTags: { license: vi.fn(), rpc: vi.fn() },
  invalidateCloudCacheAfterCashMutation: (...args) => fixtures.invalidateCashCache(...args)
}));
vi.mock('../sync/posSyncClient', () => ({ buildPosSyncAuthContext: vi.fn() }));
vi.mock('../sync/syncConstants', () => ({ SYNC_LIMITS: { DEFAULT_PULL_LIMIT: 100, MAX_PULL_LIMIT: 500 } }));

import { cashCloudRepository } from './cashCloudRepository';

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.executeFinancialIntent.mockResolvedValue({
    intentId: 'intent-close',
    response: { success: true }
  });
});

describe('cashCloudRepository close financial operation types', () => {
  it('dispatches a normal owner close as cash.close', async () => {
    const actorHandle = { actorKey: 'admin:owner' };
    await cashCloudRepository.closeCashSession({
      licenseKey: 'license-test',
      cashSessionId: 'cash-owner',
      closing: { counted_amount: '75', next_shift_fund: '25' },
      expectedVersion: 4,
      idempotencyKey: null,
      actorHandle
    });

    expect(fixtures.executeFinancialIntent).toHaveBeenCalledWith({
      operationType: 'cash.close',
      request: {
        counted_amount: '75',
        next_shift_fund: '25',
        cash_session_id: 'cash-owner',
        expected_version: 4
      },
      licenseKey: 'license-test',
      idempotencyKey: null,
      cashSessionId: 'cash-owner',
      actorHandle
    });
  });

  it('dispatches explicit foreign reconciliation as cash.admin_close', async () => {
    const actorHandle = { actorKey: 'admin:reviewer' };
    await cashCloudRepository.adminCloseCashSession({
      licenseKey: 'license-test',
      cashSessionId: 'cash-foreign-staff',
      closingMode: 'admin_audited',
      countedAmount: '75',
      nextShiftFund: '25',
      reasonCode: 'abandoned_session',
      comments: 'Cierre revisado por administración.',
      expectedVersion: 7,
      idempotencyKey: 'cash-admin-close-key',
      actorHandle
    });

    expect(fixtures.executeFinancialIntent).toHaveBeenCalledWith({
      operationType: 'cash.admin_close',
      request: {
        cash_session_id: 'cash-foreign-staff',
        closing_mode: 'admin_audited',
        counted_amount: '75',
        next_shift_fund: '25',
        reason_code: 'abandoned_session',
        comments: 'Cierre revisado por administración.',
        expected_version: 7
      },
      licenseKey: 'license-test',
      idempotencyKey: 'cash-admin-close-key',
      cashSessionId: 'cash-foreign-staff',
      actorHandle
    });
  });

  it('propagates the canonical station resolved before the financial dispatch', async () => {
    fixtures.executeFinancialIntent.mockResolvedValue({
      intentId: 'intent-open',
      intent: { cashStationId: 'cash_station_device_A' },
      response: {
        success: true,
        cash_session: { id: 'cash-a', status: 'open' }
      }
    });

    const result = await cashCloudRepository.openCashSession({
      licenseKey: 'license-test',
      opening: { opening_amount: '100' },
      idempotencyKey: null,
      actorHandle: { actorKey: 'admin:owner' }
    });

    expect(result).toMatchObject({
      financialIntentId: 'intent-open',
      resolvedCashStationId: 'cash_station_device_A',
      cash_session: { id: 'cash-a' }
    });
  });
});
