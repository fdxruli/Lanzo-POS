import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  getLicenseKeyFromDetails: vi.fn(() => 'LIC-1'),
  isCloudCustomerCreditSyncEnabled: vi.fn(() => true),
  generateIdempotencyKey: vi.fn(() => 'payment-idem-1'),
  pullIncremental: vi.fn(() => Promise.resolve()),
  getCashMode: vi.fn(() => ({ online: true })),
  recordCustomerPayment: vi.fn(),
  localProcessPayment: vi.fn(),
  runtimeState: { actorType: 'staff', permissions: ['customers', 'customer_payments'] },
  lastActorHandle: null
}));

const permissionError = (permission) => {
  const error = new Error(`ACTOR_PERMISSION_DENIED:${permission}`);
  error.code = 'ACTOR_PERMISSION_DENIED';
  return error;
};

const createActorHandle = (requiredPermission) => ({
  actorType: mocks.runtimeState.actorType,
  assertCurrent: vi.fn((permission = requiredPermission) => {
    if (mocks.runtimeState.actorType === 'staff'
      && !mocks.runtimeState.permissions.includes(permission)) {
      throw permissionError(permission);
    }
    return { actorType: mocks.runtimeState.actorType };
  })
});

vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: {
    getState: () => mocks.runtimeState,
    capture: vi.fn((permission) => {
      const handle = createActorHandle(permission);
      handle.assertCurrent(permission);
      return handle;
    })
  },
  isActorRuntimeError: (error) => String(error?.code || '').startsWith('ACTOR_')
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(vi.fn(), { getState: mocks.getState })
}));

vi.mock('../../Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../utils', () => ({ showMessageModal: vi.fn() }));
vi.mock('../../sync/idempotency', () => ({ generateIdempotencyKey: mocks.generateIdempotencyKey }));
vi.mock('../../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: mocks.getLicenseKeyFromDetails,
  isCloudCustomerCreditSyncEnabled: mocks.isCloudCustomerCreditSyncEnabled,
  SYNC_ENTITY_TYPES: { CUSTOMER_LEDGER: 'customer_ledger' },
  SYNC_OPERATIONS: { CREATE: 'create' }
}));
vi.mock('../../sync/posSyncOrchestrator', () => ({ posSyncOrchestrator: { pullIncremental: mocks.pullIncremental } }));
vi.mock('../../customers/customerLocalRepository', () => ({
  customerLocalRepository: { applyCloudCustomers: vi.fn(() => Promise.resolve([])) }
}));
vi.mock('../../cash/cashLocalRepository', () => ({
  cashLocalRepository: {
    applyCloudCashMovements: vi.fn(() => Promise.resolve([])),
    applyCloudCashSessions: vi.fn(() => Promise.resolve([]))
  }
}));
vi.mock('../../cash/cashActor', () => ({ getCashMode: mocks.getCashMode }));
vi.mock('../customerCreditCloudRepository', () => ({
  customerCreditCloudRepository: { recordCustomerPayment: mocks.recordCustomerPayment }
}));
vi.mock('../customerCreditLocalRepository', () => ({
  customerCreditLocalRepository: {
    processPayment: mocks.localProcessPayment,
    applyCloudLedger: vi.fn(() => Promise.resolve(null)),
    applyCloudLedgers: vi.fn(() => Promise.resolve([]))
  }
}));
vi.mock('../../salesCloud/salesCloudLocalRepository', () => ({ salesCloudLocalRepository: {} }));
vi.mock('../customerCreditMapper', () => ({ receiptPayloadToLocal: (receipt) => receipt }));
vi.mock('../customerCreditSyncHandler', () => ({}));

import { customerCreditRepository, CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE } from '../customerCreditRepository';

describe('customer payment service authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeState = { actorType: 'staff', permissions: ['customers', 'customer_payments'] };
    mocks.getState.mockReturnValue({
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-1' },
      licenseDetails: { license_key: 'LIC-1' }
    });
    mocks.isCloudCustomerCreditSyncEnabled.mockReturnValue(true);
    mocks.recordCustomerPayment.mockImplementation(async ({ actorHandle }) => {
      mocks.lastActorHandle = actorHandle;
      actorHandle.assertCurrent();
      // Model a permission revocation after the server has committed the payment.
      mocks.runtimeState = { actorType: 'staff', permissions: ['customers'] };
      actorHandle.assertCurrent();
      return {
        success: true,
        new_debt: 90,
        ledger_entry: { id: 'ledger-1' },
        receipt: { customer_id: 'customer-1', amount: 10, new_debt: 90, ledger_id: 'ledger-1' }
      };
    });
    mocks.localProcessPayment.mockResolvedValue({ success: true, newDebt: '90', ledgerId: 'local-ledger-1' });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('denies Staff without the independent permission before calling a payment repository', async () => {
    mocks.runtimeState = { actorType: 'staff', permissions: ['customers'] };

    const result = await customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');

    expect(result).toMatchObject({
      success: false,
      code: 'CUSTOMER_PAYMENT_PERMISSION_DENIED',
      message: CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE
    });
    expect(mocks.recordCustomerPayment).not.toHaveBeenCalled();
    expect(mocks.localProcessPayment).not.toHaveBeenCalled();
  });

  it('denies payment permission when Staff lacks Customers access', async () => {
    mocks.runtimeState = { actorType: 'staff', permissions: ['customer_payments'] };

    const result = await customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');

    expect(result).toMatchObject({
      success: false,
      code: 'CUSTOMER_PAYMENT_PERMISSION_DENIED',
      message: CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE
    });
    expect(mocks.recordCustomerPayment).not.toHaveBeenCalled();
    expect(mocks.localProcessPayment).not.toHaveBeenCalled();
  });

  it('keeps the committed result when the payment permission is revoked during the RPC', async () => {
    const result = await customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');

    expect(result).toMatchObject({ success: true, newDebt: '90', ledgerId: 'ledger-1' });
    expect(mocks.lastActorHandle.assertCurrent).toHaveBeenCalledWith('customer_payments');
    expect(mocks.lastActorHandle.assertCurrent).toHaveBeenCalledWith('customers');
    expect(mocks.lastActorHandle.assertCurrent.mock.calls.filter(([permission]) => permission === 'customer_payments'))
      .toHaveLength(2);
  });

  it('preserves the local Admin path and never writes a Cloud payment while offline', async () => {
    mocks.isCloudCustomerCreditSyncEnabled.mockReturnValue(false);
    mocks.runtimeState = { actorType: 'admin', permissions: ['*'] };
    mocks.getState.mockReturnValue({ currentDeviceRole: 'admin', licenseDetails: null });

    await expect(customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1'))
      .resolves.toMatchObject({ success: true });
    expect(mocks.localProcessPayment).toHaveBeenCalledTimes(1);

    mocks.localProcessPayment.mockClear();
    mocks.isCloudCustomerCreditSyncEnabled.mockReturnValue(true);
    mocks.runtimeState = { actorType: 'staff', permissions: ['customers', 'customer_payments'] };
    vi.stubGlobal('navigator', { onLine: false });

    const offlineResult = await customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');

    expect(offlineResult.code).toBe('CUSTOMER_CREDIT_CLOUD_OFFLINE');
    expect(mocks.localProcessPayment).not.toHaveBeenCalled();
    expect(mocks.recordCustomerPayment).not.toHaveBeenCalled();
  });
});
