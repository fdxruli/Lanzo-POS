import { describe, expect, it, vi } from 'vitest';
import { readProductCatalog } from '../productCatalogReader';

const snapshotPage = (rows = {}) => ({
  success: true, snapshot_contract: 'keyset_reference_v1', snapshot_contract_version: 1,
  snapshot_reference_change_seq: 8, safe_change_seq: 8, sync_deferred: false,
  categories: [], products: [], batches: [], limit: 500,
  has_more: false, snapshot_complete: true, next_page_cursor: null, ...rows
});

const row = (id) => ({ id });
const categories = Array.from({ length: 498 }, (_, i) => row('category-' + String(i).padStart(3, '0')));
const cursor = { position_rank: 2, position_id: 'p2', opaque: 'server-issued' };
const first = snapshotPage({ categories, products: [row('p1'), row('p2')], has_more: true,
  snapshot_complete: false, next_page_cursor: cursor });
const second = snapshotPage({ products: [row('p3')], batches: [row('b1'), row('b2')] });
const harness = (...pages) => {
  const actorHandle = { assertCurrent: vi.fn() };
  const cloudRepository = {
    negotiateSnapshotProtocol: vi.fn(async () => ({ supported: true })),
    pullCatalogSnapshot: vi.fn()
  };
  for (const response of pages) cloudRepository.pullCatalogSnapshot.mockResolvedValueOnce(response);
  return { actorHandle, cloudRepository, licenseKey: 'tenant-a' };
};

describe('read-only product catalog keyset reader', () => {
  it('reads 503 records across partitions with one stable reference and opaque cursor', async () => {
    const args = harness(first, second);
    const result = await readProductCatalog(args);
    expect(result.categories).toHaveLength(498);
    expect(result.products.map(x => x.id)).toEqual(['p1','p2','p3']);
    expect(result.batches).toHaveLength(2);
    expect(args.cloudRepository.pullCatalogSnapshot.mock.calls.map(([p]) =>
      [p.snapshotReferenceChangeSeq, p.pageCursor, p.licenseKey])).toEqual([[null,null,'tenant-a'],[8,cursor,'tenant-a']]);
    expect(args.cloudRepository.negotiateSnapshotProtocol).toHaveBeenCalledOnce();
  });
  it('stops a category-only query at the next rank rather than reading all inventory', async () => {
    const args = harness(first);
    expect((await readProductCatalog({ ...args, categoriesOnly: true })).categories).toHaveLength(498);
    expect(args.cloudRepository.pullCatalogSnapshot).toHaveBeenCalledOnce();
  });
  it.each([
    [{ ...second, snapshot_complete: false }, 'PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE'],
    [{ ...second, batches: undefined }, 'PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE'],
    [{ ...second, sync_deferred: true }, 'PRODUCT_RECOVERY_CLOUD_READ_DEFERRED'],
    [{ ...second, safe_change_seq: 9 }, 'PRODUCT_RECOVERY_CLOUD_SNAPSHOT_CHANGED'],
    [{ ...second, snapshot_reference_change_seq: 9, safe_change_seq: 9 }, 'PRODUCT_RECOVERY_CLOUD_SNAPSHOT_CHANGED'],
    [{ ...second, products: [row('p2')] }, 'PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE'],
    [first, 'PRODUCT_RECOVERY_CLOUD_RESPONSE_INCOMPLETE']
  ])('rejects unsafe continuation %#', async (response, code) => {
    await expect(readProductCatalog(harness(first, response))).rejects.toMatchObject({ code });
  });
  it('rejects a changed actor after a page response', async () => {
    const args = harness(first);
    let stale = false;
    args.actorHandle.assertCurrent.mockImplementation(() => { if (stale) throw new Error('ACTOR_CONTEXT_STALE'); });
    args.cloudRepository.pullCatalogSnapshot.mockReset().mockImplementationOnce(async () => { stale = true; return first; });
    await expect(readProductCatalog(args)).rejects.toThrow('ACTOR_CONTEXT_STALE');
    expect(args.cloudRepository.pullCatalogSnapshot).toHaveBeenCalledOnce();
  });
  it('fails closed without a supported protocol', async () => {
    const args = harness(first);
    args.cloudRepository.negotiateSnapshotProtocol.mockResolvedValueOnce({ supported: false });
    await expect(readProductCatalog(args)).rejects.toThrow('CLOUD_SNAPSHOT_CONTRACT_UNAVAILABLE');
    expect(args.cloudRepository.pullCatalogSnapshot).not.toHaveBeenCalled();
  });
});
