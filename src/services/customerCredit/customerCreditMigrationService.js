import { db, STORES } from '../db/dexie';
import { Money } from '../../utils/moneyMath';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { syncMetaService } from '../sync/syncMetaService';
import { customerCreditCloudRepository } from './customerCreditCloudRepository';
import { historicalCreditSnapshot } from './historicalCreditSnapshot';

const BATCH_KEY = 'historical-credit:v1:batch';
const completeStatuses = new Set(['IMPORTED', 'ALREADY_IMPORTED_IDENTICAL', 'CLOUD_PROJECTION']);
const ownerHandle = () => {
  const handle = actorRuntimeController.capture('customers');
  if (handle.actorType !== 'admin') throw new Error('REJECTED_AUTHORITY');
  return handle;
};
const readBatch = async () => (await db.table(STORES.SYNC_CACHE).get(BATCH_KEY))?.value || null;
const persist = async (batch, handle) => {
  handle.assertCurrent();
  await db.table(STORES.SYNC_CACHE).put({ key: BATCH_KEY, value: batch });
  handle.assertCurrent();
};
const rpc = async (licenseKey, action, batch, handle, confirm = false) => {
  handle.assertCurrent();
  const response = await customerCreditCloudRepository.historicalCreditBatch({
    licenseKey, action, manifest: batch?.manifest, authorizationId: batch?.authorizationId, confirm
  });
  handle.assertCurrent();
  if (batch?.previewHash && response.hash && response.hash !== batch.previewHash) throw new Error('HISTORICAL_RESPONSE_MISMATCH');
  return response;
};
const recordResults = async (batch, response, handle) => {
  const results = [];
  const approvedEntries = new Map(batch.manifest.entries.map((entry) => [entry.customer_id, entry]));
  const received = response.results || [];
  if (response.state === 'CONSUMED' && (received.length !== approvedEntries.size
    || new Set(received.map((row) => row.customer_id)).size !== approvedEntries.size)) {
    throw new Error('HISTORICAL_RECEIPT_MISSING');
  }
  for (const result of response.results || []) {
    handle.assertCurrent();
    const approved = approvedEntries.get(result.customer_id);
    if (!approved || approved.amount_cents !== result.amount_cents || approved.source_customer_id !== result.source_customer_id) {
      throw new Error('HISTORICAL_RESPONSE_MISMATCH');
    }
    if (completeStatuses.has(result.status) && !result.ledger_id) throw new Error('HISTORICAL_RECEIPT_MISSING');
    results.push(await historicalCreditSnapshot.saveResult(result.customer_id, result));
  }
  const localConflict = results.some((result) => result.status === 'CONFLICT_LOCAL_ACTIVITY');
  const localResponse = localConflict
    ? { ...response, success:false, state:'LOCAL_CONFLICT', cloudState:response.state, results }
    : { ...response, results };
  const updated = { ...batch, authorizationId: response.authorization_id || batch.authorizationId,
    state: response.state || batch.state, response: localResponse };
  await persist(updated, handle);
  return updated;
};

export const customerCreditMigrationService = {
  async runInitialMigrationIfNeeded({ licenseKey, actorHandle = actorRuntimeController.capture('customers') } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'license_missing' };
    actorHandle.assertCurrent();
    await historicalCreditSnapshot.preserveAll({ actorHandle });
    actorHandle.assertCurrent();
    const pending = (await historicalCreditSnapshot.list()).filter((row) => !completeStatuses.has(row.status));
    // Opening the app or reconnecting never grants financial approval.
    return { success: pending.length === 0, code: pending.length ? 'PENDING_AUTHORIZATION' : null, pending: pending.length };
  },
  async preview({ licenseKey }) {
    const handle = ownerHandle();
    await historicalCreditSnapshot.preserveAll();
    handle.assertCurrent();
    let batch = await readBatch();
    if (batch?.state === 'CONSUMED') {
      // Archive the confirmed receipt before starting another bounded batch.
      // Conflicts and later local activity remain preserved for manual review.
      const previousCustomers = new Set(batch.manifest.entries.map((entry) => entry.customer_id));
      const remaining = (await historicalCreditSnapshot.list()).some((row) =>
        row.status === 'PENDING_AUTHORIZATION' && !previousCustomers.has(row.customerId));
      if (remaining) {
        handle.assertCurrent();
        await db.transaction('rw', db.table(STORES.SYNC_CACHE), async () => {
          await db.table(STORES.SYNC_CACHE).put({ key: `${BATCH_KEY}:archive:${batch.manifest.batch_id}`, value: batch });
          await db.table(STORES.SYNC_CACHE).delete(BATCH_KEY);
        });
        handle.assertCurrent();
        batch = null;
      }
    }
    if (!batch) {
      const context = await rpc(licenseKey, 'context', null, handle);
      if (!context.success) throw new Error(context.code || 'REJECTED_AUTHORITY');
      const preserved = await historicalCreditSnapshot.list();
      const snapshots = preserved.filter((row) => row.status === 'PENDING_AUTHORIZATION').slice(0, 500);
      if (!snapshots.length) {
        const conflicts = preserved.filter((row) => !completeStatuses.has(row.status));
        return { success: conflicts.length === 0, empty: conflicts.length === 0, state: conflicts.length ? 'LOCAL_CONFLICT' : null,
          results: conflicts.map((row) => row.result || { customer_id: row.customerId, amount_cents: row.amountCents, status: row.status }) };
      }
      const sources = new Set(snapshots.map((row) => row.sourceId));
      if (sources.size !== 1) throw new Error('HISTORICAL_SOURCE_CONFLICT');
      const entries = snapshots.map((row) => ({ customer_id: row.customerId, source_customer_id: row.sourceCustomerId, amount_cents: row.amountCents }));
      batch = { manifest: { version: 1, tenant_id: context.tenant_id, source_id: snapshots[0].sourceId,
        batch_id: crypto.randomUUID(), entries, customer_count: entries.length,
        total_cents: entries.reduce((sum, row) => sum + row.amount_cents, 0) }, state: 'PENDING_AUTHORIZATION' };
      await persist(batch, handle);
    }
    const response = await rpc(licenseKey, 'preview', batch, handle);
    if (!response.hash) throw new Error(response.code || 'HISTORICAL_PREVIEW_FAILED');
    batch = { ...batch, previewHash: response.hash, preview: response };
    await persist(batch, handle);
    const snapshots = await historicalCreditSnapshot.list();
    return { ...response, batch, names: Object.fromEntries(snapshots.map((row) => [row.customerId, row.originalCustomer.name])) };
  },
  async authorizeAndImport({ licenseKey, reviewedHash }) {
    const handle = ownerHandle();
    let batch = await readBatch();
    if (!batch?.previewHash || batch.previewHash !== reviewedHash) throw new Error('HISTORICAL_REVIEW_REQUIRED');
    // Persist the exact pending request before network I/O. A lost response is unknown, never success.
    await persist({ ...batch, state: 'AUTHORIZATION_UNCERTAIN' }, handle);
    const approved = await rpc(licenseKey, 'authorize', batch, handle, true);
    if (!approved.authorization_id || approved.hash !== reviewedHash) throw new Error(approved.code || 'HISTORICAL_AUTHORIZATION_FAILED');
    batch = { ...batch, authorizationId: approved.authorization_id, state: approved.state };
    await persist(batch, handle);
    return this.resumeImport({ licenseKey });
  },
  async status({ licenseKey }) {
    const handle = ownerHandle();
    const batch = await readBatch();
    if (!batch) return { success: false, code: 'PENDING_AUTHORIZATION' };
    const response = await rpc(licenseKey, 'status', batch, handle);
    if (!response.authorization_id) throw new Error(response.code || 'PENDING_AUTHORIZATION');
    return (await recordResults(batch, response, handle)).response;
  },
  async resumeImport({ licenseKey }) {
    const handle = ownerHandle();
    let batch = await readBatch();
    if (!batch) throw new Error('PENDING_AUTHORIZATION');
    // Reconcile first, including a timeout after server commit or approval.
    const status = await rpc(licenseKey, 'status', batch, handle);
    if (!status.authorization_id) throw new Error(status.code || 'PENDING_AUTHORIZATION');
    batch = await recordResults(batch, status, handle);
    if (status.state === 'CONSUMED') return batch.response;
    if (['EXPIRED','SESSION_CHANGED','CONFLICT'].includes(status.state)) throw new Error(status.state);
    const response = await rpc(licenseKey, 'consume', batch, handle);
    if (!response.authorization_id) throw new Error(response.code || 'HISTORICAL_IMPORT_FAILED');
    return (await recordResults(batch, response, handle)).response;
  },
  async markLastChangeSeq(licenseKey, changeSeq) {
    if (licenseKey && Number(changeSeq) > 0) await syncMetaService.setMeta('customer_credit_last_change_seq', Number(changeSeq), { licenseKey });
  },
  async getLocalLedgerEntries(customerId = null) {
    if (!db.isOpen()) await db.open();
    return customerId ? db.table(STORES.CUSTOMER_LEDGER).where('customerId').equals(customerId).toArray() : db.table(STORES.CUSTOMER_LEDGER).toArray();
  },
  async getPreservedBalance(customerId) {
    const snapshot = (await historicalCreditSnapshot.list()).find((row) => row.customerId === customerId);
    return snapshot ? Money.toExactString(Money.divide(snapshot.amountCents, 100)) : null;
  }
};
export default customerCreditMigrationService;
