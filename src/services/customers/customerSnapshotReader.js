import { actorRuntimeController } from '../auth/actorRuntimeController';
import { requireCloudSnapshotContract } from '../sync/cloudSyncProtocolV2';
import { customerCloudRepository } from './customerCloudRepository';
import { assertCustomerReadContext, validateCustomerSnapshotPage } from './customerSnapshotPage';

export { assertCustomerReadContext } from './customerSnapshotPage';

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

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
