import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ rows: new Map(), claimed: new Set(), receipt: vi.fn(), execute: vi.fn(), stale: false }));
const handle = {
  actorKey: 'admin:a', actorType: 'admin', actorId: 'a', deviceRef: 'device-a',
  tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 },
  assertCurrent() { if (runtime.stale) throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' }); }
};

vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { capture: () => handle } }));
vi.mock('../financialIntentLedger', () => {
  const STATUS = { PREPARED: 'PREPARED', DISPATCHING: 'DISPATCHING', PENDING_RECEIPT: 'PENDING_RECEIPT', COMPLETED: 'COMPLETED', CONFLICT: 'CONFLICT', BLOCKED: 'BLOCKED' };
  const owned = (row, current) => row?.originActorKey === current.actorKey && row.originActorType === current.actorType && row.originActorId === current.actorId && row.originTenantOpaqueId === current.tenant.opaqueId && row.originTenantDatabaseName === current.tenant.databaseName && (!row.originDeviceRef || row.originDeviceRef === current.deviceRef);
  return {
    FINANCIAL_INTENT_STATUS: STATUS,
    assertFinancialIntentRecoveryAuthority(row, current) { current.assertCurrent(); if (!owned(row, current)) throw new Error('FINANCIAL_RECOVERY_ORIGIN_MISMATCH'); },
    async getFinancialIntent(id) { return structuredClone(runtime.rows.get(id) || null); },
    async claimFinancialIntentRecovery({ intentId, actorHandle }) { actorHandle.assertCurrent(); if (runtime.claimed.has(intentId)) { const error = new Error('FINANCIAL_RECOVERY_LEASE_HELD'); error.code = error.message; throw error; } runtime.claimed.add(intentId); return { ...runtime.rows.get(intentId), recoveryLeaseId: `lease:${intentId}` }; },
    async releaseFinancialIntentRecoveryClaim({ intentId }) { runtime.claimed.delete(intentId); },
    async updateFinancialIntentForRecovery(id, changes, current) { current.assertCurrent(); const prior = runtime.rows.get(id); if (!owned(prior, current)) throw new Error('FINANCIAL_RECOVERY_ORIGIN_MISMATCH'); runtime.rows.set(id, { ...prior, ...structuredClone(changes) }); },
    async getFinancialIntentReceiptForRecovery({ intent, actorHandle }) { actorHandle.assertCurrent(); return runtime.receipt(intent); }
  };
});

import { refreshFinancialIntentReceipt } from '../financialReceiptReconciliation';

const row = (changes = {}) => ({
  id: 'intent-1', operationType: 'cash.open', idempotencyKey: 'K-original', requestHash: 'H-original',
  originActorKey: 'admin:a', originActorType: 'admin', originActorId: 'a', originTenantOpaqueId: 'tenant-a', originTenantDatabaseName: 'LanzoDB_t_tenant-a', originDeviceRef: 'device-a',
  status: 'PENDING_RECEIPT', dispatchAttemptCount: 1, projectionStatus: 'PENDING', ...changes
});

beforeEach(() => {
  runtime.rows.clear(); runtime.claimed.clear(); runtime.receipt.mockReset(); runtime.execute.mockReset(); runtime.stale = false;
});

describe('manual financial receipt reconciliation', () => {
  it('persists a completed authoritative receipt without any execute edge or immutable rewrite', async () => {
    runtime.rows.set('intent-1', row());
    runtime.receipt.mockResolvedValue({ status: 'COMPLETED', result: { success: true, receipt: 'server' } });
    await expect(refreshFinancialIntentReceipt({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle })).resolves.toMatchObject({ outcome: 'receipt_completed' });
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'COMPLETED', idempotencyKey: 'K-original', requestHash: 'H-original', responsePayload: { success: true, receipt: 'server' } });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['PROCESSING', 'PENDING_RECEIPT', 'receipt_processing'],
    ['CONFLICT', 'CONFLICT', 'receipt_conflict']
  ])('maps receipt %s without financial execute', async (receiptStatus, status, outcome) => {
    runtime.rows.set('intent-1', row());
    runtime.receipt.mockResolvedValue({ status: receiptStatus });
    await expect(refreshFinancialIntentReceipt({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle })).resolves.toMatchObject({ outcome });
    expect(runtime.rows.get('intent-1').status).toBe(status);
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('keeps NOT_FOUND attempted evidence pending and never resends', async () => {
    runtime.rows.set('intent-1', row({ status: 'DISPATCHING', dispatchAttemptCount: 1 }));
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    await expect(refreshFinancialIntentReceipt({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle })).resolves.toMatchObject({ outcome: 'receipt_not_found_no_resend' });
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'PENDING_RECEIPT', dispatchAttemptCount: 1, lastReceiptStatus: 'NOT_FOUND' });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('keeps PREPARED zero-attempt NOT_FOUND prepared and never reaches the 5C dispatch edge', async () => {
    runtime.rows.set('intent-1', row({ status: 'PREPARED', dispatchAttemptCount: 0 }));
    runtime.receipt.mockResolvedValue({ status: 'NOT_FOUND' });
    await expect(refreshFinancialIntentReceipt({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle })).resolves.toMatchObject({ outcome: 'receipt_not_found_prepared_no_dispatch' });
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'PREPARED', dispatchAttemptCount: 0 });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('preserves financial state when receipt transport is unavailable', async () => {
    runtime.rows.set('intent-1', row({ status: 'PENDING_RECEIPT', idempotencyKey: 'K-original', requestHash: 'H-original' }));
    runtime.receipt.mockRejectedValue(Object.assign(new Error('offline'), { code: 'NETWORK_UNAVAILABLE' }));
    await expect(refreshFinancialIntentReceipt({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle })).resolves.toMatchObject({ outcome: 'receipt_unavailable' });
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'PENDING_RECEIPT', idempotencyKey: 'K-original', requestHash: 'H-original' });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('rejects cross-actor admin observation before querying receipt', async () => {
    runtime.rows.set('intent-1', row({ originActorKey: 'staff:b', originActorType: 'staff', originActorId: 'b' }));
    await expect(refreshFinancialIntentReceipt({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle })).rejects.toThrow('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');
    expect(runtime.receipt).not.toHaveBeenCalled();
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('rejects the durable write when an actor switches during an in-flight receipt', async () => {
    runtime.rows.set('intent-1', row());
    runtime.receipt.mockImplementation(async () => { runtime.stale = true; return { status: 'COMPLETED', result: { success: true } }; });
    await expect(refreshFinancialIntentReceipt({ intentId: 'intent-1', licenseKey: 'transient', actorHandle: handle })).rejects.toThrow('ACTOR_CONTEXT_STALE');
    expect(runtime.rows.get('intent-1').status).toBe('PENDING_RECEIPT');
    expect(runtime.execute).not.toHaveBeenCalled();
  });
});
