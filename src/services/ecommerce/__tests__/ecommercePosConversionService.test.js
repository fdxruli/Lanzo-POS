import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  order: null,
  state: null,
  updateOrder: vi.fn(),
  unlockOrder: vi.fn(),
  removeEcommerceDraftLocal: vi.fn(),
  getSale: vi.fn(),
  firstSale: vi.fn(),
  verifyCommittedSale: vi.fn(),
  rpc: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: {
    getState: () => mocks.state
  }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      licenseDetails: { license_key: 'LIC-1' },
      currentDeviceRole: 'admin',
      currentStaffUser: null
    })
  }
}));

vi.mock('../../db/dexie', () => ({
  db: {
    table: () => ({
      get: (...args) => mocks.getSale(...args),
      filter: () => ({ first: (...args) => mocks.firstSale(...args) })
    })
  },
  STORES: { SALES: 'sales' }
}));

vi.mock('../../salesCloud/salesCloudCashierService', () => ({
  salesCloudCashierService: {
    verifyCommittedSale: (...args) => mocks.verifyCommittedSale(...args)
  }
}));

vi.mock('../../supabase', () => ({
  supabaseClient: {
    rpc: (...args) => mocks.rpc(...args)
  }
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: vi.fn(async () => ({
    licenseKey: 'LIC-1',
    deviceFingerprint: 'device-a',
    securityToken: 'security-token',
    staffSessionToken: null
  }))
}));

import {
  ECOMMERCE_CONVERSION_STATUS,
  getEcommerceConversionKey
} from '../ecommercePosCheckoutConversion';
import {
  ECOMMERCE_SALE_READ_FAILED,
  ECOMMERCE_SALE_VERIFICATION_PENDING,
  recoverEcommercePosConversion
} from '../ecommercePosConversionService';

const createOrder = (overrides = {}) => ({
  id: 'ecom-order-1',
  origin: 'ecommerce',
  ecommerceOrderId: 'order-1',
  ecommerceClaimToken: 'claim-token',
  ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
  ecommerceConversionAttemptId: 'attempt-1',
  ecommerceConversionActorIdentity: 'admin:device',
  ecommerceRemoteConversionStatus: 'reserved',
  ecommerceRemoteConversionStartedAt: '2026-07-11T20:00:00.000Z',
  ecommerceSaleExecutionMode: 'cloud_cashier_inventory',
  ecommerceCheckoutSnapshot: {
    ecommerceConversionKey: getEcommerceConversionKey('order-1')
  },
  ...overrides
});

const remoteState = (overrides = {}) => ({
  success: true,
  contractVersion: 2,
  orderId: 'order-1',
  orderStatus: 'accepted',
  draftStatus: 'prepared',
  draftId: 'ecom-order-1',
  claimOwned: true,
  claimValid: true,
  conversionStatus: 'reserved',
  conversionOwned: true,
  conversionAttemptId: 'attempt-1',
  reservedSaleId: 'ecom-order-1',
  conversionStartedAt: '2026-07-11T20:00:00.000Z',
  conversionKey: getEcommerceConversionKey('order-1'),
  convertedSaleId: null,
  ...overrides
});

const configureState = (order) => {
  mocks.order = order;
  mocks.state = {
    activeOrders: new Map([[order.id, order]]),
    updateOrder: mocks.updateOrder,
    unlockOrder: mocks.unlockOrder,
    removeEcommerceDraftLocal: mocks.removeEcommerceDraftLocal
  };
  mocks.updateOrder.mockImplementation((orderId, patch) => {
    const current = mocks.state.activeOrders.get(orderId);
    mocks.state.activeOrders.set(orderId, { ...current, ...patch });
    return true;
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  configureState(createOrder());
  mocks.getSale.mockResolvedValue(undefined);
  mocks.firstSale.mockResolvedValue(null);
  mocks.unlockOrder.mockResolvedValue({ success: true });
  mocks.rpc.mockImplementation(async (name) => {
    if (name === 'ecommerce_get_pos_conversion_state') {
      return { data: remoteState(), error: null };
    }
    if (name === 'ecommerce_cancel_pos_conversion') {
      return {
        data: {
          success: true,
          changed: true,
          contractVersion: 2,
          conversionStatus: 'idle'
        },
        error: null
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
});

describe('recoverEcommercePosConversion', () => {
  it('recovers a cloud sale missing from Dexie without cancelling the reservation', async () => {
    mocks.verifyCommittedSale.mockResolvedValue({
      success: true,
      exists: true,
      saleId: 'ecom-order-1',
      cloudSaleId: 'cloud-sale-1',
      localSale: {
        id: 'ecom-order-1',
        status: 'closed',
        metadata: { ecommerceConversionKey: getEcommerceConversionKey('order-1') }
      }
    });

    const result = await recoverEcommercePosConversion({ orderId: 'ecom-order-1' });
    const updated = mocks.state.activeOrders.get('ecom-order-1');

    expect(result).toMatchObject({
      success: true,
      recoveredStatus: ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING,
      saleId: 'ecom-order-1'
    });
    expect(updated).toMatchObject({
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING,
      ecommerceConvertedSaleId: 'ecom-order-1',
      ecommerceRemoteConversionStatus: 'reserved'
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'ecommerce_cancel_pos_conversion',
      expect.anything()
    );
    expect(mocks.unlockOrder).not.toHaveBeenCalled();
  });

  it('keeps the reservation when the cloud verification is uncertain', async () => {
    mocks.verifyCommittedSale.mockResolvedValue({
      success: false,
      code: ECOMMERCE_SALE_VERIFICATION_PENDING,
      message: 'Cloud temporalmente no disponible'
    });

    const result = await recoverEcommercePosConversion({ orderId: 'ecom-order-1' });
    const updated = mocks.state.activeOrders.get('ecom-order-1');

    expect(result).toMatchObject({
      success: false,
      code: ECOMMERCE_SALE_VERIFICATION_PENDING,
      saleVerificationPending: true
    });
    expect(updated.ecommerceConversionAttemptId).toBe('attempt-1');
    expect(updated.ecommerceCheckoutSnapshot).toEqual({
      ecommerceConversionKey: getEcommerceConversionKey('order-1')
    });
    expect(updated).toMatchObject({
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.ERROR,
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceCheckoutGateStatus: 'blocked'
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'ecommerce_cancel_pos_conversion',
      expect.anything()
    );
  });

  it('releases the reservation only after local and cloud absence are confirmed', async () => {
    mocks.verifyCommittedSale.mockResolvedValue({ success: true, exists: false });

    const result = await recoverEcommercePosConversion({ orderId: 'ecom-order-1' });
    const updated = mocks.state.activeOrders.get('ecom-order-1');

    expect(result).toMatchObject({
      success: true,
      recoveredStatus: ECOMMERCE_CONVERSION_STATUS.ERROR,
      changed: true
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'ecommerce_cancel_pos_conversion',
      expect.objectContaining({
        p_attempt_id: 'attempt-1',
        p_sale_id: 'ecom-order-1',
        p_conversion_key: getEcommerceConversionKey('order-1')
      })
    );
    expect(mocks.unlockOrder).toHaveBeenCalledWith('ecom-order-1');
    expect(updated).toMatchObject({
      ecommerceRemoteConversionStatus: 'idle',
      ecommerceConversionAttemptId: null,
      ecommerceCheckoutSnapshot: null
    });
  });

  it('fails closed when the local idempotency read fails', async () => {
    mocks.getSale.mockRejectedValueOnce(new Error('DEXIE_READ_FAILED'));

    const result = await recoverEcommercePosConversion({ orderId: 'ecom-order-1' });
    const updated = mocks.state.activeOrders.get('ecom-order-1');

    expect(result).toMatchObject({
      success: false,
      code: ECOMMERCE_SALE_READ_FAILED,
      saleVerificationPending: true
    });
    expect(updated.ecommerceRemoteConversionStatus).toBe('reserved');
    expect(mocks.verifyCommittedSale).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'ecommerce_cancel_pos_conversion',
      expect.anything()
    );
  });

  it('allows validating/payment_pending recovery to release only after positive absence', async () => {
    configureState(createOrder({
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
      ecommerceSaleExecutionMode: 'local'
    }));

    const result = await recoverEcommercePosConversion({ orderId: 'ecom-order-1' });

    expect(result.success).toBe(true);
    expect(mocks.verifyCommittedSale).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      'ecommerce_cancel_pos_conversion',
      expect.anything()
    );
  });
});
