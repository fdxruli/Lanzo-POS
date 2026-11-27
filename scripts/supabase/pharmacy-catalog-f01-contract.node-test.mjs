import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const migrationPath = `${repositoryRoot}/supabase/migrations/20261127054627_pharmacy_catalog_f01_active_ingredients.sql`;
const migration = await readFile(migrationPath, 'utf8');
const source = async (path) => readFile(`${repositoryRoot}/${path}`, 'utf8');

test('F01 adds a separate business-scoped active ingredient catalog with storage uniqueness', () => {
  assert.match(migration, /create table public\.pos_active_ingredients/u);
  assert.match(migration, /unique index pos_active_ingredients_license_name_key_uidx\s+on public\.pos_active_ingredients \(license_id, name_key\)/u);
  assert.match(migration, /alter table public\.pos_active_ingredients enable row level security/u);
  assert.match(migration, /revoke all on public\.pos_active_ingredients from public, anon, authenticated, service_role/u);
  assert.match(migration, /on conflict do nothing\s+returning \* into v_saved;\s+v_changed := v_saved\.id is not null;/u);
  assert.match(migration, /if v_saved\.id is null then\s+select \* into v_saved from public\.pos_active_ingredients\s+where license_id = v_license_id and name_key = v_name_key/u);
  assert.match(migration, /private\.normalize_pos_product_name_key\(v_name\)/u);
});

test('the pos_products trigger is the shared structured and legacy write boundary', () => {
  assert.match(migration, /create trigger pos_products_pharmacy_composition_write_guard_v1\s+before insert or update on public\.pos_products/u);
  assert.match(migration, /if not \(v_new_pharmacy \? 'composition'\) then[\s\S]*?jsonb_build_object\('composition', v_old_composition\)/u);
  assert.match(migration, /NEW\.active_substance is distinct from OLD\.active_substance/u);
  assert.match(migration, /PHARMACY_LEGACY_CONCENTRATION_CONTRADICTS_COMPOSITION/u);
  assert.match(migration, /jsonb_typeof\(v_new_pharmacy->'composition'\) = 'null'/u);
  assert.match(migration, /ai\.license_id = v_license_id and ai\.id = v_id/u);
  assert.match(migration, /PHARMACY_ACTIVE_INGREDIENT_ARCHIVED/u);
  assert.match(migration, /jsonb_build_object\('composition', v_composition, 'concentration', v_concentration\)/u);
  const guard = migration.match(/create or replace function private\.pharmacy_composition_write_guard_v1\(\)([\s\S]*?)\$function\$;/u)?.[1] || '';
  assert.doesNotMatch(guard, /NEW\.(?:stock|cost|sku|barcode|prescription_type|sanitary_registration)\s*=/u);
});

test('catalog sync advertises the new versioned endpoint additively and keeps the safe frontier', () => {
  assert.match(migration, /public\.pos_pull_product_catalog_snapshot_v3/u);
  assert.match(migration, /'active_ingredient', ai\.id/u);
  assert.match(migration, /private\.pos_sync_safe_frontier_v1\(v_license_id\)/u);
  assert.match(migration, /e\.change_seq <= v_safe/u);
  assert.match(migration, /v_capabilities := v_capabilities \|\| jsonb_build_array\('pharmacy_active_ingredient_catalog_v1'\)/u);
  assert.match(migration, /v_endpoints := v_endpoints \|\| jsonb_build_array\('pos_pull_product_catalog_snapshot_v3'\)/u);
  assert.doesNotMatch(migration, /drop function[^;]*pos_pull_product_catalog_snapshot_v2/iu);
});

test('client negotiation tolerates existing v2 servers and gates the optional v3 endpoint', async () => {
  const protocol = await source('src/services/sync/cloudSyncProtocolV2.js');
  const repository = await source('src/services/products/productCloudRepository.js');
  assert.match(protocol, /const SNAPSHOT_ENDPOINTS = Object\.freeze\(\{[\s\S]*?pos_pull_product_catalog_snapshot_v2/u);
  assert.match(protocol, /OPTIONAL_SNAPSHOT_ENDPOINTS/u);
  assert.match(protocol, /snapshotContract\.capabilities\?\.includes\(optionalEndpoint\.capability\)/u);
  assert.match(repository, /capabilities\?\.includes\(CLOUD_PHARMACY_ACTIVE_INGREDIENT_CAPABILITY\)[\s\S]*?'pos_pull_product_catalog_snapshot_v3'[\s\S]*?'pos_pull_product_catalog_snapshot_v2'/u);
});
