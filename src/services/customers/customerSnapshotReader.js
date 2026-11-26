import { actorRuntimeController } from '../auth/actorRuntimeController';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import { requireCloudSnapshotContract } from '../sync/cloudSyncProtocolV2';
import { customerCloudRepository } from './customerCloudRepository';

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export const assertCustomerReadContext = (licenseKey, actorHandle) => {
  actorHandle.assertCurrent('customers');
  if (!licenseKey || getLicenseKeyFromDetails(useAppStore.getState().licenseDetails) !== licenseKey) {
    fail('CUSTOMER_SNAPSHOT_CONTEXT_CHANGED');
  }
};

// V3 authenticates each page; the reference fixes membership, not MVCC row
// values. Never turn a deferred or changed frontier into evidence of absence.
export const validateCustomerSnapshotPage = (response, { limit, reference = null, cursor = null, rowsKey = 'customers' }) => {
  if (response?.success !== true) fail(response?.code || 'CUSTOMER_SNAPSHOT_FAILED');
  if (response.sync_deferred === true) fail('CUSTOMER_SNAPSHOT_DEFERRED');
  const nextReference = response.snapshot_reference_change_seq;
  const safe = response.safe_change_seq;
  const rows = response[rowsKey];
  const next = response.next_page_cursor;
  if (response.snapshot_contract !== 'keyset_reference_v1' || response.snapshot_contract_version !== 1
    || response.sync_deferred !== false || !Number.isSafeInteger(nextReference) || nextReference < 0
    || !Number.isSafeInteger(safe) || safe < nextReference || response.limit !== limit
    || typeof response.has_more !== 'boolean' || response.snapshot_complete !== !response.has_more
    || !Array.isArray(rows) || rows.length > limit
    || (response.has_more && rows.length !== limit)
    || rows.some(row => typeof row?.id !== 'string' || !row.id.trim())
    || new Set(rows.map(row => row.id)).size !== rows.length
    || (response.has_more ? (!next || typeof next !== 'object' || Array.isArray(next)
      || JSON.stringify(next) === JSON.stringify(cursor)) : next !== null)) {
    fail('CUSTOMER_SNAPSHOT_INCOMPLETE');
  }
  if (safe !== nextReference || (reference !== null && reference !== nextReference)) {
    fail('CUSTOMER_SNAPSHOT_CHANGED');
  }
  return { rows, reference: nextReference, next, complete: response.snapshot_complete };
};

// Positive exact-ID matches can stop after a validated page. A negative match
// requires the complete traversal including tombstones. No local apply/checkpoint.
export const readCloudCustomerById = async ({ licenseKey, customerId,
  actorHandle = actorRuntimeController.capture('customers'), assertContextCurrent = null }) => {
  if (!customerId) fail('CUSTOMER_ID_REQUIRED');
  const assertCurrent = () => {
    assertCustomerReadContext(licenseKey, actorHandle);
    assertContextCurrent?.();
    actorHandle.assertCurrent('customers');
  };
  assertCurrent();
  const snapshotProtocol = requireCloudSnapshotContract(
    await customerCloudRepository.negotiateSnapshotProtocol({ licenseKey, actorHandle })
  );
  assertCurrent();
  const seen = new Set();
  const cursors = new Set();
  let reference = null;
  let cursor = null;
  for (let page = 0; page < 10000; page += 1) {
    assertCurrent();
    const response = await customerCloudRepository.pullCustomerSnapshot({
      licenseKey, limit: 500, snapshotProtocol, snapshotReferenceChangeSeq: reference,
      pageCursor: cursor, actorHandle
    });
    assertCurrent();
    const parsed = validateCustomerSnapshotPage(response, { limit: 500, reference, cursor });
    for (const row of parsed.rows) {
      if (seen.has(row.id)) fail('CUSTOMER_SNAPSHOT_INCOMPLETE');
      seen.add(row.id);
    }
    if (parsed.next !== null) {
      const key = JSON.stringify(parsed.next);
      if (cursors.has(key)) fail('CUSTOMER_SNAPSHOT_INCOMPLETE');
      cursors.add(key);
    }
    const found = parsed.rows.find(row => row.id === String(customerId));
    if (found) return found;
    if (parsed.complete) return null;
    reference = parsed.reference;
    cursor = parsed.next;
  }
  fail('CUSTOMER_SNAPSHOT_INCOMPLETE');
};
