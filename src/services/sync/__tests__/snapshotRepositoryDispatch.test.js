import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn()
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: (...args) => mocks.rpc(...args) }
}));

vi.mock('../posSyncClient', () => ({
  buildPosSyncAuthContext: vi.fn(async ({ licenseKey }) => ({
    licenseKey,
    deviceFingerprint: 'snapshot-device',
    securityToken: 'snapshot-security-token',
    staffSessionToken: 'snapshot-session-token'
  }))
}));

import { cashCloudRepository } from '../../cash/cashCloudRepository';
import { customerCreditCloudRepository } from '../../customerCredit/customerCreditCloudRepository';
import { customerCloudRepository } from '../../customers/customerCloudRepository';
import { productCloudRepository } from '../../products/productCloudRepository';
import { salesCloudRepository } from '../../salesCloud/salesCloudRepository';
import { CLOUD_SNAPSHOT_CONTRACT_RPC } from '../cloudSyncProtocolV2';

const LICENSE_KEY = 'snapshot-repository-dispatch-test';
const actorHandle = {
  actorKey: 'admin:snapshot-test',
  actorType: 'admin',
  sessionId: 'snapshot-test-session',
  assertCurrent: vi.fn()
};
const pageCursor = { position_rank: 12, position_id: 'stable-id-12' };

const endpoints = {
  pos_pull_product_catalog_snapshot_v2: ['product_catalog', {
    categories: [], products: [], batches: []
  }],
  pos_pull_customers_snapshot_v3: ['customer_directory', { customers: [] }],
  pos_pull_customer_credit_snapshot_v3: ['customer_credit', {
    customer_id: null, customers: [], ledger_entries: [], cash_movements: [], cash_sessions: [],
    ledger_reconciliation_complete: true
  }],
  pos_pull_sales_snapshot_v2: ['sales', {
    sales: [], items: [], payments: [], scope: { date_from: null, date_to: null, visibility: 'authorized' }
  }],
  pos_pull_cash_snapshot_v2: ['cash_register', { cash_sessions: [], movements: [], scope: 'all' }]
};

const capabilityResponse = {
  contract_version: 1,
  contract_kind: 'SNAPSHOT_READ_ONLY',
  tenant_id: 'snapshot-repository-tenant',
  server_status: 'SUPPORTED',
  capabilities: ['historical_credit_preservation_v1', 'customer_projection_safe_apply_v1', 'snapshot_keyset_reference_v1'],
  endpoint_families: ['product_catalog', 'customer_directory', 'customer_credit', 'sales', 'cash_register'],
  endpoints: Object.keys(endpoints)
};

const snapshotPage = (payload) => ({
  success: true,
  snapshot_contract: 'keyset_reference_v1',
  snapshot_contract_version: 1,
  snapshot_reference_change_seq: 0,
  safe_change_seq: 0,
  has_more: false,
  snapshot_complete: true,
  next_page_cursor: null,
  ...payload
});

const v2SnapshotEnvelope = (endpoint, family, payload) => ({
  contract_version: 2,
  tenant_id: capabilityResponse.tenant_id,
  endpoint,
  family,
  customer_projection_scope: 'CURRENT',
  customer_projections: [],
  payload: snapshotPage(payload)
});

describe('versioned snapshot repository dispatch', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(async (endpoint) => {
      if (endpoint === CLOUD_SNAPSHOT_CONTRACT_RPC) return { data: capabilityResponse, error: null };
      const [family, payload] = endpoints[endpoint] || [];
      if (!family) return { data: null, error: new Error(`Unexpected RPC ${endpoint}`) };
      return {
        data: ['customer_directory', 'customer_credit'].includes(family)
          ? v2SnapshotEnvelope(endpoint, family, payload)
          : snapshotPage(payload),
        error: null
      };
    });
    actorHandle.assertCurrent.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it('negotiates the V2 contract for direct product consumers without legacy dispatch', async () => {
    await productCloudRepository.pullCatalogSnapshot({ licenseKey: LICENSE_KEY + '-products-direct', actorHandle });
    expect(mocks.rpc.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      CLOUD_SNAPSHOT_CONTRACT_RPC, 'pos_pull_product_catalog_snapshot_v2'
    ]);
  });

  it('rejects an unsupported product contract without calling a legacy RPC', async () => {
    await expect(productCloudRepository.pullCatalogSnapshot({
      licenseKey: LICENSE_KEY + '-products-unsupported', actorHandle, snapshotProtocol: { supported: false }
    })).rejects.toThrow('CLOUD_SNAPSHOT_CONTRACT_UNAVAILABLE');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('negotiates the V2 contract for direct cash consumers', async () => {
    await cashCloudRepository.pullCashSnapshot({ licenseKey: LICENSE_KEY + '-direct', scope: 'all', actorHandle });
    expect(mocks.rpc.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      CLOUD_SNAPSHOT_CONTRACT_RPC, 'pos_pull_cash_snapshot_v2'
    ]);
  });

  it('fails closed when the snapshot contract is unavailable', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
    await expect(cashCloudRepository.pullCashSnapshot({
      licenseKey: LICENSE_KEY + '-unsupported', actorHandle
    })).rejects.toThrow('CLOUD_SNAPSHOT_CONTRACT_UNAVAILABLE');
    expect(mocks.rpc.mock.calls.map(([endpoint]) => endpoint)).toEqual([CLOUD_SNAPSHOT_CONTRACT_RPC]);
  });

  it('negotiates the sales read contract without legacy and rejects unsupported discovery', async () => {
    await salesCloudRepository.pullSalesSnapshot({ licenseKey: LICENSE_KEY + '-sales-direct', actorHandle });
    expect(mocks.rpc.mock.calls.map(([endpoint]) => endpoint)).toEqual([CLOUD_SNAPSHOT_CONTRACT_RPC, 'pos_pull_sales_snapshot_v2']);
    mocks.rpc.mockClear();
    await expect(salesCloudRepository.pullSalesSnapshot({ licenseKey: LICENSE_KEY + '-sales-unsupported', actorHandle, snapshotProtocol: { supported: false } })).rejects.toThrow('CLOUD_SNAPSHOT_CONTRACT_UNAVAILABLE');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('routes all five modules through advertised endpoints and forwards a zero reference and opaque cursor', async () => {
    const protocol = await productCloudRepository.negotiateSnapshotProtocol({
      licenseKey: LICENSE_KEY, actorHandle
    });
    expect(protocol.supported).toBe(true);

    const responses = await Promise.all([
      productCloudRepository.pullCatalogSnapshot({
        licenseKey: LICENSE_KEY, limit: 13, snapshotProtocol: protocol,
        snapshotReferenceChangeSeq: 0, pageCursor, actorHandle
      }),
      customerCloudRepository.pullCustomerSnapshot({
        licenseKey: LICENSE_KEY, limit: 13, includeDeleted: true, snapshotProtocol: protocol,
        snapshotReferenceChangeSeq: 0, pageCursor, actorHandle
      }),
      customerCreditCloudRepository.pullCreditSnapshot({
        licenseKey: LICENSE_KEY, limit: 13, customerId: null, includeDeleted: true,
        snapshotProtocol: protocol, snapshotReferenceChangeSeq: 0, pageCursor, actorHandle
      }),
      salesCloudRepository.pullSalesSnapshot({
        licenseKey: LICENSE_KEY, limit: 13, dateFrom: null, dateTo: null,
        snapshotProtocol: protocol, snapshotReferenceChangeSeq: 0, pageCursor, actorHandle
      }),
      cashCloudRepository.pullCashSnapshot({
        licenseKey: LICENSE_KEY, limit: 13, scope: 'all', snapshotProtocol: protocol,
        snapshotReferenceChangeSeq: 0, pageCursor, actorHandle
      })
    ]);

    const pageCalls = mocks.rpc.mock.calls.filter(([endpoint]) => endpoint !== CLOUD_SNAPSHOT_CONTRACT_RPC);
    expect(mocks.rpc.mock.calls[0][0]).toBe(CLOUD_SNAPSHOT_CONTRACT_RPC);
    expect(pageCalls.map(([endpoint]) => endpoint).sort()).toEqual(Object.keys(endpoints).sort());
    for (const [, args] of pageCalls) {
      expect(args.p_snapshot_reference_change_seq).toBe(0);
      expect(args.p_page_cursor).toEqual(pageCursor);
      expect(args.p_license_key).toBe(LICENSE_KEY);
    }
    expect(pageCalls.find(([endpoint]) => endpoint === 'pos_pull_customers_snapshot_v3')[1].p_sync_contract)
      .toMatchObject({ contract_version: 2 });
    expect(pageCalls.find(([endpoint]) => endpoint === 'pos_pull_customer_credit_snapshot_v3')[1].p_customer_id)
      .toBeNull();
    expect(pageCalls.find(([endpoint]) => endpoint === 'pos_pull_sales_snapshot_v2')[1])
      .toMatchObject({ p_date_from: null, p_date_to: null });
    expect(pageCalls.find(([endpoint]) => endpoint === 'pos_pull_cash_snapshot_v2')[1].p_scope).toBe('all');
    expect(responses.map((response) => response.snapshot_reference_change_seq)).toEqual([0, 0, 0, 0, 0]);
    expect(responses[1].cloudSyncEnvelope.endpoint).toBe('pos_pull_customers_snapshot_v3');
    expect(responses[2].cloudSyncEnvelope.endpoint).toBe('pos_pull_customer_credit_snapshot_v3');
  });
});
