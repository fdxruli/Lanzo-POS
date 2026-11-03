import { db, STORES } from '../db/dexie';
import { customerCreditRepository as dexieCustomerCreditRepository } from '../db/customerCreditRepository';
import { cloudLedgerToLocal } from './customerCreditMapper';
import { customerLocalRepository } from '../customers/customerLocalRepository';
import { POS_SYNC_STORES } from '../sync/syncConstants';

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};
const projectionTables = () => [STORES.CUSTOMERS, STORES.SYNC_CACHE, STORES.CUSTOMER_LEDGER, POS_SYNC_STORES.CONFLICTS]
  .map((name) => db.table(name));

export const customerCreditLocalRepository = {
  async processPayment(...args) {
    return dexieCustomerCreditRepository.processPayment(...args);
  },

  async recalculateDebtFromLedger(...args) {
    return dexieCustomerCreditRepository.recalculateDebtFromLedger(...args);
  },

  async healCustomerSalesDebt(...args) {
    return dexieCustomerCreditRepository.healCustomerSalesDebt(...args);
  },

  async migrateExistingDebtsToLedger(...args) {
    return dexieCustomerCreditRepository.migrateExistingDebtsToLedger(...args);
  },

  async applyCloudLedger(ledger) {
    if (!ledger?.id) return null;
    await ensureOpen();
    return db.transaction('rw', projectionTables(), async () => {
      if ((await customerLocalRepository.protectHistoricalCustomer(ledger.customer_id || ledger.customerId)).blocked) {
        return null;
      }
      const existing = await db.table(STORES.CUSTOMER_LEDGER).get(ledger.id);
      const local = cloudLedgerToLocal(ledger, existing);
      if (!local) return null;
      await db.table(STORES.CUSTOMER_LEDGER).put(local);
      return local;
    });
  },

  async applyCloudLedgers(ledgers = []) {
    await ensureOpen();
    return db.transaction('rw', projectionTables(), async () => {
      const applied = [];
      for (const ledger of ledgers || []) {
        const local = await this.applyCloudLedger(ledger);
        if (local) applied.push(local);
      }
      return applied;
    });
  },

  async getCustomerLedger(customerId) {
    if (!customerId) return [];
    await ensureOpen();
    const entries = await db.table(STORES.CUSTOMER_LEDGER)
      .where('customerId')
      .equals(customerId)
      .toArray();

    return entries.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
  },

  async getCustomersWithDebt() {
    await ensureOpen();
    return db.table(STORES.CUSTOMERS)
      .filter((customer) => Number(customer?.debt || 0) > 0)
      .toArray();
  }
};

export default customerCreditLocalRepository;
