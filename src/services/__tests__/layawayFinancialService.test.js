import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMode: vi.fn(),
  getCurrentCashSession: vi.fn(),
  registerMovement: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  addPayment: vi.fn(),
  addPaymentWithCash: vi.fn(),
  confirmPayment: vi.fn(),
  beginRefund: vi.fn(),
  completeRefund: vi.fn(),
  cancel: vi.fn(),
  convertToSale: vi.fn(),
  canUseCloudLayawayCompletion: vi.fn(),
  processCloudLayawayCompletion: vi.fn()
}));

vi.mock('../db/layaways', () => ({
  layawayRepository: {
    getById: mocks.getById,
    create: mocks.create,
    addPayment: mocks.addPayment,
    addPaymentWithCash: mocks.addPaymentWithCash,
    confirmPayment: mocks.confirmPayment,
    beginRefund: mocks.beginRefund,
    completeRefund: mocks.completeRefund,
    cancel: mocks.cancel,
    convertToSale: mocks.convertToSale
  }
}));

vi.mock('../cash/cashRepository', () => ({
  cashRepository: {
    getMode: mocks.getMode,
    getCurrentCashSession: mocks.getCurrentCashSession,
    registerMovement: mocks.registerMovement
  }
}));

vi.mock('../salesCloud/salesCloudCashierService', () => ({
  salesCloudCashierService: {
    canUseCloudLayawayCompletion: mocks.canUseCloudLayawayCompletion,
    processCloudLayawayCompletion: mocks.processCloudLayawayCompletion
  }
}));

import { layawayFinancialService } from '../layawayFinancialService';

const layawayData = {
  id: 'layaway-1',
  customerId: 'customer-1',
  customerName: 'Cliente',
  items: [],
  totalAmount: 175,
  deadline: '2026-07-30'
};

const refundActorHandle = {
  actorKey: 'staff:refunds',
  assertCurrent: vi.fn(() => ({ actorKey: 'staff:refunds' }))
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMode.mockReturnValue({ cloudEnabled: false, online: true });
  mocks.getCurrentCashSession.mockResolvedValue({
    cashSession: { id: 'cash-1', estado: 'abierta' },
    readOnly: false
  });
  mocks.create.mockResolvedValue({ success: true, layaway: layawayData });
  mocks.addPaymentWithCash.mockResolvedValue({ success: true, newPaidAmount: 175 });
  mocks.confirmPayment.mockResolvedValue({ success: true, newPaidAmount: 75 });
  mocks.canUseCloudLayawayCompletion.mockResolvedValue(false);
  mocks.processCloudLayawayCompletion.mockResolvedValue({ success: true });
  mocks.convertToSale.mockResolvedValue({ success: true, saleId: 'local-sale-1' });
});

describe('layawayFinancialService', () => {
  it('denies direct cancellation before reading or mutating a layaway without refunds authority', async () => {
    const denied = new Error('ACTOR_PERMISSION_DENIED');
    denied.code = 'ACTOR_PERMISSION_DENIED';
    const deniedHandle = { assertCurrent: vi.fn(() => { throw denied; }) };

    await expect(layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      actorHandle: deniedHandle
    })).rejects.toMatchObject({ code: 'ACTOR_PERMISSION_DENIED' });
    expect(mocks.getById).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('registers a Free initial deposit atomically through the canonical cash options', async () => {
    await layawayFinancialService.create({
      layawayData,
      initialPayment: 75,
      paymentId: 'payment-1'
    });

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [, amount, cashSessionId, options] = mocks.create.mock.calls[0];
    expect(amount).toBe(75);
    expect(cashSessionId).toBe('cash-1');
    expect(options.cashMovement.idempotencyKey).toBe('layaway:layaway-1:payment:payment-1');
    expect(options.cashMovement.metadata).toMatchObject({
      source: 'layaway_payment',
      layawayId: 'layaway-1',
      paymentId: 'payment-1',
      paymentType: 'initial_deposit'
    });
  });

  it('registers a cloud initial deposit once and confirms the pending payment', async () => {
    mocks.getMode.mockReturnValue({ cloudEnabled: true, online: true });
    mocks.getById.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ success: true, layaway: { ...layawayData, paidAmount: 0, payments: [] } });
    mocks.registerMovement.mockResolvedValue({
      success: true,
      movement: { id: 'cloud-movement-1' }
    });

    await layawayFinancialService.create({ layawayData, initialPayment: 75, paymentId: 'payment-1' });

    expect(mocks.registerMovement).toHaveBeenCalledTimes(1);
    expect(mocks.registerMovement).toHaveBeenCalledWith(expect.objectContaining({
      type: 'entrada',
      amount: 75,
      idempotencyKey: 'layaway:layaway-1:payment:payment-1',
      metadata: expect.objectContaining({ layawayId: 'layaway-1', paymentId: 'payment-1' })
    }));
    expect(mocks.confirmPayment).toHaveBeenCalledWith('layaway-1', 'payment-1', 'cloud-movement-1', 'cash-1');
  });

  it('reuses the pending payment identity on a cloud retry', async () => {
    mocks.getMode.mockReturnValue({ cloudEnabled: true, online: true });
    mocks.getById.mockResolvedValue({
      ...layawayData,
      paidAmount: 0,
      payments: [{ id: 'payment-1', amount: 75, status: 'pending', idempotencyKey: 'layaway:layaway-1:payment:payment-1' }]
    });
    mocks.registerMovement.mockResolvedValue({ success: true, movement: { id: 'cloud-movement-1' } });

    await layawayFinancialService.create({ layawayData, initialPayment: 75, paymentId: 'new-ui-id' });

    expect(mocks.registerMovement.mock.calls[0][0].idempotencyKey).toBe('layaway:layaway-1:payment:payment-1');
    expect(mocks.confirmPayment).toHaveBeenCalledWith('layaway-1', 'payment-1', 'cloud-movement-1', 'cash-1');
  });

  it('rejects payments before touching the layaway when Caja is closed', async () => {
    mocks.getCurrentCashSession.mockResolvedValue({ cashSession: null, readOnly: false });

    await expect(layawayFinancialService.addPayment({ layawayId: 'layaway-1', amount: 100 })).rejects.toThrow('Debes abrir Caja');
    expect(mocks.addPayment).not.toHaveBeenCalled();
    expect(mocks.addPaymentWithCash).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('fails closed instead of converting locally when a cloud capability check errors', async () => {
    const capabilityError = new Error('DEVICE_ID_REQUIRED');
    capabilityError.code = 'DEVICE_ID_REQUIRED';
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      licenseDetails: { license_key: 'license-1' }
    });
    mocks.getById.mockResolvedValue({
      ...layawayData,
      status: 'ready',
      paidAmount: 175
    });
    mocks.canUseCloudLayawayCompletion.mockRejectedValue(capabilityError);

    await expect(layawayFinancialService.complete({ layawayId: 'layaway-1' }))
      .rejects.toMatchObject({ code: 'DEVICE_ID_REQUIRED' });

    expect(mocks.convertToSale).not.toHaveBeenCalled();
    expect(mocks.processCloudLayawayCompletion).not.toHaveBeenCalled();
  });

  it('uses the cloud completion operation once when a PRO apart​​ado is fully paid', async () => {
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      licenseDetails: { license_key: 'license-1' }
    });
    mocks.getById.mockResolvedValue({
      ...layawayData,
      status: 'ready',
      paidAmount: 175,
      items: [{
        id: 'product-1',
        name: 'Producto',
        quantity: 1,
        price: 175
      }]
    });
    mocks.canUseCloudLayawayCompletion.mockResolvedValue(true);

    await layawayFinancialService.complete({ layawayId: 'layaway-1' });

    expect(mocks.processCloudLayawayCompletion).toHaveBeenCalledWith(expect.objectContaining({
      licenseDetails: { license_key: 'license-1' },
      request: expect.objectContaining({
        layaway_id: 'layaway-1',
        payments: [expect.objectContaining({
          method: 'layaway_completed',
          amount: '175.00',
          received_amount: '175.00',
          change_amount: '0'
        })]
      })
    }));
    expect(mocks.convertToSale).not.toHaveBeenCalled();
  });

  it('records a cloud cancellation refund as one canonical exit', async () => {
    mocks.getMode.mockReturnValue({ cloudEnabled: true, online: true });
    mocks.getById.mockResolvedValue({ ...layawayData, paidAmount: 75, status: 'active', payments: [] });
    mocks.beginRefund.mockResolvedValue({
      success: true,
      pending: { refundId: 'refund-1', amount: 75, idempotencyKey: 'layaway:layaway-1:refund:refund-1' }
    });
    mocks.registerMovement.mockResolvedValue({ success: true, movement: { id: 'refund-movement-1' } });

    await layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      actorHandle: refundActorHandle
    });

    expect(mocks.registerMovement).toHaveBeenCalledWith(expect.objectContaining({
      type: 'salida',
      amount: 75,
      idempotencyKey: 'layaway:layaway-1:refund:refund-1'
    }));
    expect(mocks.completeRefund).toHaveBeenCalledWith(
      'layaway-1',
      'Cliente',
      'refund-movement-1',
      expect.objectContaining({ assertActorCurrent: expect.any(Function) })
    );
  });
});
