import { db, getTenantRuntimeReadiness } from '../db/tenantRuntimeRouter';
import { resolveStableActorId } from '../auth/actorIdentity';
import { actorRuntimeController } from '../auth/actorRuntimeController';

// Diagnostic only: never return local sale rows, identifiers, amounts or timestamps.
// It does not decide ownership transfer, whether a payment succeeded, or whether
// a checkout may be released. The handoff contract remains the authority.
const MAX_VISIBLE_LOCKS = 10;
const LOCAL_SALE_STATES = new Set(['open', 'closed', 'cancelled', 'requires_review']);

const unavailable = code => Object.freeze({
  status: 'unavailable',
  code
});

export const classifyProtectedCheckoutForDiagnosis = (sale, expectedAdminKey) => {
  const actorKey = typeof sale?.checkoutActorKey === 'string'
    ? sale.checkoutActorKey.trim()
    : '';

  const owner = !actorKey ? 'no_owner_proof'
    : actorKey === expectedAdminKey ? 'matching_admin'
      : actorKey.startsWith('staff:') ? 'staff'
        : actorKey.startsWith('admin:') ? 'other_admin'
          : 'unrecognized_owner';

  const localStatus = LOCAL_SALE_STATES.has(sale?.status)
    ? sale.status : 'unknown';

  return Object.freeze({
    owner,
    localStatus,
    attemptMarked: Boolean(sale?.checkoutAttemptId || sale?.localCheckoutAttemptId),
    // Local state and a checkout lock cannot establish a financial outcome.
    financialOutcome: 'unverified'
  });
};

export const readProtectedCheckoutDiagnosis = async ({ verifiedAdminActor } = {}) => {
  const adminId = resolveStableActorId('admin', verifiedAdminActor);
  if (!adminId) return unavailable('ADMIN_IDENTITY_UNAVAILABLE');

  const before = getTenantRuntimeReadiness();
  if (!before.ready || !before.runtime?.opaqueId || !Number.isFinite(before.runtime.generation)) {
    return unavailable('TENANT_RUNTIME_UNAVAILABLE');
  }
  if (actorRuntimeController.getState().status !== 'locked') {
    return unavailable('ACTOR_CONTEXT_CHANGED');
  }

  try {
    let total = 0;
    const entries = [];
    // Dexie Collection.each uses an IndexedDB read cursor. No transactions
    // with rw, writes, deletions, localStorage, sync, or actor grants.
    await db.table('sales')
      .filter(sale => sale?.isLockedForCheckout === true)
      .each(sale => {
        total += 1;
        if (entries.length < MAX_VISIBLE_LOCKS) {
          entries.push(classifyProtectedCheckoutForDiagnosis(sale, `admin:${adminId}`));
        }
      });

    const after = getTenantRuntimeReadiness();
    if (!after.ready || !after.runtime
        || after.runtime.opaqueId !== before.runtime.opaqueId
        || after.runtime.generation !== before.runtime.generation
        || actorRuntimeController.getState().status !== 'locked') {
      return unavailable('CONTEXT_CHANGED_DURING_READ');
    }

    return Object.freeze({
      status: 'ready',
      total,
      truncated: total > entries.length,
      entries: Object.freeze(entries)
    });
  } catch {
    return unavailable('LOCAL_READ_UNAVAILABLE');
  }
};
