import Logger from '../Logger';
import { syncConflictService } from '../sync/syncConflictService';
import { syncMetaService } from '../sync/syncMetaService';
import { SYNC_ENTITY_TYPES, SYNC_LIMITS } from '../sync/syncConstants';
import { buildPhoneBuckets, summarizePhoneConflictGroups, toIndexedPhoneKey } from '../db/customerPhoneUtils';
import { customerCloudRepository } from './customerCloudRepository';
import { customerLocalRepository } from './customerLocalRepository';
import { localCustomerToCloudPayload } from './customerMapper';

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

const pullFullSnapshot = async (licenseKey) => {
  let offset = 0;
  let hasMore = true;
  let applied = 0;

  while (hasMore) {
    const response = await customerCloudRepository.pullCustomerSnapshot({
      licenseKey,
      offset,
      limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT,
      includeDeleted: true
    });

    if (response?.success === false) {
      throw new Error(response.message || response.code || 'CUSTOMER_SNAPSHOT_FAILED');
    }

    const customers = Array.isArray(response.customers) ? response.customers : [];
    await customerLocalRepository.applyCloudCustomers(customers);

    applied += customers.length;
    hasMore = Boolean(response.has_more || response.hasMore);
    offset += customers.length;

    if (customers.length === 0 && hasMore) {
      throw new Error('CUSTOMER_SNAPSHOT_EMPTY_PAGE');
    }
  }

  await syncMetaService.setMeta(LAST_SNAPSHOT_AT_KEY, nowIso(), { licenseKey });
  return applied;
};

export const customerMigrationService = {
  async runInitialMigrationIfNeeded({ licenseKey } = {}) {
    if (!licenseKey) return { skipped: true, reason: 'missing_license' };
    if (!isOnline()) return { skipped: true, reason: 'offline' };

    const alreadyMigrated = await syncMetaService.getMeta(MIGRATED_KEY, false, { licenseKey });
    if (alreadyMigrated) {
      return { skipped: true, reason: 'already_migrated' };
    }

    const localCustomers = await customerLocalRepository.getAllActiveCustomers();
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

      await syncMetaService.setMeta(MIGRATION_WARNING_KEY, {
        at: nowIso(),
        issues,
        conflictId: conflict?.id || null
      }, { licenseKey });

      Logger.warn('[Customers/Migration] Migracion bloqueada por conflictos locales:', issues);
      return { success: false, blocked: true, issues };
    }

    if (localCustomers.length === 0) {
      await pullFullSnapshot(licenseKey);
      await syncMetaService.setMeta(MIGRATED_KEY, true, { licenseKey });
      await syncMetaService.setMeta(MIGRATED_AT_KEY, nowIso(), { licenseKey });
      return { success: true, migrated: 0 };
    }

    const batchId = `customers-${licenseKey}-${Date.now()}`;
    let migrated = 0;

    for (let index = 0; index < localCustomers.length; index += BATCH_SIZE) {
      const slice = localCustomers.slice(index, index + BATCH_SIZE);
      const payload = slice.map((customer) => {
        const mapped = localCustomerToCloudPayload(customer);
        mapped.phone_key = toIndexedPhoneKey(mapped.phone_key || mapped.phone);
        return mapped;
      });

      const response = await customerCloudRepository.migrateLocalCustomers({
        licenseKey,
        customers: payload,
        batchId: `${batchId}-${index / BATCH_SIZE}`
      });

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

        await syncMetaService.setMeta(MIGRATION_WARNING_KEY, {
          at: nowIso(),
          failed,
          batchId
        }, { licenseKey });

        return { success: false, blocked: true, failed };
      }

      const cloudCustomers = results
        .map((result) => result?.customer)
        .filter(Boolean);

      await customerLocalRepository.applyCloudCustomers(cloudCustomers);
      migrated += cloudCustomers.length;
    }

    const snapshotCount = await pullFullSnapshot(licenseKey);

    await syncMetaService.setMeta(MIGRATED_KEY, true, { licenseKey });
    await syncMetaService.setMeta(MIGRATED_AT_KEY, nowIso(), { licenseKey });
    await syncMetaService.setMeta(MIGRATION_WARNING_KEY, null, { licenseKey });

    Logger.log(`[Customers/Migration] Migracion inicial completada. Migrados=${migrated}, snapshot=${snapshotCount}`);
    return { success: true, migrated, snapshotCount };
  },

  pullFullSnapshot
};

export default customerMigrationService;
