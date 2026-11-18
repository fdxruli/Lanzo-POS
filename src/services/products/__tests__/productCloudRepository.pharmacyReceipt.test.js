import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: { success: true }, error: null })),
  assertCurrent: vi.fn(),
  capture: vi.fn(() => ({ actorType: 'admin', actorKey: 'admin:receipt-test' })),
  buildContext: vi.fn(async () => ({
    licenseKey: 'CLOUD-LICENSE', deviceFingerprint: 'DEVICE-1', securityToken: 'SESSION-1', staffSessionToken: null
  })),
  invalidate: vi.fn()
}));

vi.mock('../../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }));
vi.mock('../../sync/posSyncClient', () => ({ buildPosSyncAuthContext: mocks.buildContext }));
vi.mock('../../auth/productInventoryAuthority', () => ({
  assertProductInventoryMutationCurrent: mocks.assertCurrent,
  captureProductInventoryMutation: mocks.capture,
  hasInitialProductStock: () => false
}));
vi.mock('../../cloud', () => ({
  CLOUD_REQUEST_COOLDOWN: {}, CLOUD_REQUEST_TAGS: {}, CLOUD_REQUEST_TTL: {},
  buildBaseRpcContextFromArgs: vi.fn(), buildRpcRequestKey: vi.fn(),
  cloudRequestManager: { request: vi.fn() }, cloudRequestTags: {},
  invalidateCloudCacheAfterCatalogMutation: mocks.invalidate
}));

import { productCloudRepository } from '../productCloudRepository';

describe('documented Cloud pharmacy receipt RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: { success: true }, error: null });
  });

  it('uses the pharmacy authority RPC and sends calendar expiry at UTC midnight', async () => {
    await productCloudRepository.addInventoryEntry({
      licenseKey: 'CLOUD-LICENSE', idempotencyKey: 'receipt-vi-1', cloudPharmacyReceipt: true,
      entry: {
        productId: 'medicine-vi', quantity: 10, baseQuantity: 10, inputUnit: 'pza', baseUnit: 'pza',
        supplier: 'Proveedor QA', manufacturerBatchId: 'VI-CLOUD-001', expiryDate: '2027-12-31',
        metadata: { pharmacyReceipt: { version: 1, documentReference: 'FAC-001', expiryDate: '2027-12-31' } }
      }
    });

    expect(mocks.rpc).toHaveBeenCalledWith('pos_receive_pharmacy_inventory_v1', expect.objectContaining({
      p_license_key: 'CLOUD-LICENSE', p_product_id: 'medicine-vi', p_quantity: 10,
      p_expiry_date: '2027-12-31T00:00:00.000Z', p_idempotency_key: 'receipt-vi-1'
    }));
    expect(mocks.assertCurrent).toHaveBeenCalledTimes(2);
  });
});
