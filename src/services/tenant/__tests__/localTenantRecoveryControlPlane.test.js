import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLegacyRecoveryPlan } from '../localTenantRecoveryPlan';
import {
  RECOVERY_JOURNAL_STATE,
  createOrResumeRecoveryInfrastructure,
  createRecoveryControlDatabase,
  listRecoveryControlMetadata
} from '../localTenantRecoveryControlPlane';

const controlDatabases = [];
const destinationNames = [];
const sourceDatabases = [];

const createControlDatabase = () => {
  const database = createRecoveryControlDatabase(`recovery-control-${crypto.randomUUID()}`);
  controlDatabases.push(database);
  return database;
};

const createEligiblePlan = async ({
  status = 'COMPLETE',
  name = 'legacy-product',
  activeTenantSource = { license_key: 'ACTIVE-A' }
} = {}) => (
  buildLegacyRecoveryPlan({
    snapshot: {
      sourceDatabase: 'LanzoDB1',
      recordsByStore: { menu: [{ id: 'product-a', name }] },
      localStorage: {},
      sessionStorage: {},
      browserStorageInspection: { status }
    },
    activeTenantSource
  })
);

const deleteNativeDatabase = (name) => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = resolve;
  request.onerror = () => reject(request.error);
  request.onblocked = resolve;
});

const inspectDestination = (name) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name);
  request.onsuccess = () => {
    const database = request.result;
    const storeNames = Array.from(database.objectStoreNames);
    database.close();
    resolve(storeNames);
  };
  request.onerror = () => reject(request.error);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(controlDatabases.splice(0).map(async (database) => {
    const name = database.name;
    database.close();
    await Dexie.delete(name);
  }));
  await Promise.all(sourceDatabases.splice(0).map(async (database) => {
    const name = database.name;
    database.close();
    await Dexie.delete(name);
  }));
  await Promise.all(destinationNames.splice(0).map(deleteNativeDatabase));
});

describe('tenant recovery control plane', () => {
  it('uses the same opaque destination for FREE/offline license-key fallback across admin and staff sessions', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan({ activeTenantSource: { license_key: 'FREE-OFFLINE-A' } });
    const first = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: plan,
      activeTenantSource: { license_key: 'FREE-OFFLINE-A', user_role: 'admin' }
    });
    destinationNames.push(first.destinationDatabaseName);
    const second = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: plan,
      activeTenantSource: { license_key: 'FREE-OFFLINE-A', user_role: 'staff' }
    });
    const metadata = await listRecoveryControlMetadata(controlDatabase);

    expect(second.tenantDatabaseId).toBe(first.tenantDatabaseId);
    expect(second.journal.runId).toBe(first.journal.runId);
    expect(first.destinationDatabaseName).toMatch(/^LanzoDB_t_[a-f0-9]{32}$/);
    expect(first.journal.state).toBe(RECOVERY_JOURNAL_STATE.DESTINATION_READY);
    expect(metadata.journals).toHaveLength(1);
    expect(JSON.stringify(metadata)).not.toContain('FREE-OFFLINE-A');
    expect(JSON.stringify(metadata)).not.toContain('license-key-sha256');
    await expect(inspectDestination(first.destinationDatabaseName)).resolves.toEqual([]);
  });

  it('keeps Tenant B isolated and supports compatible alias enrichment only through a shared durable alias', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const tenantA = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: plan,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const enrichedPlan = await buildLegacyRecoveryPlan({
      snapshot: {
        sourceDatabase: 'LanzoDB1',
        recordsByStore: { menu: [{ id: 'product-a', name: 'legacy-product' }] },
        localStorage: {},
        sessionStorage: {},
        browserStorageInspection: { status: 'COMPLETE' }
      },
      activeTenantSource: { license_id: 'LICENSE-A', license_key: 'ACTIVE-A' }
    });
    const enrichedA = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: enrichedPlan,
      activeTenantSource: { license_id: 'LICENSE-A', license_key: 'ACTIVE-A' }
    }).catch((error) => error);
    const tenantBPlan = await createEligiblePlan({ activeTenantSource: { license_key: 'ACTIVE-B' } });
    const tenantB = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: tenantBPlan,
      activeTenantSource: { license_key: 'ACTIVE-B' }
    });
    destinationNames.push(tenantA.destinationDatabaseName, tenantB.destinationDatabaseName);

    // Enrichment intentionally changes the tenant-context fingerprint; it
    // resolves the same namespace but fail-closes the old journal on resume.
    expect(enrichedA).toMatchObject({ code: 'RECOVERY_TENANT_CONTEXT_CHANGED' });
    const metadata = await listRecoveryControlMetadata(controlDatabase);
    const licenseAliasTokenCount = metadata.aliases.filter((entry) => entry.tenantDatabaseId === tenantA.tenantDatabaseId).length;
    expect(licenseAliasTokenCount).toBe(2);
    expect(tenantB.tenantDatabaseId).not.toBe(tenantA.tenantDatabaseId);
  });

  it('fails closed when aliases already map to conflicting destination namespaces', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan({
      activeTenantSource: { license_id: 'LICENSE-A', license_key: 'ACTIVE-A' }
    });
    const tenantA = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: plan,
      activeTenantSource: { license_id: 'LICENSE-A', license_key: 'ACTIVE-A' }
    });
    const tenantBPlan = await createEligiblePlan({ activeTenantSource: { license_key: 'ACTIVE-B' } });
    const tenantB = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: tenantBPlan,
      activeTenantSource: { license_key: 'ACTIVE-B' }
    });
    destinationNames.push(tenantA.destinationDatabaseName, tenantB.destinationDatabaseName);

    const conflictingPlan = await createEligiblePlan({
      activeTenantSource: { license_id: 'LICENSE-A', license_key: 'ACTIVE-B' }
    });
    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: conflictingPlan,
      activeTenantSource: { license_id: 'LICENSE-A', license_key: 'ACTIVE-B' }
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_ALIAS_CONFLICT' });
  });

  it('fails closed when a resumable journal sees a changed source or tenant context fingerprint', async () => {
    const controlDatabase = createControlDatabase();
    const original = await createEligiblePlan({ name: 'source-one' });
    const first = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: original,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(first.destinationDatabaseName);
    const changedSource = await createEligiblePlan({ name: 'source-two' });
    const changedContext = await buildLegacyRecoveryPlan({
      snapshot: {
        sourceDatabase: 'LanzoDB1',
        recordsByStore: { menu: [{ id: 'product-a', name: 'source-one' }] },
        localStorage: {},
        sessionStorage: {},
        browserStorageInspection: { status: 'COMPLETE' }
      },
      activeTenantSource: { license_id: 'LICENSE-A', license_key: 'ACTIVE-A' }
    });

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: changedSource,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_SNAPSHOT_CHANGED' });
    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: changedContext,
      activeTenantSource: { license_id: 'LICENSE-A', license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'RECOVERY_TENANT_CONTEXT_CHANGED' });
  });

  it('requires a complete executable RecoveryPlan and preserves separate bound/unknown gates', async () => {
    const controlDatabase = createControlDatabase();
    const complete = await createEligiblePlan();
    const notApplicable = await createEligiblePlan({ status: 'NOT_APPLICABLE' });
    const bound = { ...complete, preconditionFailure: 'RECOVERY_SOURCE_ALREADY_BOUND', executableForFutureCopy: false };
    const unknown = { ...complete, unknownStores: ['unknown'], executableForFutureCopy: false };

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: notApplicable, activeTenantSource: { license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'RECOVERY_STORAGE_INSPECTION_NOT_COMPLETE' });
    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: bound, activeTenantSource: { license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_ALREADY_BOUND' });
    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: unknown, activeTenantSource: { license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'UNKNOWN_STORE_PRESENT' });
  });

  it('uses a durable control-db uniqueness invariant for concurrent same-tenant reservation', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const [left, right] = await Promise.all([
      createOrResumeRecoveryInfrastructure({ controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' } }),
      createOrResumeRecoveryInfrastructure({ controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' } })
    ]);
    destinationNames.push(left.destinationDatabaseName);
    const metadata = await listRecoveryControlMetadata(controlDatabase);

    expect(left.tenantDatabaseId).toBe(right.tenantDatabaseId);
    expect(metadata.directory).toHaveLength(1);
    expect(metadata.journals).toHaveLength(1);
  });

  it('resumes a durable CREATED journal after a simulated process stop without creating another destination', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const first = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(first.destinationDatabaseName);
    await controlDatabase.table('recovery_run_journal').update(first.journal.runId, {
      state: RECOVERY_JOURNAL_STATE.CREATED,
      updatedAt: new Date().toISOString()
    });

    const resumed = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const metadata = await listRecoveryControlMetadata(controlDatabase);

    expect(resumed.resumed).toBe(true);
    expect(resumed.tenantDatabaseId).toBe(first.tenantDatabaseId);
    expect(resumed.journal.runId).toBe(first.journal.runId);
    expect(resumed.journal.state).toBe(RECOVERY_JOURNAL_STATE.DESTINATION_READY);
    expect(metadata.directory).toHaveLength(1);
    expect(metadata.journals).toHaveLength(1);
  });

  it('marks partial namespace creation FAILED_RESUMABLE and resumes the same run without touching the vault', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const source = new Dexie(`recovery-vault-${crypto.randomUUID()}`);
    source.version(1).stores({ menu: 'id' });
    await source.open();
    await source.table('menu').put({ id: 'legacy-row' });
    sourceDatabases.push(source);
    const sourceWrites = ['put', 'update', 'delete', 'clear'].map((method) => vi.spyOn(source.table('menu'), method));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: plan,
      activeTenantSource: { license_key: 'ACTIVE-A' },
      destinationNamespaceFactory: async () => { throw Object.assign(new Error('failed'), { code: 'NAMESPACE_FAILED' }); }
    })).rejects.toMatchObject({ code: 'NAMESPACE_FAILED' });
    const failed = (await listRecoveryControlMetadata(controlDatabase)).journals[0];
    expect(failed.state).toBe(RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE);

    const resumed = await createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: plan,
      activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(resumed.destinationDatabaseName);
    expect(resumed.journal.runId).toBe(failed.runId);
    expect(resumed.journal.state).toBe(RECOVERY_JOURNAL_STATE.DESTINATION_READY);
    expect(sourceWrites.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    await expect(source.table('menu').count()).resolves.toBe(1);
  });
});
