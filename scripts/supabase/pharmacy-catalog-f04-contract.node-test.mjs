import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = async (path) => readFile(`${repositoryRoot}/${path}`, 'utf8');
const migration = await source('supabase/migrations/20261128003702_pharmacy_catalog_f04_active_ingredient_identity.sql');
const f01 = await source('supabase/migrations/20261127054627_pharmacy_catalog_f01_active_ingredients.sql');
const rpc = migration.match(/create or replace function public\.pos_upsert_active_ingredient_v1\([\s\S]*?\$function\$;/u)?.[0] || '';

test('F04 migration is a focused transactional change to the installed F01 authority', () => {
  assert.match(migration, /^-- LANZO\.FARMACIA\.CATALOG\.F04[\s\S]*?begin;[\s\S]*commit;\s*$/u);
  assert.match(migration, /create or replace function private\.pos_active_ingredient_name_key_f04\(p_name text\)/u);
  assert.match(migration, /normalize\(p_name, NFD\)/u);
  assert.match(migration, /U&'\[\\0300-\\036F\]'/u);
  assert.match(migration, /'\[\[:space:\]\]\+'/u);
  assert.doesNotMatch(migration, /create\s+(?:unique\s+)?index|alter\s+table\s+public\.pos_active_ingredients|drop\s+function/iu);

  assert.match(f01, /unique index pos_active_ingredients_license_name_key_uidx\s+on public\.pos_active_ingredients \(license_id, name_key\)/u);
  assert.match(f01, /alter table public\.pos_active_ingredients enable row level security/u);
});

test('the unchanged RPC contract recomputes identity and serializes equivalent tenant writes', () => {
  assert.match(rpc, /p_license_key text,[\s\S]*?p_staff_session_token text default null,[\s\S]*?p_active_ingredient jsonb default '\{\}'::jsonb,[\s\S]*?p_expected_version integer default null,[\s\S]*?p_idempotency_key text default null/u);
  assert.match(rpc, /private\.validate_pos_sync_context\(/u);
  assert.match(rpc, /private\.assert_cloud_products_sync_enabled\(v_context\)/u);
  assert.match(rpc, /private\.assert_pos_products_write_permission\(v_context\)/u);
  assert.match(rpc, /v_name_key := private\.pos_active_ingredient_name_key_f04\(v_name\)/u);
  assert.doesNotMatch(rpc, /ACTIVE_INGREDIENT_NAME_KEY_MISMATCH|p_active_ingredient->>'name_key'/u);
  assert.match(rpc, /pg_advisory_xact_lock\([\s\S]*?hashtextextended\(v_license_id::text[\s\S]*?v_name_key/u);
  assert.match(rpc, /ai\.license_id = v_license_id[\s\S]*?private\.pos_active_ingredient_name_key_f04\(ai\.name\) = v_name_key/u);
  assert.match(rpc, /order by \(ai\.id = v_requested_id\) desc, \(ai\.name_key = v_name_key\) desc,[\s\S]*?ai\.is_active desc, ai\.created_at, ai\.id/u);
  assert.match(rpc, /on conflict do nothing[\s\S]*?returning \* into v_saved/u);
  assert.match(rpc, /'client_id', v_requested_id/u);
});

test('the production write surface keeps F01 security and client grants', () => {
  assert.match(rpc, /security definer set search_path = ''/u);
  assert.match(migration, /alter function public\.pos_upsert_active_ingredient_v1\(text,text,text,text,jsonb,integer,text\) owner to postgres/u);
  assert.match(migration, /revoke all on function public\.pos_upsert_active_ingredient_v1\(text,text,text,text,jsonb,integer,text\) from public/u);
  assert.match(migration, /grant execute on function public\.pos_upsert_active_ingredient_v1\(text,text,text,text,jsonb,integer,text\) to anon, authenticated, service_role/u);
  assert.match(migration, /revoke all on function private\.pos_active_ingredient_name_key_f04\(text\) from public, anon, authenticated, service_role/u);
});
