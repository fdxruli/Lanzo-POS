import { db, STORES } from '../db/dexie';
import {
  loadCustomersByDebtPaginated,
  loadData,
  recycleData,
  saveDataSafe
} from '../database';
import { normalizeCustomerDebtCents } from '../db/customerDebtIndex';
import { toIndexedPhoneKey } from '../db/customerPhoneUtils';
import { historicalCreditSnapshot } from '../customerCredit/historicalCreditSnapshot';
import {
  buildPendingCustomer,
  cloudCustomerToLocal,
  CUSTOMER_SYNC_STATUS,
  isCustomerVisible,
  markCustomerConflict,
  normalizeCustomerForLocal
} from './customerMapper';

const nowIso = () => new Date().toISOString();

const ensureOpen = async () => {
  if (!db.isOpen()) {
    await db.open();
  }
};

const applyCloudCustomerInCurrentTransaction = async (cloudCustomer, actorHandle = null) => {
  if (!cloudCustomer?.id) return null;
  actorHandle?.assertCurrent?.();
  const existing = await db.table(STORES.CUSTOMERS).get(cloudCustomer.id);
  const snapshot = await historicalCreditSnapshot.preserveInTransaction(existing, { actorHandle });
  const localCustomer = cloudCustomerToLocal(cloudCustomer, existing);
  const projectionStatus = localCustomer.financialProjectionStatus;
  const projectionUnknown = ['HISTORICAL_PENDING', 'CONFLICT', 'NOT_INCLUDED'].includes(projectionStatus);

  if (snapshot && !['IMPORTED', 'ALREADY_IMPORTED_IDENTICAL', 'CLOUD_PROJECTION'].includes(snapshot.status)) {
    localCustomer.debt = existing.debt;
    localCustomer.debtCents = normalizeCustomerDebtCents(existing.debt);
    localCustomer.creditMigrationStatus = snapshot.status;
  } else if (projectionUnknown) {
    localCustomer.financialSource = existing?.financialSource || 'unknown';
    if (existing?.lastCloudDebtCents !== undefined) {
      localCustomer.lastCloudDebtCents = existing.lastCloudDebtCents;
    } else {
      delete localCustomer.lastCloudDebtCents;
    }
  } else {
    localCustomer.financialSource = 'cloud';
    localCustomer.lastCloudDebtCents = normalizeCustomerDebtCents(localCustomer.debt);
  }

  if (localCustomer.deletedAt || localCustomer.deletedTimestamp) {
    localCustomer.isActive = false;
    localCustomer.phoneKey = null;
    delete localCustomer.phoneKey;
  }

  actorHandle?.assertCurrent?.();
  await db.table(STORES.CUSTOMERS).put(localCustomer);
  return localCustomer;
};

const normalizeSearchTerm = (query = '') => String(query || '').trim().toLowerCase();

const matchesSearch = (customer, normalizedTerm) => {
  if (!normalizedTerm) return true;

  return [customer?.name, customer?.phone, customer?.address]
    .map((value) => String(value || '').toLowerCase())
    .some((value) => value.includes(normalizedTerm));
};

export const customerLocalRepository = {
  async listCustomersPage({ limit = 50, offset = 0, snapshotAt = null } = {}) {
    return loadCustomersByDebtPaginated({ limit, offset, snapshotAt });
  },

  async getCustomerById(customerId) {
    if (!customerId) return null;
    return loadData(STORES.CUSTOMERS, customerId);
  },

  async searchCustomers(query = '') {
    await ensureOpen();
    const normalizedTerm = normalizeSearchTerm(query);
    const customers = await db.table(STORES.CUSTOMERS).toArray();

    return customers
      .filter(isCustomerVisible)
      .filter((customer) => matchesSearch(customer, normalizedTerm))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  },

  async saveCustomerLocal(customerData, { existingCustomer = null, syncStatus = CUSTOMER_SYNC_STATUS.LOCAL, pendingOperationId = null } = {}) {
    const now = nowIso();
    const payload = normalizeCustomerForLocal(
      {
        ...customerData,
        createdAt: existingCustomer?.createdAt || customerData.createdAt || now,
        updatedAt: now,
        debt: customerData.debt ?? existingCustomer?.debt ?? 0,
        debtCents: normalizeCustomerDebtCents(customerData.debt ?? existingCustomer?.debt ?? 0),
        phoneKey: toIndexedPhoneKey(customerData.phone),
        syncStatus,
        pendingOperationId
      },
      existingCustomer,
      { syncStatus, pendingOperationId }
    );

    return saveDataSafe(STORES.CUSTOMERS, payload);
  },

  async deleteCustomerLocal(customerId, reason = 'Eliminado desde Directorio') {
    return recycleData(STORES.CUSTOMERS, STORES.DELETED_CUSTOMERS, customerId, reason);
  },

  async markCustomerPending(customerData, { existingCustomer = null, operationId = null, operation = 'upsert' } = {}) {
    const pendingCustomer = buildPendingCustomer(customerData, existingCustomer, { operationId, operation });
    return saveDataSafe(STORES.CUSTOMERS, pendingCustomer);
  },

  async markCustomerDeletedPending(customer, { operationId = null } = {}) {
    if (!customer?.id) {
      return { success: false, message: 'Cliente invalido para eliminar.' };
    }

    await ensureOpen();
    const pendingCustomer = buildPendingCustomer(customer, customer, { operationId, operation: 'delete' });
    pendingCustomer.isActive = false;
    pendingCustomer.deletedAt = pendingCustomer.deletedAt || nowIso();
    pendingCustomer.deletedTimestamp = pendingCustomer.deletedAt;
    pendingCustomer.phoneKey = null;
    delete pendingCustomer.phoneKey;

    await db.table(STORES.CUSTOMERS).put(pendingCustomer);
    return { success: true, data: pendingCustomer };
  },

  async applyCloudCustomer(cloudCustomer, { actorHandle = null } = {}) {
    if (!cloudCustomer?.id) return null;

    await ensureOpen();
    actorHandle?.assertCurrent?.();
    const result = await db.transaction('rw', db.table(STORES.CUSTOMERS), db.table(STORES.SYNC_CACHE), db.table(STORES.CUSTOMER_LEDGER), async () => {
      const applied = await applyCloudCustomerInCurrentTransaction(cloudCustomer, actorHandle);
      actorHandle?.assertCurrent?.();
      return applied;
    });
    actorHandle?.assertCurrent?.();
    return result;
  },

  async applyCloudCustomers(customers = [], { actorHandle = null } = {}) {
    const rows = Array.isArray(customers) ? customers : [];
    await ensureOpen();
    actorHandle?.assertCurrent?.();
    const result = await db.transaction('rw', db.table(STORES.CUSTOMERS), db.table(STORES.SYNC_CACHE), db.table(STORES.CUSTOMER_LEDGER), async () => {
      return this.applyCloudCustomersInCurrentTransaction(rows, { actorHandle });
    });
    actorHandle?.assertCurrent?.();
    return result;
  },

  async applyCloudCustomersInCurrentTransaction(customers = [], { actorHandle = null } = {}) {
    const rows = Array.isArray(customers) ? customers : [];
    const ids = rows.filter((customer) => customer?.id).map((customer) => String(customer.id));
    if (new Set(ids).size !== ids.length) throw new Error('CLOUD_SYNC_PROTOCOL_DUPLICATE_CUSTOMER');
    actorHandle?.assertCurrent?.();
    const applied = [];
    for (const customer of rows) {
      const result = await applyCloudCustomerInCurrentTransaction(customer, actorHandle);
      if (result) applied.push(result);
    }
    actorHandle?.assertCurrent?.();
    return applied;
  },

  async markConflict(customer, reason = 'VERSION_CONFLICT') {
    if (!customer?.id) return null;
    await ensureOpen();
    const conflictCustomer = markCustomerConflict(customer, reason);
    await db.table(STORES.CUSTOMERS).put(conflictCustomer);
    return conflictCustomer;
  },

  async getAllActiveCustomers() {
    await ensureOpen();
    const rows = await db.table(STORES.CUSTOMERS).toArray();
    return rows.filter(isCustomerVisible);
  }
};

export default customerLocalRepository;
