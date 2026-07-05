import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: vi.fn(() => 'lic-1'),
  isRestaurantOrdersCloudEnabled: vi.fn(() => true)
}));

vi.mock('../../restaurant/restaurantOrdersRepository', () => ({
  restaurantOrdersRepository: {
    closeRestaurantOrderAfterCheckout: vi.fn(async () => ({ success: true, code: 'OK' }))
  }
}));

vi.mock('../../../utils/businessType', () => ({
  CANONICAL_BUSINESS_TYPES: { FOOD_SERVICE: 'food_service' }
}));

import {
  buildRestaurantSplitCheckoutCloseIdempotencyKey,
  buildSplitCheckoutClosePayload,
  closeRestaurantCloudOrderAfterSuccessfulSplitPayment,
  retryPendingRestaurantCloudOrderCloses
} from '../../restaurant/restaurantOrderCheckoutClose';
import { restaurantOrdersRepository } from '../../restaurant/restaurantOrdersRepository';

const STORAGE_KEY = 'lanzo:restaurant-order-close-pending:v1';
const features = { activeRubros: ['food_service'], hasTables: true };
const licenseDetails = { valid: true };

const splitResult = {
  splitGroupId: 'spl-1',
  parentOrderId: 'sale-open-1',
  childSaleIds: ['sal-a', 'sal-b'],
  total: '500',
  paymentSummary: {
    source: 'split_bill',
    splitGroupId: 'spl-1',
    parentOrderId: 'sale-open-1',
    childSaleIds: ['sal-a', 'sal-b'],
    tickets: [
      { label: 'A', saleId: 'sal-a', paymentMethod: 'efectivo', amountPaid: '250', saldoPendiente: '0', total: '250' },
      { label: 'B', saleId: 'sal-b', paymentMethod: 'fiado', amountPaid: '100', saldoPendiente: '150', customerId: 'cust-1', total: '250' }
    ],
    methods: ['efectivo', 'fiado'],
    amountPaidTotal: '350',
    balanceDueTotal: '150',
    total: '500',
    sourceMode: 'shadow/local_applied'
  }
};

const installStorage = () => {
  const store = new Map();
  const localStorage = {
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => store.set(key, String(value))),
    removeItem: vi.fn((key) => store.delete(key)),
    clear: vi.fn(() => store.clear())
  };

  vi.stubGlobal('window', { localStorage });
  return { store, localStorage };
};

const setOnline = (online) => {
  vi.stubGlobal('navigator', { onLine: online });
};

const readPending = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');

describe('restaurantOrderCheckoutClose split bill support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installStorage();
    setOnline(true);
    restaurantOrdersRepository.closeRestaurantOrderAfterCheckout.mockResolvedValue({ success: true, code: 'OK' });
  });

  it('builds stable split idempotency key and payload', () => {
    expect(buildRestaurantSplitCheckoutCloseIdempotencyKey({
      localOrderId: 'sale-open-1',
      splitGroupId: 'spl-1'
    })).toBe('restaurant:checkout-close:split:sale-open-1:spl-1');

    const payload = buildSplitCheckoutClosePayload({ localOrderId: 'sale-open-1', splitResult });

    expect(payload).toMatchObject({
      localOrderId: 'sale-open-1',
      paidSaleId: 'spl-1',
      paidSaleFolio: 'SPLIT-spl-1',
      paidTotal: 500,
      idempotencyKey: 'restaurant:checkout-close:split:sale-open-1:spl-1'
    });
    expect(payload.paymentSummary).toMatchObject({
      source: 'split_bill',
      splitGroupId: 'spl-1',
      parentOrderId: 'sale-open-1',
      childSaleIds: ['sal-a', 'sal-b'],
      sourceMode: 'shadow/local_applied'
    });
    expect(payload.paymentSummary.tickets[1]).toMatchObject({
      label: 'B',
      paymentMethod: 'fiado',
      amountPaid: '100',
      saldoPendiente: '150',
      customerId: 'cust-1'
    });
  });

  it('sends split checkout close payload to repository when online', async () => {
    const response = await closeRestaurantCloudOrderAfterSuccessfulSplitPayment({
      localOrderId: 'sale-open-1',
      splitResult,
      licenseDetails,
      saleTotal: '500',
      features
    });

    expect(response).toEqual({ success: true, code: 'OK' });
    expect(restaurantOrdersRepository.closeRestaurantOrderAfterCheckout).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'lic-1',
      localOrderId: 'sale-open-1',
      paidSaleId: 'spl-1',
      paidSaleFolio: 'SPLIT-spl-1',
      paidTotal: 500,
      idempotencyKey: 'restaurant:checkout-close:split:sale-open-1:spl-1',
      paymentSummary: expect.objectContaining({ source: 'split_bill' })
    }));
  });

  it('saves pending split close when offline', async () => {
    setOnline(false);

    const response = await closeRestaurantCloudOrderAfterSuccessfulSplitPayment({
      localOrderId: 'sale-open-1',
      splitResult,
      licenseDetails,
      features
    });

    expect(response).toMatchObject({ success: false, retryable: true, pendingSaved: true });
    expect(restaurantOrdersRepository.closeRestaurantOrderAfterCheckout).not.toHaveBeenCalled();

    const pending = readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      localOrderId: 'sale-open-1',
      idempotencyKey: 'restaurant:checkout-close:split:sale-open-1:spl-1',
      paymentSummary: expect.objectContaining({ source: 'split_bill' })
    });
  });

  it('saves pending split close when repository returns failure', async () => {
    restaurantOrdersRepository.closeRestaurantOrderAfterCheckout.mockResolvedValue({
      success: false,
      code: 'RPC_FAILED',
      message: 'boom'
    });

    const response = await closeRestaurantCloudOrderAfterSuccessfulSplitPayment({
      localOrderId: 'sale-open-1',
      splitResult,
      licenseDetails,
      features
    });

    expect(response).toMatchObject({ success: false, retryable: true, pendingSaved: true });
    const pending = readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].lastError).toBe('boom');
  });

  it('retries pending split close without losing paymentSummary', async () => {
    const payload = buildSplitCheckoutClosePayload({ localOrderId: 'sale-open-1', splitResult });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ ...payload, retryCount: 0 }]));

    const response = await retryPendingRestaurantCloudOrderCloses({
      licenseDetails,
      features,
      maxRetries: 1
    });

    expect(response).toMatchObject({ success: true, closed: 1, failed: 0, total: 1 });
    expect(restaurantOrdersRepository.closeRestaurantOrderAfterCheckout).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'lic-1',
      localOrderId: 'sale-open-1',
      idempotencyKey: 'restaurant:checkout-close:split:sale-open-1:spl-1',
      paymentSummary: expect.objectContaining({
        source: 'split_bill',
        childSaleIds: ['sal-a', 'sal-b']
      })
    }));
    expect(readPending()).toEqual([]);
  });
});