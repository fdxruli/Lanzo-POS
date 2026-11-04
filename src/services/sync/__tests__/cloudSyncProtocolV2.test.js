import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncOutboxService } from '../syncOutboxService';
import {
  callCloudSyncV2Rpc,
  CLOUD_SYNC_CONTRACT_RPC,
  CLOUD_SYNC_CONTRACT_VERSION,
  CLOUD_FINANCIAL_RESULT_CAPABILITY,
  validateCloudSyncV2Envelope
} from '../cloudSyncProtocolV2';

vi.mock('../syncOutboxService', () => ({
  syncOutboxService: { resumeUpdateRequired: vi.fn().mockResolvedValue(0) }
}));

const contract = {
  contract_version: CLOUD_SYNC_CONTRACT_VERSION,
  tenant_id: 'tenant-1',
  server_status: 'SUPPORTED',
  endpoint_families: ['customer_credit'],
  endpoints: ['pos_pull_customer_credit_changes_v2'],
  capabilities: ['historical_credit_preservation_v1', 'customer_projection_safe_apply_v1']
};

const sampleCustomer = (overrides = {}) => ({
  id: 'customer-1',
  name: 'Synthetic customer',
  credit_limit: '0',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  server_version: 1,
  debt_cents: 4250,
  ...overrides
});

describe('immutable financial operation results', () => {
  afterEach(() => vi.unstubAllGlobals());
  const context = {
    expectedTenantId: 'tenant-1', expectedEndpoint: 'pos_get_financial_operation_receipt_v2',
    expectedFamily: 'financial_operations', expectedIdempotencyKey: 'original-key', expectedRequestHash: 'original-hash'
  };
  const receipt = (customer = sampleCustomer({ debt: 10, debt_cents: 1000 })) => ({
    contract_version: 2, tenant_id: 'tenant-1', endpoint: context.expectedEndpoint,
    family: 'financial_operations', customer_projection_scope: 'OPERATION_RESULT',
    customer_projections: [], payload: { status: 'COMPLETED', result: { success: true, customer } },
    operation: { idempotency_key: 'original-key', request_hash: 'original-hash', status: 'COMPLETED' }
  });

  it('accepts the original $10 receipt independently of a later $5 current projection', () => {
    const raw = receipt();
    const unchanged = JSON.parse(JSON.stringify(raw));
    const result = validateCloudSyncV2Envelope(raw, context);
    expect(result.result.customer).toMatchObject({ debt: 10, debt_cents: 1000,
      financial_projection: { status: 'NOT_INCLUDED', debt_cents: null, scope: 'OPERATION_RESULT' } });
    expect(raw).toEqual(unchanged);
    const current = validateCloudSyncV2Envelope(envelope({
      payload: { customers: [sampleCustomer({ debt: 5, debt_cents: 500, server_version: 2 })] },
      customer_projections: [{ customer_id: 'customer-1', status: 'KNOWN_POSITIVE', debt_cents: 500,
        source: 'pos_customers.debt_cents', projection_version: 2 }]
    }), { expectedTenantId: 'tenant-1', expectedEndpoint: 'pos_pull_customer_credit_changes_v2', expectedFamily: 'customer_credit' });
    expect(current.customers[0].debt).toBe(5);
    expect(validateCloudSyncV2Envelope(receipt(), context).result.customer.debt).toBe(10);
  });

  it('keeps missing debt unknown and tags every historical snapshot of the same customer', () => {
    const raw = receipt(sampleCustomer({ debt_cents: undefined }));
    raw.payload.result.children = [{ customer: sampleCustomer({ debt: 15, debt_cents: 1500, server_version: 2 }) }];
    const result = validateCloudSyncV2Envelope(raw, context);
    expect(result.result.customer).not.toHaveProperty('debt');
    expect(result.result.customer).not.toHaveProperty('debt_cents');
    expect(result.result.customer.financial_projection.debt_cents).toBeNull();
    expect(result.result.children[0].customer.financial_projection.scope).toBe('OPERATION_RESULT');
    expect(result.result.children[0].customer.debt).toBe(15);
  });

  it('retains financial validation and rejects mixed projection meanings', () => {
    expect(() => validateCloudSyncV2Envelope(receipt(sampleCustomer({ debt: 10, debt_cents: 500 })), context))
      .toThrow('CLOUD_SYNC_PROTOCOL_PROJECTION_VALUE_MISMATCH');
    expect(() => validateCloudSyncV2Envelope(receipt(sampleCustomer({ debt_cents: -1 })), context))
      .toThrow('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
    const raw = receipt();
    raw.customer_projections = envelope().customer_projections;
    expect(() => validateCloudSyncV2Envelope(raw, context)).toThrow('CLOUD_SYNC_PROTOCOL_OPERATION_RESULT_PROJECTION');
    expect(() => validateCloudSyncV2Envelope({ ...receipt(), customer_projection_scope: 'CURRENT' }, context))
      .toThrow('CLOUD_CLIENT_UPDATE_REQUIRED');
  });

  it('accepts a real signed payment delta while keeping current balances nonnegative', () => {
    const raw = envelope({ payload: { ledger_entries: [{ id: 'payment-1', customer_id: 'customer-1',
      type: 'PAYMENT', created_at: '2026-01-01T00:00:00Z', amount: -5, balance_after: 5, debt_cents_after: 500 }] },
    customer_projections: [] });
    const currentContext = { expectedTenantId: 'tenant-1', expectedEndpoint: raw.endpoint, expectedFamily: 'customer_credit' };
    expect(validateCloudSyncV2Envelope(raw, currentContext).ledger_entries[0].amount).toBe(-5);
    raw.payload.ledger_entries[0].balance_after = -1;
    expect(() => validateCloudSyncV2Envelope(raw, currentContext)).toThrow('CLOUD_SYNC_PROTOCOL_INVALID_LEDGER');
  });

  it('rejects the wrong tenant, original key or hash', () => {
    expect(() => validateCloudSyncV2Envelope({ ...receipt(), tenant_id: 'tenant-2' }, context))
      .toThrow('CLOUD_SYNC_PROTOCOL_TENANT_MISMATCH');
    for (const field of ['idempotency_key', 'request_hash']) {
      const raw = receipt(); raw.operation[field] = 'wrong';
      expect(() => validateCloudSyncV2Envelope(raw, context)).toThrow('CLOUD_SYNC_PROTOCOL_OPERATION_MISMATCH');
    }
  });

  it('requires result semantics during discovery before a financial write', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...contract, endpoint_families: ['financial_operations'],
      endpoints: ['pos_execute_financial_operation_v2'] }, error: null });
    await expect(callCloudSyncV2Rpc({ client: { rpc }, rpcName: 'pos_execute_financial_operation_v2',
      authArgs: { p_license_key: 'license' }, family: 'financial_operations' }))
      .rejects.toMatchObject({ code: 'CLOUD_CLIENT_UPDATE_REQUIRED' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_capabilities).toContain(CLOUD_FINANCIAL_RESULT_CAPABILITY);
  });

  it('emits UPDATE_REQUIRED on incompatible discovery without an outbox row', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } });
    const rpc = vi.fn().mockResolvedValue({ data: { ...contract, server_status: 'UPDATE_REQUIRED' }, error: null });
    await expect(callCloudSyncV2Rpc({ client: { rpc }, rpcName: 'pos_pull_customer_credit_changes_v2',
      authArgs: { p_license_key: 'license' }, family: 'customer_credit' }))
      .rejects.toMatchObject({ code: 'CLOUD_CLIENT_UPDATE_REQUIRED' });
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'lanzo:cloud-protocol-update-required',
      detail: { family: 'customer_credit', code: 'CLOUD_CLIENT_UPDATE_REQUIRED' } }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('normalizes the PostgreSQL update-required message', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: contract, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'CLOUD_CLIENT_UPDATE_REQUIRED' } });
    await expect(callCloudSyncV2Rpc({ client: { rpc }, rpcName: 'pos_pull_customer_credit_changes_v2',
      authArgs: { p_license_key: 'license' }, family: 'customer_credit' }))
      .rejects.toMatchObject({ code: 'CLOUD_CLIENT_UPDATE_REQUIRED', retryable: false });
  });

  it('does not write or fall back to v1 when the server has not enabled the QA pilot', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { contract_version: 2, tenant_id: 'tenant-1',
      server_status: 'UPDATE_REQUIRED', active_protocol: 1, reason: 'QA_PILOT_NOT_ENABLED' }, error: null });
    await expect(callCloudSyncV2Rpc({ client: { rpc }, rpcName: 'pos_execute_financial_operation_v2',
      authArgs: { p_license_key: 'license' }, family: 'financial_operations' }))
      .rejects.toMatchObject({ code: 'CLOUD_CLIENT_UPDATE_REQUIRED', retryable: false });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([CLOUD_SYNC_CONTRACT_RPC]);
  });

  it('recovers the same receipt after pilot stop but refuses an execute absent from discovery', async () => {
    const recoveryContract = { ...contract, mode: 'RECOVERY_ONLY', active_protocol: 1,
      endpoint_families: ['financial_operations'], endpoints: ['pos_get_financial_operation_receipt_v2'],
      capabilities: [...contract.capabilities, CLOUD_FINANCIAL_RESULT_CAPABILITY] };
    const rpc = vi.fn().mockResolvedValueOnce({ data: recoveryContract, error: null })
      .mockResolvedValueOnce({ data: receipt(), error: null });
    const response = await callCloudSyncV2Rpc({ client: { rpc }, rpcName: 'pos_get_financial_operation_receipt_v2',
      authArgs: { p_license_key: 'license' }, params: { p_idempotency_key: 'original-key', p_request_hash: 'original-hash' },
      family: 'financial_operations', expectedIdempotencyKey: 'original-key', expectedRequestHash: 'original-hash' });
    expect(response.status).toBe('COMPLETED');
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_idempotency_key: 'original-key', p_request_hash: 'original-hash' });
    const blocked = vi.fn().mockResolvedValue({ data: recoveryContract, error: null });
    await expect(callCloudSyncV2Rpc({ client: { rpc: blocked }, rpcName: 'pos_execute_financial_operation_v2',
      authArgs: { p_license_key: 'license' }, family: 'financial_operations' }))
      .rejects.toMatchObject({ code: 'CLOUD_CLIENT_UPDATE_REQUIRED' });
    expect(blocked).toHaveBeenCalledTimes(1);
  });
});

const envelope = (overrides = {}) => ({
  contract_version: CLOUD_SYNC_CONTRACT_VERSION,
  tenant_id: 'tenant-1',
  endpoint: 'pos_pull_customer_credit_changes_v2',
  family: 'customer_credit',
  payload: { customers: [sampleCustomer()] },
  customer_projections: [{
    customer_id: 'customer-1',
    status: 'KNOWN_POSITIVE',
    debt_cents: 4250,
    source: 'CLOUD_LEDGER',
    projection_version: 1
  }],
  cursor: { change_seq: 4, has_more: false, next_cursor: null },
  ...overrides
});

describe('cloud sync protocol v2', () => {
  it('discovers the contract and calls only the requested v2 route', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: contract, error: null })
      .mockResolvedValueOnce({ data: envelope(), error: null });

    const result = await callCloudSyncV2Rpc({
      client: { rpc },
      rpcName: 'pos_pull_customer_credit_changes_v2',
      authArgs: { p_license_key: 'license-key' },
      family: 'customer_credit',
      requireCursor: true
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      CLOUD_SYNC_CONTRACT_RPC,
      'pos_pull_customer_credit_changes_v2'
    ]);
    expect(rpc.mock.calls[0][1].p_requested_contract).toBe(2);
    expect(rpc.mock.calls[1][1].p_sync_contract.contract_version).toBe(2);
    expect(result.customers[0].financial_projection).toEqual({
      status: 'KNOWN_POSITIVE',
      debt_cents: 4250,
      source: 'CLOUD_LEDGER',
      projection_version: 1
    });
    expect(result.cloudSyncEnvelope.cursor.change_seq).toBe(4);
    expect(syncOutboxService.resumeUpdateRequired).toHaveBeenCalledWith('customer_credit', {
      licenseKey: 'license-key'
    });
  });

  it('turns a missing discovery RPC into update-required without calling legacy or v2 writes', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not in schema cache' } });

    await expect(callCloudSyncV2Rpc({
      client: { rpc },
      rpcName: 'pos_upsert_customer_v2',
      authArgs: { p_license_key: 'license-key' },
      family: 'customer_directory'
    })).rejects.toMatchObject({ code: 'CLOUD_CLIENT_UPDATE_REQUIRED', retryable: false });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe(CLOUD_SYNC_CONTRACT_RPC);
  });

  it('rejects an endpoint the negotiated family does not advertise', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: { ...contract, endpoints: [] }, error: null
    });
    await expect(callCloudSyncV2Rpc({
      client: { rpc },
      rpcName: 'pos_pull_customer_credit_changes_v2',
      authArgs: { p_license_key: 'license-key' },
      family: 'customer_credit'
    })).rejects.toMatchObject({ code: 'CLOUD_CLIENT_UPDATE_REQUIRED' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects a different tenant, unsupported contract, and bad customer identity', () => {
    expect(() => validateCloudSyncV2Envelope(envelope({ tenant_id: 'tenant-2' }), {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit'
    })).toThrow('CLOUD_SYNC_PROTOCOL_TENANT_MISMATCH');

    expect(() => validateCloudSyncV2Envelope(envelope({ contract_version: 3 }), {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit'
    })).toThrow('CLOUD_CLIENT_UPDATE_REQUIRED');

    expect(() => validateCloudSyncV2Envelope(envelope(), {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit',
      expectedCustomerId: 'customer-2'
    })).toThrow('CLOUD_SYNC_PROTOCOL_CUSTOMER_MISMATCH');
  });

  it('rejects missing, fractional, and out-of-range financial projections', () => {
    const context = {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit'
    };

    expect(() => validateCloudSyncV2Envelope(envelope({ customer_projections: [] }), context))
      .toThrow('CLOUD_SYNC_PROTOCOL_PROJECTION_MISSING');
    expect(() => validateCloudSyncV2Envelope(envelope({ customer_projections: [{
      customer_id: 'customer-1', status: 'KNOWN_POSITIVE', debt_cents: 12.5,
      source: 'CLOUD_LEDGER', projection_version: 1
    }] }), context)).toThrow('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
    expect(() => validateCloudSyncV2Envelope(envelope({ customer_projections: [{
      customer_id: 'customer-1', status: 'KNOWN_POSITIVE', debt_cents: 2147483648,
      source: 'CLOUD_LEDGER', projection_version: 1
    }] }), context)).toThrow('CLOUD_SYNC_PROTOCOL_INVALID_PROJECTION');
  });

  it('rejects malformed customer rows before they can reach Dexie', () => {
    expect(() => validateCloudSyncV2Envelope(envelope({
      payload: { customers: [{ name: 'No id' }] },
      customer_projections: []
    }), {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit'
    })).toThrow('CLOUD_SYNC_PROTOCOL_INVALID_CUSTOMER');
  });

  it('requires explicit unknown status instead of treating an absent amount as zero', () => {
    const result = validateCloudSyncV2Envelope(envelope({
      payload: { customers: [sampleCustomer({ debt_cents: undefined })] },
      customer_projections: [{
        customer_id: 'customer-1', status: 'NOT_INCLUDED', debt_cents: null,
        source: 'DIRECTORY_ONLY', projection_version: 1
      }]
    }), {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit'
    });

    expect(result.customers[0].financial_projection).toMatchObject({
      status: 'NOT_INCLUDED', debt_cents: null
    });
  });

  it('requires and attaches projections to customers nested in financial responses', () => {
    const nestedCustomer = sampleCustomer();
    const financialEnvelope = envelope({
      payload: { sale: { credit: { customer: nestedCustomer } } },
      customer_projections: [{
        customer_id: 'customer-1', status: 'KNOWN_POSITIVE', debt_cents: 4250,
        source: 'pos_customers.debt_cents', projection_version: 1
      }]
    });
    const result = validateCloudSyncV2Envelope(financialEnvelope, {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit'
    });

    expect(result.sale.credit.customer.financial_projection).toMatchObject({
      status: 'KNOWN_POSITIVE', debt_cents: 4250
    });
    expect(() => validateCloudSyncV2Envelope({
      ...financialEnvelope,
      customer_projections: []
    }, {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit'
    })).toThrow('CLOUD_SYNC_PROTOCOL_PROJECTION_MISSING');
  });

  it('rejects incompatible cursors and replays with a different key or hash', () => {
    const context = {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit',
      requireCursor: true
    };
    expect(() => validateCloudSyncV2Envelope(envelope({ cursor: { change_seq: 1.5, has_more: false } }), context))
      .toThrow('CLOUD_SYNC_PROTOCOL_CURSOR_INVALID');

    expect(() => validateCloudSyncV2Envelope(envelope({
      operation: { idempotency_key: 'new-key', request_hash: 'sha256:new-hash' }
    }), {
      expectedTenantId: 'tenant-1',
      expectedEndpoint: 'pos_pull_customer_credit_changes_v2',
      expectedFamily: 'customer_credit',
      expectedIdempotencyKey: 'expected-key',
      expectedRequestHash: 'sha256:expected-hash'
    })).toThrow('CLOUD_SYNC_PROTOCOL_OPERATION_MISMATCH');
  });
});
