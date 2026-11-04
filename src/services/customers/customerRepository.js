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
  SYNC_LIMITS,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { customerCloudRepository } from './customerCloudRepository';
import { customerLocalRepository } from './customerLocalRepository';
import { normalizeCustomerServerVersion } from '../db/customerServerVersion';
import { normalizeCustomerDebtCents } from '../db/customerDebtIndex';
import { getCustomerPhoneValidationError, toIndexedPhoneKey } from '../db/customerPhoneUtils';
import { validateCustomerCreditLimitMoney, validateDirectoryCreditLimitEdit, validateQuickAddCreditLimit } from './customerCreditLimit';
import { hasCurrentActorPermission } from '../sync/actorPermission';
import {
  CUSTOMER_SYNC_STATUS,
  cloudCustomerToLocal,
  localCustomerToCloudPayload,
  normalizeCustomerForLocal
} from './customerMapper';
import {
  buildCustomerRetryLimitConflicts,
  getCustomerDirectoryChangedFields,
  reconcileCustomerDirectoryEdit
} from './customerDirectoryReconciliation';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const stringifyCloudError = (error) => {
  const values = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    error?.status,
    error?.statusCode,
    error?.name,
    error?.error_description,
    error?.error
  ].filter((value) => value !== null && value !== undefined);

  return values.map((value) => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ').toLowerCase();
};

const isRetryableCloudError = (error) => {
  if (!isOnline()) return true;
  if (error?.name === 'TypeError') return true;

  const code = String(error?.code || '').toLowerCase();
  const message = stringifyCloudError(error);

  return (
    code === '57014' ||
    code.startsWith('08') ||
    code.startsWith('53') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('canceling statement due to statement timeout') ||
    message.includes('statement timeout') ||
    message.includes('query timeout') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
};

const buildPhoneFieldError = (message = 'El telefono ya esta registrado para otro cliente.') => ({
  success: false,
  code: 'DUPLICATE_PHONE',
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
  if (code === 'CUSTOMER_DELETED') {
    return {
      success: false,
      code,
      message: 'Este cliente ya fue eliminado y no puede editarse.',
      error: { code, message: 'Este cliente ya fue eliminado y no puede editarse.' }
    };
  }
  const message = response?.message || 'No se pudo sincronizar cliente.';

  if (code === 'DUPLICATE_PHONE') {
    return buildPhoneFieldError(message);
  }
  if (code === 'VERSION_CONFLICT') {
    return {
      success: false,
      code,
      message: 'Este cliente tiene cambios recientes. Actualiza la lista antes de volver a eliminarlo.',
      error: { code, message: 'Este cliente tiene cambios recientes. Actualiza la lista antes de volver a eliminarlo.' }
    };
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

const validateCustomerDirectoryResult = (customer, { creditLimitContext = 'directory', minimumCreditLimit = 0, referenceCustomer = null } = {}) => {
  const fieldErrors = {};
  if (!String(customer?.name || '').trim()) fieldErrors.name = 'El nombre del cliente no puede estar vacío.';
  const phoneError = getCustomerPhoneValidationError(customer?.phone);
  if (phoneError) fieldErrors.phone = phoneError;
  const limit = creditLimitContext === 'quick_add'
    ? validateQuickAddCreditLimit(customer?.creditLimit, minimumCreditLimit)
    : validateDirectoryCreditLimitEdit(customer?.creditLimit, referenceCustomer?.creditLimit);
  if (!limit.valid) fieldErrors.creditLimit = limit.error;

  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    customer: limit.valid ? { ...customer, creditLimit: limit.value } : customer
  };
};

const getCloudCustomerById = async ({ licenseKey, customerId }) => {
  let offset = 0;
  for (let page = 0; page < 100; page += 1) {
    const response = await customerCloudRepository.pullCustomerSnapshot({
      licenseKey,
      limit: SYNC_LIMITS.MAX_PULL_LIMIT,
      offset,
      includeDeleted: true,
      force: true
    });
    if (response?.success === false) {
      throw new Error(response.message || response.code || 'CUSTOMER_SNAPSHOT_FAILED');
    }

    const customers = Array.isArray(response?.customers) ? response.customers : [];
    const found = customers.find((customer) => String(customer?.id) === String(customerId));
    if (found) return { customer: cloudCustomerToLocal(found), complete: true };

    const hasMore = Boolean(response?.has_more ?? response?.hasMore);
    if (!hasMore || customers.length === 0) return { customer: null, complete: true };
    const nextOffset = Number(response?.next_offset ?? response?.nextOffset);
    offset = Number.isSafeInteger(nextOffset) && nextOffset > offset
      ? nextOffset
      : offset + customers.length;
  }
  return { customer: null, complete: false };
};

const getResponseCustomer = async ({ response, licenseKey, customerId }) => {
  if (response?.customer?.id) return cloudCustomerToLocal(response.customer);
  const snapshot = await getCloudCustomerById({ licenseKey, customerId });
  if (!snapshot.complete) throw new Error('CUSTOMER_SNAPSHOT_INCOMPLETE');
  return snapshot.customer;
};

const saveCustomerConflict = async ({ baseline, proposed, current, conflicts, source, reason = 'VERSION_CONFLICT' }) => {
  const fieldConflicts = conflicts?.length
    ? conflicts
    : buildCustomerRetryLimitConflicts({ baseline, local: proposed, cloud: current });
  const safeLocalPayload = localCustomerToCloudPayload(proposed);
  const conflict = await syncConflictService.saveConflict({
    entityType: SYNC_ENTITY_TYPES.CUSTOMER,
    entityId: proposed.id,
    conflictType: reason,
    localPayload: {
      baselineCustomer: baseline ? localCustomerToCloudPayload(baseline) : null,
      customer: safeLocalPayload,
      expectedVersion: normalizeCustomerServerVersion(baseline?.serverVersion ?? baseline?.server_version)
    },
    serverPayload: current || null,
    metadata: { source, directoryFieldsOnly: true }
  });

  await customerLocalRepository.markConflict(proposed, reason, {
    serverCustomer: current,
    baselineCustomer: baseline,
    conflicts: fieldConflicts
  });

  return {
    success: false,
    code: 'CUSTOMER_FIELDS_CONFLICT',
    message: 'Este cliente tiene cambios recientes. Revisa los campos indicados antes de guardar.',
    fieldConflicts,
    currentCustomer: current,
    conflictId: conflict?.id || null
  };
};

const makeDeletedCustomerResult = async ({ baseline, proposed, current, source }) => {
  await customerLocalRepository.markConflict(proposed, 'CUSTOMER_DELETED', {
    serverCustomer: current,
    baselineCustomer: baseline,
    conflicts: []
  });
  await syncConflictService.saveConflict({
    entityType: SYNC_ENTITY_TYPES.CUSTOMER,
    entityId: proposed.id,
    conflictType: 'CUSTOMER_DELETED',
    localPayload: { customer: localCustomerToCloudPayload(proposed) },
    serverPayload: current || null,
    metadata: { source, directoryFieldsOnly: true }
  });
  return {
    success: false,
    code: 'CUSTOMER_DELETED',
    message: 'Este cliente ya fue eliminado y no puede editarse.'
  };
};

const enqueueCustomerOperation = async ({
  licenseKey,
  operation,
  customer,
  baseCustomer = null,
  cloudPayload,
  idempotencyKey,
  expectedVersion = null,
  creditLimitContext = 'directory',
  minimumCreditLimit = 0,
  reconciliationAttempts = 0
}) => syncOutboxService.enqueueOperation({
  licenseKey,
  entityType: SYNC_ENTITY_TYPES.CUSTOMER,
  operation,
  entityId: customer?.id || cloudPayload?.id,
  payload: {
    customer: cloudPayload,
    baseCustomer: baseCustomer ? localCustomerToCloudPayload(baseCustomer) : null,
    expectedVersion
  },
  idempotencyKey,
  metadata: {
    phase: 'fase1_customers_directory',
    creditLimitContext,
    minimumCreditLimit,
    reconciliationAttempts,
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

  async saveCustomer(customerData, {
    existingCustomer: openedCustomer = null,
    creditLimitContext = 'directory',
    minimumCreditLimit = 0,
    resolutionAcknowledged = false
  } = {}) {
    const mode = getMode();
    if (mode.cloudEnabled && !hasCurrentActorPermission('customers')) {
      return {
        success: false,
        code: 'CUSTOMER_PERMISSION_REQUIRED',
        message: 'Tu usuario no tiene permiso para gestionar clientes.'
      };
    }
    const isUpdate = Boolean(openedCustomer?.id);
    const id = openedCustomer?.id || customerData?.id || generateID('cust');
    const baseAtOpen = openedCustomer?.conflictCloudSnapshot || openedCustomer;
    const rawCreditLimit = Object.prototype.hasOwnProperty.call(customerData || {}, 'creditLimit')
      ? customerData.creditLimit
      : (baseAtOpen?.creditLimit ?? 0);
    const latestLocal = isUpdate ? await customerLocalRepository.getCustomerById(id) : null;
    const initialLimit = creditLimitContext === 'quick_add'
      ? validateQuickAddCreditLimit(rawCreditLimit, minimumCreditLimit)
      : validateDirectoryCreditLimitEdit(rawCreditLimit, latestLocal?.creditLimit);

    if (!initialLimit.valid) {
      // A newer local snapshot may carry a different limit than the open draft.
      // Do not treat the draft as an authoritative historical record; ask for
      // review instead of accepting it or disguising the collision as a step error.
      const proposedMoney = validateCustomerCreditLimitMoney(rawCreditLimit);
      const openedMoney = validateCustomerCreditLimitMoney(baseAtOpen?.creditLimit);
      const currentMoney = validateCustomerCreditLimitMoney(latestLocal?.creditLimit);
      if (mode.cloudEnabled && isUpdate && latestLocal && proposedMoney.valid && openedMoney.valid
        && currentMoney.valid && proposedMoney.cents === openedMoney.cents
        && openedMoney.cents !== currentMoney.cents) {
        return {
          success: false,
          code: 'CUSTOMER_FIELDS_CONFLICT',
          message: 'El límite cambió mientras editabas. Revisa el valor antes de guardar.',
          currentCustomer: latestLocal,
          fieldConflicts: [{ field: 'creditLimit', label: 'límite de crédito', baseValue: baseAtOpen.creditLimit, proposedValue: rawCreditLimit, currentValue: latestLocal.creditLimit, reason: 'overlapping_change' }]
        };
      }
      return {
        success: false,
        code: 'INVALID_CUSTOMER_CREDIT_LIMIT',
        fieldErrors: { creditLimit: initialLimit.error },
        message: initialLimit.error
      };
    }

    let baseline = baseAtOpen;
    const duplicatePhoneCorrected = isUpdate
      && latestLocal?.conflictReason === 'DUPLICATE_PHONE'
      && toIndexedPhoneKey(customerData?.phone) !== toIndexedPhoneKey(latestLocal.phone);

    if (isUpdate && openedCustomer?.syncStatus === CUSTOMER_SYNC_STATUS.CONFLICT && !resolutionAcknowledged && !duplicatePhoneCorrected) {
      if (openedCustomer.conflictReason === 'DUPLICATE_PHONE') {
        return {
          success: false,
          code: 'DUPLICATE_PHONE',
          fieldErrors: { phone: 'El teléfono ya está registrado para otro cliente. Cámbialo para volver a guardar.' },
          message: 'El teléfono ya está registrado para otro cliente. Cámbialo para volver a guardar.'
        };
      }
      return {
        success: false,
        code: 'CUSTOMER_FIELDS_CONFLICT',
        message: 'Este cliente tiene cambios recientes. Revisa los campos indicados antes de guardar.',
        fieldConflicts: openedCustomer.conflictFields || [],
        currentCustomer: openedCustomer.conflictCloudSnapshot || openedCustomer.latestCloudSnapshot || null
      };
    }

    if (mode.cloudEnabled && isUpdate && latestLocal) {
      if (latestLocal.deletedAt || latestLocal.deletedTimestamp || latestLocal.isActive === false) {
        return {
          success: false,
          code: 'CUSTOMER_DELETED',
          message: 'Este cliente ya fue eliminado y no puede editarse.'
        };
      }
      if (latestLocal.syncStatus === CUSTOMER_SYNC_STATUS.PENDING) {
        return {
          success: false,
          code: 'CUSTOMER_SYNC_PENDING',
          message: 'Este cliente tiene cambios locales pendientes de sincronización. Espera a que se reconcilien y vuelve a guardar.'
        };
      }
      if (!resolutionAcknowledged && latestLocal.syncStatus === CUSTOMER_SYNC_STATUS.CONFLICT && !duplicatePhoneCorrected) {
        if (latestLocal.conflictReason === 'DUPLICATE_PHONE') {
          return {
            success: false,
            code: 'DUPLICATE_PHONE',
            fieldErrors: { phone: 'El teléfono ya está registrado para otro cliente. Cámbialo para volver a guardar.' },
            message: 'El teléfono ya está registrado para otro cliente. Cámbialo para volver a guardar.'
          };
        }
        return {
          success: false,
          code: latestLocal.conflictReason === 'CUSTOMER_DELETED' ? 'CUSTOMER_DELETED' : 'CUSTOMER_FIELDS_CONFLICT',
          message: latestLocal.conflictReason === 'CUSTOMER_DELETED'
            ? 'Este cliente ya fue eliminado y no puede editarse.'
            : 'Este cliente tiene cambios recientes. Revisa los campos indicados antes de guardar.',
          fieldConflicts: latestLocal.conflictFields || [],
          currentCustomer: latestLocal.conflictCloudSnapshot || latestLocal.latestCloudSnapshot || null
        };
      }
    }

    const localDebt = latestLocal?.debt
      ?? baseAtOpen?.debt
      ?? 0;
    const localDebtCents = latestLocal?.debtCents
      ?? latestLocal?.debt_cents
      ?? baseAtOpen?.debtCents
      ?? baseAtOpen?.debt_cents
      ?? normalizeCustomerDebtCents(localDebt);
    let candidate = normalizeCustomerForLocal({
      ...baseAtOpen,
      ...customerData,
      id,
      debt: localDebt,
      debtCents: localDebtCents,
      creditLimit: initialLimit.value
    }, baseAtOpen, {
      syncStatus: mode.cloudEnabled ? CUSTOMER_SYNC_STATUS.PENDING : CUSTOMER_SYNC_STATUS.LOCAL
    });

    const initialValidation = validateCustomerDirectoryResult(candidate, { creditLimitContext, minimumCreditLimit, referenceCustomer: latestLocal });
    if (!initialValidation.valid) {
      return {
        success: false,
        code: 'INVALID_CUSTOMER_DIRECTORY_FIELDS',
        fieldErrors: initialValidation.fieldErrors,
        message: Object.values(initialValidation.fieldErrors)[0]
      };
    }
    candidate = initialValidation.customer;

    if (!mode.cloudEnabled) {
      return customerLocalRepository.saveCustomerLocal(candidate, {
        existingCustomer: latestLocal || baseAtOpen,
        syncStatus: CUSTOMER_SYNC_STATUS.LOCAL
      });
    }

    let expectedVersion = isUpdate
      ? normalizeCustomerServerVersion(baseline?.serverVersion ?? baseline?.server_version)
      : null;

    if (isUpdate && latestLocal?.syncStatus === CUSTOMER_SYNC_STATUS.SYNCED) {
      const localVersion = normalizeCustomerServerVersion(latestLocal.serverVersion ?? latestLocal.server_version);
      const openedVersion = normalizeCustomerServerVersion(baseline?.serverVersion ?? baseline?.server_version);
      const localDirectoryChanged = getCustomerDirectoryChangedFields(baseline || {}, latestLocal).length > 0;
      if (localVersion !== null && (localVersion > (openedVersion ?? 0) || localDirectoryChanged)) {
        const merged = reconcileCustomerDirectoryEdit({ baseline, local: candidate, cloud: latestLocal });
        if (!merged.ok) {
          return saveCustomerConflict({
            baseline,
            proposed: candidate,
            current: latestLocal,
            conflicts: merged.conflicts,
            source: 'customerRepository.local_snapshot_reconcile'
          });
        }
        baseline = latestLocal;
        expectedVersion = localVersion;
        candidate = normalizeCustomerForLocal({
          ...merged.customer,
          debt: latestLocal.debt,
          debtCents: latestLocal.debtCents ?? latestLocal.debt_cents
        }, latestLocal, { syncStatus: CUSTOMER_SYNC_STATUS.PENDING });
      }
    }

    if (isUpdate && expectedVersion === null) {
      if (!isOnline()) {
        return {
          success: false,
          code: 'CUSTOMER_VERSION_REQUIRED',
          message: 'No se puede guardar esta edición sin confirmar la versión Cloud. Conéctate y sincroniza clientes antes de reintentar.'
        };
      }

      try {
        const snapshot = await getCloudCustomerById({ licenseKey: mode.licenseKey, customerId: id });
        if (!snapshot.complete) throw new Error('CUSTOMER_SNAPSHOT_INCOMPLETE');
        if (!snapshot.customer) {
          return {
            success: false,
            code: 'CUSTOMER_NOT_IN_CLOUD',
            message: 'No se encontró la versión Cloud de este cliente. La edición no se guardó para evitar recrear un registro.'
          };
        }
        if (snapshot.customer.deletedAt || snapshot.customer.deletedTimestamp) {
          return makeDeletedCustomerResult({
            baseline,
            proposed: candidate,
            current: snapshot.customer,
            source: 'customerRepository.version_snapshot'
          });
        }
        const merged = reconcileCustomerDirectoryEdit({ baseline, local: candidate, cloud: snapshot.customer });
        if (!merged.ok) {
          return saveCustomerConflict({
            baseline,
            proposed: candidate,
            current: snapshot.customer,
            conflicts: merged.conflicts,
            source: 'customerRepository.version_snapshot'
          });
        }
        baseline = snapshot.customer;
        expectedVersion = normalizeCustomerServerVersion(snapshot.customer.serverVersion ?? snapshot.customer.server_version);
        candidate = normalizeCustomerForLocal({ ...merged.customer, debt: snapshot.customer.debt, debtCents: snapshot.customer.debtCents }, snapshot.customer);
      } catch (error) {
        return {
          success: false,
          code: 'CUSTOMER_VERSION_UNAVAILABLE',
          message: 'No se pudo confirmar la versión actual del cliente. No se guardó ningún cambio; vuelve a intentarlo cuando haya conexión.',
          error
        };
      }
      if (expectedVersion === null) {
        return {
          success: false,
          code: 'CUSTOMER_VERSION_REQUIRED',
          message: 'No se recibió una versión Cloud válida. La edición no se guardó.'
        };
      }
    }

    const validatedCandidate = validateCustomerDirectoryResult(candidate, { creditLimitContext, minimumCreditLimit, referenceCustomer: baseline });
    if (!validatedCandidate.valid) {
      return {
        success: false,
        code: 'INVALID_CUSTOMER_DIRECTORY_FIELDS',
        fieldErrors: validatedCandidate.fieldErrors,
        message: Object.values(validatedCandidate.fieldErrors)[0]
      };
    }
    candidate = validatedCandidate.customer;

    let attempt = {
      baseline,
      candidate,
      expectedVersion,
      idempotencyKey: generateIdempotencyKey({
        entityType: SYNC_ENTITY_TYPES.CUSTOMER,
        operation: isUpdate ? SYNC_OPERATIONS.UPDATE : SYNC_OPERATIONS.CREATE,
        entityId: id,
        prefix: 'customer'
      }),
      reconciliationAttempts: 0
    };

    const queueAttempt = async (currentAttempt, message) => {
      const payload = localCustomerToCloudPayload(currentAttempt.candidate);
      const localResult = await customerLocalRepository.saveCustomerLocal(currentAttempt.candidate, {
        existingCustomer: latestLocal || currentAttempt.baseline,
        syncStatus: CUSTOMER_SYNC_STATUS.PENDING,
        pendingOperationId: currentAttempt.idempotencyKey
      });
      if (!localResult.success) return localResult;

      await enqueueCustomerOperation({
        licenseKey: mode.licenseKey,
        operation: SYNC_OPERATIONS.UPSERT,
        customer: currentAttempt.candidate,
        baseCustomer: currentAttempt.baseline,
        cloudPayload: payload,
        idempotencyKey: currentAttempt.idempotencyKey,
        expectedVersion: currentAttempt.expectedVersion,
        creditLimitContext,
        minimumCreditLimit,
        reconciliationAttempts: currentAttempt.reconciliationAttempts
      });
      return {
        success: true,
        pending: true,
        data: currentAttempt.candidate,
        message
      };
    };

    if (!isOnline()) {
      if (isUpdate && attempt.expectedVersion === null) {
        return {
          success: false,
          code: 'CUSTOMER_VERSION_REQUIRED',
          message: 'No se puede guardar esta edición sin una versión Cloud confirmada.'
        };
      }
      return queueAttempt(attempt, 'Cambios guardados en este dispositivo. Sincronización pendiente.');
    }

    try {
      let response = await customerCloudRepository.upsertCustomer({
        licenseKey: mode.licenseKey,
        customer: localCustomerToCloudPayload(attempt.candidate),
        expectedVersion: attempt.expectedVersion,
        idempotencyKey: attempt.idempotencyKey
      });

      if (response?.success === false && response.code === 'CUSTOMER_DELETED') {
        const deleted = response.customer ? cloudCustomerToLocal(response.customer) : null;
        return makeDeletedCustomerResult({
          baseline: attempt.baseline,
          proposed: attempt.candidate,
          current: deleted,
          source: 'customerRepository.upsert'
        });
      }

      if (response?.success === false && response.code === 'VERSION_CONFLICT' && isUpdate) {
        const current = await getResponseCustomer({ response, licenseKey: mode.licenseKey, customerId: id });
        if (!current) {
          return {
            success: false,
            code: 'CUSTOMER_VERSION_UNAVAILABLE',
            message: 'No se pudo confirmar la versión actual del cliente. Conserva tu edición e inténtalo de nuevo.'
          };
        }
        if (current.deletedAt || current.deletedTimestamp) {
          return makeDeletedCustomerResult({
            baseline: attempt.baseline,
            proposed: attempt.candidate,
            current,
            source: 'customerRepository.version_conflict'
          });
        }

        const merged = reconcileCustomerDirectoryEdit({ baseline: attempt.baseline, local: attempt.candidate, cloud: current });
        if (!merged.ok) {
          return saveCustomerConflict({
            baseline: attempt.baseline,
            proposed: attempt.candidate,
            current,
            conflicts: merged.conflicts,
            source: 'customerRepository.version_conflict'
          });
        }

        const validatedMerge = validateCustomerDirectoryResult(merged.customer, { creditLimitContext, minimumCreditLimit, referenceCustomer: current });
        if (!validatedMerge.valid) {
          return {
            success: false,
            code: 'INVALID_CUSTOMER_DIRECTORY_FIELDS',
            fieldErrors: validatedMerge.fieldErrors,
            message: Object.values(validatedMerge.fieldErrors)[0],
            currentCustomer: current
          };
        }

        const currentVersion = normalizeCustomerServerVersion(current.serverVersion ?? current.server_version);
        if (currentVersion === null) {
          return {
            success: false,
            code: 'CUSTOMER_VERSION_REQUIRED',
            message: 'No se recibió una versión Cloud válida. La edición no se guardó.'
          };
        }
        attempt = {
          baseline: current,
          candidate: normalizeCustomerForLocal({
            ...validatedMerge.customer,
            debt: current.debt,
            debtCents: current.debtCents
          }, current, { syncStatus: CUSTOMER_SYNC_STATUS.PENDING }),
          expectedVersion: currentVersion,
          idempotencyKey: generateIdempotencyKey({
            entityType: SYNC_ENTITY_TYPES.CUSTOMER,
            operation: SYNC_OPERATIONS.UPDATE,
            entityId: id,
            prefix: 'customer-rebase'
          }),
          reconciliationAttempts: 1
        };

        response = await customerCloudRepository.upsertCustomer({
          licenseKey: mode.licenseKey,
          customer: localCustomerToCloudPayload(attempt.candidate),
          expectedVersion: attempt.expectedVersion,
          idempotencyKey: attempt.idempotencyKey
        });

        if (response?.success === false && response.code === 'VERSION_CONFLICT') {
          const newest = await getResponseCustomer({ response, licenseKey: mode.licenseKey, customerId: id });
          if (newest?.deletedAt || newest?.deletedTimestamp) {
            return makeDeletedCustomerResult({ baseline: attempt.baseline, proposed: attempt.candidate, current: newest, source: 'customerRepository.retry_conflict' });
          }
          const secondMerge = newest
            ? reconcileCustomerDirectoryEdit({ baseline: attempt.baseline, local: attempt.candidate, cloud: newest })
            : null;
          const secondConflicts = secondMerge?.conflicts?.length
            ? secondMerge.conflicts
            : buildCustomerRetryLimitConflicts({ baseline: attempt.baseline, local: attempt.candidate, cloud: newest || {} });
          return saveCustomerConflict({
            baseline: attempt.baseline,
            proposed: attempt.candidate,
            current: newest,
            conflicts: secondConflicts,
            source: 'customerRepository.retry_limit',
            reason: 'CUSTOMER_RETRY_LIMIT_REACHED'
          });
        }
      }

      if (response?.success === false) return normalizeCloudFailure(response);
      if (!response?.customer) {
        return {
          success: false,
          code: 'CUSTOMER_SAVE_UNCONFIRMED',
          message: 'El servidor no confirmó la actualización. Conserva tus cambios e inténtalo de nuevo.'
        };
      }

      const saved = await customerLocalRepository.applyCloudCustomer(response.customer, {
        source: 'mutation_ack',
        operationId: 'customer_repository_direct_ack'
      });
      posSyncOrchestrator.pullIncremental('customer_save').catch(() => {});
      return { success: true, data: saved, response };
    } catch (error) {
      Logger.warn('[Customers] Upsert cloud fallo:', error);
      if (isRetryableCloudError(error)) {
        return queueAttempt(
          attempt,
          'Cambios guardados en este dispositivo. Sincronización pendiente.'
        );
      }
      return {
        success: false,
        code: error?.code || 'CUSTOMER_SAVE_FAILED',
        message: error?.message || 'No se pudo guardar el cliente.',
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
    const expectedVersion = normalizeCustomerServerVersion(existingCustomer.serverVersion ?? existingCustomer.server_version);

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
          if (response.customer?.id) await customerLocalRepository.applyCloudCustomer(response.customer);
        }
        return normalizeCloudFailure(response);
      }

      await customerLocalRepository.applyCloudCustomer(response.customer);
      posSyncOrchestrator.pullIncremental('customer_delete').catch(() => {});
      return { success: true, response };
    } catch (error) {
      Logger.warn('[Customers] Delete cloud fallo:', error);

      if (isRetryableCloudError(error)) {
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
          message: 'Cliente eliminado localmente. La sincronizacion quedo pendiente y se reintentara automaticamente.'
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
