import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ rows: new Map(), claimed: new Set(), project: vi.fn(), receipt: vi.fn(), execute: vi.fn() }));
const handle = { actorKey: 'admin:a', actorType: 'admin', actorId: 'a', deviceRef: 'device-a', tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 }, assertCurrent: vi.fn() };

vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { capture: () => handle } }));
vi.mock('../financialProjectionRegistry', () => ({ applyFinancialProjection: (options) => runtime.project(options) }));
vi.mock('../financialIntentLedger', () => {
  const STATUS = { COMPLETED: 'COMPLETED' };
  const PROJECTION = { NOT_REQUIRED: 'NOT_REQUIRED', PENDING: 'PENDING', APPLIED: 'APPLIED', FAILED: 'FAILED' };
  const owned = (row, current) => row?.originActorKey === current.actorKey && row.originActorType === current.actorType && row.originActorId === current.actorId && row.originTenantOpaqueId === current.tenant.opaqueId && row.originTenantDatabaseName === current.tenant.databaseName && row.originDeviceRef === current.deviceRef;
  return {
    FINANCIAL_INTENT_STATUS: STATUS, FINANCIAL_PROJECTION_STATUS: PROJECTION,
    assertFinancialIntentRecoveryAuthority(row, current) { current.assertCurrent(); if (!owned(row, current)) throw new Error('FINANCIAL_RECOVERY_ORIGIN_MISMATCH'); },
    async getFinancialIntent(id) { return structuredClone(runtime.rows.get(id) || null); },
    async claimFinancialIntentRecovery({ intentId }) { if (runtime.claimed.has(intentId)) { const error = new Error('FINANCIAL_RECOVERY_LEASE_HELD'); error.code = error.message; throw error; } runtime.claimed.add(intentId); return { ...runtime.rows.get(intentId), recoveryLeaseId: `lease:${intentId}` }; },
    async releaseFinancialIntentRecoveryClaim({ intentId }) { runtime.claimed.delete(intentId); },
    async updateFinancialIntentForRecovery(id, changes, current) { current.assertCurrent(); const prior = runtime.rows.get(id); if (!owned(prior, current)) throw new Error('FINANCIAL_RECOVERY_ORIGIN_MISMATCH'); runtime.rows.set(id, { ...prior, ...structuredClone(changes) }); }
  };
});

import { retryFinancialIntentProjection } from '../financialProjectionRepair';

const row = (changes = {}) => ({
  id: 'intent-1', operationType: 'sale.cashier', idempotencyKey: 'K-original', requestHash: 'H-original', status: 'COMPLETED', projectionStatus: 'FAILED', projectionErrorCode: 'OLD_ERROR',
  originActorKey: 'admin:a', originActorType: 'admin', originActorId: 'a', originTenantOpaqueId: 'tenant-a', originTenantDatabaseName: 'LanzoDB_t_tenant-a', originDeviceRef: 'device-a', ...changes
});

beforeEach(() => { runtime.rows.clear(); runtime.claimed.clear(); runtime.project.mockReset(); runtime.receipt.mockReset(); runtime.execute.mockReset(); handle.assertCurrent.mockClear(); });

describe('projection-only financial repair', () => {
  it('repairs only an already completed local projection without receipt or financial RPC', async () => {
    runtime.rows.set('intent-1', row());
    runtime.project.mockResolvedValue({ ok: true });
    await expect(retryFinancialIntentProjection({ intentId: 'intent-1', actorHandle: handle })).resolves.toMatchObject({ outcome: 'projection_applied' });
    expect(runtime.project).toHaveBeenCalledTimes(1);
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'COMPLETED', projectionStatus: 'APPLIED', projectionErrorCode: null, idempotencyKey: 'K-original', requestHash: 'H-original' });
    expect(runtime.receipt).not.toHaveBeenCalled(); expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('persists a stable local failure while preserving financial completion', async () => {
    runtime.rows.set('intent-1', row());
    runtime.project.mockRejectedValue(Object.assign(new Error('local failed'), { code: 'LOCAL_HANDLER_FAILED' }));
    await expect(retryFinancialIntentProjection({ intentId: 'intent-1', actorHandle: handle })).resolves.toMatchObject({ outcome: 'projection_failed' });
    expect(runtime.rows.get('intent-1')).toMatchObject({ status: 'COMPLETED', projectionStatus: 'FAILED', projectionErrorCode: 'LOCAL_HANDLER_FAILED' });
    expect(runtime.receipt).not.toHaveBeenCalled(); expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('rejects admin retry of another actor before any local projection', async () => {
    runtime.rows.set('intent-1', row({ originActorKey: 'staff:b', originActorType: 'staff', originActorId: 'b' }));
    await expect(retryFinancialIntentProjection({ intentId: 'intent-1', actorHandle: handle })).rejects.toThrow('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');
    expect(runtime.project).not.toHaveBeenCalled();
  });
});
