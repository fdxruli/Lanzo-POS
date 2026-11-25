import Logger from '../Logger';
import { syncConflictService } from '../sync/syncConflictService';
import { syncMetaService } from '../sync/syncMetaService';
import { SYNC_ENTITY_TYPES, SYNC_LIMITS } from '../sync/syncConstants';
import { buildPhoneBuckets, summarizePhoneConflictGroups, toIndexedPhoneKey } from '../db/customerPhoneUtils';
import { customerCloudRepository } from './customerCloudRepository';
import { customerLocalRepository } from './customerLocalRepository';
import { localCustomerToCloudPayload } from './customerMapper';
import { historicalCreditSnapshot } from '../customerCredit/historicalCreditSnapshot';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { durableSnapshotService, buildSnapshotContextId } from '../sync/durableSnapshotService';

const MIGRATED_KEY = 'customers_cloud_migrated';
const MIGRATED_AT_KEY = 'customers_cloud_migrated_at';
const LAST_SNAPSHOT_AT_KEY = 'customers_last_snapshot_at';
const MIGRATION_WARNING_KEY = 'customers_cloud_migration_warning';
const BATCH_SIZE = 10;

const nowIso = () => new Date().toISOString();

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const buildMigrationConflictId = (licenseKey, suffix) => `customers-migration:${licenseKey}:${suffix}`;

const validateLocalCustomersForMigration = (customers = []) => {
  const issues = [];
  const missingIds = customers.filter((customer) => !customer?.id);
  const missingNames = customers.filter((customer) => !String(customer?.name || '').trim());
  const buckets = buildPhoneBuckets(customers);
  const duplicatePhoneGroups = Array.from(buckets.entries())
    .filter(([, records]) => records.length > 1)
    .map(([phoneKey, records]) => ({ phoneKey, records }));

  if (missingIds.length > 0) {
    issues.push({ type: 'MISSING_ID', count: missingIds.length, records: missingIds });
  }

  if (missingNames.length > 0) {
    issues.push({ type: 'MISSING_NAME', count: missingNames.length, records: missingNames });
  }

  if (duplicatePhoneGroups.length > 0) {
    issues.push({
      type: 'DUPLICATE_PHONE',
      count: duplicatePhoneGroups.length,
      preview: summarizePhoneConflictGroups(duplicatePhoneGroups),
      groups: duplicatePhoneGroups.map(({ phoneKey, records }) => ({
        phoneKey,
        ids: records.map((record) => record.id),
        names: records.map((record) => record.name)
      }))
    });
  }

  return issues;
};

const pullFullSnapshot = async (licenseKey, actorHandle = actorRuntimeController.capture('customers')) => {
  const snapshotProtocol = await customerCloudRepository.negotiateSnapshotProtocol?.({ licenseKey, actorHandle })
    || { supported: false, reason: 'snapshot_negotiation_unavailable' };
  actorHandle.assertCurrent();
  if (snapshotProtocol.supported) {
    const contextId = buildSnapshotContextId({
      licenseKey,
      streamKey: 'customers',
      scope: { includeDeleted: true, customerId: null },
      actorHandle
    });
    const snapshot = await durableSnapshotService.runConsistentSnapshot({
      licenseKey,
      streamKey: 'customers',
      contextId,
      actorHandle,
      cursorKey: 'customers_last_change_seq',
      fetchPage: ({ referenceChangeSeq, pageCursor }) => customerCloudRepository.pullCustomerSnapshot({
        licenseKey,
        limit: Math.min(SYNC_LIMITS.MAX_PULL_LIMIT, 500),
        includeDeleted: true,
        snapshotProtocol,
        snapshotReferenceChangeSeq: referenceChangeSeq,
        pageCursor,
        force: true,
        actorHandle
      }),
      applyPage: async (response) => {
        const customers = Array.isArray(response.customers) ? response.customers : [];
        const appliedCustomers = await customerLocalRepository.applyCloudCustomers(customers, { actorHandle });
        actorHandle.assertCurrent();
        if (appliedCustomers.length !== customers.length) {
          throw new Error('CUSTOMER_SNAPSHOT_LOCAL_APPLY_INCOMPLETE');
        }
        // Protected local edits and newer versions are intentionally retained
        // by the repository; valid rows are still covered by that local state.
        return { applied: customers.length, rowCount: customers.length };
      }
    });
    actorHandle.assertCurrent();
    if (!snapshot.success) throw new Error('CUSTOMER_SNAPSHOT_INCOMPLETE');
    if (!await syncMetaService.setMeta(LAST_SNAPSHOT_AT_KEY, nowIso(), { licenseKey })) {
      throw new Error('CUSTOMER_SNAPSHOT_CHECKPOINT_FAILED');
    }
    return {
      ...snapshot,
      snapshotReferenceChangeSeq: snapshot.referenceChangeSeq,
      consistent: true
    };
  }

  let offset = 0;
  let hasMore = true;
  let applied = 0;

  while (hasMore) {
    const response = await customerCloudRepository.pullCustomerSnapshot({
      licenseKey,
      offset,
      limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
      includeDeleted: true,
      actorHandle
    });
    actorHandle.assertCurrent();

    if (response?.success === false) {
      throw new Error(response.message || response.code || 'CUSTOMER_SNAPSHOT_FAILED');
    }

    const customers = Array.isArray(response.customers) ? response.customers : [];
    const appliedCustomers = await customerLocalRepository.applyCloudCustomers(customers, { actorHandle });
    actorHandle.assertCurrent();
    if (appliedCustomers.length !== customers.length) throw new Error('CUSTOMER_SNAPSHOT_LOCAL_APPLY_INCOMPLETE');

    applied += customers.length;
    hasMore = Boolean(response.has_more || response.hasMore);
    const nextOffset = response.cloudSyncEnvelope?.cursor?.next_offset;
    offset = Number.isSafeInteger(nextOffset) ? nextOffset : offset + customers.length;

    if (customers.length === 0 && hasMore) {
      throw new Error('CUSTOMER_SNAPSHOT_EMPTY_PAGE');
    }
  }

  actorHandle.assertCurrent();
  if (!await syncMetaService.setMeta(LAST_SNAPSHOT_AT_KEY, nowIso(), { licenseKey })) {
    throw new Error('CUSTOMER_SNAPSHOT_CHECKPOINT_FAILED');
  }
  actorHandle.assertCurrent();
  return { success: true, applied, consistent: false, legacyFallback: true };
};

export const customerMigrationService = {
  async hasCompleteCloudDirectorySnapshot(licenseKey) {
    if (!licenseKey) return false;
    return Boolean(await syncMetaService.getMeta(MIGRATED_KEY, false, { licenseKey }));
  },

  async runInitialMigrationIfNeeded({ licenseKey, actorHandle = actorRuntimeController.capture('customers') } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (!isOnline()) return { skipped: true, reason: 'offline' };

    actorHandle.assertCurrent();
    await historicalCreditSnapshot.preserveAll({ actorHandle });
    actorHandle.assertCurrent();
    const localCustomers = await customerLocalRepository.getAllActiveCustomers();
    const blockedCustomerIds = [];
    for (const customer of localCustomers) {
      if ((await customerLocalRepository.protectHistoricalCustomer(customer.id)).blocked) {
        blockedCustomerIds.push(customer.id);
      }
    }
    if (blockedCustomerIds.length > 0) {
      if (!await syncMetaService.setMeta(MIGRATED_KEY, false, { licenseKey })) {
        throw new Error('CUSTOMER_MIGRATION_CHECKPOINT_FAILED');
      }
      return {
        success: false, blocked: true, code: 'HISTORICAL_DEBT_PRESERVATION_REQUIRED', blockedCustomerIds
      };
    }

    const alreadyMigrated = await syncMetaService.getMeta(MIGRATED_KEY, false, { licenseKey });
    actorHandle.assertCurrent();
    if (alreadyMigrated) {
      const snapshotProtocol = await customerCloudRepository.negotiateSnapshotProtocol?.({ licenseKey, actorHandle })
        || { supported: false };
      actorHandle.assertCurrent();
      if (snapshotProtocol.supported) {
        const contextId = buildSnapshotContextId({
          licenseKey,
          streamKey: 'customers',
          scope: { includeDeleted: true, customerId: null },
          actorHandle
        });
        const marker = await durableSnapshotService.getState({
          licenseKey, streamKey: 'customers', contextId
        });
        actorHandle.assertCurrent();
        if (marker?.status !== 'complete' || marker.snapshotContractVersion !== 1) {
          const snapshot = await pullFullSnapshot(licenseKey, actorHandle);
          actorHandle.assertCurrent();
          if (snapshot?.success !== true) return { success: false, snapshot, alreadyMigrated: true };
          return { success: true, skipped: false, reconciled: true, ...snapshot };
        }
      }
      return { skipped: true, reason: 'already_migrated' };
    }

    const issues = validateLocalCustomersForMigration(localCustomers);

    if (issues.length > 0) {
      const conflict = await syncConflictService.saveConflict({
        id: buildMigrationConflictId(licenseKey, Date.now()),
        entityType: SYNC_ENTITY_TYPES.CUSTOMER,
        entityId: 'local-migration',
        conflictType: 'CUSTOMER_MIGRATION_BLOCKED',
        localPayload: { issues },
        serverPayload: null,
        metadata: {
          licenseKey,
          message: 'Migracion inicial de clientes detenida por datos locales inconsistentes.'
        }
      });
      actorHandle.assertCurrent();

      await syncMetaService.setMeta(MIGRATION_WARNING_KEY, {
        at: nowIso(),
        issues,
        conflictId: conflict?.id || null
      }, { licenseKey });
      actorHandle.assertCurrent();

      Logger.warn('[Customers/Migration] Migracion bloqueada por conflictos locales:', issues);
      return { success: false, blocked: true, issues };
    }

    if (localCustomers.length === 0) {
      const snapshot = await pullFullSnapshot(licenseKey, actorHandle);
      actorHandle.assertCurrent();
      if (snapshot?.success !== true) return snapshot;
      if (!await syncMetaService.setMeta(MIGRATED_KEY, true, { licenseKey })) {
        throw new Error('CUSTOMER_MIGRATION_CHECKPOINT_FAILED');
      }
      actorHandle.assertCurrent();
      if (!await syncMetaService.setMeta(MIGRATED_AT_KEY, nowIso(), { licenseKey })) {
        throw new Error('CUSTOMER_MIGRATION_CHECKPOINT_FAILED');
      }
      actorHandle.assertCurrent();
      return { ...snapshot, success: true, migrated: 0 };
    }

    const batchId = `customers-${licenseKey}-${Date.now()}`;
    let migrated = 0;

    for (let index = 0; index < localCustomers.length; index += BATCH_SIZE) {
      const slice = localCustomers.slice(index, index + BATCH_SIZE);
      const payload = slice.map((customer) => {
        // Pending Local history is blocked above; the directory batch cannot
        // authorize or import historical credit.
        const mapped = localCustomerToCloudPayload(customer);
        mapped.phone_key = toIndexedPhoneKey(mapped.phone_key || mapped.phone);
        return mapped;
      });

      const response = await customerCloudRepository.migrateLocalCustomers({
        licenseKey,
        customers: payload,
        batchId: `${batchId}-${index / BATCH_SIZE}`,
        actorHandle
      });
      actorHandle.assertCurrent();

      if (response?.success === false) {
        throw new Error(response.message || response.code || 'CUSTOMER_MIGRATION_BATCH_FAILED');
      }

      const results = Array.isArray(response.results) ? response.results : [];
      const failed = results.filter((result) => result?.success === false);

      if (failed.length > 0) {
        await syncConflictService.saveConflict({
          id: buildMigrationConflictId(licenseKey, `batch-${index}`),
          entityType: SYNC_ENTITY_TYPES.CUSTOMER,
          entityId: 'local-migration',
          conflictType: 'CUSTOMER_MIGRATION_RPC_FAILED',
          localPayload: { payload, failed },
          serverPayload: null,
          metadata: { licenseKey, batchId }
        });
        actorHandle.assertCurrent();

        await syncMetaService.setMeta(MIGRATION_WARNING_KEY, {
          at: nowIso(),
          failed,
          batchId
        }, { licenseKey });
        actorHandle.assertCurrent();

        return { success: false, blocked: true, failed };
      }

      const cloudCustomers = results
        .map((result) => result?.customer)
        .filter(Boolean);

      await customerLocalRepository.applyCloudCustomers(cloudCustomers, { actorHandle });
      migrated += cloudCustomers.length;
    }

    const snapshot = await pullFullSnapshot(licenseKey, actorHandle);
    actorHandle.assertCurrent();
    if (snapshot?.success !== true) return snapshot;

    if (!await syncMetaService.setMeta(MIGRATED_KEY, true, { licenseKey })) {
      throw new Error('CUSTOMER_MIGRATION_CHECKPOINT_FAILED');
    }
    actorHandle.assertCurrent();
    if (!await syncMetaService.setMeta(MIGRATED_AT_KEY, nowIso(), { licenseKey })) {
      throw new Error('CUSTOMER_MIGRATION_CHECKPOINT_FAILED');
    }
    actorHandle.assertCurrent();
    if (!await syncMetaService.setMeta(MIGRATION_WARNING_KEY, null, { licenseKey })) {
      throw new Error('CUSTOMER_MIGRATION_CHECKPOINT_FAILED');
    }
    actorHandle.assertCurrent();

    Logger.log(`[Customers/Migration] Migracion inicial completada. Migrados=${migrated}, snapshot=${snapshot.applied || 0}`);
    return { ...snapshot, success: true, migrated, snapshotCount: snapshot.pages || 0 };
  },

  pullFullSnapshot
};

export default customerMigrationService;
