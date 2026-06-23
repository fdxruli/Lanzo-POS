import { db, STORES } from '../db/dexie';
import {
  loadCustomersByDebtPaginated,
  loadData,
  recycleData,
  saveDataSafe
} from '../database';
import { normalizeCustomerDebtCents } from '../db/customerDebtIndex';
import { toIndexedPhoneKey } from '../db/customerPhoneUtils';
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

  async applyCloudCustomer(cloudCustomer) {
    if (!cloudCustomer?.id) return null;

    await ensureOpen();
    const existing = await db.table(STORES.CUSTOMERS).get(cloudCustomer.id);
    const localCustomer = cloudCustomerToLocal(cloudCustomer, existing);

    if (localCustomer.deletedAt || localCustomer.deletedTimestamp) {
      localCustomer.isActive = false;
      localCustomer.phoneKey = null;
      delete localCustomer.phoneKey;
    }

    await db.table(STORES.CUSTOMERS).put(localCustomer);
    return localCustomer;
  },

  async applyCloudCustomers(customers = []) {
    const applied = [];
    for (const customer of customers) {
      const result = await this.applyCloudCustomer(customer);
      if (result) applied.push(result);
    }
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
