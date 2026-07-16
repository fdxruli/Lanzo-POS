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

import {
  recoverEcommercePosConversion
} from '../ecommercePosConversionService';

const order = {
  id: 'ecom-order-68',
  origin: 'ecommerce',
  ecommerceOrderId: 'order-68',
  ecommerceClaimToken: 'claim-68',
  ecommerceConversionStatus: 'idle',
  ecommerceRemoteConversionStatus: 'idle',
  ecommerceConvertedSaleId: null
};

const expiredRemoteReservation = {
  success: true,
  claimOwned: true,
  claimValid: false,
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
    success: true,
    changed: false,
    recoveredStatus: 'idle'
  });
  mocks.getRemote.mockResolvedValue(expiredRemoteReservation);
  mocks.findSale.mockResolvedValue(null);
  mocks.cancelRemote.mockResolvedValue({ success: true, conversionStatus: 'idle' });
  mocks.updateState.mockImplementation((orderId, status, patch) => {
    const current = mocks.state.activeOrders.get(orderId);
    mocks.state.activeOrders.set(orderId, {
      ...current,
      ...patch,
      ecommerceConversionStatus: status
    });
  });
});

describe('ecommerce expired reservation recovery after reload', () => {
  it('checks remote state even when the restored local state says idle', async () => {
    const result = await recoverEcommercePosConversion({ orderId: order.id });
    const stored = mocks.state.activeOrders.get(order.id);

    expect(mocks.getRemote).toHaveBeenCalledWith({ order: expect.objectContaining({ id: order.id }) });
    expect(mocks.findSale).toHaveBeenCalledWith({
      orderId: 'order-68',
      conversionKey: 'ecommerce:order-68'
    });
    expect(mocks.cancelRemote).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'attempt-68',
      saleId: 'ecom-order-68',
      conversionKey: 'ecommerce:order-68'
    }));
    expect(result).toMatchObject({ success: true, authoritativeRelease: true });
    expect(stored.ecommerceRemoteConversionStatus).toBe('idle');
    expect(mocks.state.unlockOrder).toHaveBeenCalledWith(order.id);
  });

  it('does not cancel a fresh reservation that may still have an active checkout', async () => {
    mocks.getRemote.mockResolvedValue({
      ...expiredRemoteReservation,
      claimValid: true
    });

    const result = await recoverEcommercePosConversion({ orderId: order.id });

    expect(result).toMatchObject({ success: true, changed: false });
    expect(mocks.findSale).not.toHaveBeenCalled();
    expect(mocks.cancelRemote).not.toHaveBeenCalled();
    expect(mocks.state.unlockOrder).not.toHaveBeenCalled();
  });

  it('does not release a reservation owned by another device', async () => {
    mocks.getRemote.mockResolvedValue({
      ...expiredRemoteReservation,
      conversionOwned: false,
      conversionAttemptId: null
    });

    const result = await recoverEcommercePosConversion({ orderId: order.id });

    expect(result).toMatchObject({ success: true, changed: false });
    expect(mocks.cancelRemote).not.toHaveBeenCalled();
    expect(mocks.state.unlockOrder).not.toHaveBeenCalled();
  });
});
