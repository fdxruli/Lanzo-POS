import { db, STORES } from '../db/dexie';
import { customerCreditRepository as dexieCustomerCreditRepository } from '../db/customerCreditRepository';
import { cloudLedgerToLocal } from './customerCreditMapper';

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

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
    const existing = await db.table(STORES.CUSTOMER_LEDGER).get(ledger.id);
    const local = cloudLedgerToLocal(ledger, existing);
    if (!local) return null;
    await db.table(STORES.CUSTOMER_LEDGER).put(local);
    return local;
  },

  async applyCloudLedgers(ledgers = []) {
    await ensureOpen();
    const ids = (ledgers || []).reduce((result, ledger) => {
      if (ledger?.id) result.push(ledger.id);
      return result;
    }, []);
    if (ids.length === 0) return [];

    const existingRows = await db.table(STORES.CUSTOMER_LEDGER).bulkGet(ids);
    const applied = (ledgers || []).reduce((result, ledger, index) => {
      const local = cloudLedgerToLocal(ledger, existingRows[index]);
      if (local) result.push(local);
      return result;
    }, []);

    if (applied.length > 0) {
      await db.table(STORES.CUSTOMER_LEDGER).bulkPut(applied);
    }

    return applied;
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
