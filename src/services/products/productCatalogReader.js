import { actorRuntimeController } from '../auth/actorRuntimeController';
import { requireCloudSnapshotContract } from '../sync/cloudSyncProtocolV2';

const collections = ['categories', 'products', 'batches'];
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

// A read-only keyset traversal. Never persist its cursor or apply projections.
// A stable membership reference is NOT an MVCC snapshot: reject observed
// frontier changes/deferred reads; writes still require server OCC and receipts.
export const readProductCatalog = async ({
  cloudRepository, licenseKey, actorHandle = null, assertContextCurrent = null,
  categoriesOnly = false
}) => {
  const handle = actorHandle?.assertCurrent ? actorHandle : actorRuntimeController.capture();
  const assertCurrent = async () => {
    handle.assertCurrent();
    await assertContextCurrent?.();
    handle.assertCurrent();
  };
  await assertCurrent();
  const snapshotProtocol = requireCloudSnapshotContract(
    await cloudRepository.negotiateSnapshotProtocol({ licenseKey, actorHandle: handle })
  );
  await assertCurrent();
  const result = { categories: [], products: [], batches: [], snapshotReferenceChangeSeq: null };
  const seen = collections.map(() => new Set());
  const cursors = new Set();
  let pageCursor = null;
  let lastRank = 0;
  for (let page = 0; page < 10000; page += 1) {
    await assertCurrent();
    const response = await cloudRepository.pullCatalogSnapshot({
      licenseKey, limit: 500, snapshotProtocol,
      snapshotReferenceChangeSeq: result.snapshotReferenceChangeSeq,
      pageCursor, actorHandle: handle
    });
    await assertCurrent();
    if (response?.success !== true) fail(response?.code || 'PRODUCT_RECOVERY_CLOUD_READ_FAILED');
    if (response.sync_deferred === true) fail('PRODUCT_RECOVERY_CLOUD_READ_DEFERRED');
    const reference = response.snapshot_reference_change_seq;
    const safe = response.safe_change_seq;
    if (response.snapshot_contract !== 'keyset_reference_v1'
      || response.snapshot_contract_version !== 1 || response.sync_deferred !== false
      || !Number.isSafeInteger(reference) || reference < 0
      || !Number.isSafeInteger(safe) || safe < reference
      || typeof response.has_more !== 'boolean'
      || response.snapshot_complete !== !response.has_more
      || response.limit !== 500
      || collections.some((key) => !Array.isArray(response[key]))) {
      fail('PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE');
    }
    if (safe !== reference || (result.snapshotReferenceChangeSeq !== null
      && reference !== result.snapshotReferenceChangeSeq)) fail('PRODUCT_RECOVERY_CLOUD_SNAPSHOT_CHANGED');
    result.snapshotReferenceChangeSeq = reference;
    let count = 0;
    for (const [rank, key] of collections.entries()) {
      for (const row of response[key]) {
        if (!row || typeof row.id !== 'string' || !row.id.trim()
          || seen[rank].has(row.id) || rank < lastRank) fail('PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE');
        lastRank = rank;
        seen[rank].add(row.id);
        result[key].push(row);
        count += 1;
      }
    }
    const next = response.next_page_cursor;
    if (count > 500 || (response.has_more && count !== 500)
      || (response.has_more ? (!next || typeof next !== 'object' || Array.isArray(next)) : next !== null)) {
      fail('PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE');
    }
    if (response.has_more) {
      const key = JSON.stringify(next);
      if (cursors.has(key)) fail('PRODUCT_RECOVERY_CLOUD_PAGINATION_STALLED');
      cursors.add(key);
    }
    // SQL ranks all categories before products and batches. Seeing a later
    // partition proves completion of the category partition, not the catalog.
    if (!response.has_more || (categoriesOnly && lastRank > 0)) return result;
    pageCursor = next;
  }
  fail('PRODUCT_RECOVERY_CLOUD_PAGINATION_STALLED');
};
