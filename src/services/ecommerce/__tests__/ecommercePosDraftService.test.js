import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appState: null,
  productState: { menu: [] },
  activeState: null,
  claim: vi.fn(),
  confirm: vi.fn(),
  release: vi.fn(),
  upsert: vi.fn(),
  switchOrder: vi.fn(),
  updateStatus: vi.fn(),
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
  claimEcommerceOrderPosDraft: mocks.claim,
  confirmEcommerceOrderPosDraft: mocks.confirm,
  releaseEcommerceOrderPosDraft: mocks.release
}));

import {
  getEcommercePosContextIdentity,
  getEcommercePosDraftId,
  mapEcommerceOrderToPosDraft,
  prepareEcommerceOrderPosDraft
} from '../ecommercePosDraftService';

const orderId = '97910ac6-3f21-4d7c-97d8-e829d0a141a7';
const baseOrder = () => ({
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
  posDraft: { status: 'none', claimToken: null, isClaimedByCurrentActor: false }
});

const localProduct = () => ({
  id: 'product-1',
  name: 'Nombre POS actual',
  price: 30,
  isActive: true,
  saleType: 'unit',
  batchManagement: { enabled: true }
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
    removeEcommerceDraftLocal: mocks.removeLocal
  };
  mocks.upsert.mockImplementation((draft) => {
    mocks.activeState.activeOrders.set(draft.id, draft);
    return { success: true, created: true, order: draft };
  });
  mocks.claim.mockImplementation(async () => {
    const order = baseOrder();
    order.posDraft = { status: 'claimed', claimToken: 'opaque-claim', isClaimedByCurrentActor: true };
    return { success: true, changed: true, order };
  });
  mocks.confirm.mockResolvedValue({ success: true, changed: true });
  mocks.release.mockResolvedValue({ success: true, changed: true });
});

describe('ecommercePosDraftService', () => {
  it('maps every item from the local product while keeping snapshot price and excluding PII', () => {
    const result = mapEcommerceOrderToPosDraft({
      order: baseOrder(),
      products: [localProduct()],
      licenseIdentity: 'context-1',
      claimToken: 'opaque-claim'
    });

    expect(result.success).toBe(true);
    expect(result.draft.id).toBe(`ecom-${orderId}`);
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
    const persisted = JSON.stringify(result.draft);
    expect(persisted).not.toContain('9610000000');
    expect(persisted).not.toContain('Privada');
    expect(persisted).not.toContain('Privadas');
    expect(persisted).not.toContain('PII');
  });

  it('fails atomically and reports all missing or inactive products', () => {
    const order = baseOrder();
    order.items.push({ ...order.items[0], id: 'order-item-2', sourceProductId: 'product-2', productName: 'Faltante' });
    const result = mapEcommerceOrderToPosDraft({
      order,
      products: [{ ...localProduct(), isActive: false }],
      licenseIdentity: 'context-1',
      claimToken: 'opaque-claim'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_POS_DRAFT_PRODUCT_MISSING'
    });
    expect(result.missingProducts.map((item) => item.productName)).toEqual(['Nombre aceptado', 'Faltante']);
    expect(result).not.toHaveProperty('draft');
  });

  it('creates one deterministic draft and confirms once for a double click', async () => {
    let resolveClaim;
    mocks.claim.mockReturnValue(new Promise((resolve) => { resolveClaim = resolve; }));
    const order = baseOrder();

    const first = prepareEcommerceOrderPosDraft({ order });
    const second = prepareEcommerceOrderPosDraft({ order });
    expect(mocks.claim).toHaveBeenCalledTimes(1);

    const claimedOrder = baseOrder();
    claimedOrder.posDraft = { status: 'claimed', claimToken: 'opaque-claim', isClaimedByCurrentActor: true };
    resolveClaim({ success: true, order: claimedOrder });
    await Promise.all([first, second]);

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: 'opaque-claim',
      draftId: getEcommercePosDraftId(orderId)
    }));
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

  it('does not create a draft when the claim response arrives after logout', async () => {
    let resolveClaim;
    mocks.claim.mockReturnValue(new Promise((resolve) => { resolveClaim = resolve; }));
    const pending = prepareEcommerceOrderPosDraft({ order: baseOrder() });
    mocks.appState = { licenseDetails: null, currentDeviceRole: null, currentStaffUser: null };

    const claimedOrder = baseOrder();
    claimedOrder.posDraft = { status: 'claimed', claimToken: 'opaque-claim', isClaimedByCurrentActor: true };
    resolveClaim({ success: true, order: claimedOrder });
    const result = await pending;

    expect(result.stale).toBe(true);
    expect(mocks.release).toHaveBeenCalledWith(expect.objectContaining({ reason: 'stale_context' }));
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
