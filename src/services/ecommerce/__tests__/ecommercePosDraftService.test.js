import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appState: null,
  productState: { menu: [] },
  activeState: null,
  getOrder: vi.fn(),
  claim: vi.fn(),
  confirm: vi.fn(),
  release: vi.fn(),
  upsert: vi.fn(),
  switchOrder: vi.fn(),
  updateStatus: vi.fn(),
  updateOrder: vi.fn(),
  removeLocal: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => mocks.appState }
}));

vi.mock('../../../store/useProductStore', () => ({
  useProductStore: { getState: () => mocks.productState }
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: { getState: () => mocks.activeState }
}));

vi.mock('../ecommerceOrderService', () => ({
  getEcommerceOrder: mocks.getOrder,
  claimEcommerceOrderPosDraft: mocks.claim,
  confirmEcommerceOrderPosDraft: mocks.confirm,
  releaseEcommerceOrderPosDraft: mocks.release
}));

import {
  getEcommercePosContextIdentity,
  getEcommercePosDraftId,
  mapEcommerceOrderToPosDraft,
  prepareEcommerceOrderPosDraft,
  retryReleaseEcommerceDraft
} from '../ecommercePosDraftService';

const orderId = '97910ac6-3f21-4d7c-97d8-e829d0a141a7';
const draftId = `ecom-${orderId}`;

const baseOrder = (posDraft = {}) => ({
  id: orderId,
  code: 'EC-00000012',
  status: 'accepted',
  fulfillmentMethod: 'delivery',
  customer: { name: 'PII', phone: '9610000000', address: 'Privada', notes: 'Privadas' },
  totals: { subtotal: 50, deliveryFee: 10, discountTotal: 0, taxTotal: 0, total: 60, currency: 'MXN' },
  items: [{
    id: 'order-item-1',
    sourceProductId: 'product-1',
    publishedProductId: 'published-1',
    productName: 'Nombre aceptado',
    unitPrice: 25,
    quantity: 2,
    options: { salsa: 'BBQ' }
  }],
  posDraft: {
    status: 'none',
    draftId: null,
    claimToken: null,
    isClaimedByCurrentActor: false,
    ...posDraft
  }
});

const localProduct = () => ({
  id: 'product-1',
  name: 'Nombre POS actual',
  price: 30,
  isActive: true,
  saleType: 'unit',
  batchManagement: { enabled: true }
});

const localDraft = ({ token = 'opaque-claim', status = 'prepared', id = draftId } = {}) => ({
  id,
  items: [{ id: 'product-1', name: 'Nombre POS actual', quantity: 2, price: 25 }],
  origin: 'ecommerce',
  ecommerceOrderId: orderId,
  ecommerceOrderCode: 'EC-00000012',
  ecommerceLicenseIdentity: getEcommercePosContextIdentity(mocks.appState),
  ecommerceClaimToken: token,
  ecommerceDraftStatus: status
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = {
    licenseDetails: { license_key: 'license-secret' },
    currentDeviceRole: 'staff',
    currentStaffUser: { id: 'staff-1', permissions: { ecommerce: true, pos: true } }
  };
  mocks.productState = { menu: [localProduct()] };
  mocks.activeState = {
    activeOrders: new Map(),
    upsertEcommerceDraft: mocks.upsert,
    switchOrder: mocks.switchOrder,
    updateEcommerceDraftStatus: mocks.updateStatus,
    updateOrder: mocks.updateOrder,
    removeEcommerceDraftLocal: mocks.removeLocal
  };
  mocks.removeLocal.mockImplementation((id) => {
    mocks.activeState.activeOrders.delete(id);
    return { success: true };
  });
  mocks.updateOrder.mockImplementation((id, updates) => {
    const current = mocks.activeState.activeOrders.get(id);
    if (current) mocks.activeState.activeOrders.set(id, { ...current, ...updates });
  });
  mocks.updateStatus.mockImplementation((id, status) => {
    const current = mocks.activeState.activeOrders.get(id);
    if (current) mocks.activeState.activeOrders.set(id, { ...current, ecommerceDraftStatus: status });
    return true;
  });
  mocks.upsert.mockImplementation((draft) => {
    const created = !mocks.activeState.activeOrders.has(draft.id);
    mocks.activeState.activeOrders.set(draft.id, draft);
    return { success: true, created, order: draft };
  });
  mocks.getOrder.mockResolvedValue({ success: true, order: baseOrder() });
  mocks.claim.mockImplementation(async () => ({
    success: true,
    changed: true,
    order: baseOrder({ status: 'claimed', claimToken: 'opaque-claim', isClaimedByCurrentActor: true })
  }));
  mocks.confirm.mockResolvedValue({
    success: true,
    changed: true,
    order: { fulfillment: { internalStatus: 'preparing', status: 'preparing', version: 2 } }
  });
  mocks.release.mockResolvedValue({ success: true, changed: true });
});

describe('ecommercePosDraftService', () => {
  it('maps the server-resolved sourceProductId while excluding customer PII from the draft', () => {
    const result = mapEcommerceOrderToPosDraft({
      order: baseOrder(),
      products: [localProduct()],
      licenseIdentity: 'context-1',
      claimToken: 'opaque-claim'
    });

    expect(result.success).toBe(true);
    expect(result.draft.id).toBe(draftId);
    expect(result.draft.items[0]).toMatchObject({
      id: 'product-1',
      name: 'Nombre POS actual',
      price: 25,
      currentPosPrice: 30,
      ecommerceSnapshotName: 'Nombre aceptado',
      ecommerceOptions: { salsa: 'BBQ' },
      priceSource: 'ecommerce_snapshot',
      needsInventoryResolution: true
    });
    expect(baseOrder().items[0].publishedProductId).toBe('published-1');
    const persisted = JSON.stringify(result.draft);
    expect(persisted).not.toContain('9610000000');
    expect(persisted).not.toContain('Privada');
    expect(persisted).not.toContain('Privadas');
    expect(persisted).not.toContain('PII');
  });

  it('fails atomically and reports every missing or inactive product', () => {
    const order = baseOrder();
    order.items.push({ ...order.items[0], id: 'order-item-2', sourceProductId: 'product-2', productName: 'Faltante' });
    const result = mapEcommerceOrderToPosDraft({
      order,
      products: [{ ...localProduct(), isActive: false }],
      licenseIdentity: 'context-1',
      claimToken: 'opaque-claim'
    });

    expect(result).toMatchObject({ success: false, code: 'ECOMMERCE_POS_DRAFT_PRODUCT_MISSING' });
    expect(result.missingProducts.map((item) => item.productName)).toEqual(['Nombre aceptado', 'Faltante']);
    expect(result).not.toHaveProperty('draft');
  });

  it('reads remote state once and creates one deterministic draft for a double click', async () => {
    let resolveRemote;
    mocks.getOrder.mockReturnValue(new Promise((resolve) => { resolveRemote = resolve; }));

    const first = prepareEcommerceOrderPosDraft({ order: baseOrder() });
    const second = prepareEcommerceOrderPosDraft({ order: baseOrder() });
    expect(mocks.getOrder).toHaveBeenCalledTimes(1);

    resolveRemote({ success: true, order: baseOrder() });
    await Promise.all([first, second]);

    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: 'opaque-claim',
      draftId
    }));
    expect(mocks.activeState.activeOrders.get(draftId)).toMatchObject({
      ecommerceDraftStatus: 'prepared',
      ecommerceOperationalStatus: 'preparing'
    });
  });

  it('opens an existing local draft only when remote prepared identity matches completely', async () => {
    const existing = localDraft();
    mocks.activeState.activeOrders.set(draftId, existing);
    mocks.getOrder.mockResolvedValue({
      success: true,
      order: baseOrder({
        status: 'prepared',
        draftId,
        claimToken: 'opaque-claim',
        isClaimedByCurrentActor: true
      })
    });

    const result = await prepareEcommerceOrderPosDraft({ order: baseOrder() });

    expect(result).toMatchObject({ success: true, created: false, draftId });
    expect(mocks.switchOrder).toHaveBeenCalledWith(draftId);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('invalidates a released local copy, claims again and confirms with a new token', async () => {
    mocks.activeState.activeOrders.set(draftId, localDraft({ token: 'old-token' }));
    mocks.getOrder.mockResolvedValue({ success: true, order: baseOrder({ status: 'released' }) });
    mocks.claim.mockResolvedValue({
      success: true,
      order: baseOrder({ status: 'claimed', claimToken: 'new-token', isClaimedByCurrentActor: true })
    });

    const result = await prepareEcommerceOrderPosDraft({ order: baseOrder() });

    expect(result.success).toBe(true);
    expect(mocks.removeLocal).toHaveBeenCalledWith(draftId);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ claimToken: 'new-token', draftId }));
  });

  it.each([
    ['claimed', 'ECOMMERCE_POS_DRAFT_IN_PROGRESS'],
    ['prepared', 'ECOMMERCE_POS_DRAFT_ALREADY_PREPARED']
  ])('does not open or claim a local copy when remote is %s by another device', async (status, code) => {
    mocks.activeState.activeOrders.set(draftId, localDraft({ token: 'old-token' }));
    mocks.getOrder.mockResolvedValue({
      success: true,
      order: baseOrder({ status, draftId: status === 'prepared' ? draftId : null, isClaimedByCurrentActor: false, claimToken: null })
    });

    const result = await prepareEcommerceOrderPosDraft({ order: baseOrder() });

    expect(result).toMatchObject({ success: false, code });
    expect(mocks.removeLocal).toHaveBeenCalledWith(draftId);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.switchOrder).not.toHaveBeenCalled();
  });

  it('does not reuse a local draft when the remote token changed', async () => {
    mocks.activeState.activeOrders.set(draftId, localDraft({ token: 'old-token' }));
    mocks.getOrder.mockResolvedValue({
      success: true,
      order: baseOrder({ status: 'prepared', draftId, claimToken: 'new-token', isClaimedByCurrentActor: true })
    });

    const result = await prepareEcommerceOrderPosDraft({ order: baseOrder() });

    expect(result.success).toBe(true);
    expect(mocks.removeLocal).toHaveBeenCalledWith(draftId);
    expect(mocks.switchOrder).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ ecommerceClaimToken: 'new-token' }));
  });

  it('fails closed when the remote prepared draftId differs from the deterministic local id', async () => {
    mocks.activeState.activeOrders.set(draftId, localDraft());
    mocks.getOrder.mockResolvedValue({
      success: true,
      order: baseOrder({ status: 'prepared', draftId: 'another-draft', claimToken: 'opaque-claim', isClaimedByCurrentActor: true })
    });

    const result = await prepareEcommerceOrderPosDraft({ order: baseOrder() });

    expect(result).toMatchObject({ success: false, code: 'ECOMMERCE_POS_DRAFT_REMOTE_CONFLICT' });
    expect(mocks.removeLocal).toHaveBeenCalledWith(draftId);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('removes the local copy when the order is no longer accepted', async () => {
    mocks.activeState.activeOrders.set(draftId, localDraft());
    mocks.getOrder.mockResolvedValue({ success: true, order: { ...baseOrder(), status: 'rejected' } });

    const result = await prepareEcommerceOrderPosDraft({ order: baseOrder() });

    expect(result).toMatchObject({ success: false, code: 'ECOMMERCE_ORDER_INVALID_TRANSITION' });
    expect(mocks.removeLocal).toHaveBeenCalledWith(draftId);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('releases the claim and never writes a partial draft when a product is missing', async () => {
    mocks.productState.menu = [];
    const result = await prepareEcommerceOrderPosDraft({ order: baseOrder() });

    expect(result.code).toBe('ECOMMERCE_POS_DRAFT_PRODUCT_MISSING');
    expect(mocks.release).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      claimToken: 'opaque-claim',
      reason: 'product_missing'
    }));
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('keeps confirm plus release failure recoverable and fail-closed', async () => {
    mocks.confirm.mockResolvedValue({ success: false, code: 'CONFIRM_FAILED' });
    mocks.release.mockResolvedValueOnce({ success: false, code: 'RELEASE_FAILED' });

    const result = await prepareEcommerceOrderPosDraft({ order: baseOrder() });
    const stored = mocks.activeState.activeOrders.get(draftId);

    expect(result).toMatchObject({ success: false, code: 'CONFIRM_FAILED', releaseRecoveryRequired: true });
    expect(stored).toMatchObject({
      origin: 'ecommerce',
      ecommerceDraftStatus: 'error_releasing',
      ecommerceClaimToken: 'opaque-claim',
      ecommerceReleaseRecoveryRequired: true
    });
    expect(mocks.removeLocal).not.toHaveBeenCalled();

    mocks.release.mockResolvedValueOnce({ success: true });
    const retried = await retryReleaseEcommerceDraft({ orderId, draftId });
    expect(retried.success).toBe(true);
    expect(mocks.release).toHaveBeenLastCalledWith(expect.objectContaining({
      orderId,
      claimToken: 'opaque-claim',
      reason: 'retry_release'
    }));
    expect(mocks.removeLocal).toHaveBeenCalledWith(draftId);
  });

  it('does not create a draft when the remote detail arrives after logout', async () => {
    let resolveRemote;
    mocks.getOrder.mockReturnValue(new Promise((resolve) => { resolveRemote = resolve; }));
    const pending = prepareEcommerceOrderPosDraft({ order: baseOrder() });
    mocks.appState = { licenseDetails: null, currentDeviceRole: null, currentStaffUser: null };

    resolveRemote({ success: true, order: baseOrder() });
    const result = await pending;

    expect(result.stale).toBe(true);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('changes context identity when license, staff or POS permission changes', () => {
    const initial = getEcommercePosContextIdentity(mocks.appState);
    expect(initial).toMatch(/^ecomctx-/);
    expect(initial).not.toContain('license-secret');

    const otherStaff = getEcommercePosContextIdentity({
      ...mocks.appState,
      currentStaffUser: { id: 'staff-2', permissions: { ecommerce: true, pos: true } }
    });
    const otherLicense = getEcommercePosContextIdentity({
      ...mocks.appState,
      licenseDetails: { license_key: 'other-license' }
    });
    const revoked = getEcommercePosContextIdentity({
      ...mocks.appState,
      currentStaffUser: { id: 'staff-1', permissions: { ecommerce: true, pos: false } }
    });

    expect(otherStaff).not.toBe(initial);
    expect(otherLicense).not.toBe(initial);
    expect(revoked).toBeNull();
  });
});
