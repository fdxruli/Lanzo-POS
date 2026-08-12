import { closeTenantRuntime, getActiveTenantDatabase, openTenantRuntime } from '../services/db/tenantRuntimeRouter';

const TEST_IDENTITY = Object.freeze({
  aliases: ['license-key-sha256:test-tenant-runtime-a'],
  primary: 'license-key-sha256:test-tenant-runtime-a',
  authority: 'license_key_sha256'
});

export const openTestTenantRuntime = async () => {
  await openTenantRuntime(TEST_IDENTITY);
  const database = getActiveTenantDatabase();
  await Promise.all(database.tables.map((table) => table.clear()));
  return database;
};

export const closeTestTenantRuntime = () => closeTenantRuntime();
