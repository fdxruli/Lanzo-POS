import { describe, expect, it } from 'vitest';
import {
  ECOMMERCE_CHECKOUT_CODE,
  ECOMMERCE_CONVERSION_STATUS,
  ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
  buildEcommerceCheckoutSnapshot,
  calculateEcommerceAcceptedTotals,
  createEcommerceConversionPatch,
  getEcommerceCheckoutEligibility,
  getEcommerceConversionKey
} from '../ecommercePosCheckoutConversion';

const createLine = (overrides = {}) => ({
  id: 'product-1',
  lineId: 'line-1',
  ecommerceOrderItemId: 'item-1',
  quantity: 2,
  price: 25,
  ecommerceSnapshotPrice: 25,
  needsInventoryResolution: false,
  inventoryResolution: {
    mode: 'exact',
    status: 'resolved',
    requiredInventoryQuantity: 2,
    requestedQuantity: 2,
    resolvedAt: '2026-07-11T20:00:00.000Z'
  },
  ...overrides
});

const createOrder = (overrides = {}) => ({
  id: 'ecom-order-1',
  origin: 'ecommerce',
  ecommerceOrderId: 'order-1',
  ecommerceOrderCode: 'EC-0001',
  ecommerceLicenseIdentity: 'context-1',
  ecommerceDraftStatus: 'prepared',
  ecommerceInventoryStatus: 'ready',
  ecommerceInventoryResolvedAt: '2026-07-11T20:00:00.000Z',
  ecommerceInventoryResolutionVersion: 2,
  ecommerceConversionStatus: 'idle',
  revision: 3,
  updatedAt: '2026-07-11T20:00:00.000Z',
  expectedSubtotal: 50,
  expectedDeliveryFee: 10,
  expectedDiscountTotal: 5,
  expectedTaxTotal: 8,
  expectedTotal: 63,
  currency: 'MXN',
  items: [createLine()],
  ...overrides
});

const createContext = (overrides = {}) => ({
  contextIdentity: 'context-1',
  actorIdentity: 'staff:1',
  claimIdentity: 'claim-hash',
  permissionsAllowed: true,
  claimOwned: true,
  inventoryFresh: true,
  remoteContractVersion: ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
  ...overrides
});

describe('getEcommerceCheckoutEligibility', () => {
  it('allows only a prepared, ready and fully resolved order', () => {
    const result = getEcommerceCheckoutEligibility(createOrder(), createContext());
    expect(result).toMatchObject({
      eligible: true,
      conversionKey: 'ecommerce:order-1'
    });
  });

  it.each([
    ['claimed', ECOMMERCE_CHECKOUT_CODE.DRAFT_NOT_PREPARED],
    ['released', ECOMMERCE_CHECKOUT_CODE.DRAFT_NOT_PREPARED]
  ])('blocks draft status %s', (status, code) => {
    expect(getEcommerceCheckoutEligibility(
      createOrder({ ecommerceDraftStatus: status }),
      createContext()
    )).toMatchObject({ eligible: false, code });
  });

  it.each(['pending', 'conflict'])('blocks inventory status %s', (status) => {
    expect(getEcommerceCheckoutEligibility(
      createOrder({ ecommerceInventoryStatus: status }),
      createContext()
    )).toMatchObject({
      eligible: false,
      code: ECOMMERCE_CHECKOUT_CODE.INVENTORY_NOT_READY
    });
  });

  it('blocks a missing batch on batch-managed lines', () => {
    const line = createLine({
      inventoryResolution: {
        mode: 'batch',
        status: 'resolved',
        requiredInventoryQuantity: 2,
        requestedQuantity: 2,
        batchId: null
      }
    });
    expect(getEcommerceCheckoutEligibility(
      createOrder({ items: [line] }),
      createContext()
    )).toMatchObject({ eligible: false, code: ECOMMERCE_CHECKOUT_CODE.BATCH_MISSING });
  });

  it('blocks a different POS context', () => {
    expect(getEcommerceCheckoutEligibility(
      createOrder(),
      createContext({ contextIdentity: 'context-2' })
    )).toMatchObject({ eligible: false, code: ECOMMERCE_CHECKOUT_CODE.CONTEXT_MISMATCH });
  });

  it('blocks lost permissions', () => {
    expect(getEcommerceCheckoutEligibility(
      createOrder(),
      createContext({ permissionsAllowed: false })
    )).toMatchObject({ eligible: false, code: ECOMMERCE_CHECKOUT_CODE.PERMISSION_DENIED });
  });

  it('blocks a lost claim', () => {
    expect(getEcommerceCheckoutEligibility(
      createOrder(),
      createContext({ claimOwned: false })
    )).toMatchObject({ eligible: false, code: ECOMMERCE_CHECKOUT_CODE.CLAIM_LOST });
  });

  it('blocks while the remote conversion contract is unavailable', () => {
    expect(getEcommerceCheckoutEligibility(
      createOrder(),
      createContext({ remoteContractVersion: 0 })
    )).toMatchObject({
      eligible: false,
      code: ECOMMERCE_CHECKOUT_CODE.REMOTE_CONTRACT_PENDING
    });
  });

  it('blocks a stale inventory resolution', () => {
    expect(getEcommerceCheckoutEligibility(
      createOrder({ ecommerceInventoryResolvedAt: null }),
      createContext()
    )).toMatchObject({ eligible: false, code: ECOMMERCE_CHECKOUT_CODE.INVENTORY_STALE });
  });

  it('blocks an unresolved line even when the global status says ready', () => {
    const line = createLine({
      needsInventoryResolution: true,
      inventoryResolution: { status: 'pending', mode: 'exact' }
    });
    expect(getEcommerceCheckoutEligibility(
      createOrder({ items: [line] }),
      createContext()
    )).toMatchObject({ eligible: false, code: ECOMMERCE_CHECKOUT_CODE.INVENTORY_NOT_READY });
  });

  it('blocks a total mismatch instead of correcting it silently', () => {
    expect(getEcommerceCheckoutEligibility(
      createOrder({ expectedTotal: 64 }),
      createContext()
    )).toMatchObject({ eligible: false, code: ECOMMERCE_CHECKOUT_CODE.TOTAL_MISMATCH });
  });

  it.each([
    ECOMMERCE_CONVERSION_STATUS.VALIDATING,
    ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
    ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
    ECOMMERCE_CONVERSION_STATUS.SALE_CREATED,
    ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
  ])('blocks duplicate interaction in %s', (status) => {
    expect(getEcommerceCheckoutEligibility(
      createOrder({ ecommerceConversionStatus: status }),
      createContext()
    )).toMatchObject({ eligible: false, code: ECOMMERCE_CHECKOUT_CODE.CONVERSION_IN_PROGRESS });
  });

  it('does not charge again when a sale already exists', () => {
    expect(getEcommerceCheckoutEligibility(
      createOrder(),
      createContext({ existingSaleId: 'sale-1' })
    )).toMatchObject({
      eligible: false,
      code: ECOMMERCE_CHECKOUT_CODE.ALREADY_CONVERTED,
      details: { saleId: 'sale-1' }
    });
  });
});

describe('accepted totals and immutable snapshot', () => {
  it('includes accepted delivery, discount and tax in the authoritative total', () => {
    expect(calculateEcommerceAcceptedTotals(createOrder())).toMatchObject({
      lineSubtotal: 50,
      expectedSubtotal: 50,
      deliveryFee: 10,
      discountTotal: 5,
      taxTotal: 8,
      expectedTotal: 63,
      composedTotal: 63,
      subtotalMatches: true,
      totalMatches: true
    });
  });

  it('builds and deeply freezes the checkout snapshot', () => {
    const result = buildEcommerceCheckoutSnapshot(createOrder(), createContext());
    expect(result.eligible).toBe(true);
    expect(result.snapshot).toMatchObject({
      ecommerceOrderId: 'order-1',
      ecommerceOrderCode: 'EC-0001',
      ecommerceClaimIdentity: 'claim-hash',
      ecommerceLicenseIdentity: 'context-1',
      ecommerceActorIdentity: 'staff:1',
      ecommerceConversionKey: 'ecommerce:order-1',
      orderRevision: 3,
      expectedTotal: 63,
      currency: 'MXN',
      lines: [{
        lineId: 'line-1',
        ecommerceOrderItemId: 'item-1',
        productId: 'product-1',
        quantity: 2,
        unitPriceSnapshot: 25,
        lineTotalSnapshot: 50,
        batchId: null,
        requiredInventoryQuantity: 2
      }]
    });
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.lines)).toBe(true);
    expect(Object.isFrozen(result.snapshot.lines[0])).toBe(true);
  });

  it('uses the deterministic conversion key', () => {
    expect(getEcommerceConversionKey('order-1')).toBe('ecommerce:order-1');
  });
});

describe('conversion state patches', () => {
  it('records start time independently from draft status', () => {
    const patch = createEcommerceConversionPatch(
      ECOMMERCE_CONVERSION_STATUS.VALIDATING,
      { ecommerceConversionAttemptId: 'attempt-1' },
      new Date('2026-07-11T21:00:00.000Z')
    );
    expect(patch).toEqual({
      ecommerceConversionStatus: 'validating',
      ecommerceConversionStartedAt: '2026-07-11T21:00:00.000Z',
      ecommerceConversionAttemptId: 'attempt-1'
    });
    expect(patch).not.toHaveProperty('ecommerceDraftStatus');
  });

  it('records completion time', () => {
    expect(createEcommerceConversionPatch(
      ECOMMERCE_CONVERSION_STATUS.COMPLETED,
      { ecommerceConvertedSaleId: 'sale-1' },
      new Date('2026-07-11T22:00:00.000Z')
    )).toMatchObject({
      ecommerceConversionStatus: 'completed',
      ecommerceConvertedSaleId: 'sale-1',
      ecommerceConversionCompletedAt: '2026-07-11T22:00:00.000Z'
    });
  });
});
