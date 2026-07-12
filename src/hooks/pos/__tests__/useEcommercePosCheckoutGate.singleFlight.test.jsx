import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    currentOrderId: 'ecom-order-1',
    activeOrders: new Map(),
    updateOrder: vi.fn((orderId, patch) => {
      const order = state.activeOrders.get(orderId);
      if (!order) return;
      state.activeOrders.set(orderId, { ...order, ...patch });
    })
  };

  return {
    state,
    createAttemptId: vi.fn(),
    recoverConversion: vi.fn(),
    getRemoteState: vi.fn(),
    findSale: vi.fn(),
    updateConversion: vi.fn((orderId, status, values = {}) => {
      state.updateOrder(orderId, {
        ecommerceConversionStatus: status,
        ...values
      });
      return state.activeOrders.get(orderId);
    }),
    showMessage: vi.fn(),
    lockOrderForCheckout: vi.fn(),
    beginRemoteConversion: vi.fn()
  };
});

vi.mock('../useActiveOrders', () => ({
  useActiveOrders: {
    getState: () => mocks.state
  }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      licenseDetails: { license_key: 'license-1' },
      currentDeviceRole: 'admin',
      currentStaffUser: null
    })
  }
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
  findEcommerceSale: (...args) => mocks.findSale(...args),
  getEcommerceActorIdentity: vi.fn(() => 'admin:device'),
  getEcommerceClaimIdentity: vi.fn(() => 'claim-1'),
  getEcommercePosConversionRemoteState: (...args) => mocks.getRemoteState(...args),
  recoverEcommercePosConversion: (...args) => mocks.recoverConversion(...args),
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
import { ecommerceCheckoutInitiationSingleFlightInternals } from '../ecommerceCheckoutInitiationSingleFlight';
import { useEcommercePosCheckoutGate } from '../useEcommercePosCheckoutGate';
import { useEcommercePosCheckoutSingleFlight } from '../useEcommercePosCheckoutSingleFlight';

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const buildReadyOrder = () => ({
  id: 'ecom-order-1',
  origin: 'ecommerce',
  items: [{
    id: 'product-1',
    quantity: 1,
    price: 100,
    ecommerceSnapshotPrice: 100,
    needsInventoryResolution: false,
    inventoryResolution: {
      status: 'resolved',
      mode: 'stock',
      requiredInventoryQuantity: 1
    }
  }],
  revision: 1,
  updatedAt: '2026-07-12T05:00:00.000Z',
  ecommerceOrderId: 'online-order-1',
  ecommerceOrderCode: 'WEB-1',
  ecommerceLicenseIdentity: 'context-1',
  ecommerceDraftStatus: 'prepared',
  ecommerceClaimToken: 'claim-token-1',
  ecommerceInventoryStatus: 'ready',
  ecommerceInventoryResolvedAt: '2026-07-12T05:00:00.000Z',
  ecommerceInventoryResolutionVersion: 1,
  ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.IDLE,
  ecommerceCheckoutInitiationStatus: null,
  ecommerceRemoteConversionStatus: 'idle',
  ecommerceConvertedSaleId: null,
  isLockedForCheckout: false,
  expectedSubtotal: 100,
  expectedDeliveryFee: 0,
  expectedDiscountTotal: 0,
  expectedTaxTotal: 0,
  expectedTotal: 100,
  currency: 'MXN'
});

beforeEach(() => {
  vi.clearAllMocks();
  ecommerceCheckoutInitiationSingleFlightInternals.resetEcommerceCheckoutInitiations();
  mocks.state.currentOrderId = 'ecom-order-1';
  mocks.state.activeOrders = new Map([
    ['ecom-order-1', buildReadyOrder()]
  ]);
  mocks.createAttemptId.mockReturnValue('attempt-1');
  vi.stubGlobal('crypto', { randomUUID: mocks.createAttemptId });
  mocks.recoverConversion.mockResolvedValue({ success: true });
  mocks.getRemoteState.mockResolvedValue({
    success: true,
    remoteContractVersion: 2,
    draftStatus: 'prepared',
    draftId: 'ecom-order-1',
    claimOwned: true,
    claimValid: true,
    conversionStatus: 'idle',
    conversionOwned: false,
    conversionAttemptId: null,
    reservedSaleId: null,
    convertedSaleId: null
  });
  mocks.findSale.mockResolvedValue(null);
});

describe('ecommerce checkout gate single-flight integration', () => {
  it('runs attempt creation, recovery, lock and reservation only once for ten rapid clicks', async () => {
    const deferred = createDeferred();
    const checkoutResult = { success: true, modalOpened: true };
    const canonicalCheckout = {
      handleInitiateCheckout: vi.fn(async () => {
        mocks.lockOrderForCheckout();
        mocks.beginRemoteConversion();
        const order = mocks.state.activeOrders.get('ecom-order-1');
        mocks.state.updateOrder('ecom-order-1', {
          isLockedForCheckout: true,
          ecommerceCheckoutLockAttemptId: order.ecommerceConversionAttemptId,
          ecommerceCheckoutLockActorIdentity: order.ecommerceConversionActorIdentity,
          ecommerceRemoteConversionStatus: 'reserved'
        });
        return deferred.promise;
      })
    };

    const { result } = renderHook(() => {
      const gatedCheckout = useEcommercePosCheckoutGate({ checkout: canonicalCheckout });
      return useEcommercePosCheckoutSingleFlight({ checkout: gatedCheckout });
    });

    let calls;
    act(() => {
      calls = Array.from({ length: 10 }, () => result.current.handleInitiateCheckout());
    });

    expect(calls.every((promise) => promise === calls[0])).toBe(true);
    expect(
      mocks.state.activeOrders.get('ecom-order-1').ecommerceCheckoutInitiationStatus
    ).toBe('starting');

    await waitFor(() => {
      expect(canonicalCheckout.handleInitiateCheckout).toHaveBeenCalledTimes(1);
    });

    expect(mocks.createAttemptId).toHaveBeenCalledTimes(1);
    expect(mocks.recoverConversion).toHaveBeenCalledTimes(1);
    expect(mocks.getRemoteState).toHaveBeenCalledTimes(1);
    expect(mocks.findSale).toHaveBeenCalledTimes(1);
    expect(mocks.lockOrderForCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.beginRemoteConversion).toHaveBeenCalledTimes(1);
    expect(mocks.showMessage).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve(checkoutResult);
      await expect(Promise.all(calls)).resolves.toEqual(
        Array.from({ length: 10 }, () => checkoutResult)
      );
    });

    const finalOrder = mocks.state.activeOrders.get('ecom-order-1');
    expect(finalOrder.ecommerceConversionAttemptId).toBe('attempt-1');
    expect(finalOrder.ecommerceCheckoutLockAttemptId).toBe('attempt-1');
    expect(finalOrder.ecommerceConversionStatus).toBe(ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING);
    expect(finalOrder.ecommerceCheckoutInitiationStatus).toBeNull();
  });
});
