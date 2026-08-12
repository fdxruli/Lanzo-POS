import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLegacyRecoveryPlan,
  createReadOnlyLegacyInspectionAdapter,
  inspectLegacyVaultAndBuildRecoveryPlan
} from '../localTenantRecoveryPlan';
import { createCanonicalLanzoDatabase } from '../../db/dexie';
import {
  CURRENT_NATIVE_DATABASE_VERSION,
  LOCAL_TENANT_BINDING_DEXIE_VERSION
} from '../../db/databaseSchema';
import {
  RECOVERY_DESTINATION_NAMESPACE_VERSION,
  RECOVERY_JOURNAL_STATE,
  createOrResumeRecoveryCopyManifest,
  createOrResumeRecoveryDestinationSchema,
  createOrResumeRecoveryInfrastructure,
  createRecoveryControlDatabase,
  describeCanonicalRecoveryDestinationSchema,
  listRecoveryControlMetadata
} from '../localTenantRecoveryControlPlane';

const controlDatabases = [];
const destinationNames = [];
const sourceDatabases = [];

const createControlDatabase = (name = `recovery-control-${crypto.randomUUID()}`) => {
  const database = createRecoveryControlDatabase(name);
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

const browserStorage = () => ({
  length: 0,
  key: () => null,
  getItem: () => null
});

const createLegacySource = async (recordsByStore = { menu: [{ id: 'product-a', name: 'Farmacia product' }] }) => {
  const name = `recovery-source-${crypto.randomUUID()}`;
  const source = new Dexie(name);
  source.version(1).stores(Object.fromEntries(Object.keys(recordsByStore).map((storeName) => [
    storeName,
    storeName === 'sync_meta' ? 'key' : 'id'
  ])));
  await source.open();
  for (const [storeName, records] of Object.entries(recordsByStore)) {
    if (records.length > 0) await source.table(storeName).bulkPut(records);
  }
  sourceDatabases.push(source);
  return source;
};

const createSourceAdapter = (database) => createReadOnlyLegacyInspectionAdapter({
  database,
  sourceDatabase: database.name,
  browserStorage: { localStorage: browserStorage(), sessionStorage: browserStorage() }
});

const prepareSchemaReady = async ({ controlDatabase, recoveryPlan, activeTenantSource }) => {
  const reserved = await createOrResumeRecoveryInfrastructure({
    controlDatabase, recoveryPlan, activeTenantSource
  });
  destinationNames.push(reserved.destinationDatabaseName);
  const schema = await createOrResumeRecoveryDestinationSchema({
    controlDatabase, recoveryPlan, activeTenantSource
  });
  return { reserved, schema };
};

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

const inspectDestinationRows = (name) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name);
  request.onsuccess = async () => {
    const database = request.result;
    try {
      const counts = {};
      for (const storeName of Array.from(database.objectStoreNames)) {
        counts[storeName] = await new Promise((countResolve, countReject) => {
          const count = database.transaction(storeName, 'readonly').objectStore(storeName).count();
          count.onsuccess = () => countResolve(count.result);
          count.onerror = () => countReject(count.error);
        });
      }
      resolve({ version: database.version, counts });
    } catch (error) {
      reject(error);
    } finally {
      database.close();
    }
  };
  request.onerror = () => reject(request.error);
});

const createNonemptyDestination = (name) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => request.result.createObjectStore('unexpected_store');
  request.onsuccess = () => {
    request.result.close();
    resolve();
  };
  request.onerror = () => reject(request.error);
});

const openDestinationAtVersion = (name, version, onUpgrade) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, version);
  request.onupgradeneeded = () => onUpgrade?.(request.result);
  request.onsuccess = () => {
    request.result.close();
    resolve();
  };
  request.onerror = () => reject(request.error);
});

const deterministicCrypto = (...ids) => ({
  subtle: crypto.subtle,
  randomUUID: () => ids.shift() || crypto.randomUUID()
});

afterEach(async () => {
  vi.restoreAllMocks();
  const controlDatabaseNames = new Set(controlDatabases.map((database) => database.name));
  controlDatabases.splice(0).forEach((database) => database.close());
  await Promise.all([...controlDatabaseNames].map((name) => Dexie.delete(name)));
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
    expect(metadata.aliases[0].aliasType).toBe('license_key_sha256');
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

  it('rejects incompatible license-id or license-key enrichment without mutating the directory', async () => {
    const controlDatabase = createControlDatabase();
    const tenantAIdentity = { license_id: 'LICENSE-A', license_key: 'ACTIVE-A' };
    const tenantAPlan = await createEligiblePlan({ activeTenantSource: tenantAIdentity });
    const tenantA = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: tenantAPlan, activeTenantSource: tenantAIdentity
    });
    destinationNames.push(tenantA.destinationDatabaseName);
    const before = await listRecoveryControlMetadata(controlDatabase);
    const differentIdSameKey = { license_id: 'LICENSE-B', license_key: 'ACTIVE-A' };
    const sameIdDifferentKey = { license_id: 'LICENSE-A', license_key: 'ACTIVE-B' };
    const differentIdPlan = await createEligiblePlan({ activeTenantSource: differentIdSameKey });
    const differentKeyPlan = await createEligiblePlan({ activeTenantSource: sameIdDifferentKey });

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: differentIdPlan, activeTenantSource: differentIdSameKey
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_ALIAS_INCOMPATIBLE' });
    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: differentKeyPlan, activeTenantSource: sameIdDifferentKey
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_ALIAS_INCOMPATIBLE' });

    expect(await listRecoveryControlMetadata(controlDatabase)).toEqual(before);
  });

  it('fails closed and preserves a destination namespace that is not empty', async () => {
    const controlDatabase = createControlDatabase();
    const tenantDatabaseId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const name = `LanzoDB_t_${tenantDatabaseId}`;
    await createNonemptyDestination(name);
    destinationNames.push(name);
    const plan = await createEligiblePlan();

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: plan,
      activeTenantSource: { license_key: 'ACTIVE-A' },
      cryptoProvider: deterministicCrypto(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      )
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_NAMESPACE_NOT_EMPTY' });

    const journal = (await listRecoveryControlMetadata(controlDatabase)).journals[0];
    expect(journal.state).toBe(RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE);
    expect(journal.failureReason).toBe('RECOVERY_DESTINATION_NAMESPACE_NOT_EMPTY');
    await expect(inspectDestination(name)).resolves.toEqual(['unexpected_store']);
  });

  it('revalidates a READY namespace and fails closed when it becomes nonempty', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const ready = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(ready.destinationDatabaseName);
    await openDestinationAtVersion(
      ready.destinationDatabaseName,
      RECOVERY_DESTINATION_NAMESPACE_VERSION + 1,
      (database) => database.createObjectStore('unexpected_store')
    );

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_NAMESPACE_VERSION_MISMATCH' });

    const journal = (await listRecoveryControlMetadata(controlDatabase)).journals[0];
    expect(journal.state).toBe(RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE);
    expect(journal.failureReason).toBe('RECOVERY_DESTINATION_NAMESPACE_VERSION_MISMATCH');
    await expect(inspectDestination(ready.destinationDatabaseName)).resolves.toEqual(['unexpected_store']);
  });

  it('rejects an empty destination namespace with the wrong native version', async () => {
    const controlDatabase = createControlDatabase();
    const tenantDatabaseId = 'cccccccccccccccccccccccccccccccc';
    const name = `LanzoDB_t_${tenantDatabaseId}`;
    await openDestinationAtVersion(name, RECOVERY_DESTINATION_NAMESPACE_VERSION + 1);
    destinationNames.push(name);
    const plan = await createEligiblePlan();

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase,
      recoveryPlan: plan,
      activeTenantSource: { license_key: 'ACTIVE-A' },
      cryptoProvider: deterministicCrypto(
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'dddddddd-dddd-dddd-dddd-dddddddddddd'
      )
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_NAMESPACE_VERSION_MISMATCH' });

    const journal = (await listRecoveryControlMetadata(controlDatabase)).journals[0];
    expect(journal.state).toBe(RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE);
    expect(journal.failureReason).toBe('RECOVERY_DESTINATION_NAMESPACE_VERSION_MISMATCH');
    await expect(inspectDestination(name)).resolves.toEqual([]);
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

  it('uses a durable cross-connection uniqueness invariant for concurrent same-tenant reservation', async () => {
    const sharedName = `recovery-control-${crypto.randomUUID()}`;
    const controlA = createControlDatabase(sharedName);
    const controlB = createControlDatabase(sharedName);
    const plan = await createEligiblePlan();
    const [left, right] = await Promise.all([
      createOrResumeRecoveryInfrastructure({ controlDatabase: controlA, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' } }),
      createOrResumeRecoveryInfrastructure({ controlDatabase: controlB, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' } })
    ]);
    destinationNames.push(left.destinationDatabaseName);
    const verificationConnection = createControlDatabase(sharedName);
    const metadata = await listRecoveryControlMetadata(verificationConnection);

    expect(left.tenantDatabaseId).toBe(right.tenantDatabaseId);
    expect(metadata.directory).toHaveLength(1);
    expect(metadata.journals).toHaveLength(1);
    expect(metadata.aliases).toHaveLength(1);
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

  it('revalidates a valid READY namespace without creating duplicate metadata', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const first = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(first.destinationDatabaseName);
    const resumed = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const metadata = await listRecoveryControlMetadata(controlDatabase);

    expect(resumed.tenantDatabaseId).toBe(first.tenantDatabaseId);
    expect(resumed.destinationDatabaseName).toBe(first.destinationDatabaseName);
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

  it('installs the canonical schema from a v1 reservation with every destination store empty', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const reserved = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(reserved.destinationDatabaseName);

    const installed = await createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const expected = describeCanonicalRecoveryDestinationSchema();
    const destination = await inspectDestinationRows(reserved.destinationDatabaseName);

    expect(installed.journal.state).toBe(RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY);
    expect(installed.journal.destinationDexieVersion).toBe(LOCAL_TENANT_BINDING_DEXIE_VERSION);
    expect(installed.journal.destinationNativeVersion).toBe(CURRENT_NATIVE_DATABASE_VERSION);
    expect(destination.version).toBe(CURRENT_NATIVE_DATABASE_VERSION);
    expect(Object.keys(destination.counts).sort()).toEqual(expected.stores.map((store) => store.name));
    expect(Object.values(destination.counts).every((count) => count === 0)).toBe(true);
    expect(destination.counts.local_tenant_binding).toBe(0);
    expect(destination.counts.sync_outbox).toBe(0);
    expect(destination.counts.sync_meta).toBe(0);
  });

  it('revalidates an installed canonical destination idempotently without duplicate metadata', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const reserved = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(reserved.destinationDatabaseName);
    const first = await createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const resumed = await createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    const metadata = await listRecoveryControlMetadata(controlDatabase);

    expect(resumed.tenantDatabaseId).toBe(first.tenantDatabaseId);
    expect(resumed.journal.runId).toBe(first.journal.runId);
    expect(resumed.journal.destinationSchemaFingerprint).toBe(first.journal.destinationSchemaFingerprint);
    expect(metadata.directory).toHaveLength(1);
    expect(metadata.journals).toHaveLength(1);
  });

  it('recovers a crash after the canonical physical commit using the same journal', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const reserved = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(reserved.destinationDatabaseName);
    const installed = await createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    await controlDatabase.table('recovery_run_journal').update(installed.journal.runId, {
      state: RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_INSTALLING,
      destinationSchemaFingerprint: null,
      updatedAt: new Date().toISOString()
    });

    const resumed = await createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    expect(resumed.journal.runId).toBe(installed.journal.runId);
    expect(resumed.journal.state).toBe(RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY);
  });

  it('safely retries schema installation from a crash before the physical commit', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const reserved = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(reserved.destinationDatabaseName);
    await controlDatabase.table('recovery_run_journal').update(reserved.journal.runId, {
      state: RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_INSTALLING,
      updatedAt: new Date().toISOString()
    });

    const retried = await createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    expect(retried.journal.runId).toBe(reserved.journal.runId);
    expect(retried.journal.state).toBe(RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY);
    await expect(inspectDestinationRows(reserved.destinationDatabaseName)).resolves.toMatchObject({
      version: CURRENT_NATIVE_DATABASE_VERSION
    });
  });

  it('fails closed when a schema-ready destination is structurally tampered and preserves it', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const reserved = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(reserved.destinationDatabaseName);
    await createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    await openDestinationAtVersion(reserved.destinationDatabaseName, CURRENT_NATIVE_DATABASE_VERSION + 1,
      (database) => database.createObjectStore('unexpected_store'));

    await expect(createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_SCHEMA_MISMATCH' });
    const journal = (await listRecoveryControlMetadata(controlDatabase)).journals[0];
    expect(journal.state).toBe(RECOVERY_JOURNAL_STATE.FAILED_RESUMABLE);
    await expect(inspectDestination(reserved.destinationDatabaseName)).resolves.toContain('unexpected_store');
  });

  it('prevents the RECOVERY.2A entry point from regressing a schema-ready journal', async () => {
    const controlDatabase = createControlDatabase();
    const plan = await createEligiblePlan();
    const reserved = await createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });
    destinationNames.push(reserved.destinationDatabaseName);
    const installed = await createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    });

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource: { license_key: 'ACTIVE-A' }
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_PHASE_ADVANCED' });
    const journal = (await listRecoveryControlMetadata(controlDatabase)).journals[0];
    expect(journal.state).toBe(RECOVERY_JOURNAL_STATE.DESTINATION_SCHEMA_READY);
    expect(journal.runId).toBe(installed.journal.runId);
  });

  it('builds a valid zero-copy manifest for mixed legacy evidence without writing source or destination data', async () => {
    const controlDatabase = createControlDatabase();
    const activeTenantSource = { license_key: 'ACTIVE-A' };
    const source = await createLegacySource({
      menu: [{ id: 'product-a', name: 'Farmacia Gary product' }],
      sync_outbox: [{ id: 'outbox-a', licenseKey: 'ACTIVE-A', entityType: 'product', entityId: 'product-a' }]
    });
    const sourceAdapter = createSourceAdapter(source);
    const plan = await inspectLegacyVaultAndBuildRecoveryPlan({ adapter: sourceAdapter, activeTenantSource });
    const { reserved } = await prepareSchemaReady({ controlDatabase, recoveryPlan: plan, activeTenantSource });
    const sourceWrites = ['add', 'put', 'update', 'delete', 'clear'].map((method) => vi.spyOn(source.table('menu'), method));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const result = await createOrResumeRecoveryCopyManifest({
      controlDatabase, recoveryPlan: plan, activeTenantSource, sourceAdapter
    });
    const destination = await inspectDestinationRows(reserved.destinationDatabaseName);
    const metadata = await listRecoveryControlMetadata(controlDatabase);

    expect(result.journal.state).toBe(RECOVERY_JOURNAL_STATE.COPY_MANIFEST_READY);
    expect(result.manifest.copyItemCount).toBe(0);
    expect(result.manifest.copyItems).toEqual([]);
    expect(Object.values(destination.counts).every((count) => count === 0)).toBe(true);
    expect(sourceWrites.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(metadata)).not.toContain('Farmacia Gary product');
    expect(JSON.stringify(metadata)).not.toContain('product-a');
    expect(JSON.stringify(metadata)).not.toContain('ACTIVE-A');
  });

  it('rebuilds a manifest after a building crash and revalidates it after ready', async () => {
    const controlDatabase = createControlDatabase();
    const activeTenantSource = { license_key: 'ACTIVE-A' };
    const source = await createLegacySource();
    const sourceAdapter = createSourceAdapter(source);
    const plan = await inspectLegacyVaultAndBuildRecoveryPlan({ adapter: sourceAdapter, activeTenantSource });
    await prepareSchemaReady({ controlDatabase, recoveryPlan: plan, activeTenantSource });
    const first = await createOrResumeRecoveryCopyManifest({
      controlDatabase, recoveryPlan: plan, activeTenantSource, sourceAdapter
    });
    await controlDatabase.table('recovery_run_journal').update(first.journal.runId, {
      state: RECOVERY_JOURNAL_STATE.COPY_MANIFEST_BUILDING,
      updatedAt: new Date().toISOString()
    });

    const rebuilt = await createOrResumeRecoveryCopyManifest({
      controlDatabase, recoveryPlan: plan, activeTenantSource, sourceAdapter
    });
    const readyResume = await createOrResumeRecoveryCopyManifest({
      controlDatabase, recoveryPlan: plan, activeTenantSource, sourceAdapter
    });
    expect(rebuilt.journal.runId).toBe(first.journal.runId);
    expect(rebuilt.manifest.manifestFingerprint).toBe(first.manifest.manifestFingerprint);
    expect(readyResume.journal.state).toBe(RECOVERY_JOURNAL_STATE.COPY_MANIFEST_READY);
  });

  it('fails closed if source or destination changes after a manifest becomes ready', async () => {
    const controlDatabase = createControlDatabase();
    const activeTenantSource = { license_key: 'ACTIVE-A' };
    const source = await createLegacySource();
    const sourceAdapter = createSourceAdapter(source);
    const plan = await inspectLegacyVaultAndBuildRecoveryPlan({ adapter: sourceAdapter, activeTenantSource });
    const { reserved } = await prepareSchemaReady({ controlDatabase, recoveryPlan: plan, activeTenantSource });
    await createOrResumeRecoveryCopyManifest({ controlDatabase, recoveryPlan: plan, activeTenantSource, sourceAdapter });
    await source.table('menu').put({ id: 'changed-source', name: 'Changed later' });
    await expect(createOrResumeRecoveryCopyManifest({
      controlDatabase, recoveryPlan: plan, activeTenantSource, sourceAdapter
    })).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_SNAPSHOT_CHANGED' });

    await source.table('menu').delete('changed-source');
    await controlDatabase.table('recovery_run_journal').update((await listRecoveryControlMetadata(controlDatabase)).journals[0].runId, {
      state: RECOVERY_JOURNAL_STATE.COPY_MANIFEST_READY,
      failureReason: null,
      failureStage: null
    });
    const destination = createCanonicalLanzoDatabase(reserved.destinationDatabaseName);
    await destination.open();
    await destination.table('menu').put({ id: 'unexpected-destination-row' });
    destination.close();
    await expect(createOrResumeRecoveryCopyManifest({
      controlDatabase, recoveryPlan: plan, activeTenantSource, sourceAdapter
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_SCHEMA_MISMATCH' });
    const inspected = await inspectDestinationRows(reserved.destinationDatabaseName);
    expect(inspected.counts.menu).toBe(1);
  });

  it('fails closed for a different authenticated tenant after manifest ready without changing recovery metadata', async () => {
    const controlDatabase = createControlDatabase();
    const activeTenantA = { license_key: 'ACTIVE-A' };
    const activeTenantB = { license_key: 'ACTIVE-B' };
    const source = await createLegacySource();
    const sourceAdapter = createSourceAdapter(source);
    const planA = await inspectLegacyVaultAndBuildRecoveryPlan({
      adapter: sourceAdapter,
      activeTenantSource: activeTenantA
    });
    await prepareSchemaReady({
      controlDatabase,
      recoveryPlan: planA,
      activeTenantSource: activeTenantA
    });
    await createOrResumeRecoveryCopyManifest({
      controlDatabase,
      recoveryPlan: planA,
      activeTenantSource: activeTenantA,
      sourceAdapter
    });
    const planB = await inspectLegacyVaultAndBuildRecoveryPlan({
      adapter: sourceAdapter,
      activeTenantSource: activeTenantB
    });
    const before = await listRecoveryControlMetadata(controlDatabase);

    await expect(createOrResumeRecoveryCopyManifest({
      controlDatabase,
      recoveryPlan: planB,
      activeTenantSource: activeTenantB,
      sourceAdapter
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_READY_REQUIRED' });

    expect(await listRecoveryControlMetadata(controlDatabase)).toEqual(before);
  });

  it('prevents RECOVERY.2A and RECOVERY.2B from regressing a manifest-ready journal', async () => {
    const controlDatabase = createControlDatabase();
    const activeTenantSource = { license_key: 'ACTIVE-A' };
    const source = await createLegacySource();
    const sourceAdapter = createSourceAdapter(source);
    const plan = await inspectLegacyVaultAndBuildRecoveryPlan({ adapter: sourceAdapter, activeTenantSource });
    await prepareSchemaReady({ controlDatabase, recoveryPlan: plan, activeTenantSource });
    const manifest = await createOrResumeRecoveryCopyManifest({
      controlDatabase, recoveryPlan: plan, activeTenantSource, sourceAdapter
    });

    await expect(createOrResumeRecoveryInfrastructure({
      controlDatabase, recoveryPlan: plan, activeTenantSource
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_PHASE_ADVANCED' });
    await expect(createOrResumeRecoveryDestinationSchema({
      controlDatabase, recoveryPlan: plan, activeTenantSource
    })).rejects.toMatchObject({ code: 'RECOVERY_DESTINATION_PHASE_ADVANCED' });
    const journal = (await listRecoveryControlMetadata(controlDatabase)).journals[0];
    expect(journal.state).toBe(RECOVERY_JOURNAL_STATE.COPY_MANIFEST_READY);
    expect(journal.runId).toBe(manifest.journal.runId);
  });
});
