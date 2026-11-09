import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  readiness: vi.fn(),
  actor: vi.fn(),
  table: vi.fn(),
  rows: []
}));
vi.mock('../../db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: harness.readiness,
  db: { table: harness.table }
}));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: { getState: harness.actor }
}));

import { classifyProtectedCheckoutForDiagnosis, readProtectedCheckoutDiagnosis } from '../protectedCheckoutDiagnosis';

beforeEach(() => {
  vi.clearAllMocks();
  harness.rows = [];
  harness.readiness.mockReturnValue({
    ready: true,
    runtime: { opaqueId: 'tenant-secret', generation: 3 }
  });
  harness.actor.mockReturnValue({ status: 'locked' });
  harness.table.mockImplementation(name => {
    if (name !== 'sales') throw new Error('Unexpected store');
    return { filter: predicate => ({
      each: async visit => {
        for (const row of harness.rows) if (predicate(row)) visit(row);
      }
    }) };
  });
});

describe('read-only protected checkout diagnosis', () => {
  it('classifies only safe categories and never returns row identifiers or amounts', async () => {
    harness.rows = [
      { id: 'secret-1', customerId: 'private', total: 999, isLockedForCheckout: true,
        checkoutActorKey: 'admin:owner', checkoutAttemptId: 'secret-attempt', status: 'open' },
      { id: 'secret-2', isLockedForCheckout: true, checkoutActorKey: 'staff:person', status: 'closed' },
      { id: 'secret-3', isLockedForCheckout: true, checkoutActorKey: 'admin:different', status: 'requires_review' },
      { id: 'secret-4', isLockedForCheckout: true, status: 'legacy-state' },
      { id: 'not-locked', isLockedForCheckout: false, checkoutActorKey: 'staff:person' }
    ];
    const result = await readProtectedCheckoutDiagnosis({ verifiedAdminActor: { id: 'owner' } });
    expect(result).toMatchObject({
      status: 'ready',
      total: 4,
      entries: [
        { owner: 'matching_admin', localStatus: 'open', attemptMarked: true, financialOutcome: 'unverified' },
        { owner: 'staff', localStatus: 'closed', attemptMarked: false, financialOutcome: 'unverified' },
        { owner: 'other_admin', localStatus: 'requires_review' },
        { owner: 'no_owner_proof', localStatus: 'unknown' }
      ]
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-|private|999|admin:owner|staff:person|admin:different|customerId|checkoutAttemptId|tenant-secret/);
    expect(harness.table).toHaveBeenCalledTimes(1);
    expect(harness.table).toHaveBeenCalledWith('sales');
  });

  it('does not infer a payment or ownership from missing or malformed evidence', () => {
    const item = classifyProtectedCheckoutForDiagnosis({
      checkoutActorKey: 'unrecognized:private-identity',
      status: 'paid_supposedly', localCommitBinding: { actorKey: 'admin:owner' }
    }, 'admin:owner');
    expect(item).toEqual({ owner: 'unrecognized_owner', localStatus: 'unknown',
      attemptMarked: false, financialOutcome: 'unverified' });
  });

  it('fails closed without verified actor, a ready real tenant, or a locked actor', async () => {
    expect(await readProtectedCheckoutDiagnosis({ verifiedAdminActor: null }))
      .toMatchObject({ status: 'unavailable', code: 'ADMIN_IDENTITY_UNAVAILABLE' });
    harness.readiness.mockReturnValue({ ready: true, runtime: null });
    expect(await readProtectedCheckoutDiagnosis({ verifiedAdminActor: { id: 'owner' } }))
      .toMatchObject({ status: 'unavailable', code: 'TENANT_RUNTIME_UNAVAILABLE' });
    harness.readiness.mockReturnValue({ ready: true, runtime: { opaqueId: 't', generation: 2 } });
    harness.actor.mockReturnValue({ status: 'granted' });
    expect(await readProtectedCheckoutDiagnosis({ verifiedAdminActor: { id: 'owner' } }))
      .toMatchObject({ status: 'unavailable', code: 'ACTOR_CONTEXT_CHANGED' });
    expect(harness.table).not.toHaveBeenCalled();
  });

  it('discards results on tenant change or actor grant during read', async () => {
    harness.rows = [{ id: 'secret', isLockedForCheckout: true, checkoutActorKey: 'staff:x' }];
    harness.readiness.mockReturnValueOnce({ ready: true, runtime: { opaqueId: 'a', generation: 3 } })
      .mockReturnValueOnce({ ready: true, runtime: { opaqueId: 'b', generation: 4 } });
    const result = await readProtectedCheckoutDiagnosis({ verifiedAdminActor: { id: 'owner' } });
    expect(result).toMatchObject({ status: 'unavailable', code: 'CONTEXT_CHANGED_DURING_READ' });
    expect(JSON.stringify(result)).not.toContain('staff');
  });

  it('does not leak underlying IndexedDB exceptions', async () => {
    harness.table.mockImplementation(() => { throw new Error('private license, sale and token'); });
    const result = await readProtectedCheckoutDiagnosis({ verifiedAdminActor: { id: 'owner' } });
    expect(result).toEqual({ status: 'unavailable', code: 'LOCAL_READ_UNAVAILABLE' });
  });

  it('bounds the number of records copied and preserves the total count', async () => {
    harness.rows = Array.from({ length: 12 }, (_, i) => ({
      id: `private-${i}`, isLockedForCheckout: true,
      checkoutActorKey: 'staff:private', status: 'open'
    }));
    const result = await readProtectedCheckoutDiagnosis({ verifiedAdminActor: { id: 'owner' } });
    expect(result).toMatchObject({ status: 'ready', total: 12, truncated: true });
    expect(result.entries).toHaveLength(10);
  });
});
