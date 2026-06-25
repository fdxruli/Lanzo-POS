import { db, STORES } from '../db/dexie';
import Logger from '../Logger';
import { syncMetaService } from '../sync/syncMetaService';
import { SYNC_LIMITS } from '../sync/syncConstants';
import { customerCreditCloudRepository } from './customerCreditCloudRepository';
import { customerCreditLocalRepository } from './customerCreditLocalRepository';

const MIGRATED_AT_KEY = 'customer_credit_migrated_at';
const LAST_CHANGE_SEQ_KEY = 'customer_credit_last_change_seq';

const nowBatchId = () => `credit-${new Date().toISOString().replace(/[:.]/g, '-')}`;

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

    const cloudLedgers = Array.isArray(snapshot.ledger_entries) ? snapshot.ledger_entries : [];
    const cloudLedgerCustomerIds = cloudLedgers.reduce((ids, ledger) => {
      const customerId = ledger.customer_id || ledger.customerId;
      if (customerId) ids.add(customerId);
      return ids;
    }, new Set());
    const balances = customers.reduce((result, customer) => {
      if (cloudLedgerCustomerIds.has(customer.id)) return result;

      result.push({
        customer_id: customer.id,
        debt: String(customer.debt || 0),
        metadata: {
          source: 'dexie_customer_debt'
        }
      });

      return result;
    }, []);

    if (balances.length === 0) {
      await syncMetaService.setMeta(MIGRATED_AT_KEY, new Date().toISOString(), { licenseKey });
      return { success: true, inserted: 0, skipped: customers.length };
    }

    const response = await customerCreditCloudRepository.migrateLocalCredit({
      licenseKey,
      customerBalances: balances,
      batchId: nowBatchId()
    });

    if (response?.success === false) {
      throw new Error(response.message || response.code || 'CUSTOMER_CREDIT_MIGRATION_FAILED');
    }

    await syncMetaService.setMeta(MIGRATED_AT_KEY, new Date().toISOString(), { licenseKey });
    const latestChangeSeq = Number(response.latest_change_seq || 0);
    if (latestChangeSeq > 0) {
      await syncMetaService.setMeta(LAST_CHANGE_SEQ_KEY, latestChangeSeq, { licenseKey });
    }

    return response;
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
