import Logger from '../Logger';
import { generateID, showMessageModal } from '../utils';
import { useAppStore } from '../../store/useAppStore';
import { DB_ERROR_CODES } from '../db/utils';
import { generateIdempotencyKey } from '../sync/idempotency';
import { syncConflictService } from '../sync/syncConflictService';
import { syncOutboxService } from '../sync/syncOutboxService';
import {
  getLicenseKeyFromDetails,
  isCloudPosSyncEnabled,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { customerCloudRepository } from './customerCloudRepository';
import { customerLocalRepository } from './customerLocalRepository';
import {
  CUSTOMER_SYNC_STATUS,
  localCustomerToCloudPayload,
  normalizeCustomerForLocal
} from './customerMapper';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const buildPhoneFieldError = (message = 'El telefono ya esta registrado para otro cliente.') => ({
  success: false,
  fieldErrors: { phone: message },
  error: {
    code: DB_ERROR_CODES.CONSTRAINT_VIOLATION,
    details: { field: 'phone' },
    message
  },
  message
});

const getMode = () => {
  const state = useAppStore.getState();
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const cloudEnabled = Boolean(licenseKey && isCloudPosSyncEnabled(licenseDetails));

  return {
    appStatus: state?.appStatus,
    licenseDetails,
    licenseKey,
    cloudEnabled
  };
};

const normalizeCloudFailure = (response) => {
  const code = response?.code || response?.error?.code;
  const message = response?.message || 'No se pudo sincronizar cliente.';

  if (code === 'DUPLICATE_PHONE') {
    return buildPhoneFieldError(message);
  }

  return {
    success: false,
    code,
    message,
    error: {
      code: code || 'CUSTOMER_CLOUD_ERROR',
      message,
      details: response || {}
    }
  };
};

const saveConflictFromResponse = async ({ customer, response, operation }) => {
  const code = response?.code || 'CUSTOMER_SYNC_CONFLICT';

  await syncConflictService.saveConflict({
    entityType: SYNC_ENTITY_TYPES.CUSTOMER,
    entityId: customer?.id || response?.customer?.id || 'unknown',
    conflictType: code,
    localPayload: { operation, customer },
    serverPayload: response?.customer || response || null,
    metadata: { source: 'customerRepository' }
  });

  if (customer?.id) {
    await customerLocalRepository.markConflict({ ...customer, ...(response?.customer || {}) }, code);
  }
};

const enqueueCustomerOperation = async ({ licenseKey, operation, customer, cloudPayload, idempotencyKey, expectedVersion = null }) => syncOutboxService.enqueueOperation({
  licenseKey,
  entityType: SYNC_ENTITY_TYPES.CUSTOMER,
  operation,
  entityId: customer?.id || cloudPayload?.id,
  payload: {
    customer: cloudPayload,
    expectedVersion
  },
  idempotencyKey,
  metadata: {
    phase: 'fase1_customers_directory',
    queuedAt: new Date().toISOString()
  }
});

export const customerRepository = {
  async listCustomersPage(options = {}) {
    return customerLocalRepository.listCustomersPage(options);
  },

  async getCustomerById(customerId) {
    return customerLocalRepository.getCustomerById(customerId);
  },

  async searchCustomers(query = '') {
    return customerLocalRepository.searchCustomers(query);
  },

  async saveCustomer(customerData, { existingCustomer = null } = {}) {
    const mode = getMode();
    const id = existingCustomer?.id || customerData?.id || generateID('cust');
    const debt = existingCustomer?.debt ?? customerData?.debt ?? 0;
    const localCandidate = normalizeCustomerForLocal({ ...customerData, id, debt }, existingCustomer, {
      syncStatus: mode.cloudEnabled ? CUSTOMER_SYNC_STATUS.PENDING : CUSTOMER_SYNC_STATUS.LOCAL
    });

    if (!mode.cloudEnabled) {
      return customerLocalRepository.saveCustomerLocal(localCandidate, {
        existingCustomer,
        syncStatus: CUSTOMER_SYNC_STATUS.LOCAL
      });
    }

    const cloudPayload = localCustomerToCloudPayload(localCandidate);
    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CUSTOMER,
      operation: existingCustomer ? SYNC_OPERATIONS.UPDATE : SYNC_OPERATIONS.CREATE,
      entityId: id,
      prefix: 'customer'
    });
    const expectedVersion = existingCustomer?.serverVersion || null;

    if (!isOnline()) {
      const localResult = await customerLocalRepository.saveCustomerLocal(localCandidate, {
        existingCustomer,
        syncStatus: CUSTOMER_SYNC_STATUS.PENDING,
        pendingOperationId: idempotencyKey
      });

      if (!localResult.success) return localResult;

      await enqueueCustomerOperation({
        licenseKey: mode.licenseKey,
        operation: SYNC_OPERATIONS.UPSERT,
        customer: localCandidate,
        cloudPayload,
        idempotencyKey,
        expectedVersion
      });

      return {
        success: true,
        pending: true,
        data: localCandidate,
        message: 'Cliente guardado localmente. Se sincronizara cuando vuelva internet.'
      };
    }

    try {
      const response = await customerCloudRepository.upsertCustomer({
        licenseKey: mode.licenseKey,
        customer: cloudPayload,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        if (response.code === 'VERSION_CONFLICT' || response.code === 'CUSTOMER_DELETED') {
          await saveConflictFromResponse({ customer: localCandidate, response, operation: SYNC_OPERATIONS.UPSERT });
        }
        return normalizeCloudFailure(response);
      }

      const saved = await customerLocalRepository.applyCloudCustomer(response.customer);
      posSyncOrchestrator.pullIncremental('customer_save').catch(() => {});

      return { success: true, data: saved, response };
    } catch (error) {
      Logger.warn('[Customers] Upsert cloud fallo. Encolando solo si parece red/offline:', error);

      if (!isOnline() || error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
        const localResult = await customerLocalRepository.saveCustomerLocal(localCandidate, {
          existingCustomer,
          syncStatus: CUSTOMER_SYNC_STATUS.PENDING,
          pendingOperationId: idempotencyKey
        });

        if (!localResult.success) return localResult;

        await enqueueCustomerOperation({
          licenseKey: mode.licenseKey,
          operation: SYNC_OPERATIONS.UPSERT,
          customer: localCandidate,
          cloudPayload,
          idempotencyKey,
          expectedVersion
        });

        return {
          success: true,
          pending: true,
          data: localCandidate,
          message: 'Cliente guardado localmente. La sincronizacion quedo pendiente.'
        };
      }

      return {
        success: false,
        message: error?.message || 'Error al guardar cliente cloud.',
        error
      };
    }
  },

  async deleteCustomer(customerId) {
    const mode = getMode();
    const existingCustomer = await customerLocalRepository.getCustomerById(customerId);

    if (!existingCustomer) {
      return { success: false, message: 'El cliente ya no existe.' };
    }

    if (Number(existingCustomer.debtCents || 0) > 0 || Number(existingCustomer.debt || 0) > 0) {
      return { success: false, code: 'CUSTOMER_HAS_DEBT', message: 'No se puede eliminar un cliente con deuda pendiente.' };
    }

    if (!mode.cloudEnabled) {
      return customerLocalRepository.deleteCustomerLocal(customerId);
    }

    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CUSTOMER,
      operation: SYNC_OPERATIONS.DELETE,
      entityId: customerId,
      prefix: 'customer'
    });
    const expectedVersion = existingCustomer.serverVersion || null;

    if (!isOnline()) {
      const localResult = await customerLocalRepository.markCustomerDeletedPending(existingCustomer, { operationId: idempotencyKey });
      if (!localResult.success) return localResult;

      await enqueueCustomerOperation({
        licenseKey: mode.licenseKey,
        operation: SYNC_OPERATIONS.DELETE,
        customer: existingCustomer,
        cloudPayload: { id: customerId },
        idempotencyKey,
        expectedVersion
      });

      return {
        success: true,
        pending: true,
        message: 'Cliente eliminado localmente. Se sincronizara cuando vuelva internet.'
      };
    }

    try {
      const response = await customerCloudRepository.deleteCustomer({
        licenseKey: mode.licenseKey,
        customerId,
        expectedVersion,
        idempotencyKey
      });

      if (response?.success === false) {
        if (response.code === 'VERSION_CONFLICT') {
          await saveConflictFromResponse({ customer: existingCustomer, response, operation: SYNC_OPERATIONS.DELETE });
        }
        return normalizeCloudFailure(response);
      }

      await customerLocalRepository.applyCloudCustomer(response.customer);
      posSyncOrchestrator.pullIncremental('customer_delete').catch(() => {});
      return { success: true, response };
    } catch (error) {
      Logger.warn('[Customers] Delete cloud fallo:', error);

      if (!isOnline() || error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
        const localResult = await customerLocalRepository.markCustomerDeletedPending(existingCustomer, { operationId: idempotencyKey });
        if (!localResult.success) return localResult;

        await enqueueCustomerOperation({
          licenseKey: mode.licenseKey,
          operation: SYNC_OPERATIONS.DELETE,
          customer: existingCustomer,
          cloudPayload: { id: customerId },
          idempotencyKey,
          expectedVersion
        });

        return {
          success: true,
          pending: true,
          message: 'Cliente eliminado localmente. La sincronizacion quedo pendiente.'
        };
      }

      return {
        success: false,
        message: error?.message || 'Error al eliminar cliente cloud.',
        error
      };
    }
  },

  showAbonosCloudNoticeIfNeeded() {
    const mode = getMode();
    if (!mode.cloudEnabled) return false;

    showMessageModal(
      'En esta fase los clientes ya sincronizan en cloud, pero abonos/caja siguen siendo locales. La deuda cloud es lectura/cache hasta la fase de caja/abonos.',
      null,
      { type: 'info' }
    );
    return true;
  }
};

export default customerRepository;
