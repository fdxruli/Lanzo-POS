import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: null,
  recoverBase: vi.fn(),
  getRemote: vi.fn(),
  findSale: vi.fn(),
  cancelRemote: vi.fn(),
  updateState: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: {
    getState: () => mocks.state
  }
}));

vi.mock('../ecommercePosConversionServiceBase', () => ({
  recoverEcommercePosConversion: mocks.recoverBase,
  getEcommercePosConversionRemoteState: mocks.getRemote,
  findEcommerceSale: mocks.findSale,
  cancelEcommercePosConversionRemote: mocks.cancelRemote,
  updateEcommerceConversionState: mocks.updateState
}));

import { recoverEcommercePosConversion } from '../ecommercePosConversionService';

const order = {
  id: 'ecom-order-68',
  origin: 'ecommerce',
  ecommerceOrderId: 'order-68',
  ecommerceClaimToken: 'claim-68',
  ecommerceConversionAttemptId: 'attempt-68',
  ecommerceRemoteConversionStatus: 'reserved',
  ecommerceConvertedSaleId: null
};

const remote = {
  success: true,
  conversionStatus: 'reserved',
  conversionOwned: true,
  conversionAttemptId: 'attempt-68',
  reservedSaleId: 'ecom-order-68',
  conversionKey: 'ecommerce:order-68',
  convertedSaleId: null
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    activeOrders: new Map([[order.id, { ...order }]]),
    unlockOrder: vi.fn().mockResolvedValue({ success: true })
  };
  mocks.recoverBase.mockResolvedValue({
    success: false,
    code: 'ECOMMERCE_SALE_VERIFICATION_PENDING',
    saleVerificationPending: true
  });
  mocks.getRemote.mockResolvedValue(remote);
  mocks.findSale.mockResolvedValue(null);
  mocks.cancelRemote.mockResolvedValue({ success: true, conversionStatus: 'idle' });
  mocks.updateState.mockImplementation((orderId, status, patch) => {
    const current = mocks.state.activeOrders.get(orderId);
    mocks.state.activeOrders.set(orderId, { ...current, ...patch, ecommerceConversionStatus: status });
  });
});

describe('ecommerce POS authoritative recovery release', () => {
  it('releases a reserved attempt only after the server confirms that no sale exists', async () => {
    const result = await recoverEcommercePosConversion({ orderId: order.id });
    const stored = mocks.state.activeOrders.get(order.id);

    expect(mocks.findSale).toHaveBeenCalledWith({
      orderId: 'order-68',
      conversionKey: 'ecommerce:order-68'
    });
    expect(mocks.cancelRemote).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'attempt-68',
      saleId: 'ecom-order-68',
      conversionKey: 'ecommerce:order-68',
      reason: 'recovery_authoritative_sale_check'
    }));
    expect(result).toMatchObject({ success: true, authoritativeRelease: true });
    expect(stored.ecommerceRemoteConversionStatus).toBe('idle');
    expect(stored.ecommerceConversionAttemptId).toBeNull();
    expect(stored.ecommerceCheckoutSnapshot).toBeNull();
    expect(mocks.state.unlockOrder).toHaveBeenCalledWith(order.id);
  });

  it('preserves the reservation when the authoritative RPC refuses cancellation', async () => {
    mocks.cancelRemote.mockResolvedValue({
      success: false,
      code: 'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED',
      message: 'Existe una venta asociada a la reserva.'
    });

    const result = await recoverEcommercePosConversion({ orderId: order.id });

    expect(result.success).toBe(false);
    expect(result.saleVerificationPending).toBe(true);
    expect(result.authoritativeCancellation).toMatchObject({
      success: false,
      code: 'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED'
    });
    expect(mocks.updateState).not.toHaveBeenCalled();
    expect(mocks.state.unlockOrder).not.toHaveBeenCalled();
  });
});