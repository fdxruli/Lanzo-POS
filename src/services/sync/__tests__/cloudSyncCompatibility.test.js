import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callCloudSyncRpc, CLOUD_SYNC_CONTRACT_RPC, CLOUD_SYNC_CAPABILITIES,
  CLOUD_FINANCIAL_RESULT_CAPABILITY } from '../cloudSyncProtocolV2';
import { customerCloudRepository } from '../../customers/customerCloudRepository';
import { customerCreditCloudRepository } from '../../customerCredit/customerCreditCloudRepository';

const runtime = vi.hoisted(() => ({ rpc: vi.fn(), handle: { assertCurrent: vi.fn(), actorKey: 'admin:a', generation: 1 } }));
vi.mock('../../supabase', () => ({ supabaseClient: { rpc: (...args) => runtime.rpc(...args) } }));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { capture: () => runtime.handle } }));
vi.mock('../posSyncClient', () => ({ buildPosSyncAuthContext: async ({ licenseKey }) => ({
  licenseKey, deviceFingerprint: 'device-a', securityToken: 'token-a', staffSessionToken: 'session-a'
}) }));
vi.mock('../syncOutboxService', () => ({ syncOutboxService: { resumeUpdateRequired: vi.fn().mockResolvedValue(0) } }));
vi.mock('../../cloud', () => ({
  CLOUD_REQUEST_COOLDOWN: {}, CLOUD_REQUEST_TAGS: {}, CLOUD_REQUEST_TTL: {},
  buildBaseRpcContextFromArgs: () => ({}), buildRpcRequestKey: () => 'fixture',
  cloudRequestManager: { request: ({ fn }) => fn() }, cloudRequestTags: { license: () => '', rpc: () => '' },
  invalidateCloudCacheAfterCustomerMutation: vi.fn(), invalidateCloudCacheAfterCreditMutation: vi.fn()
}));

const legacyContract = { contract_version: 2, tenant_id: 'tenant-a', server_status: 'UPDATE_REQUIRED',
  active_protocol: 1, reason: 'QA_PILOT_NOT_ENABLED' };
const supported = (endpoint, family, extra = {}) => ({ contract_version: 2, tenant_id: 'tenant-a',
  server_status: 'SUPPORTED', capabilities: [...CLOUD_SYNC_CAPABILITIES, CLOUD_FINANCIAL_RESULT_CAPABILITY],
  endpoints: [endpoint], endpoint_families: [family], ...extra });
const envelope = (endpoint, family, args, payload = {}) => ({ contract_version: 2, tenant_id: 'tenant-a',
  endpoint, family, payload, customer_projections: [], cursor: { offset: args.p_offset ?? 0, change_seq: 0, has_more: false },
  customer_projection_scope: family === 'financial_operations' ? 'OPERATION_RESULT' : 'CURRENT',
  operation: { idempotency_key: args.p_idempotency_key, request_hash: args.p_request_hash, batch_id: args.p_batch_id } });
const options = { licenseKey: 'license-a', customer: { id: 'c' }, customerId: 'c',
  idempotencyKey: 'original-k', batchId: 'batch-a', amount: 5 };
const routes = [
  [customerCloudRepository, 'upsertCustomer', 'pos_upsert_customer', 'customer_directory'],
  [customerCloudRepository, 'deleteCustomer', 'pos_delete_customer', 'customer_directory'],
  [customerCloudRepository, 'migrateLocalCustomers', 'pos_migrate_local_customers', 'customer_directory'],
  [customerCloudRepository, 'pullCustomerSnapshot', 'pos_pull_customers_snapshot', 'customer_directory'],
  [customerCloudRepository, 'pullCustomerChanges', 'pos_pull_customer_changes', 'customer_directory'],
  [customerCreditCloudRepository, 'getCustomerCreditSummary', 'pos_get_customer_credit_summary', 'customer_credit'],
  [customerCreditCloudRepository, 'pullCreditSnapshot', 'pos_pull_customer_credit_snapshot', 'customer_credit'],
  [customerCreditCloudRepository, 'pullCreditChanges', 'pos_pull_customer_credit_changes', 'customer_credit'],
  [customerCreditCloudRepository, 'recordCustomerPayment', 'pos_record_customer_payment', 'customer_credit']
];
const call = (rpc = runtime.rpc, extra = {}) => callCloudSyncRpc({ client: { rpc },
  rpcName: 'pos_execute_financial_operation_v2', authArgs: { p_license_key: 'license-a' },
  family: 'financial_operations', ...extra });

beforeEach(() => { runtime.rpc.mockReset(); runtime.handle.assertCurrent.mockReset(); });

describe.each([1, 2])('repository protocol %i', (protocol) => {
  it.each(routes)('routes %s.%s exclusively to its authorized RPC', async (repo, method, legacy, family) => {
    const endpoint = legacy + '_v2';
    runtime.rpc.mockImplementation(async (name, args) => ({ error: null,
      data: name === CLOUD_SYNC_CONTRACT_RPC ? (protocol === 1 ? legacyContract : supported(endpoint, family))
        : protocol === 1 ? JSON.stringify({ success: true }) : envelope(endpoint, family, args, { success: true }) }));
    await expect(repo[method](options)).resolves.toMatchObject({ success: true });
    expect(runtime.rpc.mock.calls.map(([name]) => name)).toEqual([CLOUD_SYNC_CONTRACT_RPC, protocol === 1 ? legacy : endpoint]);
    expect(runtime.rpc.mock.calls[1][1]).toMatchObject({ p_license_key: 'license-a',
      p_device_fingerprint: 'device-a', p_security_token: 'token-a', p_staff_session_token: 'session-a' });
    if (protocol === 1) expect(runtime.rpc.mock.calls[1][1]).not.toHaveProperty('p_sync_contract');
  });
});

it.each([
  ['network', null, new TypeError('Failed to fetch')],
  ['missing RPC', null, { code: 'PGRST202' }], ['permission', null, { code: '42501' }],
  ['empty', {}, null], ['null', null, null], ['malformed JSON', '{', null],
  ['missing reason', { ...legacyContract, reason: undefined }, null],
  ['missing tenant', { ...legacyContract, tenant_id: '' }, null],
  ['wrong protocol', { ...legacyContract, active_protocol: 2 }, null],
  ['ambiguous protocol type', { ...legacyContract, active_protocol: '1' }, null],
  ['contradictory mode', { ...legacyContract, mode: 'RECOVERY_ONLY' }, null],
  ['failed response', { ...legacyContract, success: false }, null],
  ['unsupported', { ...legacyContract, reason: 'UNSUPPORTED_CLIENT' }, null]
])('fails closed on %s discovery', async (_label, data, error) => {
  runtime.rpc.mockResolvedValue({ data, error });
  await expect(call()).rejects.toBeDefined();
  expect(runtime.rpc.mock.calls.map(([name]) => name)).toEqual([CLOUD_SYNC_CONTRACT_RPC]);
});

it.each([new TypeError('Failed to fetch'), { code: 'PGRST202' }, { code: '42501' },
  { code: 'P0001', message: 'CLOUD_CLIENT_UPDATE_REQUIRED' }])('never falls back after v2 admission and an endpoint error', async (error) => {
  runtime.rpc.mockResolvedValueOnce({ data: supported('pos_execute_financial_operation_v2', 'financial_operations') })
    .mockResolvedValueOnce({ error });
  await expect(call()).rejects.toBeDefined();
  expect(runtime.rpc.mock.calls.map(([name]) => name)).toEqual([CLOUD_SYNC_CONTRACT_RPC, 'pos_execute_financial_operation_v2']);
});

it('keeps RECOVERY_ONLY restricted to the v2 receipt even if endpoints over-advertise', async () => {
  const discovery = supported('pos_get_financial_operation_receipt_v2', 'financial_operations',
    { mode: 'RECOVERY_ONLY', active_protocol: 1, endpoints: ['pos_get_financial_operation_receipt_v2', 'pos_execute_financial_operation_v2'] });
  runtime.rpc.mockResolvedValue({ data: discovery });
  await expect(call()).rejects.toMatchObject({ code: 'CLOUD_CLIENT_UPDATE_REQUIRED' });
  expect(runtime.rpc).toHaveBeenCalledTimes(1);
  runtime.rpc.mockReset().mockResolvedValueOnce({ data: discovery }).mockResolvedValueOnce({ data:
    envelope('pos_get_financial_operation_receipt_v2', 'financial_operations', { p_idempotency_key: 'k', p_request_hash: 'h' },
      { status: 'COMPLETED', result: { original: true } }) });
  await expect(call(runtime.rpc, { rpcName: 'pos_get_financial_operation_receipt_v2',
    params: { p_idempotency_key: 'k', p_request_hash: 'h' }, expectedIdempotencyKey: 'k', expectedRequestHash: 'h' }))
    .resolves.toMatchObject({ status: 'COMPLETED', result: { original: true } });
  expect(runtime.rpc.mock.calls[1][0]).toBe('pos_get_financial_operation_receipt_v2');
});

it('rediscovers for each license and captures auth throughout an in-flight negotiation', async () => {
  const authArgs = { p_license_key: 'license-a' };
  runtime.rpc.mockImplementation(async (name, args) => {
    if (name === CLOUD_SYNC_CONTRACT_RPC) {
      authArgs.p_license_key = 'license-b';
      return { data: args.p_license_key === 'license-a' ? legacyContract : null };
    }
    return { data: { success: true } };
  });
  await call(runtime.rpc, { authArgs });
  expect(runtime.rpc.mock.calls[1]).toEqual(['pos_execute_financial_operation_v1', { p_license_key: 'license-a' }]);
  await expect(call(runtime.rpc, { authArgs })).rejects.toBeDefined();
  expect(runtime.rpc.mock.calls.map(([name]) => name)).toEqual([
    CLOUD_SYNC_CONTRACT_RPC, 'pos_execute_financial_operation_v1', CLOUD_SYNC_CONTRACT_RPC]);
});

it('rejects an actor/tenant change while discovery is in flight before dispatch', async () => {
  runtime.rpc.mockImplementation(async () => {
    runtime.handle.assertCurrent.mockImplementation(() => { throw new Error('ACTOR_CONTEXT_STALE'); });
    return { data: legacyContract };
  });
  await expect(call(runtime.rpc, { actorHandle: runtime.handle })).rejects.toThrow('ACTOR_CONTEXT_STALE');
  expect(runtime.rpc).toHaveBeenCalledTimes(1);
});

it('does not reuse a v2 admission for another license or a later failed discovery', async () => {
  runtime.rpc.mockImplementation(async (name, args) => {
    if (name === CLOUD_SYNC_CONTRACT_RPC) return { data: args.p_license_key === 'license-a'
      ? supported('pos_execute_financial_operation_v2', 'financial_operations') : { ...legacyContract, tenant_id: 'tenant-b' } };
    return { data: name.endsWith('_v2') ? envelope(name, 'financial_operations', args, { success: true }) : { success: true } };
  });
  await call();
  await call(runtime.rpc, { authArgs: { p_license_key: 'license-b' } });
  runtime.rpc.mockResolvedValueOnce({ error: new TypeError('Failed to fetch') });
  await expect(call()).rejects.toThrow('Failed to fetch');
  expect(runtime.rpc.mock.calls.map(([name]) => name)).toEqual([CLOUD_SYNC_CONTRACT_RPC,
    'pos_execute_financial_operation_v2', CLOUD_SYNC_CONTRACT_RPC, 'pos_execute_financial_operation_v1', CLOUD_SYNC_CONTRACT_RPC]);
  expect(runtime.rpc.mock.calls[3][1].p_license_key).toBe('license-b');
});
