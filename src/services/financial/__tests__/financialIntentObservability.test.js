import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  rows: [], calls: [], writes: 0, handle: null
}));

const makeHandle = (actorKey = 'admin:a', tenant = 'tenant-a', deviceRef = 'device-a') => ({
  actorKey, actorType: actorKey.split(':')[0], actorId: actorKey.split(':')[1], deviceRef,
  tenant: { opaqueId: tenant, databaseName: `LanzoDB_t_${tenant}`, generation: 1 },
  assertCurrent: vi.fn()
});

vi.mock('../../db/dexie', () => ({
  STORES: { FINANCIAL_INTENTS: 'financial_intents' },
  db: {
    table: () => ({
      where(index) {
        return {
          equals(value) {
            return {
              limit(limit) {
                runtime.calls.push({ index, value, limit });
                return { toArray: async () => structuredClone(runtime.rows.filter((row) => (
                  index === 'status' ? row.status === value : row.originActorKey === value[0] && row.status === value[1]
                )).slice(0, limit)) };
              }
            };
          }
        };
      },
      get: async (id) => structuredClone(runtime.rows.find((row) => row.id === id) || null)
    })
  }
}));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { capture: () => runtime.handle } }));
vi.mock('../financialIntentLedger', () => ({
  assertFinancialIntentRecoveryAuthority(row, handle) {
    handle.assertCurrent();
    if (row.originActorKey !== handle.actorKey || row.originActorType !== handle.actorType || row.originActorId !== handle.actorId || row.originTenantOpaqueId !== handle.tenant.opaqueId || row.originTenantDatabaseName !== handle.tenant.databaseName || (row.originDeviceRef && row.originDeviceRef !== handle.deviceRef)) throw new Error('FINANCIAL_RECOVERY_ORIGIN_MISMATCH');
  }
}));

import {
  getFinancialDiagnosticSummary,
  getFinancialIntentDiagnostic,
  listFinancialIntentDiagnostics
} from '../financialIntentObservability';

const row = (id, changes = {}) => ({
  id, ledgerVersion: 1, operationType: 'cash.open', idempotencyKey: `k-${id}-long-value`, requestHash: `h-${id}-long-value`, requestContractVersion: 1,
  status: 'PENDING_RECEIPT', projectionStatus: 'PENDING', dispatchAttemptCount: 1, recoveryAttemptCount: 0,
  originActorKey: 'admin:a', originActorType: 'admin', originActorId: 'a', originTenantOpaqueId: 'tenant-a', originTenantDatabaseName: 'LanzoDB_t_tenant-a', originDeviceRef: 'device-a',
  createdAt: '2026-08-22T19:00:00.000Z', updatedAt: '2026-08-22T19:10:00.000Z', requestPayload: { accessToken: 'forbidden' }, responsePayload: { private: 'forbidden' }, canonicalRequest: { raw: 'forbidden' },
  ...changes
});

beforeEach(() => {
  runtime.rows = []; runtime.calls = []; runtime.writes = 0; runtime.handle = makeHandle();
});

describe('financial intent observability authority and bounded reads', () => {
  it('lets staff read only its own current-tenant safe summaries', async () => {
    runtime.handle = makeHandle('staff:a');
    runtime.rows = [
      row('own', { originActorKey: 'staff:a', originActorType: 'staff', originActorId: 'a' }),
      row('other', { originActorKey: 'staff:b', originActorType: 'staff', originActorId: 'b' })
    ];
    const diagnostics = await listFinancialIntentDiagnostics({ scope: 'all' });
    expect(diagnostics.map((item) => item.intentId)).toEqual(['own']);
    await expect(getFinancialIntentDiagnostic({ intentId: 'other' })).rejects.toThrow('FINANCIAL_OBSERVABILITY_ACTOR_MISMATCH');
  });

  it('lets an admin observe tenant-wide sanitized rows but never grants cross-actor actions', async () => {
    runtime.rows = [
      row('admin'),
      row('staff', { originActorKey: 'staff:b', originActorType: 'staff', originActorId: 'b' })
    ];
    const diagnostics = await listFinancialIntentDiagnostics({ scope: 'all' });
    const staff = diagnostics.find((item) => item.intentId === 'staff');
    expect(diagnostics).toHaveLength(2);
    expect(staff.allowedActions.refreshReceipt).toBe(false);
    expect(staff.allowedActions.retryProjection).toBe(false);
    expect(staff.allowedActions.requiresOriginActorLogin).toBe(true);
    expect(JSON.stringify(staff)).not.toContain('forbidden');
  });

  it('fails closed across physical tenants even if a malformed row exists in the current store', async () => {
    runtime.rows = [row('current'), row('foreign', { originTenantOpaqueId: 'tenant-b', originTenantDatabaseName: 'LanzoDB_t_tenant-b' })];
    expect((await listFinancialIntentDiagnostics({ scope: 'all' })).map((item) => item.intentId)).toEqual(['current']);
  });

  it('reads with bounded indexed queries and never writes or calls cloud APIs', async () => {
    runtime.rows = Array.from({ length: 360 }, (_, index) => row(`row-${index}`, { status: ['PREPARED', 'DISPATCHING', 'PENDING_RECEIPT', 'COMPLETED', 'CONFLICT', 'BLOCKED'][index % 6] }));
    const diagnostics = await listFinancialIntentDiagnostics({ scope: 'all', limit: 1000 });
    const summary = await getFinancialDiagnosticSummary({ limit: 50 });
    expect(diagnostics).toHaveLength(100);
    expect(summary.visible).toBeLessThanOrEqual(50);
    expect(runtime.calls.length).toBeGreaterThan(0);
    expect(runtime.calls.every((call) => call.limit <= 100)).toBe(true);
    expect(runtime.writes).toBe(0);
  });

  it('shows active leases without enabling competing action and does not mutate expired leases while reading', async () => {
    runtime.rows = [
      row('active', { recoveryLeaseId: 'lease-a', recoveryLeaseUntil: new Date(Date.now() + 60000).toISOString() }),
      row('expired', { recoveryLeaseId: 'lease-b', recoveryLeaseUntil: new Date(Date.now() - 60000).toISOString() })
    ];
    const diagnostics = await listFinancialIntentDiagnostics({ scope: 'all' });
    expect(diagnostics.find((item) => item.intentId === 'active')).toMatchObject({ recoveryLeaseState: 'ACTIVE', allowedActions: { refreshReceipt: false } });
    expect(diagnostics.find((item) => item.intentId === 'expired').recoveryLeaseState).toBe('EXPIRED');
    expect(runtime.writes).toBe(0);
  });
});
