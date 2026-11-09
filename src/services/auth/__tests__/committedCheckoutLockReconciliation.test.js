import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasCommittedCheckoutReceipt,
  reconcileCommittedCheckoutLocks
} from '../committedCheckoutLockReconciliation';

let db;
const cloudRow = (id = 'sale-cloud') => ({
  id, status: 'closed', sourceMode: 'cloud_committed', cloudSaleId: 'server-1',
  cloudSalesSyncStatus: 'synced', isLockedForCheckout: true,
  checkoutActorKey: 'staff:original', checkoutAttemptId: 'attempt-original',
  lockedAt: '2026-11-08T10:00:00.000Z', total: 110, customerId: 'customer-private'
});
const localRow = (id = 'sale-local') => ({
  id, status: 'closed', sourceMode: 'local_committed', isLockedForCheckout: true,
  checkoutActorKey: 'staff:original', checkoutAttemptId: 'attempt-local',
  localCheckoutAttemptId: 'attempt-local',
  localCommitBinding: { actorKey: 'staff:original', sessionId: 'original-session' },
  lockedAt: '2026-11-08T10:00:00.000Z', total: 90
});
const cloudLog = saleId => ({
  id: 'log-cloud-' + saleId, type: 'CLOUD_SALE', status: 'COMPLETED',
  saleId, cloudSaleId: 'server-1', sourceMode: 'cloud_committed'
});
const localLog = saleId => ({
  id: 'log-local-' + saleId, type: 'SALE', status: 'COMPLETED', saleId
});

beforeEach(async () => {
  db = new Dexie('committed-lock-reconciliation-' + crypto.randomUUID());
  db.version(1).stores({ sales: 'id,status', transaction_log: 'id,status' });
  await db.open();
});
afterEach(async () => { await db.delete(); });
const reconcile = (assertCurrent = vi.fn()) => reconcileCommittedCheckoutLocks({ db, assertCurrent });

describe('checkout lock reconciliation after durable commit', () => {
  it('unlocks only two provably committed Staff receipts without changing sales or logs', async () => {
    const initialCloud = cloudRow();
    const initialLocal = localRow();
    const unresolved = { ...cloudRow('unresolved'), cloudSaleId: 'unconfirmed-server' };
    const active = { ...localRow('active'), status: 'open' };
    await db.table('sales').bulkPut([initialCloud, initialLocal, unresolved, active]);
    await db.table('transaction_log').bulkPut([cloudLog('sale-cloud'), localLog('sale-local')]);
    const logsBefore = await db.table('transaction_log').toArray();

    expect(await reconcile()).toEqual({ reconciled: 2 });
    const cloud = await db.table('sales').get('sale-cloud');
    const local = await db.table('sales').get('sale-local');
    expect(cloud).toEqual({ ...initialCloud, isLockedForCheckout: false, lockedAt: null });
    expect(local).toEqual({ ...initialLocal, isLockedForCheckout: false, lockedAt: null });
    expect(await db.table('sales').get('unresolved')).toEqual(unresolved);
    expect(await db.table('sales').get('active')).toEqual(active);
    expect(await db.table('transaction_log').toArray()).toEqual(logsBefore);
    expect(await reconcile()).toEqual({ reconciled: 0 });
  });

  it.each([
    ['not closed', { status: 'open' }, cloudLog('sale-cloud')],
    ['no local cloud receipt', {}, null],
    ['cloud receipt different sale', {}, cloudLog('other-sale')],
    ['cloud receipt different server ID', {}, { ...cloudLog('sale-cloud'), cloudSaleId: 'other-server' }],
    ['cloud receipt not completed', {}, { ...cloudLog('sale-cloud'), status: 'PENDING' }],
    ['cloud receipt wrong type', {}, { ...cloudLog('sale-cloud'), type: 'SALE' }],
    ['not synced', { cloudSalesSyncStatus: 'pending' }, cloudLog('sale-cloud')],
    ['no server identity', { cloudSaleId: null }, cloudLog('sale-cloud')],
    ['locally closed but no cloud marker', { sourceMode: 'shadow' }, cloudLog('sale-cloud')]
  ])('preserves ambiguous cloud checkout: %s', async (_case, patch, log) => {
    const sale = { ...cloudRow(), ...patch };
    await db.table('sales').put(sale);
    if (log) await db.table('transaction_log').put(log);
    expect(await reconcile()).toEqual({ reconciled: 0 });
    expect(await db.table('sales').get(sale.id)).toEqual(sale);
  });

  it.each([
    ['no immutable local binding', { localCommitBinding: null }, localLog('sale-local')],
    ['different original actor', { localCommitBinding: { actorKey: 'staff:foreign' } }, localLog('sale-local')],
    ['different checkout attempt', { localCheckoutAttemptId: 'different-attempt' }, localLog('sale-local')],
    ['missing attempt', { checkoutAttemptId: null }, localLog('sale-local')],
    ['missing SALE receipt', {}, null],
    ['not locally closed', { status: 'requires_review' }, localLog('sale-local')]
  ])('preserves ambiguous Local checkout: %s', async (_case, patch, log) => {
    const sale = { ...localRow(), ...patch };
    await db.table('sales').put(sale);
    if (log) await db.table('transaction_log').put(log);
    expect(await reconcile()).toEqual({ reconciled: 0 });
    expect(await db.table('sales').get(sale.id)).toEqual(sale);
  });

  it('aborts all changes on authority transition during the same transaction', async () => {
    await db.table('sales').bulkPut([cloudRow('first'), cloudRow('second')]);
    await db.table('transaction_log').bulkPut([cloudLog('first'), cloudLog('second')]);
    let checks = 0;
    await expect(reconcile(() => {
      checks += 1;
      if (checks === 3) throw new Error('ACTOR_CONTEXT_STALE');
    })).rejects.toThrow('ACTOR_CONTEXT_STALE');
    expect((await db.table('sales').get('first')).isLockedForCheckout).toBe(true);
    expect((await db.table('sales').get('second')).isLockedForCheckout).toBe(true);
    expect(await db.table('transaction_log').count()).toBe(2);
  });

  it('fails closed without an authenticated context callback', async () => {
    await expect(reconcileCommittedCheckoutLocks({ db })).rejects.toThrow('Authenticated tenant context');
    expect(hasCommittedCheckoutReceipt({
      ...cloudRow(), status: 'closed'
    }, [])).toBe(false);
  });
});
