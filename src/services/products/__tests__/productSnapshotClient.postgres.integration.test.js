// Run with LANZO_BLOCK3_PG_DB set to an isolated database containing the
// Block 1 + Block 2 migrations and synthetic fixture license B2-3738.
// This deliberately exercises the real repositories and Dexie against the
// PostgreSQL snapshot/change RPCs through a small local psql transport.
// @vitest-environment node
import 'fake-indexeddb/auto';
import { execFileSync, spawn } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  rpc: vi.fn(),
  meta: new Map(),
  interleave: false,
  interleaved: false,
  concurrentMutations: null
}));

vi.mock('../../db/dexie', async () => {
  const { default: Dexie } = await import('dexie');
  const db = new Dexie('product-snapshot-client-postgres');
  db.version(1).stores({
    menu: '&id, categoryId, isActive, serverVersion, lastSyncedAt, syncStatus',
    categories: '&id, name, isActive, serverVersion, lastSyncedAt, syncStatus',
    product_batches: '&id, productId, isActive, serverVersion, lastSyncedAt, syncStatus',
    sales: '&id, status',
    inventory_events: '&id, productId',
    sync_outbox: '&id, entityType, entityId, status',
    deleted_menu: '&id',
    deleted_categories: '&id',
    sync_cache: '&key',
    sync_meta: '&key',
    sync_conflicts: '&id, status'
  });
  return {
    db,
    STORES: {
      MENU: 'menu', CATEGORIES: 'categories', PRODUCT_BATCHES: 'product_batches',
      SALES: 'sales', INVENTORY_EVENTS: 'inventory_events', DELETED_MENU: 'deleted_menu',
      DELETED_CATEGORIES: 'deleted_categories', SYNC_CACHE: 'sync_cache'
    }
  };
});

vi.mock('../../supabase', () => ({ supabaseClient: { rpc: harness.rpc } }));
vi.mock('../../sync/posSyncClient', () => ({ buildPosSyncAuthContext: vi.fn(async () => ({
  licenseKey: 'B2-3738', deviceFingerprint: 'device-snapshot-a',
  securityToken: 'token-snapshot-a', staffSessionToken: 'session-snapshot-a'
})) }));
vi.mock('../../sync/syncMetaService', () => ({ syncMetaService: {
  getMeta: vi.fn(async (key, fallback = null) => harness.meta.get(key) ?? fallback),
  setMeta: vi.fn(async (key, value, { licenseKey } = {}) => {
    harness.meta.set(`${licenseKey}:${key}`, value);
    harness.meta.set(key, value);
    return true;
  }),
  advanceMeta: vi.fn(async (key, value, { licenseKey } = {}) => {
    const scopedKey = `${licenseKey}:${key}`;
    const current = Number(harness.meta.get(scopedKey) ?? 0);
    const next = Math.max(current, Number(value));
    harness.meta.set(scopedKey, next);
    harness.meta.set(key, next);
    return next;
  })
} }));
vi.mock('../../cloud', () => ({
  CLOUD_REQUEST_COOLDOWN: { SNAPSHOT: 0 }, CLOUD_REQUEST_TAGS: { PRODUCTS: 'products' },
  CLOUD_REQUEST_TTL: { MEDIUM: 0 }, buildBaseRpcContextFromArgs: vi.fn(() => ({})),
  buildRpcRequestKey: vi.fn(() => 'catalog-snapshot'), cloudRequestManager: {
    request: ({ fn }) => fn()
  }, cloudRequestTags: { license: (value) => value, rpc: (value) => value },
  invalidateCloudCacheAfterCatalogMutation: vi.fn()
}));
vi.mock('../database', () => ({}));
vi.mock('../db/general', () => ({ categoriesRepository: {} }));
vi.mock('../utils', () => ({ generateID: vi.fn((prefix = 'id') => `${prefix}-generated`) }));
vi.mock('../productEvents', () => ({ notifyProductsChanged: vi.fn() }));

import { db } from '../../db/dexie';
import { productMigrationService } from '../productMigrationService';
import { pullCatalogChanges } from '../productSyncHandler';
import { PRODUCT_CATALOG_LAST_SEQ_KEY } from '../productConstants';

const licenseId = '00000000-0000-0000-0000-00000000a111';
const snapshotContract = {
  contract_version: 2,
  tenant_id: licenseId,
  server_status: 'SUPPORTED',
  capabilities: ['historical_credit_preservation_v1', 'customer_projection_safe_apply_v1',
    'snapshot_keyset_reference_v1'],
  endpoint_families: ['product_catalog', 'customer_directory', 'customer_credit', 'sales', 'cash_register'],
  endpoints: ['pos_pull_product_catalog_snapshot_v2', 'pos_pull_customers_snapshot_v3',
    'pos_pull_customer_credit_snapshot_v3', 'pos_pull_sales_snapshot_v2', 'pos_pull_cash_snapshot_v2']
};

const sqlText = (value) => value === null || value === undefined
  ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const sqlNumber = (value) => value === null || value === undefined ? 'null' : String(Number(value));
const sqlJson = (value) => value === null || value === undefined
  ? 'null::jsonb' : `${sqlText(JSON.stringify(value))}::jsonb`;

const runPsql = (query) => execFileSync('docker', [
  'exec', 'lanzo-pos-b1-pg176', 'psql', '-U', 'postgres', '-d', process.env.LANZO_BLOCK3_PG_DB,
  '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query
], { encoding: 'utf8' }).trim();

const callPostgresRpc = (rpcName, args) => {
  const common = [args.p_license_key, args.p_device_fingerprint, args.p_security_token,
    args.p_staff_session_token].map(sqlText);
  if (rpcName === 'pos_pull_product_catalog_snapshot_v2') {
    return runPsql(`select public.${rpcName}(${[
      ...common, sqlNumber(args.p_limit), sqlNumber(args.p_snapshot_reference_change_seq), sqlJson(args.p_page_cursor)
    ].join(',')})::text`);
  }
  if (rpcName === 'pos_pull_product_catalog_changes') {
    return runPsql(`select public.${rpcName}(${[
      ...common, sqlNumber(args.p_since_change_seq), sqlNumber(args.p_limit)
    ].join(',')})::text`);
  }
  throw new Error(`Unexpected PostgreSQL RPC in catalog integration: ${rpcName}`);
};

const applyConcurrentProductUpdate = () => {
  const name = `A-updated-${Date.now()}`;
  const idempotencyKey = `block3-snapshot-${Date.now()}`;
  const query = `with updated as (
    update public.pos_products
       set name=${sqlText(name)}, server_version=server_version+1, updated_at=clock_timestamp()
     where license_id=${sqlText(licenseId)}::uuid and id='A'
     returning server_version
  )
  select (private.record_pos_sync_event(
    ${sqlText(licenseId)}::uuid, 'product', 'A', 'upsert', null, null,
    ${sqlText(idempotencyKey)}, jsonb_build_object('id','A'),
    (select server_version from updated)
  )).change_seq`;
  const changeSeq = Number(runPsql(query));
  if (!changeSeq) throw new Error('The PostgreSQL fixture product update did not record an event.');
  return { name, changeSeq };
};

const applyConcurrentCatalogMutations = () => {
  const suffix = Date.now();
  const createdIds = [`0-B3-CONCURRENT-${suffix}`, `Z-B3-CONCURRENT-${suffix}`];
  const productUpdate = applyConcurrentProductUpdate();
  const createSql = `with source as (
    select to_jsonb(p) as row_data
      from public.pos_products p
     where p.license_id=${sqlText(licenseId)}::uuid and p.id='A'
  ), requested(id, name, sku) as (
    values (${sqlText(createdIds[0])}, ${sqlText(`Concurrent before ${suffix}`)}, ${sqlText(`B3-CONCURRENT-BEFORE-${suffix}`)}),
           (${sqlText(createdIds[1])}, ${sqlText(`Concurrent after ${suffix}`)}, ${sqlText(`B3-CONCURRENT-AFTER-${suffix}`)})
  ), inserted as (
    insert into public.pos_products
    select (jsonb_populate_record(null::public.pos_products, source.row_data || jsonb_build_object(
      'id', requested.id, 'name', requested.name, 'name_key', lower(requested.name),
      'sku', requested.sku, 'sku_key', lower(requested.sku), 'barcode', null,
      'barcode_key', null, 'server_version', 1, 'created_at', clock_timestamp(),
      'updated_at', clock_timestamp(), 'deleted_at', null, 'last_idempotency_key', null
    ))).*
      from source cross join requested
    on conflict (id) do nothing
    returning license_id, id, server_version
  )
  select coalesce(max((private.record_pos_sync_event(
    i.license_id, 'product', i.id, 'upsert', null, null,
    'block3-concurrent-create-' || i.id, jsonb_build_object('id', i.id), i.server_version
  )).change_seq), 0)
    from inserted i`;
  const createdEvent = Number(runPsql(createSql));
  if (!createdEvent) throw new Error('The PostgreSQL concurrent product create did not record events.');

  const deletedId = runPsql(`
    select id from public.pos_products
     where license_id=${sqlText(licenseId)}::uuid
       and id like 'B3-PAGE-%' and deleted_at is null
       and id <> 'B3-PAGE-001'
     order by id limit 1
  `);
  const deleteIdempotencyKey = `block3-concurrent-delete-${suffix}`;
  const deleteSql = `with updated as (
    update public.pos_products
       set deleted_at=clock_timestamp(), server_version=server_version+1, updated_at=clock_timestamp()
     where license_id=${sqlText(licenseId)}::uuid and id=${sqlText(deletedId)} and deleted_at is null
     returning license_id, id, server_version
  )
  select private.record_pos_sync_event(
    u.license_id, 'product', u.id, 'delete', null, null,
    ${sqlText(deleteIdempotencyKey)}, jsonb_build_object('id', u.id), u.server_version
  )
    from updated u`;
  runPsql(deleteSql);
  const deleteChangeSeq = Number(runPsql(`
    select change_seq from public.pos_sync_events
     where license_id=${sqlText(licenseId)}::uuid
       and idempotency_key=${sqlText(deleteIdempotencyKey)}
  `));
  if (!Number.isSafeInteger(deleteChangeSeq) || deleteChangeSeq <= 0) {
    throw new Error('The PostgreSQL concurrent product tombstone did not record an event.');
  }
  return {
    updatedName: productUpdate.name,
    updateChangeSeq: productUpdate.changeSeq,
    createdIds,
    deletedId
  };
};

const startPendingProductTransaction = async () => {
  const suffix = Date.now();
  const updatedName = `A-pending-transaction-${suffix}`;
  const query = `begin;
with updated as (
  update public.pos_products
     set name=${sqlText(updatedName)}, name_key=lower(${sqlText(updatedName)}),
         server_version=server_version+1, updated_at=clock_timestamp()
   where license_id=${sqlText(licenseId)}::uuid and id='B3-PAGE-001'
   returning license_id, id, server_version
)
select 'PENDING_SEQ:' || (private.record_pos_sync_event(
  u.license_id, 'product', u.id, 'upsert', null, null,
  ${sqlText(`block3-pending-${suffix}`)}, jsonb_build_object('id', u.id), u.server_version
)).change_seq from updated u;
select 'PENDING_PID:' || pg_backend_pid();
`;
  const child = spawn('docker', [
    'exec', '-i', 'lanzo-pos-b1-pg176', 'psql', '-U', 'postgres', '-d', process.env.LANZO_BLOCK3_PG_DB,
    '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(query);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out opening PostgreSQL transaction: ${stderr}`)), 10_000);
    const poll = setInterval(() => {
      if (stdout.includes('PENDING_SEQ:') && stdout.includes('PENDING_PID:')) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
      }
      if (child.exitCode !== null) {
        clearInterval(poll);
        clearTimeout(timeout);
        reject(new Error(`Pending PostgreSQL transaction exited early: ${stderr || stdout}`));
      }
    }, 10);
  });
  const pendingSeq = Number(stdout.split('PENDING_SEQ:').at(-1)?.trim().split(/\s+/)[0]);
  const pendingPid = Number(stdout.split('PENDING_PID:').at(-1)?.trim().split(/\s+/)[0]);
  if (!Number.isSafeInteger(pendingSeq) || pendingSeq <= 0
    || !Number.isSafeInteger(pendingPid) || pendingPid <= 0) {
    child.stdin.write('ROLLBACK;\n\\q\n');
    throw new Error(`Invalid pending sequence from PostgreSQL: ${stdout}`);
  }
  return {
    pendingSeq,
    pendingPid,
    updatedName,
    async finish(commit = true) {
      if (child.exitCode !== null) return;
      child.stdin.write(`${commit ? 'COMMIT' : 'ROLLBACK'};\n\\q\n`);
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`PostgreSQL transaction exit ${code}: ${stderr}`)));
      });
    }
  };
};

const ensureMultipageCatalogFixture = () => runPsql(`
  with source as (
    select to_jsonb(p) as row_data
      from public.pos_products p
     where p.license_id=${sqlText(licenseId)}::uuid and p.id='A'
  ), inserted as (
    insert into public.pos_products
    select (jsonb_populate_record(null::public.pos_products,
      source.row_data || jsonb_build_object(
        'id', 'B3-PAGE-' || lpad(n::text, 3, '0'),
        'name', 'B3 catalog page ' || n,
        'name_key', lower('B3 catalog page ' || n),
        'sku', 'B3-PAGE-SKU-' || n,
        'sku_key', lower('B3-PAGE-SKU-' || n),
        'barcode', null,
        'barcode_key', null,
        'server_version', 1,
        'created_at', clock_timestamp(),
        'updated_at', clock_timestamp(),
        'deleted_at', null,
        'last_idempotency_key', null
      ))).*
      from source cross join generate_series(1, 505) n
    on conflict (id) do nothing
    returning license_id, id, server_version
  )
  select coalesce(max((private.record_pos_sync_event(
    i.license_id, 'product', i.id, 'upsert', null, null,
    'block3-page-fixture-' || i.id, jsonb_build_object('id', i.id), i.server_version
  )).change_seq), 0)
  from inserted i
`);

const getFrontierState = () => {
  const [safeChangeSeq, syncDeferred] = runPsql(`
    select f.safe_change_seq || ',' || f.sync_deferred
      from private.pos_sync_safe_frontier_v1(${sqlText(licenseId)}::uuid) f
  `).split(',');
  return { safeChangeSeq: Number(safeChangeSeq), syncDeferred: ['t', 'true'].includes(syncDeferred) };
};

const getServerActiveProductIds = () => JSON.parse(runPsql(`
  select coalesce(json_agg(id order by id), '[]'::json)::text
    from public.pos_products
   where license_id=${sqlText(licenseId)}::uuid and deleted_at is null
`));

describe('consistent catalog snapshot with PostgreSQL and Dexie', () => {
  beforeEach(async () => {
    if (!process.env.LANZO_BLOCK3_PG_DB) return;
    ensureMultipageCatalogFixture();
    harness.meta.clear();
    harness.interleave = false;
    harness.interleaved = false;
    harness.concurrentMutations = null;
    await db.delete();
    await db.open();
    harness.rpc.mockReset();
    harness.rpc.mockImplementation(async (rpcName, args) => {
      if (rpcName === 'pos_fin01_sync_contract_v1') return { data: snapshotContract, error: null };
      const data = JSON.parse(callPostgresRpc(rpcName, args));
      if (rpcName === 'pos_pull_product_catalog_snapshot_v2'
        && harness.interleave && !harness.interleaved) {
        harness.interleaved = true;
        harness.concurrentMutations = applyConcurrentCatalogMutations();
        harness.updatedName = harness.concurrentMutations.updatedName;
      }
      return { data, error: null };
    });
  });

  it.skipIf(!process.env.LANZO_BLOCK3_PG_DB)(
    'converges Dexie through keyset snapshot, commit inversion, concurrent create/delete, and delta recovery', async () => {
      harness.interleave = true;
      const pendingTransaction = await startPendingProductTransaction();
      let committedPendingTransaction = false;
      try {
      const frontierBeforeSnapshot = getFrontierState();
      expect(runPsql(`select state from pg_stat_activity where pid=${pendingTransaction.pendingPid}`))
        .toBe('idle in transaction');
      expect(frontierBeforeSnapshot.syncDeferred).toBe(true);
      expect(frontierBeforeSnapshot.safeChangeSeq).toBe(pendingTransaction.pendingSeq - 1);
      await db.table('menu').put({
        id: 'B3-LOCAL-PENDING', name: 'Edición local pendiente', price: 10, cost: 4, stock: 0,
        isActive: true, syncStatus: 'pending', serverVersion: null, pendingOperationId: 'B3-LOCAL-PENDING'
      });
      await db.table('sync_outbox').put({
        id: 'B3-LOCAL-PENDING', licenseKey: 'B2-3738', entityType: 'product',
        entityId: 'B3-LOCAL-PENDING', operation: 'upsert', status: 'pending', payload: {}
      });
      const initialProductName = runPsql(`select name from public.pos_products where license_id=${sqlText(licenseId)}::uuid and id='A'`);
      const initialFrontier = frontierBeforeSnapshot.safeChangeSeq;
      const result = await productMigrationService.pullFullSnapshot({ licenseKey: 'B2-3738' });

      expect(result).toMatchObject({ success: true, consistent: true, snapshotReferenceChangeSeq: initialFrontier,
        recoveryPending: true, syncDeferred: true });
      expect(harness.interleaved).toBe(true);
      expect(harness.concurrentMutations.updateChangeSeq).toBeGreaterThan(pendingTransaction.pendingSeq);
      expect(result.pages).toBeGreaterThan(1);
      expect(await db.table('menu').get('A')).toMatchObject({ name: initialProductName });
      const reference = Number(harness.meta.get(`B2-3738:${PRODUCT_CATALOG_LAST_SEQ_KEY}`));
      expect(reference).toBe(initialFrontier);

      const deferredDelta = await pullCatalogChanges('B2-3738');
      expect(deferredDelta).toMatchObject({ latestChangeSeq: reference, syncDeferred: true });
      expect(await db.table('menu').get('A')).toMatchObject({ name: initialProductName });

      await pendingTransaction.finish(true);
      committedPendingTransaction = true;
      const delta = await pullCatalogChanges('B2-3738');
      expect(delta.latestChangeSeq).toBeGreaterThan(reference);
      expect(delta.syncDeferred).toBe(false);
      expect(await db.table('menu').get('A')).toMatchObject({ name: harness.updatedName });
      expect(await db.table('menu').get('B3-PAGE-001')).toMatchObject({ name: pendingTransaction.updatedName });
      expect(await db.table('menu').bulkGet(harness.concurrentMutations.createdIds))
        .toEqual(expect.arrayContaining(harness.concurrentMutations.createdIds.map((id) => expect.objectContaining({ id }))));
      expect(await db.table('menu').get(harness.concurrentMutations.deletedId)).toMatchObject({
        deletedAt: expect.any(String)
      });
      const localActiveIds = (await db.table('menu').toArray())
        .filter((product) => product.serverVersion > 0 && !product.deletedAt && !product.deleted_at)
        .map((product) => product.id).sort();
      expect(localActiveIds).toEqual(getServerActiveProductIds());
      expect(await db.table('menu').get('B3-LOCAL-PENDING')).toMatchObject({
        name: 'Edición local pendiente', syncStatus: 'pending', pendingOperationId: 'B3-LOCAL-PENDING'
      });
      expect(await db.table('sync_outbox').get('B3-LOCAL-PENDING')).toMatchObject({
        status: 'pending', entityId: 'B3-LOCAL-PENDING'
      });
      expect(await db.table('categories').count()).toBe(1);
      expect(await db.table('product_batches').count()).toBe(1);
      expect((await db.table('menu').where('syncStatus').equals('synced').count())).toBeGreaterThan(500);
      } finally {
        if (!committedPendingTransaction) await pendingTransaction.finish(false);
      }
    }
  );
});
