import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const migrationPath = 'supabase/migrations/20260820165842_shared_terminal_financial_receipt_contract.sql';
const expectedSha256 = '23a93e388cbb82c9079efc508e8491bc5e0d9b5d8760bfddd6ee1102da73df9e';
const restaurantFixturePath = 'supabase/tests/fixtures/restaurant_sale_dispatcher_guard_3d14_setup.sql';
const expectedRestaurantFixtureSha256 = '5adb0261a49d8dccae5e9fbe292f4612cb8e5ce1f8db6692595e1ec0be4bd22c';
const migration = await fs.readFile(migrationPath, 'utf8');
assert.equal(createHash('sha256').update(migration, 'utf8').digest('hex'), expectedSha256, 'SHARED_TERMINAL_FINANCIAL_RECEIPT_MIGRATION_SHA256_MISMATCH');
const restaurantFixture = await fs.readFile(restaurantFixturePath, 'utf8');
assert.equal(createHash('sha256').update(restaurantFixture, 'utf8').digest('hex'), expectedRestaurantFixtureSha256, 'RESTAURANT_DISPATCHER_FIXTURE_SOURCE_SHA256_MISMATCH');

function uniqueStatement(pattern, label) {
  const matches = [...migration.matchAll(pattern)];
  assert.equal(matches.length, 1, `CANONICAL_FIXTURE_STATEMENT_COUNT:${label}`);
  return matches[0][0].trim();
}

const createTable = uniqueStatement(/create table if not exists public\.pos_financial_operations\s*\([\s\S]*?\n\);/giu, 'table');
const createIndex = uniqueStatement(/create index if not exists idx_pos_financial_operations_receipt\s+on public\.pos_financial_operations\s*\([^;]+;/giu, 'index');
const enableRls = uniqueStatement(/alter table public\.pos_financial_operations enable row level security;/giu, 'rls');
const revoke = uniqueStatement(/revoke all on table public\.pos_financial_operations from public, anon, authenticated;/giu, 'acl');
const createRestaurantOrderTable = (() => {
  const matches = [...restaurantFixture.matchAll(/create table public\.pos_restaurant_orders\s*\([\s\S]*?\n\);/giu)];
  assert.equal(matches.length, 1, 'RESTAURANT_DISPATCHER_FIXTURE_TABLE_STATEMENT_COUNT');
  const statement = matches[0][0].trim();
  assert.match(statement, /^create table public\.pos_restaurant_orders\s*\(\s*id text primary key,\s*license_id uuid not null,\s*local_order_id text not null\s*\);$/iu, 'RESTAURANT_DISPATCHER_FIXTURE_TABLE_PROFILE_MISMATCH');
  return statement;
})();

const sql = `
begin;
set local search_path = pg_catalog, public, private;
do $financial_receipt_fixture_preflight$
begin
  if to_regclass('public.pos_restaurant_orders') is not null then
    raise exception 'RESTAURANT_DISPATCHER_FIXTURE_TABLE_ALREADY_PRESENT' using errcode='P0001';
  end if;
  if to_regclass('public.pos_cash_sessions') is null
     or to_regclass('public.pos_cash_stations') is null
     or to_regclass('public.licenses') is null
     or to_regclass('public.license_devices') is null
     or not exists (
       select 1 from pg_constraint
       where conrelid='public.pos_cash_sessions'::regclass
         and conname='pos_cash_sessions_license_id_id_uk'
         and pg_get_constraintdef(oid)='UNIQUE (license_id, id)'
     ) then
    raise exception 'SHARED_TERMINAL_FINANCIAL_RECEIPT_FIXTURE_PREREQUISITE_MISSING' using errcode='P0001';
  end if;
end
$financial_receipt_fixture_preflight$;
${createRestaurantOrderTable}
${createTable}
${createIndex}
${enableRls}
${revoke}
do $financial_receipt_fixture_verify$
declare actual_columns text[]; table_oid oid;
begin
  table_oid := to_regclass('public.pos_financial_operations');
  if table_oid is null then raise exception 'FINANCIAL_RECEIPT_FIXTURE_TABLE_MISSING' using errcode='P0001'; end if;
  select array_agg(column_name order by ordinal_position)
    into actual_columns
    from information_schema.columns
    where table_schema='public' and table_name='pos_financial_operations';
  if actual_columns is distinct from array[
    'id','license_id','idempotency_key','legacy_idempotency_key','request_hash',
    'request_contract_version','operation_type','verified_actor_key','verified_device_id',
    'verified_cash_session_id','verified_cash_station_id','canonical_request','status',
    'response_payload','created_at','completed_at'
  ]::text[] then raise exception 'FINANCIAL_RECEIPT_FIXTURE_COLUMN_PROFILE_MISMATCH' using errcode='P0001'; end if;
  if (select array_agg(column_name order by ordinal_position)
        from information_schema.columns
        where table_schema='public' and table_name='pos_restaurant_orders')
       is distinct from array['id','license_id','local_order_id']::text[] then
    raise exception 'RESTAURANT_DISPATCHER_FIXTURE_PROFILE_MISMATCH' using errcode='P0001';
  end if;
  if (select relrowsecurity from pg_class where oid=table_oid) is distinct from true
     or not exists(select 1 from pg_constraint where conrelid=table_oid and conname='pos_financial_operations_status_chk')
     or not exists(select 1 from pg_constraint where conrelid=table_oid and conname='pos_financial_operations_hash_chk')
     or not exists(select 1 from pg_constraint where conrelid=table_oid and conname='pos_financial_operations_contract_chk')
     or not exists(select 1 from pg_constraint where conrelid=table_oid and conname='pos_financial_operations_completed_chk')
     or not exists(select 1 from pg_constraint where conrelid=table_oid and conname='pos_financial_operations_license_key_uk')
     or not exists(select 1 from pg_constraint where conrelid=table_oid and conname='pos_financial_operations_license_legacy_key_uk')
     or not exists(select 1 from pg_constraint where conrelid=table_oid and conname='pos_financial_operations_session_fk')
     or not exists(select 1 from pg_constraint where conrelid=table_oid and conname='pos_financial_operations_station_fk')
     or exists(select 1 from pg_policies where schemaname='public' and tablename='pos_financial_operations') then
    raise exception 'FINANCIAL_RECEIPT_FIXTURE_SECURITY_PROFILE_MISMATCH' using errcode='P0001';
  end if;
end
$financial_receipt_fixture_verify$;
commit;
`;

const manifestPath = 'artifacts/fin01/fixture-source-manifest.json';
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.supplemental_canonical_fixture = {
  migration_path: migrationPath,
  migration_sha256: expectedSha256,
  dispatcher_fixture_path: restaurantFixturePath,
  dispatcher_fixture_sha256: expectedRestaurantFixtureSha256,
  extracted_statements: ['pos_restaurant_orders test-fixture table', 'pos_financial_operations table', 'receipt index', 'RLS enablement', 'default ACL revoke'],
  source_copied_into_repository: false
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stderr.write(`${JSON.stringify({ result: 'PASS', source: migrationPath, source_sha256: expectedSha256, dispatcher_fixture: restaurantFixturePath, dispatcher_fixture_sha256: expectedRestaurantFixtureSha256, fixture: ['public.pos_restaurant_orders', 'public.pos_financial_operations'], extracted_statements: 5 })}\n`);
process.stdout.write(sql);
