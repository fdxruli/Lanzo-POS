import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateConversion: vi.fn(),
  showMessage: vi.fn(),
  state: {
    currentOrderId: 'ecom-order-1',
    activeOrders: new Map()
  }
}));

vi.mock('../useActiveOrders', () => ({
  useActiveOrders: {
    getState: () => mocks.state
  }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({}) }
}));

vi.mock('../../../services/utils', () => ({
  showMessageModal: (...args) => mocks.showMessage(...args)
}));

vi.mock('../../../services/salesCloud/salesCloudCashierService', () => ({
  salesCloudCashierService: {
    shouldUseCloudCashierSale: vi.fn()
  }
}));

vi.mock('../../../services/ecommerce/ecommercePosConversionService', () => ({
  ECOMMERCE_SALE_READ_FAILED: 'ECOMMERCE_SALE_READ_FAILED',
  ECOMMERCE_SALE_VERIFICATION_PENDING: 'ECOMMERCE_SALE_VERIFICATION_PENDING',
  cancelEcommercePosConversionRemote: vi.fn(),
  completeEcommercePosConversionRemote: vi.fn(),
  finalizeEcommerceConversionLocally: vi.fn(),
  findEcommerceSale: vi.fn(),
  getEcommerceActorIdentity: vi.fn(() => 'admin:device'),
  getEcommerceClaimIdentity: vi.fn(() => 'claim-1'),
  getEcommercePosConversionRemoteState: vi.fn(),
  recoverEcommercePosConversion: vi.fn(),
  updateEcommerceConversionState: (...args) => mocks.updateConversion(...args)
}));

vi.mock('../../../services/ecommerce/ecommercePosDraftService', () => ({
  canPrepareEcommercePosDraft: vi.fn(() => true),
  getEcommercePosContextIdentity: vi.fn(() => 'context-1')
}));

vi.mock('../../../services/ecommerce/ecommercePosInventoryResolution', () => ({
  ECOMMERCE_INVENTORY_STALE_RESPONSE: 'STALE_RESPONSE',
  revalidateEcommerceDraftInventory: vi.fn()
}));

import { ECOMMERCE_CONVERSION_STATUS } from '../../../services/ecommerce/ecommercePosCheckoutConversion';
import { ecommercePosCheckoutGateInternals } from '../useEcommercePosCheckoutGate';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useEcommercePosCheckoutGate internals', () => {
  it('binds the checkout lock to the same conversion attempt and actor', () => {
    const order = {
      isLockedForCheckout: true,
      ecommerceConversionAttemptId: 'attempt-1',
      ecommerceCheckoutLockAttemptId: 'attempt-1',
      ecommerceConversionActorIdentity: 'admin:device',
      ecommerceCheckoutLockActorIdentity: 'admin:device'
    };

    expect(
      ecommercePosCheckoutGateInternals.hasOwnedCheckoutLock(order, 'admin:device')
    ).toBe(true);
    expect(
      ecommercePosCheckoutGateInternals.hasOwnedCheckoutLock(order, 'staff:other')
    ).toBe(false);
  });

  it('keeps snapshot and attempt intact when sale verification is uncertain', () => {
    const result = ecommercePosCheckoutGateInternals.markUncertainSaleResult({
      orderId: 'ecom-order-1',
      code: 'ECOMMERCE_SALE_VERIFICATION_PENDING',
      message: 'No se pudo confirmar todavía si la venta fue registrada.'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_SALE_VERIFICATION_PENDING',
      saleVerificationPending: true
    });
    expect(mocks.updateConversion).toHaveBeenCalledWith(
      'ecom-order-1',
      ECOMMERCE_CONVERSION_STATUS.ERROR,
      expect.objectContaining({
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceRemoteConversionStatus: 'reserved',
        ecommerceConversionRecoveryFromStatus: ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
        ecommerceConversionError: {
          code: 'ECOMMERCE_SALE_VERIFICATION_PENDING',
          message: 'No se pudo confirmar todavía si la venta fue registrada.'
        }
      })
    );
    const patch = mocks.updateConversion.mock.calls[0][2];
    expect(patch).not.toHaveProperty('ecommerceCheckoutSnapshot');
    expect(patch).not.toHaveProperty('ecommerceConversionAttemptId');
  });
});
