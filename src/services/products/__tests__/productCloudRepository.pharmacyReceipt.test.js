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

  it.each([
    ['tenant verification pending', 'ACTOR_TENANT_NOT_READY', 'tenant_verification_pending'],
    ['revoked session', 'ADMIN_SESSION_REVOKED', 'session_required'],
    ['obsolete actor context', 'ACTOR_CONTEXT_STALE', 'stale_actor']
  ])('preserves a matching successful RPC receipt when %s after dispatch', async (_caseName, code, authorityKind) => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        product: { id: 'product-qa', category_id: 'category-hygiene' },
        idempotency_key: 'product-edit-idempotency'
      },
      error: null
    });
    mocks.assertCurrent
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw Object.assign(new Error(code), { code }); });

    const response = await productCloudRepository.upsertProduct({
      licenseKey: 'CLOUD-LICENSE',
      product: { id: 'product-qa', category_id: 'category-hygiene' },
      idempotencyKey: 'product-edit-idempotency',
      actorHandle: { actorKey: 'admin:qa' }
    });

    expect(response).toMatchObject({
      success: true,
      clientLocalReconciliationPending: true,
      clientIdempotencyKey: 'product-edit-idempotency',
      clientAuthorityErrorCode: code,
      clientAuthorityErrorKind: authorityKind,
      product: { id: 'product-qa', category_id: 'category-hygiene' }
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.assertCurrent).toHaveBeenCalledTimes(2);
    expect(mocks.invalidate).toHaveBeenCalledWith('CLOUD-LICENSE');
  });

  it('does not claim a post-RPC write as confirmed when its receipt idempotency key differs', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        product: { id: 'product-qa', category_id: 'category-hygiene' },
        idempotency_key: 'another-operation'
      },
      error: null
    });
    mocks.assertCurrent
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('ACTOR_TENANT_NOT_READY'), { code: 'ACTOR_TENANT_NOT_READY' });
      });

    await expect(productCloudRepository.upsertProduct({
      licenseKey: 'CLOUD-LICENSE',
      product: { id: 'product-qa', category_id: 'category-hygiene' },
      idempotencyKey: 'product-edit-idempotency',
      actorHandle: { actorKey: 'admin:qa' }
    })).rejects.toMatchObject({ code: 'ACTOR_TENANT_NOT_READY' });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
