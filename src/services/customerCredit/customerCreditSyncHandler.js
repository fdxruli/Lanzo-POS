import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  isCloudCustomerCreditSyncEnabled,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS
} from '../sync/syncConstants';
import { cashLocalRepository } from '../cash/cashLocalRepository';
import { isBrowserOnline } from '../cash/cashActor';
import { customerLocalRepository } from '../customers/customerLocalRepository';
import { customerCreditCloudRepository } from './customerCreditCloudRepository';
import { customerCreditLocalRepository } from './customerCreditLocalRepository';
import { customerCreditMigrationService } from './customerCreditMigrationService';

const CREDIT_LAST_CHANGE_SEQ_KEY = 'customer_credit_last_change_seq';
let registered = false;

const notifyCreditChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:customer-credit-sync-updated'));
  window.dispatchEvent(new CustomEvent('lanzo:customers-sync-updated'));
  window.dispatchEvent(new CustomEvent('lanzo:cash-sync-updated'));
};

const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);

const normalizeChangeSeq = (response, fallback = 0) => {
  const value = Number(response?.latest_change_seq ?? response?.latestChangeSeq ?? response?.change_seq ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const applyCreditPayload = async (response = {}) => {
  const ledgers = Array.isArray(response.ledger_entries) ? response.ledger_entries : [];
  const customers = Array.isArray(response.customers) ? response.customers : [];
  const movements = Array.isArray(response.cash_movements)
    ? response.cash_movements
    : (Array.isArray(response.movements) ? response.movements : []);
  const sessions = Array.isArray(response.cash_sessions) ? response.cash_sessions : [];

  const [
    appliedLedgers,
    appliedCustomers,
    appliedMovements,
    appliedSessions
  ] = await Promise.all([
    customerCreditLocalRepository.applyCloudLedgers(ledgers),
    customerLocalRepository.applyCloudCustomers(customers),
    cashLocalRepository.applyCloudCashMovements(movements),
    cashLocalRepository.applyCloudCashSessions(sessions)
  ]);

  return appliedLedgers.length + appliedCustomers.length + appliedMovements.length + appliedSessions.length;
};

export const customerCreditSyncHandler = {
  async onStart({ licenseDetails, licenseKey } = {}) {
    const resolvedLicenseKey = licenseKey || getLicenseKeyFromDetails(licenseDetails);
    if (!resolvedLicenseKey || !isBrowserOnline() || !isCloudCustomerCreditSyncEnabled(licenseDetails)) {
      return { skipped: true };
    }

    try {
      const migrationResult = await customerCreditMigrationService.runInitialMigrationIfNeeded({ licenseKey: resolvedLicenseKey });
      const snapshot = await customerCreditCloudRepository.pullCreditSnapshot({
        licenseKey: resolvedLicenseKey,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
        includeDeleted: false
      });

      if (snapshot?.success === false) {
        throw new Error(snapshot.message || snapshot.code || 'CUSTOMER_CREDIT_SNAPSHOT_FAILED');
      }

      const applied = await applyCreditPayload(snapshot);
      const latestChangeSeq = normalizeChangeSeq(snapshot, 0);
      if (latestChangeSeq > 0) {
        await syncMetaService.setMeta(CREDIT_LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey: resolvedLicenseKey });
      }

      if (applied > 0) notifyCreditChanged();
      return { success: true, migrationResult, applied, latestChangeSeq };
    } catch (error) {
      Logger.warn('[CustomerCredit/Sync] Inicio fallo sin bloquear app:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = []) {
    const licenseKey = getRuntimeLicenseKey();
    if (!licenseKey || !isBrowserOnline()) return { applied: 0, skipped: true };

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
    let hasMore = true;
    let applied = 0;

    while (hasMore) {
      const response = await customerCreditCloudRepository.pullCreditChanges({
        licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
      });

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'CUSTOMER_CREDIT_CHANGES_PULL_FAILED');
      }

      applied += await applyCreditPayload(response);

      const latestChangeSeq = normalizeChangeSeq(response, sinceChangeSeq);
      if (latestChangeSeq > sinceChangeSeq) {
        sinceChangeSeq = latestChangeSeq;
        await syncMetaService.setMeta(CREDIT_LAST_CHANGE_SEQ_KEY, sinceChangeSeq, { licenseKey });
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
