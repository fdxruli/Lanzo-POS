import { closeTenantRuntime, getActiveTenantDatabase, openTenantRuntime } from '../services/db/tenantRuntimeRouter';

const TEST_IDENTITY = Object.freeze({ aliases: ['test-tenant-runtime-a'], primary: 'test-tenant-runtime-a' });

export const openTestTenantRuntime = async () => {
  await openTenantRuntime(TEST_IDENTITY);
  const database = getActiveTenantDatabase();
  await Promise.all(database.tables.map((table) => table.clear()));
  return database;
};

export const closeTestTenantRuntime = () => closeTenantRuntime();
