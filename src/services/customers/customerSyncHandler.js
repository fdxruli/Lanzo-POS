import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncConflictService } from '../sync/syncConflictService';
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

const CUSTOMER_LAST_CHANGE_SEQ_KEY = 'customers_last_change_seq';
const CONFLICT_CODES = new Set(['VERSION_CONFLICT', 'CUSTOMER_DELETED', 'DUPLICATE_PHONE']);

let registered = false;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const notifyCustomersChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:customers-sync-updated'));
};

const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const getExpectedVersion = (operation = {}) => {
  const value = Number(operation?.payload?.expectedVersion ?? operation?.payload?.expected_version);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const savePushConflict = async ({ operation, response }) => {
  const conflictType = response?.code || 'CUSTOMER_SYNC_CONFLICT';

  await syncConflictService.saveConflict({
    entityType: SYNC_ENTITY_TYPES.CUSTOMER,
    entityId: operation?.entityId || response?.customer?.id || 'unknown',
    conflictType,
    localPayload: operation?.payload || operation || null,
    serverPayload: response?.customer || response || null,
    metadata: {
      source: 'customerSyncHandler.pushOperation',
      outboxId: operation?.id || null
    }
  });

  if (response?.customer) {
    await customerLocalRepository.applyCloudCustomer(response.customer);
  }

  if (operation?.entityId) {
    const localCustomer = await customerLocalRepository.getCustomerById(operation.entityId);
    if (localCustomer) {
      await customerLocalRepository.markConflict(localCustomer, conflictType);
    }
  }
};

export const customerSyncHandler = {
  async onStart({ licenseKey, reason = 'manual', force = false } = {}) {
    if (!licenseKey || !isOnline()) return { skipped: true };

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
      Logger.warn('[Customers/Sync] Migracion inicial fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = []) {
    const licenseKey = getRuntimeLicenseKey();
    if (!licenseKey || !isOnline()) return { applied: 0, skipped: true };

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

    const expectedVersion = getExpectedVersion(operation);
    const idempotencyKey = operation?.idempotencyKey || operation?.id;
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
      response = await customerCloudRepository.upsertCustomer({
        licenseKey,
        customer: operation?.payload?.customer,
        expectedVersion,
        idempotencyKey
      });
    }

    if (response?.success === false) {
      if (CONFLICT_CODES.has(response.code)) {
        await savePushConflict({ operation, response });
        notifyCustomersChanged();
        return { conflict: response };
      }

      throw new Error(response.message || response.code || 'CUSTOMER_PUSH_FAILED');
    }

    if (response?.customer) {
      await customerLocalRepository.applyCloudCustomer(response.customer);
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
