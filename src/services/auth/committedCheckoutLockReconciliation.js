// Reconciles only obsolete checkout locks with durable, matching commit proof.
// This is not a checkout cancellation, actor handoff, payment retry or sale edit.
const isNonempty = value => typeof value === 'string' && value.trim().length > 0;

export const hasCommittedCheckoutReceipt = (sale, logs = []) => {
  if (!sale?.id || sale.isLockedForCheckout !== true || sale.status !== 'closed') return false;
  const receipts = logs.filter(log => (
    log?.saleId === sale.id && log.status === 'COMPLETED'
  ));

  if (sale.sourceMode === 'cloud_committed') {
    // A server-committed sale projected locally must have both the durable
    // server sale identifier and the matching completed local projection log.
    // A closed UI status or pending cloud intent alone proves nothing.
    return isNonempty(sale.cloudSaleId)
      && sale.cloudSalesSyncStatus === 'synced'
      && receipts.some(log => (
        log.type === 'CLOUD_SALE'
        && log.sourceMode === 'cloud_committed'
        && log.cloudSaleId === sale.cloudSaleId
      ));
  }

  // Local checkout commit is atomic with its SALE ledger record and its exact
  // immutable actor/attempt binding. Unknown or legacy rows stay protected.
  return isNonempty(sale.checkoutActorKey)
    && isNonempty(sale.checkoutAttemptId)
    && isNonempty(sale.localCheckoutAttemptId)
    && sale.checkoutAttemptId === sale.localCheckoutAttemptId
    && sale.localCommitBinding?.actorKey === sale.checkoutActorKey
    && receipts.some(log => log.type === 'SALE');
};

export const reconcileCommittedCheckoutLocks = async ({
  db,
  assertCurrent
} = {}) => {
  if (!db || typeof assertCurrent !== 'function') {
    throw new TypeError('Authenticated tenant context required for checkout reconciliation');
  }

  let reconciled = 0;
  // The same physical tenant SALES and TRANSACTION_LOG stores are locked in
  // one IndexedDB read-write transaction. No sale, ledger, payment, stock,
  // actor identity or checkout-attempt content is rewritten.
  await db.transaction('rw', db.table('sales'), db.table('transaction_log'), async () => {
    assertCurrent();
    const locks = await db.table('sales')
      .filter(row => row?.isLockedForCheckout === true)
      .toArray();
    if (locks.length === 0) return;

    const lockedSaleIds = new Set(locks.map(sale => sale.id).filter(Boolean));
    const completedLogs = await db.table('transaction_log')
      .filter(log => lockedSaleIds.has(log?.saleId) && log?.status === 'COMPLETED')
      .toArray();

    for (const sale of locks) {
      if (!hasCommittedCheckoutReceipt(sale, completedLogs)) continue;
      assertCurrent();
      const updated = await db.table('sales').update(sale.id, {
        isLockedForCheckout: false,
        lockedAt: null
      });
      if (updated !== 1) throw new Error('COMMITTED_CHECKOUT_LOCK_STALE');
      reconciled += 1;
    }
    // A context transition aborts the entire transaction, even if one lock
    // was already updated within it. Never partially reconcile on a stale actor.
    assertCurrent();
  });

  return Object.freeze({ reconciled });
};
