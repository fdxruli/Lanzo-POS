import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullCatalogSnapshot: vi.fn(),
  getCategoryById: vi.fn(),
  getOperation: vi.fn(),
  markSynced: vi.fn(),
  assertOperationActorCurrent: vi.fn(),
  upsertCategory: vi.fn(),
  applyCloudCategory: vi.fn()
}));

vi.mock('../productCloudRepository', () => ({
  productCloudRepository: {
    pullCatalogSnapshot: mocks.pullCatalogSnapshot,
    upsertCategory: mocks.upsertCategory
  }
}));
vi.mock('../productLocalRepository', () => ({
  productLocalRepository: {
    getCategoryById: mocks.getCategoryById,
    applyCloudCategory: mocks.applyCloudCategory
  }
}));
vi.mock('../../sync/syncOutboxService', () => ({
  syncOutboxService: { getOperation: mocks.getOperation, markSynced: mocks.markSynced }
}));
vi.mock('../../auth/productInventoryAuthority', () => ({
  assertProductInventoryOperationActorCurrent: mocks.assertOperationActorCurrent
}));

import { ensureCloudProductCategory, getProductCloudConfirmationError } from '../productCategoryCloudGate';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pullCatalogSnapshot.mockResolvedValue({
    success: true,
    categories: [],
    has_more: false
  });
  mocks.getCategoryById.mockResolvedValue(null);
  mocks.getOperation.mockResolvedValue(null);
  mocks.markSynced.mockResolvedValue(undefined);
  mocks.assertOperationActorCurrent.mockReturnValue(undefined);
  mocks.upsertCategory.mockResolvedValue({ success: true, category: { id: 'cat-qa', is_active: true } });
  mocks.applyCloudCategory.mockResolvedValue({ id: 'cat-qa' });
});

describe('product category Cloud gate', () => {
  it('accepts only a category found in the active tenant catalog', async () => {
    const category = { id: 'cat-qa', is_active: true };
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({ success: true, categories: [category], has_more: false });

    await expect(ensureCloudProductCategory({ licenseKey: 'qa-license', categoryId: 'cat-qa' }))
      .resolves.toEqual({ success: true, category });
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'qa-license', entityType: 'categories', force: true, includeDeleted: true
    }));
    expect(mocks.getCategoryById).not.toHaveBeenCalled();
  });

  it('confirms an exact pending category operation for the same tenant before product save', async () => {
    const category = { id: 'cat-qa', is_active: true, name: 'Generales QA' };
    const operation = {
      id: 'category-operation',
      idempotencyKey: 'category-operation',
      licenseKey: 'qa-license',
      entityType: 'category',
      operation: 'upsert',
      entityId: 'cat-qa',
      status: 'pending',
      payload: { category, expectedVersion: null }
    };
    mocks.getCategoryById.mockResolvedValueOnce({
      ...category,
      syncStatus: 'pending',
      pendingOperationId: 'category-operation'
    });
    mocks.getOperation.mockResolvedValueOnce(operation);

    await expect(ensureCloudProductCategory({
      licenseKey: 'qa-license', categoryId: 'cat-qa', actorHandle: { actorId: 'staff-1' }
    })).resolves.toMatchObject({ success: true, category: { id: 'cat-qa' } });

    expect(mocks.getOperation).toHaveBeenCalledWith('category-operation', { licenseKey: 'qa-license' });
    expect(mocks.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'qa-license', category, idempotencyKey: 'category-operation', actorHandle: { actorId: 'staff-1' }
    }));
    expect(mocks.applyCloudCategory).toHaveBeenCalledWith({ id: 'cat-qa', is_active: true });
    expect(mocks.markSynced).toHaveBeenCalledWith('category-operation', expect.objectContaining({ success: true }), {
      licenseKey: 'qa-license'
    });
  });

  it('rejects an unconfirmed local category without a same-tenant pending operation', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({ id: 'cat-stale', name: 'Stale', syncStatus: 'synced', serverVersion: 2 });

    await expect(ensureCloudProductCategory({ licenseKey: 'qa-license', categoryId: 'cat-stale' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_NOT_AVAILABLE' });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('does not replay a pending category operation that cannot be read in the active tenant', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({
      id: 'cat-other', name: 'Otra tienda', isActive: true, syncStatus: 'pending', pendingOperationId: 'other-tenant-operation'
    });
    mocks.getOperation.mockRejectedValueOnce(new Error('OUTBOX_TENANT_MISMATCH'));

    await expect(ensureCloudProductCategory({ licenseKey: 'qa-license', categoryId: 'cat-other' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_NOT_AVAILABLE' });
    expect(mocks.getOperation).toHaveBeenCalledWith('other-tenant-operation', { licenseKey: 'qa-license' });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('checks the original Staff actor before replaying a pending category write', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({
      id: 'cat-qa', name: 'Generales QA', isActive: true, syncStatus: 'pending', pendingOperationId: 'category-operation'
    });
    mocks.getOperation.mockResolvedValueOnce({
      id: 'category-operation', licenseKey: 'qa-license', actorSensitivity: 'actor_bound',
      entityType: 'category', operation: 'upsert', entityId: 'cat-qa', status: 'pending',
      payload: { category: { id: 'cat-qa', name: 'Generales QA', is_active: true } }
    });
    mocks.assertOperationActorCurrent.mockImplementationOnce(() => {
      throw Object.assign(new Error('ACTOR_PERMISSION_DENIED'), { code: 'ACTOR_PERMISSION_DENIED' });
    });

    await expect(ensureCloudProductCategory({ licenseKey: 'qa-license', categoryId: 'cat-qa' }))
      .rejects.toMatchObject({ code: 'ACTOR_PERMISSION_DENIED' });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('does not treat a partial product receipt as category confirmation', () => {
    expect(getProductCloudConfirmationError(
      { success: true, product: { id: 'product-1', price: 12 } },
      { id: 'product-1', category_id: 'cat-qa' }
    )).toMatchObject({ code: 'PRODUCT_CATEGORY_CONFIRMATION_MISSING' });
  });

  it('rejects a receipt that returned a different category than the submitted selection', () => {
    expect(getProductCloudConfirmationError(
      { success: true, product: { id: 'product-1', category_id: null } },
      { id: 'product-1', category_id: 'cat-qa' }
    )).toMatchObject({ code: 'PRODUCT_CATEGORY_NOT_CONFIRMED' });
  });
});
