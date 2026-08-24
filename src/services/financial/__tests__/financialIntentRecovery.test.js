import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  rows: new Map(),
  receipt: vi.fn(),
  execute: vi.fn(),
  claimed: new Set(),
  stale: false
}));

const handle = {
  actorKey: 'admin:a', actorType: 'admin', actorId: 'a', deviceRef: 'device-a',
  tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 2 },
  assertCurrent() { if (runtime.stale) throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' }); }
};

vi.mock('../financialIntentLedger', () => {
  const STATUS = { PREPARED: 'PREPARED', DISPATCHING: 'DISPATCHING', PENDING_RECEIPT: 'PENDING_RECEIPT', COMPLETED: 'COMPLETED', CONFLICT: 'CONFLICT', BLOCKED: 'BLOCKED' };
  const PROJECTION = { NOT_REQUIRED: 'NOT_REQUIRED', PENDING: 'PENDING', APPLIED: 'APPLIED', FAILED: 'FAILED' };
  const owned = (row, current) => row.originActorKey === current.actorKey && row.originActorType === current.actorType && row.originActorId === current.actorId && row.originTenantOpaqueId === current.tenant.opaqueId && row.originTenantDatabaseName === current.tenant.databaseName && (!row.originDeviceRef || !current.deviceRef || row.originDeviceRef === current.deviceRef);
  return {
    FINANCIAL_INTENT_STATUS: STATUS,
    FINANCIAL_PROJECTION_STATUS: PROJECTION,
    assertFinancialIntentRecoveryAuthority(row, current) { current.assertCurrent(); if (!owned(row, current)) throw new Error(row.originDeviceRef !== current.deviceRef ? 'FINANCIAL_RECOVERY_DEVICE_MISMATCH' : 'FINANCIAL_RECOVERY_ORIGIN_MISMATCH'); },
    async getFinancialIntent(id) { return structuredClone(runtime.rows.get(id)); },
    async updateFinancialIntentForRecovery(id, values, current) { current.assertCurrent(); const row = runtime.rows.get(id); if (!owned(row, current)) throw new Error('FINANCIAL_RECOVERY_ORIGIN_MISMATCH'); runtime.rows.set(id, { ...row, ...structuredClone(values) }); },
    async claimFinancialIntentRecovery({ intentId, actorHandle }) { actorHandle.assertCurrent(); if (runtime.claimed.has(intentId)) { const error = new Error('FINANCIAL_RECOVERY_LEASE_HELD'); error.code = error.message; throw error; } runtime.claimed.add(intentId); return { ...runtime.rows.get(intentId), recoveryLeaseId: `lease:${intentId}` }; },
    async releaseFinancialIntentRecoveryClaim({ intentId }) { runtime.claimed.delete(intentId); },
    async getFinancialIntentReceiptForRecovery({ intent, actorHandle }) { actorHandle.assertCurrent(); return runtime.receipt(intent); },
    async executePreparedFinancialIntentForRecovery({ intentId, actorHandle }) { actorHandle.assertCurrent(); const row = runtime.rows.get(intentId); if (row.status !== STATUS.PREPARED || row.dispatchAttemptCount !== 0) throw new Error('FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE'); const response = await runtime.execute(row); runtime.rows.set(intentId, { ...row, status: STATUS.COMPLETED, dispatchAttemptCount: 1, responsePayload: response }); return { intentId, response }; }
  };
});

import { recoverFinancialIntent } from '../financialIntentRecovery';

const row = (changes = {}) => ({
  id: 'intent-1', operationType: 'cash.open', idempotencyKey: 'K-original', requestHash: 'H-original', requestPayload: { opening_amount: '1' },
  originActorKey: 'admin:a', originActorType: 'admin', originActorId: 'a', originActorSessionId: 'old-session', originActorGeneration: 1,
  originTenantOpaqueId: 'tenant-a', originTenantDatabaseName: 'LanzoDB_t_tenant-a', originTenantGeneration: 1, originDeviceRef: 'device-a',
  status: 'PENDING_RECEIPT', dispatchAttemptCount: 1, projectionStatus: 'NOT_REQUIRED', ...changes
});

beforeEach(() => {
  runtime.rows.clear(); runtime.claimed.clear(); runtime.stale = false;
  runtime.receipt.mockReset(); runtime.execute.mockReset();
});

describe('financial receipt-first recovery', () => {
  it('recovers a same actor new session from a completed receipt without execute or origin rewrite', async () => {
    runtime.rows.set('intent-1', row());
    runtime.receipt.mockResolvedValue({ status: 'COMPLETED', result: { success: true, receipt: 'authoritative' } });
    await recoverFinancialIntent({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle });
    const result = runtime.rows.get('intent-1');
    expect(result).toMatchObject({ status: 'COMPLETED', idempotencyKey: 'K-original', requestHash: 'H-original', originActorSessionId: 'old-session', originActorGeneration: 1 });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it.each(['DISPATCHING', 'PENDING_RECEIPT'])('never resends attempted %s after NOT_FOUND', async (status) => {
    runtime.rows.set('intent-1', row({ status }));
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    await recoverFinancialIntent({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle });
    expect(runtime.execute).not.toHaveBeenCalled();
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'PENDING_RECEIPT', idempotencyKey: 'K-original', requestHash: 'H-original' });
  });

  it('preserves the exact attempted cash.admin_close NOT_FOUND incident without resend, replacement K, or state reset', async () => {
    runtime.rows.set('intent-1', row({
      operationType: 'cash.admin_close',
      status: 'PENDING_RECEIPT',
      projectionStatus: 'PENDING',
      dispatchAttemptCount: 1,
      lastReceiptStatus: 'NOT_FOUND'
    }));
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });

    await expect(recoverFinancialIntent({
      intentId: 'intent-1',
      licenseKey: 'transient',
      actorHandle: handle
    })).resolves.toMatchObject({ outcome: 'receipt_not_found_no_resend' });

    expect(runtime.receipt).toHaveBeenCalledTimes(1);
    expect(runtime.execute).not.toHaveBeenCalled();
    expect(runtime.rows.size).toBe(1);
    expect(runtime.rows.get('intent-1')).toMatchObject({
      operationType: 'cash.admin_close',
      status: 'PENDING_RECEIPT',
      projectionStatus: 'PENDING',
      dispatchAttemptCount: 1,
      lastReceiptStatus: 'NOT_FOUND',
      idempotencyKey: 'K-original',
      requestHash: 'H-original'
    });
  });

  it('uses the existing zero-attempt PREPARED intent for exactly one first dispatch', async () => {
    runtime.rows.set('intent-1', row({ status: 'PREPARED', dispatchAttemptCount: 0 }));
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    runtime.execute.mockResolvedValue({ success: true });
    await recoverFinancialIntent({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle });
    expect(runtime.execute).toHaveBeenCalledTimes(1);
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'COMPLETED', dispatchAttemptCount: 1, idempotencyKey: 'K-original', requestHash: 'H-original' });
  });

  it('does not execute PREPARED when receipt transport is ambiguous', async () => {
    runtime.rows.set('intent-1', row({ status: 'PREPARED', dispatchAttemptCount: 0 }));
    runtime.receipt.mockRejectedValue(new TypeError('Failed to fetch'));
    await recoverFinancialIntent({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle });
    expect(runtime.execute).not.toHaveBeenCalled();
    expect(runtime.rows.get('intent-1').status).toBe('PREPARED');
  });

  it('retries a completed local projection without receipt or financial RPC', async () => {
    runtime.rows.set('intent-1', row({ status: 'COMPLETED', projectionStatus: 'FAILED', responsePayload: { success: true } }));
    const project = vi.fn();
    await recoverFinancialIntent({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle, project });
    expect(project).toHaveBeenCalledTimes(1);
    expect(runtime.receipt).not.toHaveBeenCalled();
    expect(runtime.execute).not.toHaveBeenCalled();
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'COMPLETED', projectionStatus: 'APPLIED' });
  });

  it('rejects a different actor before receipt, claim, projection, or execute', async () => {
    runtime.rows.set('intent-1', row());
    const other = { ...handle, actorKey: 'staff:b', actorType: 'staff', actorId: 'b' };
    await expect(recoverFinancialIntent({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: other })).rejects.toThrow('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');
    expect(runtime.receipt).not.toHaveBeenCalled(); expect(runtime.execute).not.toHaveBeenCalled(); expect(runtime.claimed.size).toBe(0);
  });

  it('fails closed on a persisted device proof mismatch', async () => {
    runtime.rows.set('intent-1', row({ originDeviceRef: 'device-original' }));
    await expect(recoverFinancialIntent({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle })).rejects.toThrow('FINANCIAL_RECOVERY_DEVICE_MISMATCH');
    expect(runtime.receipt).not.toHaveBeenCalled(); expect(runtime.execute).not.toHaveBeenCalled();
  });
});
