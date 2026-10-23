import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  isCloudCustomerCreditSyncEnabled,
  shouldDeferPosBootstrapStartHook,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS
} from '../sync/syncConstants';
import { cashLocalRepository } from '../cash/cashLocalRepository';
import { isBrowserOnline } from '../cash/cashActor';
import { customerLocalRepository } from '../customers/customerLocalRepository';
import { customerCreditCloudRepository } from './customerCreditCloudRepository';
import { customerCreditLocalRepository } from './customerCreditLocalRepository';
import { customerCreditMigrationService } from './customerCreditMigrationService';
import { isLocalTenantAccessError } from '../tenant/localTenantGuard';
import { hasCurrentActorPermission } from '../sync/actorPermission';
import { db, STORES } from '../db/dexie';
import { actorRuntimeController } from '../auth/actorRuntimeController';

const CREDIT_LAST_CHANGE_SEQ_KEY = 'customer_credit_last_change_seq';
let registered = false;

const notifyCreditChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:customer-credit-sync-updated'));
  window.dispatchEvent(new CustomEvent('lanzo:customers-sync-updated'));
  window.dispatchEvent(new CustomEvent('lanzo:cash-sync-updated'));
};

const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);
const canSyncCustomerCredit = () => hasCurrentActorPermission('customers');

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const applyCreditPayload = async (response = {}, actorHandle) => {
  const ledgers = Array.isArray(response.ledger_entries) ? response.ledger_entries : [];
  const customers = Array.isArray(response.customers) ? response.customers : [];
  const movements = Array.isArray(response.cash_movements)
    ? response.cash_movements
    : (Array.isArray(response.movements) ? response.movements : []);
  const sessions = Array.isArray(response.cash_sessions) ? response.cash_sessions : [];

  if (!db.isOpen()) await db.open();
  actorHandle.assertCurrent();
  let applied = 0;
  await db.transaction('rw', [
    db.table(STORES.CUSTOMER_LEDGER),
    db.table(STORES.CUSTOMERS),
    db.table(STORES.SYNC_CACHE),
    db.table(STORES.CAJAS),
    db.table(STORES.MOVIMIENTOS_CAJA)
  ], async () => {
    actorHandle.assertCurrent();
    const appliedLedgers = await customerCreditLocalRepository.applyCloudLedgersInCurrentTransaction(ledgers, { actorHandle });
    applied += appliedLedgers.length;
    actorHandle.assertCurrent();
    const appliedCustomers = await customerLocalRepository.applyCloudCustomersInCurrentTransaction(customers, { actorHandle });
    applied += appliedCustomers.length;
    actorHandle.assertCurrent();
    const appliedMovements = await cashLocalRepository.applyCloudCashMovements(movements, { actorHandle });
    applied += appliedMovements.length;
    actorHandle.assertCurrent();
    const appliedSessions = await cashLocalRepository.applyCloudCashSessions(sessions, { actorHandle });
    applied += appliedSessions.length;
    actorHandle.assertCurrent();
  });
  actorHandle.assertCurrent();
  return applied;
};

export const customerCreditSyncHandler = {
  async onStart({ licenseDetails, licenseKey, reason = 'manual', force = false } = {}) {
    const resolvedLicenseKey = licenseKey || getLicenseKeyFromDetails(licenseDetails);
    if (!resolvedLicenseKey || !isBrowserOnline() || !isCloudCustomerCreditSyncEnabled(licenseDetails)) {
      return { skipped: true };
    }
    if (!canSyncCustomerCredit()) {
      return { skipped: true, reason: 'actor_permission_missing' };
    }
    const actorHandle = actorRuntimeController.capture('customers');

    if (shouldDeferPosBootstrapStartHook(reason, { force })) {
      Logger.log('[CustomerCredit/Sync] Snapshot/migracion inicial diferida por bootstrap inteligente.');
      return { skipped: true, deferred: true, reason: 'bootstrap_deferred_snapshot' };
    }

    try {
      const migrationResult = await customerCreditMigrationService.runInitialMigrationIfNeeded({ licenseKey: resolvedLicenseKey, actorHandle });
      actorHandle.assertCurrent();
      let offset = 0;
      let latestChangeSeq = null;
      let snapshotCount = 0;
      let applied = 0;
      let hasMore = true;
      while (hasMore) {
        const snapshot = await customerCreditCloudRepository.pullCreditSnapshot({
          licenseKey: resolvedLicenseKey,
          limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
          offset,
          includeDeleted: false,
          force,
          actorHandle
        });
        actorHandle.assertCurrent();
        if (snapshot?.success === false) {
          throw new Error(snapshot.message || snapshot.code || 'CUSTOMER_CREDIT_SNAPSHOT_FAILED');
        }
        const pageSeq = normalizeChangeSeq(snapshot, 0);
        if (latestChangeSeq !== null && latestChangeSeq !== pageSeq) {
          throw new Error('CLOUD_SYNC_PROTOCOL_SNAPSHOT_CURSOR_CHANGED');
        }
        latestChangeSeq = pageSeq;
        const pageApplied = await applyCreditPayload(snapshot, actorHandle);
        applied += pageApplied;
        snapshotCount += 1;
        hasMore = Boolean(snapshot.has_more || snapshot.hasMore);
        const nextOffset = snapshot.cloudSyncEnvelope?.cursor?.next_offset;
        if (hasMore && (!Number.isSafeInteger(nextOffset) || nextOffset <= offset)) {
          throw new Error('CLOUD_SYNC_PROTOCOL_CURSOR_INVALID');
        }
        if (hasMore && pageApplied === 0 && (snapshot.customers || []).length === 0) {
          throw new Error('CUSTOMER_CREDIT_SNAPSHOT_EMPTY_PAGE');
        }
        offset = Number.isSafeInteger(nextOffset) ? nextOffset : offset + (snapshot.customers || []).length;
        if (snapshotCount > 10000) throw new Error('CLOUD_SYNC_PROTOCOL_SNAPSHOT_PAGE_LIMIT');
      }

      if (latestChangeSeq > 0) {
        actorHandle.assertCurrent();
        await syncMetaService.setMeta(CREDIT_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey: resolvedLicenseKey });
        actorHandle.assertCurrent();
      }

      if (applied > 0) notifyCreditChanged();
      return { success: true, migrationResult, applied, latestChangeSeq };
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[CustomerCredit/Sync] Inicio fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], { licenseKey: capturedLicenseKey = null } = {}) {
    const licenseKey = capturedLicenseKey || getRuntimeLicenseKey();
    if (!licenseKey || !isBrowserOnline()) return { applied: 0, skipped: true };
    if (!canSyncCustomerCredit()) return { applied: 0, skipped: true, reason: 'actor_permission_missing' };
    const actorHandle = actorRuntimeController.capture('customers');

    const hasCreditEvents = events.some((event) => {
      const entityType = event.entity_type || event.entityType;
      return entityType === SYNC_ENTITY_TYPES.CUSTOMER_LEDGER
        || entityType === SYNC_ENTITY_TYPES.CUSTOMER_CREDIT
        || entityType === SYNC_ENTITY_TYPES.CUSTOMER
        || entityType === SYNC_ENTITY_TYPES.CASH_MOVEMENT
        || entityType === SYNC_ENTITY_TYPES.CASH_SESSION;
    });

    if (events.length > 0 && !hasCreditEvents) {
      return { applied: 0, skipped: true };
    }

    let sinceChangeSeq = Number(await syncMetaService.getMeta(CREDIT_LAST_CHANGE_SEQ_KEY, 0, { licenseKey })) || 0;
    actorHandle.assertCurrent();
    let hasMore = true;
    let applied = 0;

    while (hasMore) {
      const response = await customerCreditCloudRepository.pullCreditChanges({
        licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
        actorHandle
      });
      actorHandle.assertCurrent();

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'CUSTOMER_CREDIT_CHANGES_PULL_FAILED');
      }

      applied += await applyCreditPayload(response, actorHandle);

      const latestChangeSeq = normalizeChangeSeq(response, sinceChangeSeq);
      if (latestChangeSeq > sinceChangeSeq) {
        actorHandle.assertCurrent();
        sinceChangeSeq = latestChangeSeq;
        await syncMetaService.setMeta(CREDIT_LAST_CHANGE_SEQ_KEY, sinceChangeSeq, { licenseKey });
        actorHandle.assertCurrent();
      }

      hasMore = Boolean(response.has_more || response.hasMore) && latestChangeSeq > 0;
      if (!response.has_more && !response.hasMore) hasMore = false;
    }

    if (applied > 0) notifyCreditChanged();
    return { applied, latestChangeSeq: sinceChangeSeq };
  },

  async pushOperation() {
    throw new Error('CUSTOMER_CREDIT_OUTBOX_DISABLED');
  }
};

export const registerCustomerCreditSyncHandler = () => {
  if (registered) return false;

  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.CUSTOMER_LEDGER, customerCreditSyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.CUSTOMER_CREDIT, customerCreditSyncHandler);
  registered = true;
  Logger.log('[CustomerCredit/Sync] Handler de credito registrado.');
  return true;
};

registerCustomerCreditSyncHandler();

export default customerCreditSyncHandler;
