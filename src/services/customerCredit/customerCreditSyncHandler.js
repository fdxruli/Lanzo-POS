import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  isCloudCustomerCreditSyncEnabled,
  shouldDeferPosBootstrapStartHook,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS,
  POS_SYNC_STORES
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
import { durableSnapshotService, buildSnapshotContextId } from '../sync/durableSnapshotService';
import { requireCloudSnapshotContract } from '../sync/cloudSyncProtocolV2';

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

const applyCreditPayload = async (response = {}, actorHandle, { requireComplete = false } = {}) => {
  const ledgers = Array.isArray(response.ledger_entries) ? response.ledger_entries : [];
  const customers = Array.isArray(response.customers) ? response.customers : [];
  const movements = Array.isArray(response.cash_movements)
    ? response.cash_movements
    : (Array.isArray(response.movements) ? response.movements : []);
  const sessions = Array.isArray(response.cash_sessions) ? response.cash_sessions : [];

  if (!db.isOpen()) await db.open();
  actorHandle.assertCurrent();
  return db.transaction('rw', [STORES.CUSTOMER_LEDGER, STORES.CUSTOMERS,
    STORES.SYNC_CACHE, POS_SYNC_STORES.CONFLICTS, STORES.CAJAS, STORES.MOVIMIENTOS_CAJA]
    .map(name => db.table(name)), async () => {
  // A failed projection must not finish the handler while sibling local writes
  // are still running. Preserve the original operation order and first error;
  // this waits for local settlement, not remote financial confirmation.
  let failed = false, firstFailure;
  const settled = await Promise.allSettled([
    customerCreditLocalRepository.applyCloudLedgers(ledgers, { actorHandle }),
    customerLocalRepository.applyCloudCustomers(customers, { source: 'credit_projection', actorHandle }),
    cashLocalRepository.applyCloudCashMovements(movements, { actorHandle }),
    cashLocalRepository.applyCloudCashSessions(sessions, { actorHandle })
  ].map(promise => Promise.resolve(promise).catch(error => {
    if (!failed) { failed = true; firstFailure = error; }
    throw error;
  })));
  if (failed) throw firstFailure;
  const [
    appliedLedgers,
    appliedCustomers,
    appliedMovements,
    appliedSessions
  ] = settled.map(result => result.value);

  actorHandle.assertCurrent();
  const applied = appliedLedgers.length + appliedCustomers.length + appliedMovements.length + appliedSessions.length;
  const expected = ledgers.length + customers.length + movements.length + sessions.length;
  if (requireComplete && applied !== expected) throw new Error('CUSTOMER_CREDIT_SNAPSHOT_LOCAL_APPLY_INCOMPLETE');
  return applied;
  });
};

const CREDIT_SNAPSHOT_STREAM = 'customer_credit';

const runCreditSnapshot = async ({ licenseKey, actorHandle, snapshotProtocol, force = false }) => {
  const contextId = buildSnapshotContextId({
    licenseKey,
    streamKey: CREDIT_SNAPSHOT_STREAM,
    scope: { customerId: null, ledgerReconciliation: true },
    actorHandle
  });
  const snapshot = await durableSnapshotService.runConsistentSnapshot({
    licenseKey,
    streamKey: CREDIT_SNAPSHOT_STREAM,
    contextId,
    actorHandle,
    cursorKey: CREDIT_LAST_CHANGE_SEQ_KEY,
    fetchPage: ({ referenceChangeSeq, pageCursor }) => customerCreditCloudRepository.pullCreditSnapshot({
      licenseKey,
      limit: Math.min(SYNC_LIMITS.MAX_PULL_LIMIT, 500),
      customerId: null,
      includeDeleted: true,
      snapshotProtocol,
      snapshotReferenceChangeSeq: referenceChangeSeq,
      pageCursor,
      force,
      actorHandle
    }),
    applyPage: async (response) => {
      if (response.customer_id !== null) {
        throw new Error('CUSTOMER_CREDIT_SNAPSHOT_SCOPE_MISMATCH');
      }
      if (response.ledger_reconciliation_complete !== response.snapshot_complete) {
        throw new Error('CUSTOMER_CREDIT_SNAPSHOT_RECONCILIATION_INCOMPLETE');
      }
      const rows = (response.ledger_entries?.length || 0)
        + (response.customers?.length || 0)
        + (response.cash_movements?.length || response.movements?.length || 0)
        + (response.cash_sessions?.length || 0);
      const applied = await applyCreditPayload(response, actorHandle, { requireComplete: true });
      actorHandle.assertCurrent();
      return { applied, rowCount: rows };
    }
  });
  return { ...snapshot, contextId };
};

export const customerCreditSyncHandler = {
  actorPermission: 'customers',

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
      const snapshotProtocol = await customerCreditCloudRepository.negotiateSnapshotProtocol?.({
        licenseKey: resolvedLicenseKey, actorHandle, force
      }) || { supported: false, reason: 'snapshot_negotiation_unavailable' };
      actorHandle.assertCurrent();
      requireCloudSnapshotContract(snapshotProtocol);
      if (snapshotProtocol.supported) {
        const snapshot = await runCreditSnapshot({
          licenseKey: resolvedLicenseKey, actorHandle, snapshotProtocol, force
        });
        actorHandle.assertCurrent();
        if (snapshot.applied > 0) notifyCreditChanged();
        return { success: true, migrationResult, ...snapshot, consistent: true };
      }

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

      if (applied > 0) notifyCreditChanged();
      return {
        success: true,
        migrationResult,
        applied,
        latestChangeSeq: null,
        observedChangeSeq: latestChangeSeq,
        consistent: false,
        legacyFallback: true
      };
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[CustomerCredit/Sync] Inicio fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], { licenseKey: capturedLicenseKey = null, force = false } = {}) {
    const licenseKey = capturedLicenseKey || getRuntimeLicenseKey();
    if (!licenseKey) return { applied: 0, skipped: true, reason: 'context_invalidated' };
    if (!isBrowserOnline()) return { applied: 0, skipped: true, reason: 'offline' };
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
      return { applied: 0, skipped: true, reason: 'module_not_applicable' };
    }

    const snapshotContextId = buildSnapshotContextId({
      licenseKey,
      streamKey: CREDIT_SNAPSHOT_STREAM,
      scope: { customerId: null, ledgerReconciliation: true },
      actorHandle
    });
    if (await durableSnapshotService.isActive({
      licenseKey, streamKey: CREDIT_SNAPSHOT_STREAM, contextId: snapshotContextId
    })) {
      if (!force) return { applied: 0, syncDeferred: true, reason: 'snapshot_resume_scheduled' };
      const snapshotProtocol = await customerCreditCloudRepository.negotiateSnapshotProtocol?.({ licenseKey, actorHandle })
        || { supported: false, reason: 'snapshot_negotiation_unavailable' };
      if (!snapshotProtocol.supported) throw new Error('CUSTOMER_CREDIT_SNAPSHOT_CONTRACT_UNAVAILABLE');
      const resumed = await runCreditSnapshot({ licenseKey, actorHandle, snapshotProtocol, force: true });
      actorHandle.assertCurrent();
      if (resumed?.success !== true) return { applied: 0, syncDeferred: true, reason: 'snapshot_resume_pending' };
    }

    let sinceChangeSeq = await durableSnapshotService.getRecoveryStartSeq({
      licenseKey,
      streamKey: CREDIT_SNAPSHOT_STREAM,
      contextId: snapshotContextId,
      cursorKey: CREDIT_LAST_CHANGE_SEQ_KEY,
      fallback: 0
    });
    actorHandle.assertCurrent();
    let hasMore = true;
    let applied = 0;
    let syncDeferred = false;

    while (hasMore) {
      const pageSinceChangeSeq = sinceChangeSeq;
      const response = await customerCreditCloudRepository.pullCreditChanges({
        licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
        actorHandle
      });
      actorHandle.assertCurrent();

      if (response?.success === false) {
        const error = new Error(response.message || response.code || 'CUSTOMER_CREDIT_CHANGES_PULL_FAILED');
        error.code = response.code || 'CUSTOMER_CREDIT_CHANGES_PULL_FAILED';
        error.retryable = response.retryable === true;
        error.response = response;
        throw error;
      }
      syncDeferred = syncDeferred || response?.sync_deferred === true || response?.syncDeferred === true;

      applied += await applyCreditPayload(response, actorHandle);

      const latestChangeSeq = normalizeChangeSeq(response, pageSinceChangeSeq);
      if (latestChangeSeq > pageSinceChangeSeq) {
        actorHandle.assertCurrent();
        const advanced = await syncMetaService.advanceMeta(CREDIT_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey });
        if (!Number.isSafeInteger(advanced) || advanced < latestChangeSeq) {
          throw new Error('POS_SYNC_CURSOR_PERSIST_FAILED');
        }
        // Preserve the response page boundary when replaying from a lower
        // snapshot reference; the durable cursor itself remains monotonic.
        sinceChangeSeq = latestChangeSeq;
        actorHandle.assertCurrent();
      }

      hasMore = Boolean(response.has_more || response.hasMore)
        && latestChangeSeq > pageSinceChangeSeq;
    }

    const recoveryComplete = await durableSnapshotService.completeRecovery({
      licenseKey,
      streamKey: CREDIT_SNAPSHOT_STREAM,
      contextId: snapshotContextId,
      cursorKey: CREDIT_LAST_CHANGE_SEQ_KEY,
      latestChangeSeq: sinceChangeSeq,
      hasMore,
      syncDeferred
    });
    syncDeferred = syncDeferred || recoveryComplete === false;

    if (applied > 0) notifyCreditChanged();
    return { applied, latestChangeSeq: sinceChangeSeq, syncDeferred };
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
