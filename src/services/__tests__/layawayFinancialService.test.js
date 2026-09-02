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
  processCloudLayawayCompletion: vi.fn(),
  processCloudLayawayCreate: vi.fn(),
  processCloudLayawayPayment: vi.fn(),
  processCloudLayawayCancel: vi.fn(),
  getLayaway: vi.fn(),
  isCloudLayawaysEnabled: vi.fn()
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

vi.mock('../cash/cashFinancialGate', () => ({
  CASH_FINANCIAL_CODES: {
    HANDOFF_REQUIRED: 'CASH_HANDOFF_REQUIRED',
    STATION_UNRESOLVED: 'CASH_STATION_UNRESOLVED',
    STATION_MISMATCH: 'CASH_SESSION_STATION_MISMATCH',
    SESSION_REQUIRED: 'CASH_SESSION_REQUIRED'
  },
  captureCashActorContext: () => ({
    actorKey: 'admin:1',
    generation: 1,
    assertCurrent: vi.fn()
  })
}));

vi.mock('../cash/cashStation', () => ({
  getCashStationIdentity: vi.fn(async () => ({ cashStationId: 'local:device:1' })),
  areCashStationsEquivalent: (left, right) => Boolean(left && right && left === right)
}));

vi.mock('../salesCloud/salesCloudCashierService', () => ({
  salesCloudCashierService: {
    canUseCloudLayawayCompletion: mocks.canUseCloudLayawayCompletion,
    processCloudLayawayCompletion: mocks.processCloudLayawayCompletion,
    processCloudLayawayCreate: mocks.processCloudLayawayCreate,
    processCloudLayawayPayment: mocks.processCloudLayawayPayment,
    processCloudLayawayCancel: mocks.processCloudLayawayCancel
  }
}));

vi.mock('../salesCloud/salesCloudRepository', () => ({
  salesCloudRepository: {
    getLayaway: mocks.getLayaway
  }
}));

vi.mock('../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: vi.fn((details) => details?.license_key || details?.licenseKey || null),
  isCloudLayawaysEnabled: mocks.isCloudLayawaysEnabled
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
  mocks.getMode.mockReturnValue({
    cloudEnabled: false,
    online: true,
    readOnly: false,
    actor: { actorKey: 'admin:1', isStaff: false, deviceRole: 'admin' }
  });
  mocks.getCurrentCashSession.mockResolvedValue({
    cashSession: {
      id: 'cash-1',
      estado: 'abierta',
      actorKey: 'admin:1',
      cashStationId: 'local:device:1'
    },
    cashStationId: 'local:device:1',
    financialState: { status: 'OWN_SESSION_OPEN' },
    readOnly: false
  });
  mocks.create.mockResolvedValue({ success: true, layaway: layawayData });
  mocks.getById.mockResolvedValue({ ...layawayData, paidAmount: 0, payments: [] });
  mocks.addPaymentWithCash.mockResolvedValue({ success: true, newPaidAmount: 175 });
  mocks.confirmPayment.mockResolvedValue({ success: true, newPaidAmount: 75 });
  mocks.canUseCloudLayawayCompletion.mockResolvedValue(false);
  mocks.processCloudLayawayCompletion.mockResolvedValue({ success: true });
  mocks.processCloudLayawayCreate.mockResolvedValue({ success: true, cloudCommitted: true });
  mocks.processCloudLayawayPayment.mockResolvedValue({ success: true, cloudCommitted: true });
  mocks.processCloudLayawayCancel.mockResolvedValue({ success: true, cloudCommitted: true });
  mocks.getLayaway.mockResolvedValue({ layaway: { ...layawayData, status: 'active', total_amount: 175, paid_amount: 75 } });
  mocks.isCloudLayawaysEnabled.mockReturnValue(false);
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
      paymentId: 'payment-1',
      expectedCashSessionId: 'cash-1'
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

  it('resolves the current session when the expected session is null', async () => {
    await layawayFinancialService.create({
      layawayData,
      initialPayment: 75,
      paymentId: 'payment-null-session',
      expectedCashSessionId: null
    });

    const [, , cashSessionId] = mocks.create.mock.calls[0];
    expect(cashSessionId).toBe('cash-1');
    expect(mocks.getCurrentCashSession).toHaveBeenCalledWith({ force: false });
  });

  it('blocks a stale expected session before creating the layaway or touching Caja', async () => {
    mocks.getCurrentCashSession.mockResolvedValue({
      cashSession: {
        id: 'cash-2',
        estado: 'abierta',
        actorKey: 'admin:1',
        cashStationId: 'local:device:1'
      },
      cashStationId: 'local:device:1',
      financialState: { status: 'OWN_SESSION_OPEN' },
      readOnly: false
    });

    await expect(layawayFinancialService.create({
      layawayData,
      initialPayment: 75,
      paymentId: 'payment-stale',
      expectedCashSessionId: 'cash-1'
    })).rejects.toMatchObject({
      code: 'CASH_SESSION_CHANGED',
      message: 'La caja cambió mientras confirmabas el apartado. Vuelve a abrir la ventana y reintenta.'
    });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('never uses the interface session id as a selector when it points to another session', async () => {
    await expect(layawayFinancialService.create({
      layawayData,
      initialPayment: 75,
      paymentId: 'payment-wrong-session',
      expectedCashSessionId: 'cash-foreign'
    })).rejects.toMatchObject({ code: 'CASH_SESSION_CHANGED' });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
    expect(mocks.getCurrentCashSession).toHaveBeenCalledWith({ force: false });
  });

  it('blocks a current session with another actor or station evidence', async () => {
    mocks.getCurrentCashSession.mockResolvedValueOnce({
      cashSession: {
        id: 'cash-foreign-actor',
        estado: 'abierta',
        actorKey: 'admin:other',
        cashStationId: 'local:device:1'
      },
      cashStationId: 'local:device:1',
      financialState: { status: 'OWN_SESSION_OPEN' },
      readOnly: false
    });

    await expect(layawayFinancialService.create({
      layawayData,
      initialPayment: 75,
      paymentId: 'payment-foreign-actor'
    })).rejects.toMatchObject({ code: 'CASH_HANDOFF_REQUIRED' });

    mocks.getCurrentCashSession.mockResolvedValueOnce({
      cashSession: {
        id: 'cash-foreign-station',
        estado: 'abierta',
        actorKey: 'admin:1',
        cashStationId: 'local:device:2'
      },
      cashStationId: 'local:device:1',
      financialState: { status: 'OWN_SESSION_OPEN' },
      readOnly: false
    });

    await expect(layawayFinancialService.create({
      layawayData,
      initialPayment: 75,
      paymentId: 'payment-foreign-station'
    })).rejects.toMatchObject({ code: 'CASH_SESSION_STATION_MISMATCH' });

    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a layaway without consulting Caja when there is no initial payment', async () => {
    await layawayFinancialService.create({
      layawayData,
      initialPayment: 0,
      expectedCashSessionId: 'stale-session-ignored'
    });

    expect(mocks.create).toHaveBeenCalledWith(layawayData, 0, null);
    expect(mocks.getCurrentCashSession).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('fails closed instead of creating a hybrid cloud layaway', async () => {
    mocks.getMode.mockReturnValue({ cloudEnabled: true, online: true });

    await expect(layawayFinancialService.create({
      layawayData,
      initialPayment: 75,
      paymentId: 'payment-1'
    })).rejects.toMatchObject({
      code: 'CLOUD_LAYAWAYS_DISABLED'
    });

    expect(mocks.getCurrentCashSession).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('fails closed before mutating a cloud layaway payment', async () => {
    mocks.getMode.mockReturnValue({ cloudEnabled: true, online: true });
    mocks.getById.mockResolvedValue({
      ...layawayData,
      paidAmount: 0,
      payments: []
    });

    await expect(layawayFinancialService.addPayment({
      layawayId: 'layaway-1',
      amount: 75,
      paymentId: 'payment-1'
    })).rejects.toMatchObject({
      code: 'CLOUD_LAYAWAYS_DISABLED'
    });

    expect(mocks.getCurrentCashSession).not.toHaveBeenCalled();
    expect(mocks.getById).not.toHaveBeenCalled();
    expect(mocks.addPayment).not.toHaveBeenCalled();
    expect(mocks.addPaymentWithCash).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('routes a cloud layaway without an initial payment exclusively through the cloud adapter', async () => {
    const licenseDetails = { license_key: 'license-1' };
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      readOnly: false,
      licenseDetails,
      actor: { actorKey: 'admin:1', isStaff: false, deviceRole: 'admin' }
    });
    mocks.isCloudLayawaysEnabled.mockReturnValue(true);

    await layawayFinancialService.create({ layawayData, initialPayment: 0, paymentId: 'payment-1' });

    expect(mocks.processCloudLayawayCreate).toHaveBeenCalledWith(expect.objectContaining({
      layawayData,
      initialPayment: null,
      cashSessionId: null,
      licenseDetails
    }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.getCurrentCashSession).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('routes a cloud initial payment with the resolved session and never creates a local pending record', async () => {
    const licenseDetails = { license_key: 'license-1' };
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      readOnly: false,
      licenseDetails,
      actor: { actorKey: 'admin:1', isStaff: false, deviceRole: 'admin' }
    });
    mocks.isCloudLayawaysEnabled.mockReturnValue(true);

    await layawayFinancialService.create({
      layawayData,
      initialPayment: 75,
      paymentId: 'payment-cloud-1',
      expectedCashSessionId: 'cash-1'
    });

    expect(mocks.processCloudLayawayCreate).toHaveBeenCalledWith(expect.objectContaining({
      layawayData,
      cashSessionId: 'cash-1',
      licenseDetails,
      initialPayment: expect.objectContaining({
        id: 'payment-cloud-1',
        amount: 75,
        status: 'pending'
      })
    }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.addPaymentWithCash).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('routes a cloud installment through the atomic adapter using the current cash session', async () => {
    const licenseDetails = { license_key: 'license-1' };
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      readOnly: false,
      licenseDetails,
      actor: { actorKey: 'admin:1', isStaff: false, deviceRole: 'admin' }
    });
    mocks.isCloudLayawaysEnabled.mockReturnValue(true);

    await layawayFinancialService.addPayment({
      layawayId: 'layaway-1',
      amount: 75,
      paymentId: 'payment-cloud-2',
      expectedCashSessionId: 'cash-1'
    });

    expect(mocks.processCloudLayawayPayment).toHaveBeenCalledWith(expect.objectContaining({
      layawayId: 'layaway-1',
      cashSessionId: 'cash-1',
      licenseDetails,
      payment: expect.objectContaining({ id: 'payment-cloud-2', amount: 75 })
    }));
    expect(mocks.getById).not.toHaveBeenCalled();
    expect(mocks.addPaymentWithCash).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('cancels a cloud layaway from the authoritative snapshot without a local refund path', async () => {
    const licenseDetails = { license_key: 'license-1' };
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      readOnly: false,
      licenseDetails,
      actor: { actorKey: 'admin:1', isStaff: false, deviceRole: 'admin' }
    });
    mocks.isCloudLayawaysEnabled.mockReturnValue(true);
    mocks.getLayaway.mockResolvedValue({
      layaway: { ...layawayData, total_amount: 175, paid_amount: 75, status: 'active' }
    });

    await layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      retainMoney: true,
      refundId: 'refund-cloud-1',
      actorHandle: refundActorHandle
    });

    expect(mocks.getLayaway).toHaveBeenCalledWith({ licenseKey: 'license-1', layawayId: 'layaway-1', force: true });
    expect(mocks.processCloudLayawayCancel).toHaveBeenCalledWith(expect.objectContaining({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      retainMoney: true,
      refundId: 'refund-cloud-1',
      cashSessionId: null,
      actorHandle: refundActorHandle,
      licenseDetails
    }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.beginRefund).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('requires and forwards the resolved cash session for a cloud refund', async () => {
    const licenseDetails = { license_key: 'license-1' };
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      readOnly: false,
      licenseDetails,
      actor: { actorKey: 'admin:1', isStaff: false, deviceRole: 'admin' }
    });
    mocks.isCloudLayawaysEnabled.mockReturnValue(true);
    mocks.getLayaway.mockResolvedValue({
      layaway: { ...layawayData, total_amount: 175, paid_amount: 75, status: 'active' }
    });

    await layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      refundId: 'refund-cloud-2',
      actorHandle: refundActorHandle,
      expectedCashSessionId: 'cash-1'
    });

    expect(mocks.processCloudLayawayCancel).toHaveBeenCalledWith(expect.objectContaining({
      layawayId: 'layaway-1',
      retainMoney: false,
      refundId: 'refund-cloud-2',
      cashSessionId: 'cash-1'
    }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('registers a subsequent payment only against the resolved current session', async () => {
    await layawayFinancialService.addPayment({
      layawayId: 'layaway-1',
      amount: 75,
      paymentId: 'payment-installment',
      expectedCashSessionId: 'cash-1'
    });

    expect(mocks.addPaymentWithCash).toHaveBeenCalledWith(
      'layaway-1',
      expect.objectContaining({ id: 'payment-installment', amount: 75 }),
      'cash-1',
      expect.objectContaining({ idempotencyKey: 'layaway:layaway-1:payment:payment-installment' })
    );
  });

  it('does not create a payment when the current session changed', async () => {
    mocks.getCurrentCashSession.mockResolvedValue({
      cashSession: {
        id: 'cash-2',
        estado: 'abierta',
        actorKey: 'admin:1',
        cashStationId: 'local:device:1'
      },
      cashStationId: 'local:device:1',
      financialState: { status: 'OWN_SESSION_OPEN' },
      readOnly: false
    });

    await expect(layawayFinancialService.addPayment({
      layawayId: 'layaway-1',
      amount: 75,
      paymentId: 'payment-stale-installment',
      expectedCashSessionId: 'cash-1'
    })).rejects.toMatchObject({ code: 'CASH_SESSION_CHANGED' });

    expect(mocks.addPaymentWithCash).not.toHaveBeenCalled();
    expect(mocks.addPayment).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('rejects payments before touching the layaway when Caja is closed', async () => {
    mocks.getCurrentCashSession.mockResolvedValue({ cashSession: null, readOnly: false });

    await expect(layawayFinancialService.addPayment({ layawayId: 'layaway-1', amount: 100 }))
      .rejects.toThrow('Debes abrir Caja');
    expect(mocks.addPayment).not.toHaveBeenCalled();
    expect(mocks.addPaymentWithCash).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('fails closed instead of completing a cloud layaway without a cloud entity', async () => {
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

    await expect(layawayFinancialService.complete({ layawayId: 'layaway-1' }))
      .rejects.toMatchObject({
        code: 'CLOUD_LAYAWAYS_DISABLED'
      });

    expect(mocks.canUseCloudLayawayCompletion).not.toHaveBeenCalled();
    expect(mocks.convertToSale).not.toHaveBeenCalled();
    expect(mocks.processCloudLayawayCompletion).not.toHaveBeenCalled();
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it('delivers a cloud layaway from the server snapshot without a second cash movement', async () => {
    const licenseDetails = { license_key: 'license-1' };
    const cloudLayaway = {
      id: 'layaway-1',
      status: 'ready',
      customer_id: 'customer-1',
      customer_name: 'Cliente',
      total_amount: '175.00',
      paid_amount: '175.00',
      currency: 'MXN',
      deadline: '2026-07-30T00:00:00.000000Z',
      items: [{ id: 'item-1', product_id: 'product-1', product_name: 'Producto server', quantity: 1, unit_price: '175.00' }]
    };
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      readOnly: false,
      licenseDetails,
      actor: { actorKey: 'admin:1', isStaff: false, deviceRole: 'admin' }
    });
    mocks.isCloudLayawaysEnabled.mockReturnValue(true);
    mocks.canUseCloudLayawayCompletion.mockResolvedValue(true);
    mocks.getLayaway.mockResolvedValue({ layaway: cloudLayaway });

    await layawayFinancialService.complete({ layawayId: 'layaway-1' });

    expect(mocks.getLayaway).toHaveBeenCalledWith({ licenseKey: 'license-1', layawayId: 'layaway-1', force: true });
    expect(mocks.processCloudLayawayCompletion).toHaveBeenCalledWith(expect.objectContaining({
      licenseDetails,
      request: expect.objectContaining({
        layaway_id: 'layaway-1',
        items: [expect.objectContaining({ product_name: 'Producto server' })],
        payments: [expect.objectContaining({ method: 'layaway_completed', amount: '175' })]
      })
    }));
    expect(mocks.convertToSale).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it.each([
    ['paid layaway refund', { retainMoney: false, refundId: 'refund-paid' }],
    ['retained funds', { retainMoney: true, refundId: 'refund-retained' }],
    ['zero-payment layaway', { retainMoney: false, refundId: 'refund-zero' }],
    ['pending-refund retry', { retainMoney: false, refundId: 'refund-pending' }]
  ])('blocks cloud cancellation before any repository or Caja access (%s)', async (_scenario, options) => {
    mocks.getMode.mockReturnValue({
      cloudEnabled: true,
      online: true,
      readOnly: false,
      actor: { actorKey: 'admin:1', isStaff: false, deviceRole: 'admin' }
    });

    await expect(layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      actorHandle: refundActorHandle,
      ...options
    })).rejects.toMatchObject({ code: 'CLOUD_LAYAWAYS_DISABLED' });

    expect(mocks.getMode).toHaveBeenCalledTimes(1);
    expect(mocks.getById).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.beginRefund).not.toHaveBeenCalled();
    expect(mocks.completeRefund).not.toHaveBeenCalled();
    expect(mocks.getCurrentCashSession).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('cancels a local layaway without payment without consulting Caja', async () => {
    mocks.getById.mockResolvedValue({ ...layawayData, paidAmount: 0, status: 'active', payments: [] });
    mocks.cancel.mockResolvedValue({ success: true, cashMovementId: null });

    await layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      actorHandle: refundActorHandle
    });

    expect(mocks.cancel).toHaveBeenCalledWith(
      'layaway-1',
      'Cliente',
      false,
      null,
      expect.objectContaining({ assertActorCurrent: expect.any(Function) })
    );
    expect(mocks.getCurrentCashSession).not.toHaveBeenCalled();
    expect(mocks.beginRefund).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('cancels a local paid layaway retaining funds without consulting Caja', async () => {
    mocks.getById.mockResolvedValue({ ...layawayData, paidAmount: 75, status: 'active', payments: [] });
    mocks.cancel.mockResolvedValue({ success: true, cashMovementId: null });

    await layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      retainMoney: true,
      actorHandle: refundActorHandle
    });

    expect(mocks.cancel).toHaveBeenCalledWith(
      'layaway-1',
      'Cliente',
      true,
      null,
      expect.objectContaining({ assertActorCurrent: expect.any(Function) })
    );
    expect(mocks.getCurrentCashSession).not.toHaveBeenCalled();
    expect(mocks.beginRefund).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
  });

  it('registers a local refund through one canonical cash exit', async () => {
    mocks.getById.mockResolvedValue({ ...layawayData, paidAmount: 75, status: 'active', payments: [] });
    mocks.beginRefund.mockResolvedValue({
      success: true,
      pending: {
        refundId: 'refund-1',
        amount: 75,
        idempotencyKey: 'layaway:layaway-1:refund:refund-1',
        createdAt: '2026-07-20T10:00:00.000Z'
      }
    });
    mocks.cancel.mockResolvedValue({ success: true, cashMovementId: 'refund-movement-1' });

    await layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      actorHandle: refundActorHandle,
      expectedCashSessionId: 'cash-1'
    });

    expect(mocks.getCurrentCashSession).toHaveBeenCalledWith({ force: false });
    expect(mocks.beginRefund).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledWith(
      'layaway-1',
      'Cliente',
      false,
      'cash-1',
      expect.objectContaining({
        assertActorCurrent: expect.any(Function),
        cashMovement: expect.objectContaining({
          cashSessionId: 'cash-1',
          idempotencyKey: 'layaway:layaway-1:refund:refund-1',
          createdAt: '2026-07-20T10:00:00.000Z'
        })
      })
    );
    expect(mocks.registerMovement).not.toHaveBeenCalled();
    expect(mocks.completeRefund).not.toHaveBeenCalled();
  });

  it('blocks a local refund before creating pendingRefund when the expected session is stale', async () => {
    mocks.getById.mockResolvedValue({ ...layawayData, paidAmount: 75, status: 'active', payments: [] });
    mocks.getCurrentCashSession.mockResolvedValue({
      cashSession: {
        id: 'cash-2',
        estado: 'abierta',
        actorKey: 'admin:1',
        cashStationId: 'local:device:1'
      },
      cashStationId: 'local:device:1',
      financialState: { status: 'OWN_SESSION_OPEN' },
      readOnly: false
    });

    await expect(layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      actorHandle: refundActorHandle,
      expectedCashSessionId: 'cash-1'
    })).rejects.toMatchObject({ code: 'CASH_SESSION_CHANGED' });

    expect(mocks.beginRefund).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
    expect(mocks.completeRefund).not.toHaveBeenCalled();
  });

  it('replays an already completed local refund without a second cash exit', async () => {
    mocks.getById.mockResolvedValue({ ...layawayData, paidAmount: 75, status: 'active', payments: [] });
    mocks.beginRefund.mockResolvedValue({
      success: true,
      duplicate: true,
      layaway: { ...layawayData, paidAmount: 75, status: 'cancelled' },
      cashMovementId: 'refund-movement-1'
    });

    const result = await layawayFinancialService.cancel({
      layawayId: 'layaway-1',
      reason: 'Cliente',
      actorHandle: refundActorHandle,
      expectedCashSessionId: 'cash-1'
    });

    expect(result).toMatchObject({ success: true, duplicate: true });
    expect(mocks.beginRefund).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.registerMovement).not.toHaveBeenCalled();
    expect(mocks.completeRefund).not.toHaveBeenCalled();
  });
});
