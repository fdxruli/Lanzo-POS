import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    currentOrderId: 'ecom-order-a',
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
    cancelRemote: vi.fn(),
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
  cancelEcommercePosConversionRemote: (...args) => mocks.cancelRemote(...args),
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
import {
  ecommercePosCheckoutGateInternals,
  useEcommercePosCheckoutGate
} from '../useEcommercePosCheckoutGate';
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

const buildReadyOrder = (id = 'ecom-order-a', patch = {}) => ({
  id,
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
  ecommerceOrderId: `online-${id}`,
  ecommerceOrderCode: id === 'ecom-order-a' ? 'WEB-A' : 'WEB-B',
  ecommerceLicenseIdentity: 'context-1',
  ecommerceDraftStatus: 'prepared',
  ecommerceClaimToken: `claim-${id}`,
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
  currency: 'MXN',
  ...patch
});

beforeEach(() => {
  vi.clearAllMocks();
  ecommerceCheckoutInitiationSingleFlightInternals.resetEcommerceCheckoutInitiations();
  mocks.state.currentOrderId = 'ecom-order-a';
  mocks.state.activeOrders = new Map([
    ['ecom-order-a', buildReadyOrder('ecom-order-a')]
  ]);
  mocks.createAttemptId.mockReturnValue('attempt-a');
  vi.stubGlobal('crypto', { randomUUID: mocks.createAttemptId });
  mocks.recoverConversion.mockResolvedValue({ success: true });
  mocks.getRemoteState.mockImplementation(async ({ order }) => ({
    success: true,
    remoteContractVersion: 2,
    draftStatus: 'prepared',
    draftId: order.id,
    claimOwned: true,
    claimValid: true,
    conversionStatus: 'idle',
    conversionOwned: false,
    conversionAttemptId: null,
    reservedSaleId: null,
    convertedSaleId: null
  }));
  mocks.findSale.mockResolvedValue(null);
  mocks.cancelRemote.mockResolvedValue({ success: true });
});

describe('ecommerce checkout gate single-flight integration', () => {
  it('runs attempt creation, recovery, lock and reservation only once for twenty rapid clicks', async () => {
    const deferred = createDeferred();
    const checkoutResult = {
      success: true,
      modalOpened: true,
      orderId: 'ecom-order-a',
      checkoutAttemptId: 'canonical-attempt-a',
      origin: 'ecommerce'
    };
    const canonicalCheckout = {
      handleInitiateCheckout: vi.fn(async (options) => {
        mocks.lockOrderForCheckout();
        mocks.beginRemoteConversion();
        const order = mocks.state.activeOrders.get(options.expectedOrderId);
        mocks.state.updateOrder(options.expectedOrderId, {
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
      calls = Array.from({ length: 20 }, () => result.current.handleInitiateCheckout());
    });

    expect(calls.every((promise) => promise === calls[0])).toBe(true);
    expect(
      mocks.state.activeOrders.get('ecom-order-a').ecommerceCheckoutInitiationStatus
    ).toBe('starting');

    await waitFor(() => {
      expect(canonicalCheckout.handleInitiateCheckout).toHaveBeenCalledTimes(1);
    });

    expect(canonicalCheckout.handleInitiateCheckout).toHaveBeenCalledWith({
      expectedOrderId: 'ecom-order-a',
      expectedOrigin: 'ecommerce'
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
        Array.from({ length: 20 }, () => checkoutResult)
      );
    });

    const finalOrder = mocks.state.activeOrders.get('ecom-order-a');
    expect(finalOrder.ecommerceConversionAttemptId).toBe('attempt-a');
    expect(finalOrder.ecommerceCheckoutLockAttemptId).toBe('attempt-a');
    expect(finalOrder.ecommerceCanonicalCheckoutAttemptId).toBe('canonical-attempt-a');
    expect(finalOrder.ecommerceConversionStatus).toBe(ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING);
    expect(finalOrder.ecommerceCheckoutInitiationStatus).toBeNull();
  });

  it('aborts A before canonical checkout when recovery resolves after selection changes to B', async () => {
    const recovery = createDeferred();
    const orderA = buildReadyOrder('ecom-order-a');
    const orderB = buildReadyOrder('ecom-order-b');
    mocks.state.activeOrders = new Map([
      [orderA.id, orderA],
      [orderB.id, orderB]
    ]);
    mocks.state.currentOrderId = orderA.id;
    mocks.recoverConversion.mockReturnValueOnce(recovery.promise);

    const canonicalCheckout = {
      handleInitiateCheckout: vi.fn()
    };
    const { result } = renderHook(() => useEcommercePosCheckoutGate({
      checkout: canonicalCheckout
    }));

    let initiation;
    act(() => {
      initiation = result.current.handleInitiateCheckout({
        expectedOrderId: orderA.id,
        expectedOrigin: 'ecommerce'
      });
    });

    await waitFor(() => expect(mocks.recoverConversion).toHaveBeenCalledWith({
      orderId: orderA.id
    }));
    mocks.state.currentOrderId = orderB.id;
    recovery.resolve({ success: true });

    await expect(initiation).resolves.toMatchObject({
      success: false,
      aborted: true,
      targetChanged: true,
      code: 'ECOMMERCE_CHECKOUT_TARGET_CHANGED'
    });
    expect(canonicalCheckout.handleInitiateCheckout).not.toHaveBeenCalled();
    expect(mocks.lockOrderForCheckout).not.toHaveBeenCalled();
    expect(mocks.beginRemoteConversion).not.toHaveBeenCalled();
    expect(mocks.showMessage).not.toHaveBeenCalled();
    expect(mocks.state.activeOrders.get(orderA.id).ecommerceConversionStatus)
      .toBe(ECOMMERCE_CONVERSION_STATUS.IDLE);
    expect(mocks.state.activeOrders.get(orderB.id)).toEqual(orderB);
  });

  it('treats a missing order and a missing attempt id as non-owners', () => {
    expect(ecommercePosCheckoutGateInternals.isAttemptOwner('missing-order', 'attempt-a')).toBe(false);
    expect(ecommercePosCheckoutGateInternals.isAttemptOwner('ecom-order-a', null)).toBe(false);
  });

  it('lets remote cleanup for disappeared A finish without closing or modifying B', async () => {
    const cancellation = createDeferred();
    const closeCanonicalCheckout = vi.fn();
    const orderA = buildReadyOrder('ecom-order-a', {
      ecommerceConversionAttemptId: 'attempt-a',
      ecommerceConversionActorIdentity: 'admin:device',
      ecommerceCheckoutLockAttemptId: 'attempt-a',
      ecommerceCheckoutLockActorIdentity: 'admin:device',
      ecommerceCanonicalCheckoutAttemptId: 'canonical-attempt-a',
      ecommerceCheckoutSnapshot: {
        ecommerceConversionKey: 'conversion-key-a'
      },
      ecommerceRemoteConversionStatus: 'reserved',
      isLockedForCheckout: true
    });
    const orderB = buildReadyOrder('ecom-order-b', {
      ecommerceConversionAttemptId: 'attempt-b',
      ecommerceConversionActorIdentity: 'staff:device',
      ecommerceCheckoutLockAttemptId: 'attempt-b',
      ecommerceCheckoutLockActorIdentity: 'staff:device',
      ecommerceCanonicalCheckoutAttemptId: 'canonical-attempt-b',
      ecommerceCheckoutSnapshot: {
        ecommerceConversionKey: 'conversion-key-b'
      },
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
      isLockedForCheckout: true
    });
    mocks.state.activeOrders = new Map([[orderA.id, orderA]]);
    mocks.state.currentOrderId = orderA.id;
    mocks.cancelRemote.mockReturnValueOnce(cancellation.promise);

    const staleCleanup = ecommercePosCheckoutGateInternals.failBeforeSale({
      orderId: orderA.id,
      code: 'ATTEMPT_A_FAILED',
      message: 'El intento A falló.',
      closeCanonicalCheckout,
      expectedCheckoutAttemptId: 'canonical-attempt-a',
      releaseRemoteReservation: true,
      releaseReason: 'attempt_a_failed',
      ownedAttemptId: 'attempt-a',
      conversionContext: ecommercePosCheckoutGateInternals.buildConversionContext({
        order: orderA,
        attemptId: 'attempt-a',
        actorIdentity: 'admin:device'
      })
    });

    await waitFor(() => expect(mocks.cancelRemote).toHaveBeenCalledTimes(1));

    mocks.state.activeOrders.delete(orderA.id);
    mocks.state.activeOrders.set(orderB.id, orderB);
    mocks.state.currentOrderId = orderB.id;

    cancellation.resolve({ success: true });
    await expect(staleCleanup).resolves.toMatchObject({
      ignored: true,
      staleAttempt: true,
      code: 'ECOMMERCE_STALE_CHECKOUT_ATTEMPT'
    });

    expect(closeCanonicalCheckout).not.toHaveBeenCalled();
    expect(mocks.updateConversion).not.toHaveBeenCalled();
    expect(mocks.showMessage).not.toHaveBeenCalled();
    expect(mocks.state.activeOrders.get(orderB.id)).toEqual(orderB);
  });
});
