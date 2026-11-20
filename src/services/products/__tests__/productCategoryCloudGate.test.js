import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullCatalogSnapshot: vi.fn(),
  getCategoryById: vi.fn(),
  getDeletedCategoryById: vi.fn(),
  getOperation: vi.fn(),
  listOperationsForEntity: vi.fn(),
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
    getDeletedCategoryById: mocks.getDeletedCategoryById,
    applyCloudCategory: mocks.applyCloudCategory
  }
}));
vi.mock('../../sync/syncOutboxService', () => ({
  syncOutboxService: {
    getOperation: mocks.getOperation,
    listOperationsForEntity: mocks.listOperationsForEntity,
    markSynced: mocks.markSynced
  }
}));
vi.mock('../../auth/productInventoryAuthority', () => ({
  assertProductInventoryOperationActorCurrent: mocks.assertOperationActorCurrent
}));

import {
  ensureCloudProductCategory,
  getProductCloudConfirmationError,
  recoverLocalCategoryInCloud
} from '../productCategoryCloudGate';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pullCatalogSnapshot.mockResolvedValue({
    success: true,
    categories: [],
    has_more: false
  });
  mocks.getCategoryById.mockResolvedValue(null);
  mocks.getDeletedCategoryById.mockResolvedValue(null);
  mocks.getOperation.mockResolvedValue(null);
  mocks.listOperationsForEntity.mockResolvedValue([]);
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
    mocks.listOperationsForEntity.mockResolvedValueOnce([operation]);

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

  it('offers explicit recovery for an active local category with no outbox operation', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({ id: 'cat-stale', name: 'Stale', syncStatus: 'synced', serverVersion: 2 });

    await expect(ensureCloudProductCategory({ licenseKey: 'qa-license', categoryId: 'cat-stale' }))
      .rejects.toMatchObject({
        code: 'PRODUCT_CATEGORY_RECOVERY_REQUIRED',
        category: { id: 'cat-stale', name: 'Stale' }
      });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('does not offer recovery when the category outbox cannot be verified for the active tenant', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({
      id: 'cat-other', name: 'Otra tienda', isActive: true, syncStatus: 'pending', pendingOperationId: 'other-tenant-operation'
    });
    mocks.listOperationsForEntity.mockRejectedValueOnce(Object.assign(new Error('OUTBOX_TENANT_MISMATCH'), { code: 'OUTBOX_TENANT_MISMATCH' }));

    await expect(ensureCloudProductCategory({ licenseKey: 'qa-license', categoryId: 'cat-other' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_TENANT_UNVERIFIED' });
    expect(mocks.getOperation).not.toHaveBeenCalled();
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
    mocks.listOperationsForEntity.mockResolvedValueOnce([{
      id: 'category-operation', entityType: 'category', operation: 'upsert', entityId: 'cat-qa', status: 'pending'
    }]);
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

  it('recovers an inherited local category with its original ID and a create-only idempotency identity', async () => {
    const localCategory = {
      id: 'cat-legacy', name: 'Generales QA', color: '#123456', sortOrder: 4,
      isActive: true, createdAt: '2025-01-01T00:00:00.000Z'
    };
    mocks.getCategoryById.mockResolvedValueOnce(localCategory);
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({ success: true, categories: [], has_more: false });
    mocks.upsertCategory.mockImplementationOnce(async ({ category, idempotencyKey }) => ({
      success: true,
      category: { ...category, is_active: true, server_version: 1 },
      idempotency_key: idempotencyKey
    }));

    await expect(recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-legacy' }))
      .resolves.toMatchObject({ id: 'cat-legacy', name: 'Generales QA', is_active: true });

    expect(mocks.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'qa-license',
      category: expect.objectContaining({ id: 'cat-legacy', name: 'Generales QA', is_active: true }),
      expectedVersion: 0,
      idempotencyKey: 'product:category:recovery:cat-legacy'
    }));
    expect(mocks.applyCloudCategory).toHaveBeenCalledWith(expect.objectContaining({ id: 'cat-legacy' }));
  });

  it('never restores an ID that Cloud returns as deleted, including through explicit recovery', async () => {
    mocks.getCategoryById.mockResolvedValue({ id: 'cat-deleted', name: 'Medicamentos QA', isActive: true });
    mocks.pullCatalogSnapshot.mockResolvedValue({
      success: true,
      categories: [{ id: 'cat-deleted', name: 'Medicamentos QA', is_active: false, deleted_at: '2026-01-01T00:00:00Z' }],
      has_more: false
    });

    await expect(ensureCloudProductCategory({ licenseKey: 'qa-license', categoryId: 'cat-deleted' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_NOT_AVAILABLE' });
    await expect(recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-deleted' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_CLOUD_DELETED' });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('rejects a local category carrying a different tenant identity', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({
      id: 'cat-other', name: 'Otra tienda', isActive: true, licenseKey: 'other-license'
    });

    await expect(recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-other' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_TENANT_MISMATCH' });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('rejects local deletion evidence before any Cloud write', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({ id: 'cat-local-deleted', name: 'Higiene QA', isActive: true });
    mocks.getDeletedCategoryById.mockResolvedValueOnce({ id: 'cat-local-deleted', deletionPending: true });

    await expect(recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-local-deleted' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_LOCAL_DELETED' });
    expect(mocks.pullCatalogSnapshot).not.toHaveBeenCalled();
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('rejects an unresolved category delete in the outbox before recovery', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({ id: 'cat-delete-pending', name: 'Higiene QA', isActive: true });
    mocks.listOperationsForEntity.mockResolvedValueOnce([{
      id: 'delete-op', entityType: 'category', operation: 'delete',
      entityId: 'cat-delete-pending', status: 'pending'
    }]);

    await expect(recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-delete-pending' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_DELETE_PENDING' });
    expect(mocks.pullCatalogSnapshot).not.toHaveBeenCalled();
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('rejects another Cloud category with the same normalized name', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({ id: 'cat-local', name: ' Generales QA ', isActive: true });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({
      success: true,
      categories: [{ id: 'cat-cloud', name: 'generales   qa', is_active: true }],
      has_more: false
    });

    await expect(recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-local' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_CLOUD_DUPLICATE' });
    expect(mocks.upsertCategory).not.toHaveBeenCalled();
  });

  it('uses the same recovery key across two tabs so Cloud stores one original category', async () => {
    const localCategory = { id: 'cat-concurrent', name: 'Generales QA', isActive: true };
    const cloudCategories = [];
    mocks.getCategoryById.mockResolvedValue(localCategory);
    mocks.pullCatalogSnapshot.mockImplementation(async () => ({
      success: true, categories: [...cloudCategories], has_more: false
    }));
    mocks.upsertCategory.mockImplementation(async ({ category, idempotencyKey }) => {
      let confirmed = cloudCategories.find((item) => item.id === category.id);
      if (!confirmed) {
        confirmed = { ...category, is_active: true, server_version: 1 };
        cloudCategories.push(confirmed);
      }
      return { success: true, category: confirmed, idempotency_key: idempotencyKey };
    });

    const results = await Promise.all([
      recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-concurrent' }),
      recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-concurrent' })
    ]);

    expect(results).toHaveLength(2);
    expect(cloudCategories).toHaveLength(1);
    expect(mocks.upsertCategory).toHaveBeenCalled();
    expect(mocks.upsertCategory.mock.calls.every(([args]) => (
      args.idempotencyKey === 'product:category:recovery:cat-concurrent'
    ))).toBe(true);
  });

  it('checks Cloud after a timeout before retrying the same recovery identity', async () => {
    const localCategory = { id: 'cat-timeout', name: 'Higiene QA', isActive: true };
    let cloudCategory = null;
    mocks.getCategoryById.mockResolvedValueOnce(localCategory);
    mocks.pullCatalogSnapshot.mockImplementation(async () => ({
      success: true, categories: cloudCategory ? [cloudCategory] : [], has_more: false
    }));
    mocks.upsertCategory.mockImplementationOnce(async ({ category }) => {
      cloudCategory = { ...category, is_active: true, server_version: 1 };
      const error = new Error('network timeout after commit');
      error.code = '57014';
      throw error;
    });

    await expect(recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-timeout' }))
      .resolves.toMatchObject({ id: 'cat-timeout', name: 'Higiene QA' });

    expect(mocks.upsertCategory).toHaveBeenCalledOnce();
    expect(mocks.pullCatalogSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.applyCloudCategory).toHaveBeenCalledWith(expect.objectContaining({ id: 'cat-timeout' }));
  });

  it('does not apply a successful-looking response with a different category ID or recovery receipt', async () => {
    mocks.getCategoryById.mockResolvedValueOnce({ id: 'cat-original', name: 'Generales QA', isActive: true });
    mocks.pullCatalogSnapshot.mockResolvedValueOnce({ success: true, categories: [], has_more: false });
    mocks.upsertCategory.mockResolvedValueOnce({
      success: true,
      category: { id: null, name: 'Generales QA', is_active: true },
      idempotency_key: 'another-operation'
    });

    await expect(recoverLocalCategoryInCloud({ licenseKey: 'qa-license', categoryId: 'cat-original' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CATEGORY_RECOVERY_NOT_CONFIRMED' });
    expect(mocks.applyCloudCategory).not.toHaveBeenCalled();
  });
});
