// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
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
    cancelRemote: vi.fn(),
    showMessage: vi.fn(),
    updateConversion: vi.fn((orderId, status, values = {}) => {
      state.updateOrder(orderId, {
        ecommerceConversionStatus: status,
        ...values
      });
      return state.activeOrders.get(orderId);
    })
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
  findEcommerceSale: vi.fn().mockResolvedValue(null),
  getEcommerceActorIdentity: vi.fn(() => 'admin:device'),
  getEcommerceClaimIdentity: vi.fn(() => 'claim-1'),
  getEcommercePosConversionRemoteState: vi.fn(async ({ order }) => ({
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
  })),
  recoverEcommercePosConversion: vi.fn().mockResolvedValue({ success: true }),
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
import { useEcommercePosCheckoutGate } from '../useEcommercePosCheckoutGate';

const buildReadyOrder = () => ({
  id: 'ecom-order-a',
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
  ecommerceOrderId: 'online-ecom-order-a',
  ecommerceOrderCode: 'WEB-A',
  ecommerceLicenseIdentity: 'context-1',
  ecommerceDraftStatus: 'prepared',
  ecommerceClaimToken: 'claim-ecom-order-a',
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
  const order = buildReadyOrder();
  mocks.state.currentOrderId = order.id;
  mocks.state.activeOrders = new Map([[order.id, order]]);
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'attempt-a') });
  mocks.cancelRemote.mockResolvedValue({ success: true });
});

describe('useEcommercePosCheckoutGate immutable reservation context', () => {
  it('retains the preflight conversion key when canonical startup fails after reservation', async () => {
    const checkout = {
      handleInitiateCheckout: vi.fn(async ({ expectedOrderId }) => {
        mocks.state.updateOrder(expectedOrderId, {
          ecommerceRemoteConversionStatus: 'reserved'
        });
        return {
          success: false,
          code: 'FEFO_BLOCKED',
          message: 'El lote ya no es vendible.'
        };
      })
    };
    const { result } = renderHook(() => useEcommercePosCheckoutGate({ checkout }));

    let response;
    await act(async () => {
      response = await result.current.handleInitiateCheckout({
        expectedOrderId: 'ecom-order-a',
        expectedOrigin: 'ecommerce'
      });
    });

    expect(response).toMatchObject({
      success: false,
      code: 'FEFO_BLOCKED',
      cancellation: { success: true }
    });
    expect(mocks.cancelRemote).toHaveBeenCalledTimes(1);

    const cancellation = mocks.cancelRemote.mock.calls[0][0];
    expect(cancellation).toMatchObject({
      order: expect.objectContaining({ id: 'ecom-order-a' }),
      attemptId: 'attempt-a',
      saleId: 'ecom-order-a',
      reason: 'checkout_start_failed'
    });
    expect(cancellation.conversionKey).toEqual(expect.any(String));
    expect(cancellation.conversionKey.length).toBeGreaterThan(0);
  });
});
