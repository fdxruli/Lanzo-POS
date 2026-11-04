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
import { syncConflictService } from '../sync/syncConflictService';
import { POS_SYNC_STORES, SYNC_ENTITY_TYPES } from '../sync/syncConstants';
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
const HISTORY_BLOCKED = 'HISTORICAL_DEBT_PRESERVATION_REQUIRED';
const historyTables = () => [STORES.CUSTOMERS, STORES.SYNC_CACHE, STORES.CUSTOMER_LEDGER, POS_SYNC_STORES.CONFLICTS]
  .map((name) => db.table(name));

const protectHistoryInTransaction = async (existing, cloudCustomer = null) => {
  const snapshot = await historicalCreditSnapshot.preserveInTransaction(existing);
  if (!snapshot || ['IMPORTED', 'ALREADY_IMPORTED_IDENTICAL', 'CLOUD_PROJECTION'].includes(snapshot.status)) {
    return { blocked: false, customer: existing, snapshot };
  }
  const id = `historical-credit-conflict:${existing.id}`;
  const conflicts = db.table(POS_SYNC_STORES.CONFLICTS);
  if (!await conflicts.get(id)) {
    await syncConflictService.saveConflict({
      id, entityType: SYNC_ENTITY_TYPES.CUSTOMER, entityId: existing.id,
      conflictType: HISTORY_BLOCKED, localPayload: snapshot, serverPayload: cloudCustomer,
      metadata: { source: 'local_history_guard', snapshotKey: `historical-credit:v1:customer:${existing.id}` }
    });
  } else if (cloudCustomer) {
    await conflicts.update(id, { serverPayload: cloudCustomer });
  }
  const customer = {
    ...existing, syncStatus: CUSTOMER_SYNC_STATUS.CONFLICT, conflictReason: HISTORY_BLOCKED,
    creditMigrationStatus: snapshot.status,
    ...(cloudCustomer ? { latestCloudSnapshot: cloudCustomer } : {})
  };
  await db.table(STORES.CUSTOMERS).put(customer);
  return { blocked: true, customer, snapshot };
};

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
  async protectHistoricalCustomer(customerId) {
    await ensureOpen();
    return db.transaction('rw', historyTables(), async () => (
      protectHistoryInTransaction(await db.table(STORES.CUSTOMERS).get(customerId))
    ));
  },
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
    await ensureOpen();
    return db.transaction('rw', historyTables(), async () => {
      existingCustomer = await db.table(STORES.CUSTOMERS).get(customerData.id) || existingCustomer;
      if (syncStatus !== CUSTOMER_SYNC_STATUS.LOCAL) {
        const history = await protectHistoryInTransaction(existingCustomer);
        if (history.blocked) return {
          success: false, code: HISTORY_BLOCKED, data: history.customer,
          message: 'La historia financiera Local está preservada y pendiente de revisión. No se importó ni sustituyó su saldo.'
        };
      }
      const now = nowIso();
      const debt = existingCustomer?.debt ?? customerData.debt ?? 0;
      const debtCents = existingCustomer?.debtCents
        ?? existingCustomer?.debt_cents
        ?? customerData.debtCents
        ?? customerData.debt_cents
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
    });
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

  async applyCloudCustomer(cloudCustomer, options = {}) {
    if (!cloudCustomer?.id) return null;
    await ensureOpen();
    const { actorHandle = null } = options;
    actorHandle?.assertCurrent?.();
    const result = await db.transaction('rw', historyTables(), async () => {
      const applied = await this.applyCloudCustomerInCurrentTransaction(cloudCustomer, options);
      actorHandle?.assertCurrent?.();
      return applied;
    });
    actorHandle?.assertCurrent?.();
    return result;
  },

  async applyCloudCustomerInCurrentTransaction(cloudCustomer, { source = 'snapshot', operationId = null, actorHandle = null } = {}) {
    if (!cloudCustomer?.id) return null;
    actorHandle?.assertCurrent?.();
    const existing = await db.table(STORES.CUSTOMERS).get(cloudCustomer.id);
    actorHandle?.assertCurrent?.();
    if (cloudCustomer.financial_projection?.scope === 'OPERATION_RESULT') {
      // Receipt snapshots describe past effects. Only credit pulls may refresh
      // current debt; an absent local customer must not become a zero balance.
      const history = await protectHistoryInTransaction(existing);
      actorHandle?.assertCurrent?.();
      return history.customer || null;
    }
    const incoming = cloudCustomerToLocal(cloudCustomer, existing);
    const history = await protectHistoryInTransaction(existing, incoming);
    if (history.blocked) return history.customer;
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
    const latestObservedVersion = Math.max(
      existingVersion,
      Number(existing?.latestCloudSnapshot?.serverVersion) || 0,
      Number(existing?.conflictCloudSnapshot?.serverVersion) || 0
    );
    // Credit responses own the debt projection; directory drafts and acks do not.
    const projectionUnknown = ['HISTORICAL_PENDING', 'CONFLICT', 'NOT_INCLUDED'].includes(incoming.financialProjectionStatus);
    const creditProjection = source === 'credit_projection' && !projectionUnknown
      ? {
        debt: incoming.debt, debtCents: incoming.debtCents,
        financialSource: 'cloud', lastCloudDebtCents: normalizeCustomerDebtCents(incoming.debt)
      }
      : {};
    const acknowledgedPendingOperation = source === 'mutation_ack' && (
      (existing?.pendingOperationId && operationId === existing.pendingOperationId)
      || (existing?.syncStatus === CUSTOMER_SYNC_STATUS.CONFLICT && operationId === 'customer_repository_direct_ack')
    );
    const confirmedHistoricalProjection = source === 'credit_projection'
      && existing?.conflictReason === HISTORY_BLOCKED
      && !existing.pendingOperationId && !existing.conflictBaseSnapshot && !existing.conflictFields?.length
      && ['IMPORTED', 'ALREADY_IMPORTED_IDENTICAL'].includes(history.snapshot?.status)
      && history.snapshot.result?.ledger_id;

    if (existing && incomingVersion < existingVersion) return existing;
    if (existing && source !== 'mutation_ack' && incomingVersion < latestObservedVersion) return existing;

    if (existing
      && !acknowledgedPendingOperation
      && !confirmedHistoricalProjection
      && [CUSTOMER_SYNC_STATUS.PENDING, CUSTOMER_SYNC_STATUS.CONFLICT].includes(existing.syncStatus)) {
      if (incoming.deletedAt || incoming.deletedTimestamp) {
        const deletedConflict = normalizeCustomerForLocal({
          ...existing,
          ...creditProjection,
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
        debtCents: existing.debtCents ?? incoming.debtCents,
        ...creditProjection
      }, existing, {
        syncStatus: existing.syncStatus,
        pendingOperationId: existing.pendingOperationId || null,
        conflictReason: existing.conflictReason || null
      });
      await db.table(STORES.CUSTOMERS).put(preserved);
      return preserved;
    }

    const localCustomer = incoming;
    if (confirmedHistoricalProjection) {
      localCustomer.creditMigrationStatus = history.snapshot.status;
      localCustomer.conflictReason = null;
      await syncConflictService.markResolved(`historical-credit-conflict:${existing.id}`, history.snapshot.result);
    }
    if (projectionUnknown) {
      localCustomer.financialSource = existing?.financialSource || 'unknown';
      if (existing?.lastCloudDebtCents !== undefined) localCustomer.lastCloudDebtCents = existing.lastCloudDebtCents;
      else delete localCustomer.lastCloudDebtCents;
    } else {
      localCustomer.financialSource = 'cloud';
      localCustomer.lastCloudDebtCents = normalizeCustomerDebtCents(localCustomer.debt);
    }

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
    await ensureOpen();
    const { actorHandle = null } = options;
    actorHandle?.assertCurrent?.();
    const result = await db.transaction('rw', historyTables(), () => this.applyCloudCustomersInCurrentTransaction(customers, options));
    actorHandle?.assertCurrent?.();
    return result;
  },

  async applyCloudCustomersInCurrentTransaction(customers = [], options = {}) {
    const { actorHandle = null } = options;
    const rows = Array.isArray(customers) ? customers : [];
    const ids = rows.filter(row => row?.id).map(row => String(row.id));
    if (new Set(ids).size !== ids.length) throw new Error('CLOUD_SYNC_PROTOCOL_DUPLICATE_CUSTOMER');
    const applied = [];
    for (const customer of rows) {
      actorHandle?.assertCurrent?.();
      const result = await this.applyCloudCustomerInCurrentTransaction(customer, options);
      if (result) applied.push(result);
    }
    actorHandle?.assertCurrent?.();
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
    return db.transaction('rw', historyTables(), async () => {
      const existing = await db.table(STORES.CUSTOMERS).get(customer.id);
      const history = await protectHistoryInTransaction(existing, serverCustomer);
      if (history.blocked) return history.customer;
      const cloud = serverCustomer
        ? cloudCustomerToLocal(serverCustomer, existing)
        : null;
      const proposal = normalizeCustomerForLocal(customer, existing);
      const conflictCustomer = normalizeCustomerForLocal({
        ...(cloud || existing || {}),
        ...proposal,
        debt: existing?.debt ?? proposal.debt,
        debtCents: existing?.debtCents ?? existing?.debt_cents ?? proposal.debtCents ?? proposal.debt_cents,
        financialSource: existing?.financialSource ?? proposal.financialSource,
        lastCloudDebtCents: existing?.lastCloudDebtCents ?? proposal.lastCloudDebtCents,
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
    });
  },

  async getAllActiveCustomers() {
    await ensureOpen();
    const rows = await db.table(STORES.CUSTOMERS).toArray();
    return rows.filter(isCustomerVisible);
  }
};

export default customerLocalRepository;
