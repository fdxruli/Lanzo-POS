import { db, STORES } from '../db/dexie';
import Logger from '../Logger';
import { Money } from '../../utils/moneyMath';
import { syncMetaService } from '../sync/syncMetaService';
import { SYNC_LIMITS } from '../sync/syncConstants';
import { customerCreditCloudRepository } from './customerCreditCloudRepository';
import { customerCreditLocalRepository } from './customerCreditLocalRepository';

const MIGRATED_AT_KEY = 'customer_credit_migrated_at';
const LAST_CHANGE_SEQ_KEY = 'customer_credit_last_change_seq';
const MIGRATION_CONFLICTS_KEY = 'customer_credit_migration_conflicts';

const buildStableBatchId = (licenseKey) => `customer_credit.initial_balance:${licenseKey}`;
const buildInitialBalanceKey = (licenseKey, customerId) => `customer_credit.initial_balance:${licenseKey}:${customerId}`;

const getLedgerEntriesFromSummary = (summary = {}) => {
  if (Array.isArray(summary.ledger_entries)) return summary.ledger_entries;
  if (Array.isArray(summary.ledgerEntries)) return summary.ledgerEntries;
  if (Array.isArray(summary.ledger)) return summary.ledger;
  return [];
};

const getCustomerDebtFromSummary = (summary = {}) => (
  summary.customer?.debt ??
  summary.customer?.current_debt ??
  summary.customer?.currentDebt ??
  summary.debt ??
  summary.current_debt ??
  summary.currentDebt ??
  null
);

const debtsDiffer = (localDebt, cloudDebt) => {
  if (cloudDebt === null || cloudDebt === undefined) return false;
  return Money.toCents(localDebt) !== Money.toCents(cloudDebt);
};

const buildMigrationConflict = ({ customer, localDebt, cloudDebt, cloudLedgerExists, reason }) => ({
  type: 'CUSTOMER_CREDIT_MIGRATION_CONFLICT',
  customerId: customer.id,
  customerName: customer.name || customer.nombre || null,
  localDebt: Money.toExactString(localDebt),
  cloudDebt: cloudDebt === null || cloudDebt === undefined ? null : Money.toExactString(cloudDebt),
  cloudLedgerExists: Boolean(cloudLedgerExists),
  createdAt: new Date().toISOString(),
  reason,
  recommendation: 'Resolver manualmente antes de intentar migracion historica avanzada. No se sobrescribio la deuda cloud.'
});

const saveMigrationConflicts = async (licenseKey, conflicts = []) => {
  if (!licenseKey || conflicts.length === 0) return;

  const previous = await syncMetaService.getMeta(MIGRATION_CONFLICTS_KEY, [], { licenseKey });
  const previousList = Array.isArray(previous) ? previous : [];
  const byCustomer = new Map();

  [...previousList, ...conflicts].forEach((conflict) => {
    const key = conflict?.customerId || `${conflict?.type}:${conflict?.createdAt}`;
    byCustomer.set(key, conflict);
  });

  await syncMetaService.setMeta(MIGRATION_CONFLICTS_KEY, Array.from(byCustomer.values()), { licenseKey });
};

export const customerCreditMigrationService = {
  async runInitialMigrationIfNeeded({ licenseKey }) {
    if (!licenseKey) return { skipped: true, reason: 'license_missing' };

    const alreadyMigrated = await syncMetaService.getMeta(MIGRATED_AT_KEY, null, { licenseKey });
    if (alreadyMigrated) return { skipped: true, migratedAt: alreadyMigrated };

    const customers = await customerCreditLocalRepository.getCustomersWithDebt();
    if (customers.length === 0) {
      await syncMetaService.setMeta(MIGRATED_AT_KEY, new Date().toISOString(), { licenseKey });
      return { success: true, inserted: 0, skipped: true };
    }

    const snapshot = await customerCreditCloudRepository.pullCreditSnapshot({
      licenseKey,
      limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
      includeDeleted: false
    });

    if (snapshot?.success === false) {
      throw new Error(snapshot.message || snapshot.code || 'CUSTOMER_CREDIT_SNAPSHOT_FAILED');
    }

    const snapshotLedgers = Array.isArray(snapshot.ledger_entries) ? snapshot.ledger_entries : [];
    const snapshotLedgerCustomerIds = snapshotLedgers.reduce((ids, ledger) => {
      const customerId = ledger.customer_id || ledger.customerId;
      if (customerId) ids.add(customerId);
      return ids;
    }, new Set());

    const balances = [];
    const conflicts = [];
    let skippedExistingCloudLedger = 0;
    let skippedZeroDebt = 0;

    for (const customer of customers) {
      const localDebt = Money.init(customer.debt || 0);

      if (localDebt.lte(0)) {
        skippedZeroDebt += 1;
        continue;
      }

      let summary = null;
      try {
        summary = await customerCreditCloudRepository.getCustomerCreditSummary({
          licenseKey,
          customerId: customer.id
        });
      } catch (summaryError) {
        Logger.warn('[CustomerCredit/Migration] No se pudo leer resumen cloud de cliente; se usara snapshot si existe:', {
          customerId: customer.id,
          error: summaryError
        });
      }

      const summaryLedgers = getLedgerEntriesFromSummary(summary);
      const cloudLedgerExists = summaryLedgers.length > 0 || snapshotLedgerCustomerIds.has(customer.id);

      if (cloudLedgerExists) {
        skippedExistingCloudLedger += 1;
        const cloudDebt = getCustomerDebtFromSummary(summary);

        if (debtsDiffer(localDebt, cloudDebt)) {
          conflicts.push(buildMigrationConflict({
            customer,
            localDebt,
            cloudDebt,
            cloudLedgerExists,
            reason: 'cloud_ledger_exists_with_different_debt'
          }));
        }

        continue;
      }

      balances.push({
        customer_id: customer.id,
        debt: Money.toExactString(localDebt),
        metadata: {
          source: 'dexie_customer_debt',
          migrationType: 'INITIAL_BALANCE_ONLY',
          historicalLedgerMigrated: false,
          idempotencyKey: buildInitialBalanceKey(licenseKey, customer.id),
          note: 'Saldo inicial migrado. El historial local previo permanece en Dexie y no se migra en Fase 4.'
        }
      });
    }

    await saveMigrationConflicts(licenseKey, conflicts);

    if (balances.length === 0) {
      await syncMetaService.setMeta(MIGRATED_AT_KEY, new Date().toISOString(), { licenseKey });
      return {
        success: true,
        inserted: 0,
        skipped: customers.length,
        skippedExistingCloudLedger,
        skippedZeroDebt,
        conflicts
      };
    }

    const response = await customerCreditCloudRepository.migrateLocalCredit({
      licenseKey,
      customerBalances: balances,
      batchId: buildStableBatchId(licenseKey)
    });

    if (response?.success === false) {
      throw new Error(response.message || response.code || 'CUSTOMER_CREDIT_MIGRATION_FAILED');
    }

    await syncMetaService.setMeta(MIGRATED_AT_KEY, new Date().toISOString(), { licenseKey });
    const latestChangeSeq = Number(response.latest_change_seq || 0);
    if (latestChangeSeq > 0) {
      await syncMetaService.setMeta(LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey });
    }

    return {
      ...response,
      skippedExistingCloudLedger,
      skippedZeroDebt,
      conflicts,
      migrationMode: 'INITIAL_BALANCE_ONLY'
    };
  },

  async markLastChangeSeq(licenseKey, changeSeq) {
    const normalized = Number(changeSeq) || 0;
    if (!licenseKey || normalized <= 0) return;
    await syncMetaService.setMeta(LAST_CHANGE_SEQ_KEY, normalized, { licenseKey });
  },

  async getLocalLedgerEntries(customerId = null) {
    if (!db.isOpen()) await db.open();
    try {
      if (customerId) {
        return db.table(STORES.CUSTOMER_LEDGER).where('customerId').equals(customerId).toArray();
      }
      return db.table(STORES.CUSTOMER_LEDGER).toArray();
    } catch (error) {
      Logger.warn('[CustomerCredit/Migration] No se pudo leer ledger local:', error);
      return [];
    }
  }
};

export default customerCreditMigrationService;
