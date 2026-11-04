import { db, STORES } from '../db/dexie';
import { customerCreditRepository as dexieCustomerCreditRepository } from '../db/customerCreditRepository';
import { cloudLedgerToLocal } from './customerCreditMapper';
import { historicalCreditLedgerView } from './historicalCreditLedger';
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

  async applyCloudLedger(ledger, { actorHandle = null } = {}) {
    if (!ledger?.id) return null;
    await ensureOpen();
    actorHandle?.assertCurrent?.();
    return db.transaction('rw', projectionTables(), async () => {
      const history = await customerLocalRepository.protectHistoricalCustomer(ledger.customer_id || ledger.customerId);
      actorHandle?.assertCurrent?.();
      if (history.blocked) {
        return null;
      }
      const existing = await db.table(STORES.CUSTOMER_LEDGER).get(ledger.id);
      const local = cloudLedgerToLocal(ledger, existing);
      if (!local) return null;
      actorHandle?.assertCurrent?.();
      await db.table(STORES.CUSTOMER_LEDGER).put(local);
      actorHandle?.assertCurrent?.();
      return local;
    });
  },

  async applyCloudLedgers(ledgers = [], { actorHandle = null } = {}) {
    await ensureOpen();
    return db.transaction('rw', projectionTables(), async () => {
      const applied = [];
      for (const ledger of ledgers || []) {
        actorHandle?.assertCurrent?.();
        const local = await this.applyCloudLedger(ledger, { actorHandle });
        if (local) applied.push(local);
      }
      actorHandle?.assertCurrent?.();
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

    const snapshot = (await db.table(STORES.SYNC_CACHE).get(`historical-credit:v1:customer:${customerId}`))?.value;
    return historicalCreditLedgerView(entries, snapshot).active
      .sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
  },

  async getCustomersWithDebt() {
    await ensureOpen();
    return db.table(STORES.CUSTOMERS)
      .filter((customer) => Number(customer?.debt || 0) > 0)
      .toArray();
  }
};

export default customerCreditLocalRepository;
