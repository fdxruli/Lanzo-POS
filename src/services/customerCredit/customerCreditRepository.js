import Logger from '../Logger';
import { showMessageModal } from '../utils';
import { Money } from '../../utils/moneyMath';
import { useAppStore } from '../../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  isCloudCustomerCreditSyncEnabled,
} from '../sync/syncConstants';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { customerLocalRepository } from '../customers/customerLocalRepository';
import { assertCustomerReadContext, validateCustomerSnapshotPage } from '../customers/customerSnapshotReader';
import { cashLocalRepository } from '../cash/cashLocalRepository';
import { getCashMode } from '../cash/cashActor';
import { customerCreditCloudRepository } from './customerCreditCloudRepository';
import { customerCreditLocalRepository } from './customerCreditLocalRepository';
import { salesCloudLocalRepository } from '../salesCloud/salesCloudLocalRepository';
import { receiptPayloadToLocal } from './customerCreditMapper';
import { actorRuntimeController, isActorRuntimeError } from '../auth/actorRuntimeController';
import {
  createOrGetCustomerPaymentIntent,
  executeCustomerPaymentIntent,
  getPendingCustomerPaymentIntent
} from '../financial/financialIntentLedger';

import './customerCreditSyncHandler';

export const CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE = 'Los abonos cloud requieren conexion para proteger la deuda del cliente y el dinero en caja. Revisa tu conexion e intenta de nuevo.';
export const CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE = 'Tu usuario puede consultar clientes, pero no tiene autorización para registrar abonos. Solicita al Administrador que active “Registrar abonos”.';
export const CUSTOMER_PAYMENT_PENDING_MESSAGE = 'No se pudo confirmar el resultado del abono. Estamos conservando esta operación para evitar duplicarla. Revisa su estado antes de registrar otro pago.';

const customerPaymentFlights = new Map();

const customerPaymentPendingFailure = (error = null) => fail(
  CUSTOMER_PAYMENT_PENDING_MESSAGE,
  'CUSTOMER_PAYMENT_RESULT_PENDING',
  { error, financialIntentId: error?.financialIntentId || null }
);

const fail = (message, code = 'CUSTOMER_CREDIT_ERROR', extra = {}) => ({
  success: false,
  code,
  message,
  ...extra
});

const isCashPaymentMethod = (paymentMethod) => (
  ['efectivo', 'cash'].includes(String(paymentMethod || '').trim().toLowerCase())
);

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const getMode = () => {
  const state = useAppStore.getState();
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const cloudEnabled = Boolean(licenseKey && isCloudCustomerCreditSyncEnabled(licenseDetails));

  return {
    appStatus: state?.appStatus,
    currentDeviceRole: state?.currentDeviceRole,
    currentStaffUser: state?.currentStaffUser,
    licenseDetails,
    licenseKey,
    cloudEnabled,
    online: isOnline(),
    cashMode: getCashMode()
  };
};

const capturePaymentActor = (mode) => {
  const actorState = actorRuntimeController.getState();
  const mustCapture = mode.cloudEnabled
    || mode.currentDeviceRole === 'staff'
    || Boolean(mode.currentStaffUser)
    || actorState.actorType === 'staff';

  if (!mustCapture) return { actorHandle: null, failure: null };

  try {
    const actorHandle = actorRuntimeController.capture('customers');
    actorHandle.assertCurrent('customers');
    if (actorHandle.actorType === 'staff') actorHandle.assertCurrent('customer_payments');
    return { actorHandle, failure: null };
  } catch (error) {
    if (error?.code === 'ACTOR_PERMISSION_DENIED') {
      return {
        actorHandle: null,
        failure: fail(CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE, 'CUSTOMER_PAYMENT_PERMISSION_DENIED')
      };
    }
    if (isActorRuntimeError(error)) {
      return {
        actorHandle: null,
        failure: fail('No se pudo validar la sesión actual. Vuelve a ingresar antes de registrar el abono.', 'CUSTOMER_PAYMENT_SESSION_REQUIRED')
      };
    }
    throw error;
  }
};

const isCustomerPaymentPermissionError = (error) => (
  /POS_PERMISSION_DENIED:customer_payments/u.test(String(error?.message || ''))
);

const applyCreditCloudResponse = async (response = {}) => {
  const applied = {
    customer: null,
    ledgerEntry: null,
    cashMovement: null,
    cashSession: null,
    ledgers: [],
    customers: [],
    cashMovements: [],
    cashSessions: []
  };

  if (response.customer) {
    applied.customer = await customerLocalRepository.applyCloudCustomer(response.customer, { source: 'credit_projection' });
  }

  if (response.ledger_entry) {
    applied.ledgerEntry = await customerCreditLocalRepository.applyCloudLedger(response.ledger_entry);
  }

  const ledgers = response.ledger_entries || [];
  if (Array.isArray(ledgers)) {
    applied.ledgers = await customerCreditLocalRepository.applyCloudLedgers(ledgers);
  }

  const customers = response.customers || [];
  if (Array.isArray(customers)) {
    applied.customers = await customerLocalRepository.applyCloudCustomers(customers, { source: 'credit_projection' });
  }

  if (response.cash_movement) {
    applied.cashMovement = await cashLocalRepository.applyCloudCashMovement(response.cash_movement);
  }

  if (response.cash_session) {
    applied.cashSession = await cashLocalRepository.applyCloudCashSession(response.cash_session);
  }

  const movements = response.cash_movements || response.movements || [];
  if (Array.isArray(movements)) {
    applied.cashMovements = await cashLocalRepository.applyCloudCashMovements(movements);
  }

  const sessions = response.cash_sessions || [];
  if (Array.isArray(sessions)) {
    applied.cashSessions = await cashLocalRepository.applyCloudCashSessions(sessions);
  }

  if (Array.isArray(response.sales)) {
    try { await salesCloudLocalRepository.applyCloudSalesPayload(response); }
    catch (error) { Logger.warn('[CustomerCredit] El saldo se confirmo; la cache de ventas requiere sincronizacion:', error); }
  }
  return applied;
};

const showOfflineMessage = () => {
  showMessageModal(CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE, null, { type: 'warning' });
};

const confirmedCloudPaymentResult = async (response, amountSafe, licenseKey) => {
  customerCreditCloudRepository.invalidateCustomerCreditCaches?.(licenseKey);
  let applied = {};
  try {
    applied = await applyCreditCloudResponse(response);
  } catch (error) {
    // The durable server response proves the payment. A local cache failure
    // must not turn a committed abono into a retryable failure.
    Logger.warn('[CustomerCredit] Abono confirmado; se actualizará la vista al sincronizar:', error);
  }
  posSyncOrchestrator.pullIncremental('customer_payment').catch(() => {});

  return {
    success: true,
    newDebt: String(response.new_debt ?? response.newDebt ?? applied.customer?.debt ?? 0),
    ledgerId: response.ledger_entry?.id || applied.ledgerEntry?.id || null,
    receipt: receiptPayloadToLocal(response.receipt || {}),
    customer: applied.customer || response.customer || null,
    cashSession: applied.cashSession || response.cash_session || null,
    cashMovement: applied.cashMovement || response.cash_movement || null,
    allocationStatus: response.sale_allocation_status || 'unconfirmed',
    confirmedAllocations: response.sale_allocation_version === 1
      ? (response.ledger_entry?.allocation_payload || []).map(row => ({ saleId: row.sale_id, amountApplied: String(row.amount_applied) }))
      : [],
    unallocatedAmount: response.unallocated_amount ?? amountSafe,
    response
  };
};

export const customerCreditRepository = {
  getMode,

  async processPayment(customerId, amount, paymentMethod = 'efectivo', cashSessionId = null, note = '', allocations = null) {
    const mode = getMode();
    const amountSafe = Money.toExactString(Money.init(amount || 0));
    const { actorHandle, failure } = capturePaymentActor(mode);

    if (failure) return failure;

    if (!mode.cloudEnabled) {
      try {
        return await customerCreditLocalRepository.processPayment(
          customerId, amount, paymentMethod, cashSessionId, note, allocations, actorHandle
        );
      } catch (error) {
        if (error?.code === 'ACTOR_PERMISSION_DENIED') {
          return fail(CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE, 'CUSTOMER_PAYMENT_PERMISSION_DENIED', { error });
        }
        if (isActorRuntimeError(error)) {
          return fail('La sesión cambió durante la operación y no se pudo confirmar el resultado. Consulta el historial antes de intentar otro pago.', 'CUSTOMER_PAYMENT_RESULT_REQUIRES_REVIEW', { error });
        }
        throw error;
      }
    }

    if (!mode.online) {
      showOfflineMessage();
      return fail(CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE, 'CUSTOMER_CREDIT_CLOUD_OFFLINE');
    }

    if (isCashPaymentMethod(paymentMethod) && !cashSessionId) {
      return fail('Debes abrir tu caja antes de registrar abonos.', 'CASH_SESSION_REQUIRED');
    }

    actorHandle?.assertCurrent('customer_payments');
    const request = {
      customer_id: customerId,
      amount: amountSafe,
      payment_method: paymentMethod,
      cash_session_id: cashSessionId,
      note,
      allocations: allocations || []
    };
    const flightKey = JSON.stringify({
      actorKey: actorHandle?.actorKey,
      tenant: actorHandle?.tenant?.opaqueId,
      generation: actorHandle?.generation,
      request
    });
    const existingFlight = customerPaymentFlights.get(flightKey);
    if (existingFlight) return existingFlight;

    const flight = (async () => {
      try {
        const pending = await getPendingCustomerPaymentIntent({ customerId, request, actorHandle });
        if (pending && (pending.blocked || pending.requestMatches !== true)) {
          return customerPaymentPendingFailure(Object.assign(new Error('CUSTOMER_PAYMENT_RECOVERY_REQUIRED'), {
            code: 'CUSTOMER_PAYMENT_RECOVERY_REQUIRED',
            financialIntentId: pending.intentId || null
          }));
        }
        if (!pending && allocations?.length > 0) {
          const summary = await customerCreditCloudRepository.getCustomerCreditSummary({
            licenseKey: mode.licenseKey, customerId, force: true, actorHandle
          });
          if (summary?.sale_allocation_version !== 1 || summary?.sale_balances_authoritative !== true
              || summary?.sale_allocation_status !== 'reconciled') {
            return fail('No hay saldos por nota conciliados en el servidor. Puedes registrar un abono general.',
              'CUSTOMER_SALE_BALANCES_UNRECONCILED');
          }
        }
        actorHandle?.assertCurrent('customer_payments');
        const prepared = await createOrGetCustomerPaymentIntent({
          request,
          licenseKey: mode.licenseKey,
          cashSessionId,
          actorHandle
        });
        if (!prepared.requestMatches) {
          return customerPaymentPendingFailure(Object.assign(new Error('CUSTOMER_PAYMENT_RECOVERY_REQUIRED'), {
            code: 'CUSTOMER_PAYMENT_RECOVERY_REQUIRED',
            financialIntentId: prepared.intent.id
          }));
        }
        if (prepared.intent.status === 'CONFLICT') {
          return customerPaymentPendingFailure(Object.assign(new Error('CUSTOMER_PAYMENT_RECOVERY_REVIEW_REQUIRED'), {
            code: 'CUSTOMER_PAYMENT_RECOVERY_REVIEW_REQUIRED',
            financialStatus: 'CONFLICT',
            financialIntentId: prepared.intent.id
          }));
        }
        const execution = await executeCustomerPaymentIntent({
          intentId: prepared.intent.id,
          licenseKey: mode.licenseKey,
          actorHandle
        });
        const response = execution?.response || {};
        if (response.success === false) {
          return fail(response.message || 'No se pudo registrar el abono cloud.', response.code || 'CUSTOMER_PAYMENT_FAILED', { response });
        }
        return await confirmedCloudPaymentResult(response, amountSafe, mode.licenseKey);
      } catch (error) {
        Logger.error('[CustomerCredit] Abono cloud fallo:', error);
        if (error?.isFinancialOperationAmbiguous === true
          || error?.financialStatus === 'PENDING_RECEIPT'
          || error?.financialStatus === 'CONFLICT'
          || ['FINANCIAL_RECOVERY_LEASE_HELD', 'IDEMPOTENCY_PROCESSING', 'CUSTOMER_PAYMENT_RECOVERY_REQUIRED', 'CUSTOMER_PAYMENT_RECOVERY_OWNER_REQUIRED', 'CUSTOMER_PAYMENT_RECOVERY_REVIEW_REQUIRED'].includes(error?.code)) {
          return customerPaymentPendingFailure(error);
        }
        if (isCustomerPaymentPermissionError(error)) {
          return fail(CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE, 'CUSTOMER_PAYMENT_PERMISSION_DENIED', { error });
        }
        if (isActorRuntimeError(error)) {
          return fail('No se pudo validar la sesión actual. Vuelve a ingresar antes de registrar el abono.', 'CUSTOMER_PAYMENT_RESULT_REQUIRES_REVIEW', { error });
        }
        return fail(error?.message || 'No se pudo registrar el abono cloud.', error?.code || 'CUSTOMER_PAYMENT_EXCEPTION', { error });
      }
    })();
    customerPaymentFlights.set(flightKey, flight);
    try {
      return await flight;
    } finally {
      if (customerPaymentFlights.get(flightKey) === flight) customerPaymentFlights.delete(flightKey);
    }
  },

  async getPendingCloudPayment(customerId) {
    const mode = getMode();
    if (!mode.cloudEnabled) return null;
    const { actorHandle, failure } = capturePaymentActor(mode);
    if (failure) return { blocked: true, canRecover: false };
    try {
      return await getPendingCustomerPaymentIntent({ customerId, actorHandle });
    } catch (error) {
      if (isActorRuntimeError(error) || isCustomerPaymentPermissionError(error)) {
        return { blocked: true, canRecover: false };
      }
      throw error;
    }
  },

  async recoverCloudPayment(intentId) {
    const mode = getMode();
    if (!mode.cloudEnabled || !mode.online) {
      return customerPaymentPendingFailure(new Error('CUSTOMER_PAYMENT_RECOVERY_OFFLINE'));
    }
    const { actorHandle, failure } = capturePaymentActor(mode);
    if (failure) return failure;
    try {
      const execution = await executeCustomerPaymentIntent({
        intentId,
        licenseKey: mode.licenseKey,
        actorHandle
      });
      const response = execution?.response || {};
      if (response.success === false) {
        return fail(response.message || 'No se pudo registrar el abono cloud.', response.code || 'CUSTOMER_PAYMENT_FAILED', { response });
      }
      return await confirmedCloudPaymentResult(response, String(response.receipt?.amount || response.amount || '0'), mode.licenseKey);
    } catch (error) {
      if (error?.isFinancialOperationAmbiguous === true
        || error?.financialStatus === 'PENDING_RECEIPT'
        || error?.financialStatus === 'CONFLICT'
        || ['FINANCIAL_RECOVERY_LEASE_HELD', 'IDEMPOTENCY_PROCESSING', 'CUSTOMER_PAYMENT_RECOVERY_REVIEW_REQUIRED'].includes(error?.code)) {
        return customerPaymentPendingFailure(error);
      }
      if (isCustomerPaymentPermissionError(error)) {
        return fail(CUSTOMER_PAYMENT_PERMISSION_DENIED_MESSAGE, 'CUSTOMER_PAYMENT_PERMISSION_DENIED', { error });
      }
      if (isActorRuntimeError(error)) {
        return fail('La sesión no puede recuperar esta operación. Vuelve a ingresar con el usuario que la inició.', 'CUSTOMER_PAYMENT_RESULT_REQUIRES_REVIEW', { error });
      }
      return fail(error?.message || 'No se pudo recuperar el abono cloud.', error?.code || 'CUSTOMER_PAYMENT_RECOVERY_FAILED', { error });
    }
  },

  async getCustomerCreditSummary(customerId, { force = false } = {}) {
    const mode = getMode();
    if (!mode.cloudEnabled || !mode.online) {
      const ledgerEntries = await customerCreditLocalRepository.getCustomerLedger(customerId);
      return { success: true, ledgerEntries, readOnly: mode.cloudEnabled };
    }

    const response = await customerCreditCloudRepository.getCustomerCreditSummary({
      licenseKey: mode.licenseKey,
      customerId, force
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo cargar credito cloud.', response.code || 'CUSTOMER_CREDIT_SUMMARY_FAILED', { response });
    }

    await applyCreditCloudResponse({ ...response, ledger_entries: response.ledger_entries || [] });
    return response;
  },

  async pullCreditSnapshot({ customerId = null, limit = 500,
    snapshotReferenceChangeSeq = null, pageCursor = null } = {}) {
    const mode = getMode();
    if (!mode.cloudEnabled || !mode.online) {
      return { success: true, skipped: true, readOnly: mode.cloudEnabled };
    }
    const actorHandle = actorRuntimeController.capture('customers');
    assertCustomerReadContext(mode.licenseKey, actorHandle);
    const pageLimit = Math.min(Math.max(Number(limit) || 500, 1), 500);
    const response = await customerCreditCloudRepository.pullCreditSnapshot({
      licenseKey: mode.licenseKey, customerId, limit: pageLimit,
      snapshotReferenceChangeSeq, pageCursor, actorHandle
    });
    assertCustomerReadContext(mode.licenseKey, actorHandle);
    validateCustomerSnapshotPage(response, {
      limit: pageLimit, reference: snapshotReferenceChangeSeq, cursor: pageCursor, rowsKey: 'ledger_entries'
    });
    if (response.customer_id !== customerId || !Array.isArray(response.customers)
      || response.ledger_reconciliation_complete !== response.snapshot_complete
      || (customerId !== null && (response.customers.some(row => row.id !== customerId)
        || response.ledger_entries.some(row => row.customer_id !== customerId)))) {
      throw new Error('CUSTOMER_CREDIT_SNAPSHOT_SCOPE_MISMATCH');
    }
    // No application of debt, ledger, sales or cash from an interface read.
    // The durable credit sync handler owns local projection/reconciliation.
    return response;
  },

  async pullCreditChanges(options = {}) {
    const mode = getMode();
    if (!mode.cloudEnabled || !mode.online) {
      return { success: true, skipped: true, readOnly: mode.cloudEnabled };
    }

    const response = await customerCreditCloudRepository.pullCreditChanges({
      licenseKey: mode.licenseKey,
      ...options
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo refrescar cambios de credito cloud.', response.code || 'CUSTOMER_CREDIT_CHANGES_FAILED', { response });
    }

    await applyCreditCloudResponse(response);
    return response;
  },

  async migrateLocalCreditIfNeeded() {
    const mode = getMode();
    if (!mode.cloudEnabled || !mode.online) {
      return { skipped: true };
    }

    const { default: customerCreditMigrationService } = await import('./customerCreditMigrationService');
    return customerCreditMigrationService.runInitialMigrationIfNeeded({ licenseKey: mode.licenseKey });
  }
};

export default customerCreditRepository;
