import Logger from '../Logger';
import { showMessageModal } from '../utils';
import { Money } from '../../utils/moneyMath';
import { useAppStore } from '../../store/useAppStore';
import { generateIdempotencyKey } from '../sync/idempotency';
import {
  getLicenseKeyFromDetails,
  isCloudCustomerCreditSyncEnabled,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { customerLocalRepository } from '../customers/customerLocalRepository';
import { cashLocalRepository } from '../cash/cashLocalRepository';
import { getCashMode } from '../cash/cashActor';
import { customerCreditCloudRepository } from './customerCreditCloudRepository';
import { customerCreditLocalRepository } from './customerCreditLocalRepository';
import { receiptPayloadToLocal } from './customerCreditMapper';

import './customerCreditSyncHandler';

export const CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE = 'Los abonos cloud requieren conexion para proteger la deuda del cliente y el dinero en caja. Revisa tu conexion e intenta de nuevo.';

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
    licenseDetails,
    licenseKey,
    cloudEnabled,
    online: isOnline(),
    cashMode: getCashMode()
  };
};

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
    applied.customer = await customerLocalRepository.applyCloudCustomer(response.customer);
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
    applied.customers = await customerLocalRepository.applyCloudCustomers(customers);
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

  return applied;
};

const showOfflineMessage = () => {
  showMessageModal(CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE, null, { type: 'warning' });
};

export const customerCreditRepository = {
  getMode,

  async processPayment(customerId, amount, paymentMethod = 'efectivo', cashSessionId = null, note = '', allocations = null) {
    const mode = getMode();
    const amountSafe = Money.toExactString(Money.init(amount || 0));

    if (!mode.cloudEnabled) {
      return customerCreditLocalRepository.processPayment(customerId, amount, paymentMethod, cashSessionId, note, allocations);
    }

    if (!mode.online) {
      showOfflineMessage();
      return fail(CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE, 'CUSTOMER_CREDIT_CLOUD_OFFLINE');
    }

    if (isCashPaymentMethod(paymentMethod) && !cashSessionId) {
      return fail('Debes abrir tu caja antes de registrar abonos.', 'CASH_SESSION_REQUIRED');
    }

    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CUSTOMER_LEDGER,
      operation: SYNC_OPERATIONS.CREATE,
      entityId: `${customerId}:${Date.now()}`,
      prefix: 'customer_payment'
    });

    try {
      const response = await customerCreditCloudRepository.recordCustomerPayment({
        licenseKey: mode.licenseKey,
        customerId,
        amount: amountSafe,
        paymentMethod,
        cashSessionId,
        note,
        allocations: allocations || [],
        idempotencyKey
      });

      if (response?.success === false) {
        return fail(response.message || 'No se pudo registrar el abono cloud.', response.code || 'CUSTOMER_PAYMENT_FAILED', { response });
      }

      const applied = await applyCreditCloudResponse(response);
      posSyncOrchestrator.pullIncremental('customer_payment').catch(() => {});

      return {
        success: true,
        newDebt: String(response.new_debt ?? response.newDebt ?? applied.customer?.debt ?? 0),
        ledgerId: response.ledger_entry?.id || applied.ledgerEntry?.id || null,
        receipt: receiptPayloadToLocal(response.receipt || {}),
        customer: applied.customer,
        cashSession: applied.cashSession,
        cashMovement: applied.cashMovement,
        response
      };
    } catch (error) {
      Logger.error('[CustomerCredit] Abono cloud fallo:', error);
      return fail(error?.message || 'No se pudo registrar el abono cloud.', error?.code || 'CUSTOMER_PAYMENT_EXCEPTION', { error });
    }
  },

  async getCustomerCreditSummary(customerId) {
    const mode = getMode();
    if (!mode.cloudEnabled || !mode.online) {
      const ledgerEntries = await customerCreditLocalRepository.getCustomerLedger(customerId);
      return { success: true, ledgerEntries, readOnly: mode.cloudEnabled };
    }

    const response = await customerCreditCloudRepository.getCustomerCreditSummary({
      licenseKey: mode.licenseKey,
      customerId
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo cargar credito cloud.', response.code || 'CUSTOMER_CREDIT_SUMMARY_FAILED', { response });
    }

    await applyCreditCloudResponse({ ...response, ledger_entries: response.ledger_entries || [] });
    return response;
  },

  async pullCreditSnapshot(options = {}) {
    const mode = getMode();
    if (!mode.cloudEnabled || !mode.online) {
      return { success: true, skipped: true, readOnly: mode.cloudEnabled };
    }

    const response = await customerCreditCloudRepository.pullCreditSnapshot({
      licenseKey: mode.licenseKey,
      ...options
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo refrescar credito cloud.', response.code || 'CUSTOMER_CREDIT_SNAPSHOT_FAILED', { response });
    }

    await applyCreditCloudResponse(response);
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
