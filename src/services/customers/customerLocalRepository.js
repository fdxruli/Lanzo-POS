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
  normalizeCustomerForLocal
} from './customerMapper';
import {
  buildCustomerRetryLimitConflicts,
  reconcileCustomerDirectoryEdit
} from './customerDirectoryReconciliation';

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
    const debt = customerData.debt ?? existingCustomer?.debt ?? 0;
    const debtCents = customerData.debtCents
      ?? customerData.debt_cents
      ?? existingCustomer?.debtCents
      ?? existingCustomer?.debt_cents
      ?? normalizeCustomerDebtCents(debt);
    const payload = normalizeCustomerForLocal(
      {
        ...customerData,
        createdAt: existingCustomer?.createdAt || customerData.createdAt || now,
        updatedAt: now,
        debt,
        debtCents,
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

  async applyCloudCustomer(cloudCustomer, { source = 'snapshot', operationId = null } = {}) {
    if (!cloudCustomer?.id) return null;

    await ensureOpen();
    const existing = await db.table(STORES.CUSTOMERS).get(cloudCustomer.id);
    const incoming = cloudCustomerToLocal(cloudCustomer, existing);
    if (source === 'mutation_ack' && existing) {
      // A directory mutation cannot authoritatively alter a local financial
      // projection. A later Cloud snapshot/ledger event will refresh it.
      incoming.debt = existing.debt ?? incoming.debt;
      incoming.debtCents = existing.debtCents
        ?? existing.debt_cents
        ?? normalizeCustomerDebtCents(existing.debt ?? incoming.debt);
    }
    const incomingVersion = Number(incoming.serverVersion) || 0;
    const existingVersion = Number(existing?.serverVersion) || 0;
    const acknowledgedPendingOperation = source === 'mutation_ack' && (
      (existing?.pendingOperationId && operationId === existing.pendingOperationId)
      || (existing?.syncStatus === CUSTOMER_SYNC_STATUS.CONFLICT && operationId === 'customer_repository_direct_ack')
    );

    if (existing && incomingVersion < existingVersion) return existing;

    if (existing
      && !acknowledgedPendingOperation
      && [CUSTOMER_SYNC_STATUS.PENDING, CUSTOMER_SYNC_STATUS.CONFLICT].includes(existing.syncStatus)) {
      if (incoming.deletedAt || incoming.deletedTimestamp) {
        const deletedConflict = normalizeCustomerForLocal({
          ...existing,
          isActive: false,
          deletedAt: incoming.deletedAt || incoming.deletedTimestamp,
          deletedTimestamp: incoming.deletedAt || incoming.deletedTimestamp,
          conflictCloudSnapshot: incoming,
          latestCloudSnapshot: incoming,
          conflictReason: 'CUSTOMER_DELETED'
        }, existing, {
          syncStatus: CUSTOMER_SYNC_STATUS.CONFLICT,
          pendingOperationId: existing.pendingOperationId || null,
          conflictReason: 'CUSTOMER_DELETED'
        });
        await db.table(STORES.CUSTOMERS).put(deletedConflict);
        return deletedConflict;
      }

      const refreshedConflicts = existing.syncStatus === CUSTOMER_SYNC_STATUS.CONFLICT
        && existing.conflictBaseSnapshot
        ? reconcileCustomerDirectoryEdit({
          baseline: existing.conflictBaseSnapshot,
          local: existing,
          cloud: incoming
        }).conflicts
        : existing.conflictFields;
      const conflicts = existing.syncStatus === CUSTOMER_SYNC_STATUS.CONFLICT
        && existing.conflictBaseSnapshot
        && refreshedConflicts.length === 0
        ? buildCustomerRetryLimitConflicts({
          baseline: existing.conflictBaseSnapshot,
          local: existing,
          cloud: incoming
        })
        : refreshedConflicts;

      const preserved = normalizeCustomerForLocal({
        ...existing,
        latestCloudSnapshot: incoming,
        conflictCloudSnapshot: existing.syncStatus === CUSTOMER_SYNC_STATUS.CONFLICT
          ? incoming
          : existing.conflictCloudSnapshot,
        conflictFields: conflicts,
        // Preserve the local operation's original OCC base. The new Cloud row
        // is kept separately until the queued operation is reconciled.
        serverVersion: existing.serverVersion,
        debt: existing.debt ?? incoming.debt,
        debtCents: existing.debtCents ?? incoming.debtCents
      }, existing, {
        syncStatus: existing.syncStatus,
        pendingOperationId: existing.pendingOperationId || null,
        conflictReason: existing.conflictReason || null
      });
      await db.table(STORES.CUSTOMERS).put(preserved);
      return preserved;
    }

    const localCustomer = incoming;

    if (localCustomer.deletedAt || localCustomer.deletedTimestamp) {
      localCustomer.isActive = false;
      localCustomer.phoneKey = null;
      delete localCustomer.phoneKey;
    }

    delete localCustomer.latestCloudSnapshot;
    delete localCustomer.conflictCloudSnapshot;
    delete localCustomer.conflictBaseSnapshot;
    delete localCustomer.conflictFields;

    await db.table(STORES.CUSTOMERS).put(localCustomer);
    return localCustomer;
  },

  async applyCloudCustomers(customers = [], options = {}) {
    const applied = [];
    for (const customer of customers) {
      const result = await this.applyCloudCustomer(customer, options);
      if (result) applied.push(result);
    }
    return applied;
  },

  async markConflict(customer, reason = 'VERSION_CONFLICT', {
    serverCustomer = null,
    baselineCustomer = null,
    conflicts = [],
    preservePendingOperation = false
  } = {}) {
    if (!customer?.id) return null;
    await ensureOpen();
    const existing = await db.table(STORES.CUSTOMERS).get(customer.id);
    const cloud = serverCustomer
      ? cloudCustomerToLocal(serverCustomer, existing)
      : null;
    const proposal = normalizeCustomerForLocal(customer, existing);
    const conflictCustomer = normalizeCustomerForLocal({
      ...(cloud || existing || {}),
      ...proposal,
      debt: proposal.debt,
      debtCents: proposal.debtCents ?? proposal.debt_cents,
      serverVersion: cloud?.serverVersion ?? proposal.serverVersion,
      conflictCloudSnapshot: cloud || existing?.conflictCloudSnapshot || null,
      conflictBaseSnapshot: baselineCustomer || existing?.conflictBaseSnapshot || null,
      conflictFields: conflicts,
      isActive: cloud?.deletedAt ? false : proposal.isActive
    }, existing, {
      syncStatus: CUSTOMER_SYNC_STATUS.CONFLICT,
      pendingOperationId: preservePendingOperation ? existing?.pendingOperationId || null : null,
      conflictReason: reason
    });
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
