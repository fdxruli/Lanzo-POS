import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  getLicenseKeyFromDetails: vi.fn(() => 'LIC-1'),
  isCloudCustomerCreditSyncEnabled: vi.fn(() => true),
  pullIncremental: vi.fn(() => Promise.resolve()),
  getCashMode: vi.fn(() => ({ online: true })),
  applyCloudLedger: vi.fn(),
  pullCreditSnapshot: vi.fn(),
  createOrGetCustomerPaymentIntent: vi.fn(),
  executeCustomerPaymentIntent: vi.fn(),
  getPendingCustomerPaymentIntent: vi.fn(),
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
  actorKey: `${mocks.runtimeState.actorType}:staff-1`,
  actorId: 'staff-1',
  sessionId: 'session-1',
  generation: 1,
  deviceRef: 'device-1',
  tenant: { opaqueId: 'tenant-1', databaseName: 'tenant-db-1', generation: 1 },
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
    }),
    subscribe: vi.fn(() => () => {})
  },
  isActorRuntimeError: (error) => String(error?.code || '').startsWith('ACTOR_')
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(vi.fn(), { getState: mocks.getState })
}));

vi.mock('../../Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../utils', () => ({ showMessageModal: vi.fn() }));
vi.mock('../../sync/syncConstants', () => ({
  getLicenseKeyFromDetails: mocks.getLicenseKeyFromDetails,
  isCloudCustomerCreditSyncEnabled: mocks.isCloudCustomerCreditSyncEnabled,
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
  customerCreditCloudRepository: { getCustomerCreditSummary: vi.fn(), pullCreditSnapshot: mocks.pullCreditSnapshot }
}));
vi.mock('../customerCreditLocalRepository', () => ({
  customerCreditLocalRepository: {
    processPayment: mocks.localProcessPayment,
    applyCloudLedger: mocks.applyCloudLedger,
    applyCloudLedgers: vi.fn(() => Promise.resolve([]))
  }
}));
vi.mock('../../salesCloud/salesCloudLocalRepository', () => ({ salesCloudLocalRepository: {} }));
vi.mock('../customerCreditMapper', () => ({ receiptPayloadToLocal: (receipt) => receipt }));
vi.mock('../../financial/financialIntentLedger', () => ({
  createOrGetCustomerPaymentIntent: mocks.createOrGetCustomerPaymentIntent,
  executeCustomerPaymentIntent: mocks.executeCustomerPaymentIntent,
  getPendingCustomerPaymentIntent: mocks.getPendingCustomerPaymentIntent
}));
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
    mocks.getPendingCustomerPaymentIntent.mockResolvedValue(null);
    mocks.applyCloudLedger.mockResolvedValue(null);
    mocks.createOrGetCustomerPaymentIntent.mockResolvedValue({
      intent: { id: 'intent-1', status: 'PREPARED' }, reused: false, requestMatches: true
    });
    mocks.executeCustomerPaymentIntent.mockImplementation(async ({ actorHandle }) => {
      mocks.lastActorHandle = actorHandle;
      actorHandle.assertCurrent();
      // Model a permission revocation after the server has committed the payment.
      mocks.runtimeState = { actorType: 'staff', permissions: ['customers'] };
      actorHandle.assertCurrent();
      return { response: {
        success: true,
        new_debt: 90,
        ledger_entry: { id: 'ledger-1' },
        receipt: { customer_id: 'customer-1', amount: 10, new_debt: 90, ledger_id: 'ledger-1' }
      } };
    });
    mocks.localProcessPayment.mockResolvedValue({ success: true, newDebt: '90', ledgerId: 'local-ledger-1' });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reads scoped V3 credit as Staff without payment permission and never projects the ledger', async () => {
    mocks.runtimeState.permissions = ['customers'];
    mocks.pullCreditSnapshot.mockResolvedValue({
      success: true, snapshot_contract: 'keyset_reference_v1', snapshot_contract_version: 1,
      snapshot_reference_change_seq: 4, safe_change_seq: 4, sync_deferred: false, limit: 500,
      customer_id: 'customer-1', customers: [{ id: 'customer-1' }],
      ledger_entries: [{ id: 'ledger-1', customer_id: 'customer-1' }],
      snapshot_complete: true, has_more: false, next_page_cursor: null, ledger_reconciliation_complete: true
    });
    await expect(customerCreditRepository.pullCreditSnapshot({ customerId: 'customer-1' })).resolves.toMatchObject({
      customer_id: 'customer-1', snapshot_complete: true
    });
    expect(mocks.applyCloudLedger).not.toHaveBeenCalled();
    expect(mocks.executeCustomerPaymentIntent).not.toHaveBeenCalled();
    expect(mocks.pullCreditSnapshot).toHaveBeenCalledWith(expect.objectContaining({ licenseKey: 'LIC-1', customerId: 'customer-1' }));
  });

  it('denies Staff without the independent permission before calling a payment repository', async () => {
    mocks.runtimeState = { actorType: 'staff', permissions: ['customers'] };

    const result = await customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');

    expect(result).toMatchObject({
      success: false,
      code: 'CUSTOMER_PAYMENT_PERMISSION_DENIED',
      message: CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE
    });
    expect(mocks.executeCustomerPaymentIntent).not.toHaveBeenCalled();
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
    expect(mocks.executeCustomerPaymentIntent).not.toHaveBeenCalled();
    expect(mocks.localProcessPayment).not.toHaveBeenCalled();
  });

  it('keeps the committed result when the payment permission is revoked during the RPC', async () => {
    const result = await customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');

    expect(result).toMatchObject({ success: true, newDebt: '90', ledgerId: 'ledger-1' });
    expect(mocks.lastActorHandle.assertCurrent).toHaveBeenCalledWith('customer_payments');
    expect(mocks.lastActorHandle.assertCurrent).toHaveBeenCalledWith('customers');
    expect(mocks.lastActorHandle.assertCurrent).toHaveBeenCalledWith('customer_payments');
  });

  it('coalesces two same-runtime submissions into one financial intent and dispatch', async () => {
    let releaseDispatch;
    const dispatchGate = new Promise((resolve) => { releaseDispatch = resolve; });
    mocks.executeCustomerPaymentIntent.mockImplementation(async () => {
      await dispatchGate;
      return { response: { success: true, new_debt: 90, ledger_entry: { id: 'ledger-1' } } };
    });
    const first = customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');
    const second = customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');
    releaseDispatch();
    const results = await Promise.all([first, second]);

    expect(results[0]).toMatchObject({ success: true, ledgerId: 'ledger-1' });
    expect(results[1]).toMatchObject({ success: true, ledgerId: 'ledger-1' });
    expect(mocks.createOrGetCustomerPaymentIntent).toHaveBeenCalledTimes(1);
    expect(mocks.executeCustomerPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('returns a pending state after an uncertain Cloud response and does not call a new RPC key', async () => {
    const ambiguous = Object.assign(new TypeError('Failed to fetch'), {
      isFinancialOperationAmbiguous: true,
      financialStatus: 'PENDING_RECEIPT',
      financialIntentId: 'intent-pending'
    });
    mocks.executeCustomerPaymentIntent.mockRejectedValue(ambiguous);

    const result = await customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');

    expect(result).toMatchObject({
      success: false,
      code: 'CUSTOMER_PAYMENT_RESULT_PENDING',
      financialIntentId: 'intent-pending',
      message: 'No se pudo confirmar el resultado del abono. Estamos conservando esta operación para evitar duplicarla. Revisa su estado antes de registrar otro pago.'
    });
    expect(mocks.createOrGetCustomerPaymentIntent).toHaveBeenCalledTimes(1);
    expect(mocks.executeCustomerPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('keeps a confirmed payment successful when updating the local ledger projection fails', async () => {
    mocks.applyCloudLedger.mockRejectedValue(new Error('local cache unavailable'));

    const result = await customerCreditRepository.processPayment('customer-1', 10, 'efectivo', 'cash-1');

    expect(result).toMatchObject({ success: true, newDebt: '90', ledgerId: 'ledger-1' });
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
    expect(mocks.executeCustomerPaymentIntent).not.toHaveBeenCalled();
  });
});
