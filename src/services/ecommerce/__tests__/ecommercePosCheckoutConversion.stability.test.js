import { describe, expect, it } from 'vitest';
import {
  ECOMMERCE_CHECKOUT_CODE,
  ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
  buildEcommerceCheckoutSnapshot,
  getEcommerceCheckoutEligibility
} from '../ecommercePosCheckoutConversion';

const line = {
  id: 'product-1',
  lineId: 'line-1',
  ecommerceOrderItemId: 'item-1',
  quantity: 2,
  ecommerceSnapshotPrice: 25,
  needsInventoryResolution: false,
  inventoryResolution: {
    mode: 'exact',
    status: 'resolved',
    requestedQuantity: 2,
    requiredInventoryQuantity: 2
  }
};

const order = {
  id: 'ecom-order-1',
  origin: 'ecommerce',
  ecommerceOrderId: 'order-1',
  ecommerceOrderCode: 'EC-0001',
  ecommerceLicenseIdentity: 'context-1',
  ecommerceDraftStatus: 'prepared',
  ecommerceInventoryStatus: 'ready',
  ecommerceInventoryResolvedAt: '2026-07-11T20:00:00.000Z',
  ecommerceInventoryResolutionVersion: 4,
  ecommerceConversionStatus: 'idle',
  revision: 8,
  updatedAt: '2026-07-11T20:00:00.000Z',
  expectedSubtotal: 50,
  expectedDeliveryFee: 0,
  expectedDiscountTotal: 0,
  expectedTaxTotal: 0,
  expectedTotal: 50,
  currency: 'MXN',
  items: [line]
};

const context = {
  contextIdentity: 'context-1',
  actorIdentity: 'staff:1',
  claimIdentity: 'claim-1',
  permissionsAllowed: true,
  claimOwned: true,
  inventoryFresh: true,
  remoteContractVersion: ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION
};

describe('ecommerce checkout snapshot stability', () => {
  it('requires the reservation-capable remote contract version', () => {
    const result = getEcommerceCheckoutEligibility(order, {
      ...context,
      remoteContractVersion: ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION - 1
    });

    expect(result).toMatchObject({
      eligible: false,
      code: ECOMMERCE_CHECKOUT_CODE.REMOTE_CONTRACT_PENDING
    });
  });

  it('does not change the locked source revision when only conversion metadata changes', () => {
    const first = buildEcommerceCheckoutSnapshot(order, context);
    expect(first.eligible).toBe(true);

    const afterLocalConversionMetadata = {
      ...order,
      revision: order.revision + 5,
      updatedAt: '2026-07-11T20:05:00.000Z',
      ecommerceConversionStatus: 'payment_pending',
      ecommerceConversionAttemptId: 'attempt-1',
      ecommerceCheckoutSnapshot: first.snapshot
    };

    const rebuilt = buildEcommerceCheckoutSnapshot(
      {
        ...afterLocalConversionMetadata,
        ecommerceConversionStatus: 'idle'
      },
      context
    );

    expect(rebuilt.eligible).toBe(true);
    expect(rebuilt.snapshot).toEqual(first.snapshot);
    expect(rebuilt.snapshot.orderRevision).toBe(8);
    expect(rebuilt.snapshot.orderUpdatedAt).toBe('2026-07-11T20:00:00.000Z');
  });
});
