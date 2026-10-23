import { db, STORES } from '../db/dexie';
import { Money } from '../../utils/moneyMath';
import { localTenantAccessController } from '../tenant/localTenantPolicy';

const PREFIX = 'historical-credit:v1:';
const SOURCE_KEY = `${PREFIX}source`;
const snapshotKey = (id) => `${PREFIX}customer:${id}`;

// Durable preservation against accidental overwrite; not proof of historical origin.
// sync_cache is tenant owned and already exists in every supported schema.
export const createHistoricalCreditSnapshotRepository = (database, tenantIdentity) => ({
  async preserveInTransaction(customer, { actorHandle = null } = {}) {
    if (!customer?.id) return null;
    actorHandle?.assertCurrent?.();
    const cache = database.table(STORES.SYNC_CACHE);
    const previous = await cache.get(snapshotKey(customer.id));
    actorHandle?.assertCurrent?.();
    const currentCents = Money.toCents(customer.debt || 0);
    const localActivity = customer.financialSource === 'local'
      || (customer.financialSource === 'cloud' && customer.lastCloudDebtCents !== undefined && customer.lastCloudDebtCents !== currentCents);
    if (previous) {
      if (localActivity && ['IMPORTED','ALREADY_IMPORTED_IDENTICAL','CLOUD_PROJECTION'].includes(previous.value.status)) {
        previous.value = { ...previous.value, status:'CONFLICT_LOCAL_ACTIVITY', latestLocalCustomer:structuredClone(customer) };
        actorHandle?.assertCurrent?.();
        await cache.put(previous);
      }
      return previous.value;
    }
    if ((customer.financialSource === 'cloud' && !localActivity) || currentCents <= 0) return null;
    const cents = Money.toCents(customer.debt);
    if (!Number.isSafeInteger(cents) || cents > 2147483647) throw new Error('HISTORICAL_BALANCE_OUT_OF_RANGE');
    let source = await cache.get(SOURCE_KEY);
    actorHandle?.assertCurrent?.();
    if (!source) {
      source = { key: SOURCE_KEY, value: crypto.randomUUID() };
      actorHandle?.assertCurrent?.();
      await cache.add(source);
    }
    const value = {
      version: 1, sourceId: source.value, sourceCustomerId: customer.id,
      customerId: customer.id, amountCents: cents, tenant: tenantIdentity(),
      databaseName: database.name, capturedAt: new Date().toISOString(),
      originalCustomer: structuredClone(customer),
      originalLedgerEntries: database.tables.some((table) => table.name === STORES.CUSTOMER_LEDGER)
        ? structuredClone(await database.table(STORES.CUSTOMER_LEDGER).where('customerId').equals(customer.id).toArray()) : [],
      status: 'PENDING_AUTHORIZATION'
    };
    // Older installations have a server projection checkpoint, but no new
    // financialSource field. Preserve that checkpoint too, without importing it
    // again or freezing normal Cloud updates. Subsequent Local writers mark local.
    if (!localActivity && customer.syncStatus === 'synced' && customer.serverVersion > 0
      && customer.lastSyncedAt && customer.updatedAt && customer.updatedAt <= customer.lastSyncedAt
      && customer.metadata?.debt_projection_source === 'pos_customer_ledger' && !customer.pendingOperationId) {
      value.status = 'CLOUD_PROJECTION';
    }
    actorHandle?.assertCurrent?.();
    await cache.add({ key: snapshotKey(customer.id), value });
    actorHandle?.assertCurrent?.();
    return value;
  },
  async preserveAll({ actorHandle = null } = {}) {
    if (!database.isOpen()) await database.open();
    actorHandle?.assertCurrent?.();
    const tables = [database.table(STORES.CUSTOMERS), database.table(STORES.SYNC_CACHE)];
    if (database.tables.some((table) => table.name === STORES.CUSTOMER_LEDGER)) tables.push(database.table(STORES.CUSTOMER_LEDGER));
    return database.transaction('rw', tables, async () => {
      actorHandle?.assertCurrent?.();
      const customers = await database.table(STORES.CUSTOMERS).toArray();
      actorHandle?.assertCurrent?.();
      for (const customer of customers) {
        await this.preserveInTransaction(customer, { actorHandle });
        actorHandle?.assertCurrent?.();
      }
    });
  },
  async list() {
    if (!database.isOpen()) await database.open();
    const records = await database.table(STORES.SYNC_CACHE).toArray();
    return records.filter((row) => row.key.startsWith(`${PREFIX}customer:`)).map((row) => row.value);
  },
  async saveResult(customerId, result) {
    if (!database.isOpen()) await database.open();
    return database.transaction('rw', database.table(STORES.CUSTOMERS), database.table(STORES.SYNC_CACHE), async () => {
      const record = await database.table(STORES.SYNC_CACHE).get(snapshotKey(customerId));
      if (!record) throw new Error('HISTORICAL_SNAPSHOT_MISSING');
      const customer = await database.table(STORES.CUSTOMERS).get(customerId);
      const cloudConfirmed = ['IMPORTED', 'ALREADY_IMPORTED_IDENTICAL'].includes(result.status);
      const localChanged = cloudConfirmed && (customer?.financialSource !== 'cloud'
        || Money.toCents(customer?.debt || 0) !== customer?.lastCloudDebtCents)
        && Money.toCents(customer?.debt || 0) !== record.value.amountCents;
      const preservedResult = localChanged ? { ...result, cloudStatus: result.status, status: 'CONFLICT_LOCAL_ACTIVITY' } : result;
      record.value = { ...record.value, status: preservedResult.status, result: preservedResult, updatedAt: new Date().toISOString() };
      await database.table(STORES.SYNC_CACHE).put(record);
      return preservedResult;
    });
  }
});

export const historicalCreditSnapshot = createHistoricalCreditSnapshotRepository(
  db, () => localTenantAccessController.getState().identities
);
