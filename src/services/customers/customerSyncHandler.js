import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncConflictService } from '../sync/syncConflictService';
import { syncOutboxService } from '../sync/syncOutboxService';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  shouldDeferPosBootstrapStartHook,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { customerCloudRepository } from './customerCloudRepository';
import { customerLocalRepository } from './customerLocalRepository';
import { customerMigrationService } from './customerMigrationService';
import { normalizeCustomerServerVersion } from '../db/customerServerVersion';
import { generateIdempotencyKey } from '../sync/idempotency';
import { getCustomerPhoneValidationError } from '../db/customerPhoneUtils';
import { isLocalTenantAccessError } from '../tenant/localTenantGuard';
import { hasCurrentActorPermission } from '../sync/actorPermission';
import {
  validateCustomerCreditLimitMoney,
  validateDirectoryCreditLimitEdit,
  validateQuickAddCreditLimit
} from './customerCreditLimit';
import {
  cloudCustomerToLocal,
  localCustomerToCloudPayload
} from './customerMapper';
import {
  buildCustomerRetryLimitConflicts,
  reconcileCustomerDirectoryEdit
} from './customerDirectoryReconciliation';

const CUSTOMER_LAST_CHANGE_SEQ_KEY = 'customers_last_change_seq';
const CONFLICT_CODES = new Set(['VERSION_CONFLICT', 'CUSTOMER_DELETED', 'DUPLICATE_PHONE']);

let registered = false;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const notifyCustomersChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:customers-sync-updated'));
};

const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);
const canSyncCustomers = () => hasCurrentActorPermission('customers');

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const getExpectedVersion = (operation = {}) => {
  const value = operation?.payload?.expectedVersion ?? operation?.payload?.expected_version;
  return normalizeCustomerServerVersion(value);
};

const savePushConflict = async ({ operation, response, baseline = null, proposed = null, current = null, conflicts = [] }) => {
  const conflictType = response?.code || 'CUSTOMER_SYNC_CONFLICT';

  await syncConflictService.saveConflict({
    entityType: SYNC_ENTITY_TYPES.CUSTOMER,
    entityId: operation?.entityId || response?.customer?.id || 'unknown',
    conflictType,
    localPayload: operation?.payload || operation || null,
    serverPayload: current || response?.customer || response || null,
    metadata: {
      source: 'customerSyncHandler.pushOperation',
      directoryFieldsOnly: true,
      outboxId: operation?.id || null
    }
  });

  if (operation?.entityId && (proposed || response?.customer || current)) {
    const local = proposed || await customerLocalRepository.getCustomerById(operation.entityId);
    if (local) {
      await customerLocalRepository.markConflict(local, conflictType, {
        serverCustomer: current || response?.customer || null,
        baselineCustomer: baseline,
        conflicts,
        preservePendingOperation: false
      });
    }
  }
};

const pullCurrentCustomer = async (licenseKey, customerId) => {
  let offset = 0;
  for (let page = 0; page < 100; page += 1) {
    const response = await customerCloudRepository.pullCustomerSnapshot({
      licenseKey,
      limit: SYNC_LIMITS.MAX_PULL_LIMIT,
      offset,
      includeDeleted: true,
      force: true
    });
    if (response?.success === false) throw new Error(response.message || response.code || 'CUSTOMER_SNAPSHOT_FAILED');
    const rows = Array.isArray(response?.customers) ? response.customers : [];
    const found = rows.find((item) => String(item?.id) === String(customerId));
    if (found) return cloudCustomerToLocal(found);
    if (!(response?.has_more ?? response?.hasMore) || rows.length === 0) return null;
    const nextOffset = Number(response?.next_offset ?? response?.nextOffset);
    offset = Number.isSafeInteger(nextOffset) && nextOffset > offset ? nextOffset : offset + rows.length;
  }
  throw new Error('CUSTOMER_SNAPSHOT_INCOMPLETE');
};

const getConflictCustomer = async ({ response, licenseKey, customerId }) => (
  response?.customer?.id
    ? cloudCustomerToLocal(response.customer)
    : pullCurrentCustomer(licenseKey, customerId)
);

const directoryPayloadToCustomer = (payload = {}, expectedVersion = null) => ({
  id: payload.id,
  name: payload.name || '',
  phone: payload.phone || '',
  address: payload.address || '',
  creditLimit: payload.credit_limit ?? payload.creditLimit ?? 0,
  serverVersion: normalizeCustomerServerVersion(expectedVersion)
});

const validateRebasedCustomer = (customer, operation, referenceCustomer) => {
  const fieldErrors = {};
  if (!String(customer?.name || '').trim()) fieldErrors.name = 'El nombre del cliente no puede estar vacío.';
  const phoneError = getCustomerPhoneValidationError(customer?.phone);
  if (phoneError) fieldErrors.phone = phoneError;

  const context = operation?.metadata?.creditLimitContext;
  const limit = context === 'directory'
    ? validateDirectoryCreditLimitEdit(customer?.creditLimit, referenceCustomer?.creditLimit)
    : context === 'quick_add'
      ? validateQuickAddCreditLimit(customer?.creditLimit, operation?.metadata?.minimumCreditLimit ?? 0)
      : validateCustomerCreditLimitMoney(customer?.creditLimit);
  if (!limit.valid) fieldErrors.creditLimit = limit.error;
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors, customer: limit.valid ? { ...customer, creditLimit: limit.value } : customer };
};

export const customerSyncHandler = {
  async onStart({ licenseKey, reason = 'manual', force = false } = {}) {
    if (!licenseKey || !isOnline()) return { skipped: true };
    if (!canSyncCustomers()) return { skipped: true, reason: 'actor_permission_missing' };

    if (shouldDeferPosBootstrapStartHook(reason, { force })) {
      Logger.log('[Customers/Sync] Migracion inicial diferida por bootstrap inteligente.');
      return { skipped: true, deferred: true, reason: 'bootstrap_deferred_snapshot' };
    }

    try {
      const migrationResult = await customerMigrationService.runInitialMigrationIfNeeded({ licenseKey });
      if (migrationResult?.blocked) {
        Logger.warn('[Customers/Sync] Migracion inicial bloqueada:', migrationResult);
      }
      return migrationResult;
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[Customers/Sync] Migracion inicial fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], { licenseKey: capturedLicenseKey = null } = {}) {
    const licenseKey = capturedLicenseKey || getRuntimeLicenseKey();
    if (!licenseKey || !isOnline()) return { applied: 0, skipped: true };
    if (!canSyncCustomers()) return { applied: 0, skipped: true, reason: 'actor_permission_missing' };

    const hasCustomerEvents = events.some((event) => (event.entity_type || event.entityType) === SYNC_ENTITY_TYPES.CUSTOMER);
    if (events.length > 0 && !hasCustomerEvents) {
      return { applied: 0, skipped: true };
    }

    let sinceChangeSeq = await syncMetaService.getMeta(CUSTOMER_LAST_CHANGE_SEQ_KEY, 0, { licenseKey });
    sinceChangeSeq = Number(sinceChangeSeq) || 0;

    let hasMore = true;
    let applied = 0;

    while (hasMore) {
      const response = await customerCloudRepository.pullCustomerChanges({
        licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
      });

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'CUSTOMER_CHANGES_PULL_FAILED');
      }

      const customers = Array.isArray(response.customers) ? response.customers : [];
      const appliedCustomers = await customerLocalRepository.applyCloudCustomers(customers);
      applied += appliedCustomers.length;

      const latestChangeSeq = normalizeChangeSeq(response, sinceChangeSeq);
      if (latestChangeSeq > sinceChangeSeq) {
        sinceChangeSeq = latestChangeSeq;
        await syncMetaService.setMeta(CUSTOMER_LAST_CHANGE_SEQ_KEY, sinceChangeSeq, { licenseKey });
      }

      hasMore = Boolean(response.has_more || response.hasMore) && latestChangeSeq > 0;
      if (customers.length === 0 && latestChangeSeq === sinceChangeSeq) {
        hasMore = false;
      }
    }

    if (applied > 0) {
      notifyCustomersChanged();
    }

    return { applied, latestChangeSeq: sinceChangeSeq };
  },

  async pushOperation(operation) {
    const licenseKey = operation?.licenseKey || getRuntimeLicenseKey();
    if (!licenseKey) {
      throw new Error('CUSTOMER_OUTBOX_LICENSE_REQUIRED');
    }
    if (!canSyncCustomers()) {
      throw new Error('CUSTOMER_PERMISSION_REQUIRED');
    }

    let currentOperation = operation;
    let expectedVersion = getExpectedVersion(currentOperation);
    let idempotencyKey = currentOperation?.idempotencyKey || currentOperation?.id;
    const op = operation?.operation;

    let response;

    if (op === SYNC_OPERATIONS.DELETE) {
      response = await customerCloudRepository.deleteCustomer({
        licenseKey,
        customerId: operation.entityId,
        expectedVersion,
        idempotencyKey
      });
    } else {
      const queuedCustomer = operation?.payload?.customer || {};
      const creditLimitContext = operation?.metadata?.creditLimitContext;
      const queuedCustomerData = directoryPayloadToCustomer(queuedCustomer, expectedVersion);
      const fieldErrors = {};
      if (!String(queuedCustomerData.name || '').trim()) {
        fieldErrors.name = 'El nombre del cliente no puede estar vacío.';
      }
      const queuedPhoneError = getCustomerPhoneValidationError(queuedCustomerData.phone);
      if (queuedPhoneError) fieldErrors.phone = queuedPhoneError;
      const baseCustomer = operation?.payload?.baseCustomer;
      const hasValidBase = expectedVersion !== null && baseCustomer?.id === operation?.entityId
        && queuedCustomer?.id === operation?.entityId;
      const limitValidation = creditLimitContext === 'directory'
        ? validateDirectoryCreditLimitEdit(queuedCustomer.credit_limit ?? queuedCustomer.creditLimit, hasValidBase ? (baseCustomer.credit_limit ?? baseCustomer.creditLimit) : undefined)
        : creditLimitContext === 'quick_add'
          ? validateQuickAddCreditLimit(queuedCustomer.credit_limit ?? queuedCustomer.creditLimit, operation?.metadata?.minimumCreditLimit ?? 0)
          : validateCustomerCreditLimitMoney(queuedCustomer.credit_limit ?? queuedCustomer.creditLimit);

      if (!limitValidation.valid) fieldErrors.creditLimit = limitValidation.error;
      if (operation?.payload?.baseCustomer && expectedVersion === null) {
        fieldErrors.serverVersion = 'No se pudo confirmar la versión Cloud de este cliente.';
      }

      if (Object.keys(fieldErrors).length > 0) {
        const invalidLimit = {
          success: false,
          code: fieldErrors.creditLimit ? 'INVALID_CUSTOMER_CREDIT_LIMIT' : 'INVALID_CUSTOMER_DIRECTORY_FIELDS',
          message: Object.values(fieldErrors)[0],
          fieldErrors
        };
        await savePushConflict({ operation, response: invalidLimit, proposed: queuedCustomerData });
        notifyCustomersChanged();
        return { conflict: invalidLimit };
      }

      response = await customerCloudRepository.upsertCustomer({
        licenseKey,
        customer: currentOperation?.payload?.customer,
        expectedVersion,
        idempotencyKey
      });
    }

    if (response?.success === false) {
      if (CONFLICT_CODES.has(response.code)) {
        if (response.code === 'VERSION_CONFLICT' && op !== SYNC_OPERATIONS.DELETE) {
          const attempts = Number(currentOperation?.metadata?.reconciliationAttempts || 0);
          const baselinePayload = currentOperation?.payload?.baseCustomer;
          const localPayload = currentOperation?.payload?.customer;
          const baseline = baselinePayload
            ? directoryPayloadToCustomer(baselinePayload, expectedVersion)
            : null;
          const local = directoryPayloadToCustomer(localPayload, expectedVersion);
          const current = await getConflictCustomer({ response, licenseKey, customerId: currentOperation.entityId });

          if (current?.deletedAt || current?.deletedTimestamp) {
            const deleted = { ...response, code: 'CUSTOMER_DELETED', customer: current };
            await savePushConflict({ operation: currentOperation, response: deleted, baseline, proposed: local, current });
            notifyCustomersChanged();
            return { conflict: deleted };
          }

          if (attempts < 1 && baseline && current) {
            const merged = reconcileCustomerDirectoryEdit({ baseline, local, cloud: current });
            if (merged.ok) {
              const validation = validateRebasedCustomer(merged.customer, currentOperation, current);
              const currentVersion = normalizeCustomerServerVersion(current.serverVersion ?? current.server_version);
              if (validation.valid && currentVersion !== null) {
                const rebasedPayload = {
                  ...currentOperation.payload,
                  customer: localCustomerToCloudPayload(validation.customer),
                  baseCustomer: localCustomerToCloudPayload(current),
                  expectedVersion: currentVersion
                };
                const rebasedKey = generateIdempotencyKey({
                  entityType: SYNC_ENTITY_TYPES.CUSTOMER,
                  operation: currentOperation.operation,
                  entityId: currentOperation.entityId,
                  prefix: 'customer-outbox-rebase'
                });
                const rebased = await syncOutboxService.rebaseProcessingCustomerOperation(currentOperation.id, {
                  licenseKey,
                  expectedIdempotencyKey: idempotencyKey,
                  idempotencyKey: rebasedKey,
                  payload: rebasedPayload,
                  metadata: { reconciliationAttempts: 1 }
                });
                currentOperation = rebased;
                expectedVersion = currentVersion;
                idempotencyKey = rebasedKey;

                response = await customerCloudRepository.upsertCustomer({
                  licenseKey,
                  customer: rebasedPayload.customer,
                  expectedVersion,
                  idempotencyKey
                });

                if (response?.success === false && response.code === 'VERSION_CONFLICT') {
                  const newest = await getConflictCustomer({ response, licenseKey, customerId: currentOperation.entityId });
                  const retryConflicts = newest
                    ? reconcileCustomerDirectoryEdit({ baseline: current, local: validation.customer, cloud: newest }).conflicts
                    : [];
                  await savePushConflict({
                    operation: currentOperation,
                    response: { ...response, code: 'CUSTOMER_RETRY_LIMIT_REACHED' },
                    baseline: current,
                    proposed: validation.customer,
                    current: newest,
                    conflicts: retryConflicts.length ? retryConflicts : buildCustomerRetryLimitConflicts({ baseline: current, local: validation.customer, cloud: newest || {} })
                  });
                  notifyCustomersChanged();
                  return { conflict: response };
                }
              } else {
                await savePushConflict({
                  operation: currentOperation,
                  response: { success: false, code: 'INVALID_CUSTOMER_DIRECTORY_FIELDS', message: Object.values(validation.fieldErrors || {})[0] },
                  baseline,
                  proposed: local,
                  current
                });
                notifyCustomersChanged();
                return { conflict: { code: 'INVALID_CUSTOMER_DIRECTORY_FIELDS', fieldErrors: validation.fieldErrors } };
              }
            } else {
              await savePushConflict({ operation: currentOperation, response, baseline, proposed: local, current, conflicts: merged.conflicts });
              notifyCustomersChanged();
              return { conflict: response };
            }
          } else {
            const conflicts = current && baseline
              ? buildCustomerRetryLimitConflicts({ baseline, local, cloud: current })
              : [];
            await savePushConflict({ operation: currentOperation, response, baseline, proposed: local, current, conflicts });
            notifyCustomersChanged();
            return { conflict: response };
          }
        } else {
          const current = response.customer?.id ? cloudCustomerToLocal(response.customer) : null;
          const queuedCustomer = currentOperation?.payload?.customer || {};
          const proposed = directoryPayloadToCustomer(queuedCustomer, expectedVersion);
          const conflicts = response.code === 'DUPLICATE_PHONE'
            ? [{ field: 'phone', label: 'teléfono', proposedValue: proposed.phone, reason: 'duplicate_phone' }]
            : [];
          await savePushConflict({ operation: currentOperation, response, baseline: null, proposed, current, conflicts });
          notifyCustomersChanged();
          return { conflict: response };
        }
      }

      if (response?.success === false && CONFLICT_CODES.has(response.code)) {
        await savePushConflict({ operation: currentOperation, response });
        notifyCustomersChanged();
        return { conflict: response };
      }

      throw new Error(response.message || response.code || 'CUSTOMER_PUSH_FAILED');
    }

    if (response?.customer) {
      await customerLocalRepository.applyCloudCustomer(response.customer, {
        source: 'mutation_ack',
        operationId: currentOperation.id
      });
    }

    const latestChangeSeq = Number(response?.change_seq ?? response?.changeSeq);
    if (Number.isFinite(latestChangeSeq) && latestChangeSeq > 0) {
      await syncMetaService.setMeta(CUSTOMER_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey });
    }

    notifyCustomersChanged();
    return response;
  }
};

export const registerCustomerSyncHandler = () => {
  if (registered) return false;

  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.CUSTOMER, customerSyncHandler);
  registered = true;
  Logger.log('[Customers/Sync] Handler de clientes registrado.');
  return true;
};

registerCustomerSyncHandler();

export default customerSyncHandler;
