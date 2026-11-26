import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ rpc: vi.fn(), licenseKey: '', granted: true, generation: 1 }));
vi.mock('../../supabase', () => ({ supabaseClient: { rpc: runtime.rpc } }));
vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: async ({ licenseKey }) => ({
    licenseKey, deviceFingerprint: 'snapshot-device', securityToken: 'snapshot-token', staffSessionToken: 'snapshot-session'
  })
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ licenseDetails: { license_key: runtime.licenseKey } }) } }));
vi.mock('../../sync/syncOutboxService', () => ({ syncOutboxService: { resumeUpdateRequired: vi.fn() } }));

import { readCloudCustomerById } from '../customerSnapshotReader';
import { customerCloudRepository } from '../customerCloudRepository';
import { customerCreditCloudRepository } from '../../customerCredit/customerCreditCloudRepository';
import { CLOUD_SNAPSHOT_CONTRACT_RPC, CLOUD_SYNC_CONTRACT_RPC } from '../../sync/cloudSyncProtocolV2';

const contract = {
  contract_version: 1, contract_kind: 'SNAPSHOT_READ_ONLY', tenant_id: 'tenant-a', server_status: 'SUPPORTED',
  capabilities: ['historical_credit_preservation_v1', 'customer_projection_safe_apply_v1', 'snapshot_keyset_reference_v1'],
  endpoints: ['pos_pull_product_catalog_snapshot_v2', 'pos_pull_customers_snapshot_v3', 'pos_pull_customer_credit_snapshot_v3', 'pos_pull_sales_snapshot_v2', 'pos_pull_cash_snapshot_v2'],
  endpoint_families: ['product_catalog', 'customer_directory', 'customer_credit', 'sales', 'cash_register']
};
const customer = (id, extra = {}) => ({
  id, name: 'Customer '+id, phone: '', credit_limit: 0, debt_cents: 0, debt: 0,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', server_version: 1, ...extra
});
const first = Array.from({ length: 500 }, (_, i) => customer('c'+String(i).padStart(4,'0')));
const cursor = { position_rank: 1, position_id: 'c0499', opaque: 'server-cursor' };
const page = (customers, extra = {}) => ({
  success: true, snapshot_contract: 'keyset_reference_v1', snapshot_contract_version: 1,
  snapshot_reference_change_seq: 42, safe_change_seq: 42, sync_deferred: false, limit: 500,
  customers, has_more: false, snapshot_complete: true, next_page_cursor: null, ...extra
});
const envelope = (endpoint, payload, tenant = 'tenant-a') => ({
  contract_version: 2, tenant_id: tenant, endpoint,
  family: endpoint === 'pos_pull_customers_snapshot_v3' ? 'customer_directory' : 'customer_credit',
  customer_projection_scope: 'CURRENT',
  customer_projections: (payload.customers || []).map(c => ({
    customer_id: c.id, status: 'KNOWN_ZERO', debt_cents: 0, source: 'cloud', projection_version: c.server_version
  })), payload
});
const firstPage = page(first, { has_more: true, snapshot_complete: false, next_page_cursor: cursor });
let seq = 0;
const args = () => {
  const generation = runtime.generation;
  return { licenseKey: runtime.licenseKey, actorHandle: { actorType: 'staff', assertCurrent() {
    if (!runtime.granted || generation !== runtime.generation) throw new Error('ACTOR_CONTEXT_STALE');
  } } };
};
const serve = (...pages) => {
  runtime.rpc.mockImplementation(async (endpoint) => {
    if (endpoint === CLOUD_SNAPSHOT_CONTRACT_RPC) return { data: contract };
    if (endpoint !== 'pos_pull_customers_snapshot_v3' && endpoint !== 'pos_pull_customer_credit_snapshot_v3') throw new Error('Unexpected RPC '+endpoint);
    const next = pages.shift();
    if (!next) throw new Error('Unexpected extra page');
    return { data: envelope(endpoint, next) };
  });
};
beforeEach(() => {
  runtime.rpc.mockReset(); runtime.licenseKey = 'customer-reader-'+(++seq); runtime.granted = true; runtime.generation = 1;
});

describe('V3 customer identity reads through real Cloud repository', () => {
  it('finds a tombstone after 500 preceding customers with an unchanged reference and opaque cursor', async () => {
    const target = customer('c0501', { deleted_at: '2026-11-01', server_version: 2 });
    serve(firstPage, page([customer('c0500'), target]));
    await expect(readCloudCustomerById({ ...args(), customerId: target.id })).resolves.toMatchObject({ id: target.id, deleted_at: target.deleted_at });
    expect(runtime.rpc.mock.calls.map(([rpc]) => rpc)).toEqual([CLOUD_SNAPSHOT_CONTRACT_RPC, 'pos_pull_customers_snapshot_v3', 'pos_pull_customers_snapshot_v3']);
    expect(runtime.rpc.mock.calls[1][1]).toMatchObject({ p_snapshot_reference_change_seq: null, p_page_cursor: null, p_limit: 500 });
    expect(runtime.rpc.mock.calls[2][1]).toMatchObject({ p_snapshot_reference_change_seq: 42, p_page_cursor: cursor });
    expect(runtime.rpc.mock.calls.some(([rpc]) => rpc === CLOUD_SYNC_CONTRACT_RPC)).toBe(false);
  });
  it('returns absence only after all 501 rows have been read', async () => {
    serve(firstPage, page([customer('c0500')]));
    await expect(readCloudCustomerById({ ...args(), customerId: 'missing' })).resolves.toBeNull();
    expect(runtime.rpc).toHaveBeenCalledTimes(3);
  });
  it.each([
    [page([], { sync_deferred: true }), 'CUSTOMER_SNAPSHOT_DEFERRED'],
    [page([], { snapshot_complete: false }), 'CUSTOMER_SNAPSHOT_INCOMPLETE'],
    [page([], { customers: undefined }), 'CUSTOMER_SNAPSHOT_INCOMPLETE'],
    [page([], { safe_change_seq: 43 }), 'CUSTOMER_SNAPSHOT_CHANGED'],
    [page([], { snapshot_reference_change_seq: 43, safe_change_seq: 43 }), 'CUSTOMER_SNAPSHOT_CHANGED'],
    [page([first[0]]), 'CUSTOMER_SNAPSHOT_INCOMPLETE']
  ])('rejects unsafe continuation %# rather than reporting absence', async (bad, code) => {
    serve(firstPage, bad);
    await expect(readCloudCustomerById({ ...args(), customerId: 'missing' })).rejects.toThrow(code);
  });
  it('rejects unsupported discovery without a legacy call', async () => {
    runtime.rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    await expect(customerCloudRepository.pullCustomerSnapshot(args())).rejects.toThrow('CLOUD_SNAPSHOT_CONTRACT_UNAVAILABLE');
    expect(runtime.rpc.mock.calls.map(([rpc]) => rpc)).toEqual([CLOUD_SNAPSHOT_CONTRACT_RPC]);
  });
  it('rejects a changed tenant and an unauthorized Staff actor', async () => {
    const original = args();
    runtime.licenseKey = 'other';
    await expect(readCloudCustomerById({ ...original, customerId: 'x' })).rejects.toThrow('CUSTOMER_SNAPSHOT_CONTEXT_CHANGED');
    runtime.granted = false;
    await expect(readCloudCustomerById({ ...args(), customerId: 'x' })).rejects.toThrow('ACTOR_CONTEXT_STALE');
    expect(runtime.rpc).not.toHaveBeenCalled();
  });
  it('rejects an actor change while a page is in flight', async () => {
    runtime.rpc.mockImplementation(async endpoint => {
      if (endpoint === CLOUD_SNAPSHOT_CONTRACT_RPC) return { data: contract };
      runtime.generation += 1;
      return { data: envelope(endpoint, page([customer('x')])) };
    });
    await expect(readCloudCustomerById({ ...args(), customerId: 'x' })).rejects.toThrow('ACTOR_CONTEXT_STALE');
  });
  it('negotiates direct scoped credit V3 reads without financial pilot discovery', async () => {
    serve(page([customer('x')], { customer_id: 'x', ledger_entries: [], ledger_reconciliation_complete: true }));
    await expect(customerCreditCloudRepository.pullCreditSnapshot({ ...args(), customerId: 'x', limit: 500 })).resolves.toMatchObject({ customer_id: 'x' });
    expect(runtime.rpc.mock.calls.map(([rpc]) => rpc)).toEqual([CLOUD_SNAPSHOT_CONTRACT_RPC, 'pos_pull_customer_credit_snapshot_v3']);
    expect(runtime.rpc.mock.calls[1][1]).toMatchObject({ p_customer_id: 'x', p_sync_contract: { contract_version: 2 } });
  });
});
