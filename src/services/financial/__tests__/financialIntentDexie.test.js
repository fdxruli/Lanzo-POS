import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_NATIVE_DATABASE_VERSION,
  FINANCIAL_INTENT_DEXIE_VERSION,
  FINANCIAL_INTENT_SCHEMA
} from '../../db/databaseSchema';
import { preflightAndRepairIndexedDb } from '../../db/indexedDbPreflightCoordinator';
import { createCanonicalLanzoDatabase, STORES } from '../../db/dexie';
import {
  LOCAL_TENANT_BINDING_KEY,
  LOCAL_TENANT_BINDING_STORE
} from '../../tenant/localTenantPolicy';

const names = [];

// This is the released tenant schema immediately before 5B. It deliberately
// reaches native IndexedDB version 320 and does not contain financial_intents.
const RELEASED_V32_SCHEMA = {
  [STORES.MENU]: 'id, createdAt, barcode, name_lower, categoryId, sku, activeStockStatus',
  [STORES.CATEGORIES]: 'id, name, isActive, sortOrder',
  [STORES.CUSTOMERS]: 'id, phone, createdAt',
  [STORES.SALES]: 'id, timestamp, cash_session_id, customerId, fulfillmentStatus, status, orderType, [customerId+timestamp], [cash_session_id+timestamp]',
  [STORES.DELETED_SALES]: 'id, deletedAt, cash_session_id, [cash_session_id+deletedAt]',
  [STORES.CAJAS]: 'id, estado, fecha_apertura, actorKey, cashStationId, [cashStationId+estado], [actorKey+estado]',
  [STORES.MOVIMIENTOS_CAJA]: 'id, caja_id, cash_session_id, fecha, actorKey, cashStationId, idempotencyKey, [cash_session_id+fecha], [cashStationId+fecha]',
  [STORES.CUSTOMER_LEDGER]: 'id, customerId, type, timestamp, [customerId+timestamp]',
  [STORES.PRODUCT_BATCHES]: 'id, productId, sku, expiryDate, [productId+isActive]',
  sync_outbox: 'id, status, entityType, createdAt, [status+createdAt], idempotencyKey',
  sync_meta: 'key',
  sync_conflicts: 'id, entityType, entityId, status, createdAt',
  [LOCAL_TENANT_BINDING_STORE]: 'key'
};

const representativeRows = () => ({
  [STORES.MENU]: { id: 'product-a', name: 'Existing product', stock: 7, categoryId: 'category-a' },
  [STORES.CATEGORIES]: { id: 'category-a', name: 'Existing category', isActive: true, sortOrder: 1 },
  [STORES.CUSTOMERS]: { id: 'customer-a', name: 'Existing customer', phone: '9990000000' },
  [STORES.SALES]: { id: 'sale-a', timestamp: '2026-08-21T00:00:00.000Z', total: '100', customerId: 'customer-a' },
  [STORES.DELETED_SALES]: { id: 'deleted-sale-a', deletedAt: '2026-08-21T01:00:00.000Z', total: '50' },
  [STORES.CAJAS]: { id: 'cash-a', estado: 'abierta', fecha_apertura: '2026-08-21T00:00:00.000Z', actorKey: 'admin:a', cashStationId: 'station-a' },
  [STORES.MOVIMIENTOS_CAJA]: { id: 'movement-a', caja_id: 'cash-a', cash_session_id: 'cash-a', fecha: '2026-08-21T00:30:00.000Z', actorKey: 'admin:a', cashStationId: 'station-a' },
  [STORES.CUSTOMER_LEDGER]: { id: 'ledger-a', customerId: 'customer-a', type: 'charge', timestamp: '2026-08-21T00:00:00.000Z', amount: 100 },
  [STORES.PRODUCT_BATCHES]: { id: 'batch-a', productId: 'product-a', sku: 'SKU-A', stock: 7, isActive: true },
  sync_outbox: { id: 'outbox-a', status: 'pending', entityType: 'sale', createdAt: '2026-08-21T00:00:00.000Z' },
  sync_meta: { key: 'last-sync', value: '2026-08-21T00:00:00.000Z' },
  sync_conflicts: { id: 'conflict-a', entityType: 'sale', entityId: 'sale-a', status: 'pending', createdAt: '2026-08-21T00:00:00.000Z' }
});

const validBinding = () => ({
  key: LOCAL_TENANT_BINDING_KEY,
  tenantIdentity: 'license-key-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  tenantAliases: ['license-key-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  bindingVersion: 1,
  source: 'test',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
});

const financialIntent = () => ({
  id: 'intent-a',
  idempotencyKey: 'financial:v1:existing-k',
  requestHash: 'existing-h',
  operationType: 'sale.cancel',
  status: 'PENDING_RECEIPT',
  receiptState: 'UNKNOWN',
  reconciliationState: 'PENDING',
  originActorKey: 'admin:a',
  originActorType: 'admin',
  originActorId: 'actor-a',
  originTenantOpaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  originTenantDatabaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  cashSessionId: 'cash-a',
  cashStationId: 'station-a',
  requestPayload: { saleId: 'sale-a', reason: 'customer_request' },
  createdAt: '2026-08-21T00:15:00.000Z',
  updatedAt: '2026-08-21T00:15:00.000Z'
});

const nativeVersion = (name) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    resolve(database.version);
    database.close();
  };
});

const createReleasedTenantDatabase = async ({ name, version, intent = null }) => {
  const legacy = new Dexie(name);
  legacy.version(version / 10).stores({
    ...RELEASED_V32_SCHEMA,
    ...(intent ? { [STORES.FINANCIAL_INTENTS]: FINANCIAL_INTENT_SCHEMA } : {})
  });
  await legacy.open();

  const rows = representativeRows();
  await Promise.all(Object.entries(rows).map(([store, row]) => legacy.table(store).put(row)));
  await legacy.table(LOCAL_TENANT_BINDING_STORE).put(validBinding());
  if (intent) await legacy.table(STORES.FINANCIAL_INTENTS).put(intent);
  legacy.close();
  expect(await nativeVersion(name)).toBe(version);
  return rows;
};

const primaryKeyFor = (store, row) => (store === 'sync_meta' ? row.key : row.id);

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe('financial intent Dexie schema', () => {
  it('creates a fresh canonical tenant database at the current native version without a schema-patch warning', async () => {
    const name = `lanzo-financial-fresh-${crypto.randomUUID()}`;
    names.push(name);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const database = createCanonicalLanzoDatabase(name);

    try {
      await database.open();
      expect(database.verno).toBe(FINANCIAL_INTENT_DEXIE_VERSION);
      expect(await nativeVersion(name)).toBe(CURRENT_NATIVE_DATABASE_VERSION);
      expect(database.tables.map((table) => table.name)).toContain(STORES.FINANCIAL_INTENTS);
      expect(database.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
        STORES.MENU,
        STORES.SALES,
        STORES.CAJAS,
        STORES.CUSTOMER_LEDGER,
        LOCAL_TENANT_BINDING_STORE
      ]));
      expect(database.table(STORES.FINANCIAL_INTENTS).schema.idxByName.idempotencyKey.unique).toBe(true);
      expect(database.table(STORES.FINANCIAL_INTENTS).schema.idxByName['[status+updatedAt]']).toBeDefined();
      expect(database.table(STORES.FINANCIAL_INTENTS).schema.idxByName['[originActorKey+status]']).toBeDefined();
      expect(warn.mock.calls.flat().join(' ')).not.toContain(
        'Schema was extended without increasing the number passed to db.version()'
      );
    } finally {
      database.close();
      warn.mockRestore();
    }
  });

  it('upgrades a released native-320 tenant to the canonical version without changing existing business rows or binding', async () => {
    const name = `lanzo-financial-v320-${crypto.randomUUID()}`;
    names.push(name);
    const rows = await createReleasedTenantDatabase({ name, version: 320 });

    await expect(preflightAndRepairIndexedDb({ databaseName: name })).resolves.toMatchObject({
      inspection: { nativeVersion: 320, classification: 'compatible_outdated' },
      migrated: false
    });
    const upgraded = createCanonicalLanzoDatabase(name);
    await upgraded.open();

    expect(await nativeVersion(name)).toBe(CURRENT_NATIVE_DATABASE_VERSION);
    expect(upgraded.tables.map((table) => table.name)).toContain(STORES.FINANCIAL_INTENTS);
    await Promise.all(Object.entries(rows).map(async ([store, row]) => {
      await expect(upgraded.table(store).get(primaryKeyFor(store, row))).resolves.toEqual(row);
    }));
    await expect(upgraded.table(LOCAL_TENANT_BINDING_STORE).get(LOCAL_TENANT_BINDING_KEY))
      .resolves.toEqual(validBinding());
    upgraded.close();
  });

  it('upgrades the bug-affected native-321 tenant through production preflight without losing the durable financial intent', async () => {
    const name = `lanzo-financial-v321-${crypto.randomUUID()}`;
    names.push(name);
    const rows = await createReleasedTenantDatabase({
      name,
      version: 321,
      intent: financialIntent()
    });

    await expect(preflightAndRepairIndexedDb({ databaseName: name })).resolves.toMatchObject({
      inspection: { nativeVersion: 321, classification: 'compatible_outdated' },
      migrated: false
    });
    const upgraded = createCanonicalLanzoDatabase(name);
    await upgraded.open();

    expect(await nativeVersion(name)).toBe(CURRENT_NATIVE_DATABASE_VERSION);
    await expect(upgraded.table(STORES.FINANCIAL_INTENTS).get('intent-a')).resolves.toEqual(financialIntent());
    await expect(upgraded.table(STORES.FINANCIAL_INTENTS).add({
      id: 'intent-duplicate-k',
      idempotencyKey: 'financial:v1:existing-k',
      status: 'PREPARED'
    })).rejects.toThrow();
    await Promise.all(Object.entries(rows).map(async ([store, row]) => {
      await expect(upgraded.table(store).get(primaryKeyFor(store, row))).resolves.toEqual(row);
    }));
    await expect(upgraded.table(LOCAL_TENANT_BINDING_STORE).get(LOCAL_TENANT_BINDING_KEY))
      .resolves.toEqual(validBinding());
    upgraded.close();
  });

  it('keeps the true future-version safeguard fail-closed', async () => {
    const name = `lanzo-financial-future-${crypto.randomUUID()}`;
    names.push(name);
    await createReleasedTenantDatabase({
      name,
      version: CURRENT_NATIVE_DATABASE_VERSION + 1,
      intent: financialIntent()
    });

    await expect(preflightAndRepairIndexedDb({ databaseName: name })).rejects.toMatchObject({
      code: 'DB_UNSUPPORTED_NATIVE_VERSION',
      diagnostic: {
        isRetryable: false,
        requiresMigration: false,
        detectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION + 1,
        expectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION
      }
    });
    expect(await nativeVersion(name)).toBe(CURRENT_NATIVE_DATABASE_VERSION + 1);
  });
});
