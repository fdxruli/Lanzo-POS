import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '20260826010000_admin_staff_rbac_r2d_product_inventory_authority.sql'
);
const migration = readFileSync(migrationPath, 'utf8').replace(/\r\n/gu, '\n');
const readProjectFile = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'missing function marker: ' + marker);
  const closingTag = source.slice(start).match(/\n[ \\t]*\$(?:function)?\$;/u);
  assert.ok(closingTag, 'incomplete function body: ' + marker);
  const end = start + closingTag.index + closingTag[0].length;
  return source.slice(start, end);
}

function assertPrivateAcl(functionSignature) {
  assert.ok(
    migration.includes('revoke all on function ' + functionSignature + ' from public, anon, authenticated, service_role;'),
    'missing private helper ACL revoke for ' + functionSignature
  );
  assert.ok(
    !migration.includes('grant execute on function ' + functionSignature + ' to anon, authenticated, service_role;'),
    'private helper must not be granted to API roles: ' + functionSignature
  );
}

function assertAcl(functionSignature) {
  assert.ok(
    migration.includes('revoke all on function ' + functionSignature + ' from public, anon, authenticated, service_role;'),
    'missing deny-by-default ACL for ' + functionSignature
  );
  assert.ok(
    migration.includes('grant execute on function ' + functionSignature + ' to anon, authenticated, service_role;'),
    'missing explicit API grants for ' + functionSignature
  );
}

const catalogFunctions = [
  ['pos_upsert_category', 'products'],
  ['pos_delete_category', 'products'],
  ['pos_upsert_product', 'products'],
  ['pos_delete_product', 'products+inventory'],
  ['pos_toggle_product_status', 'products'],
  ['pos_upsert_product_batch', 'inventory'],
  ['pos_delete_product_batch', 'inventory'],
  ['pos_migrate_local_product_catalog', 'products+inventory-if-batches']
];

const catalogSignatures = [
  'public.pos_upsert_category(text, text, text, text, jsonb, integer, text)',
  'public.pos_delete_category(text, text, text, text, text, integer, text)',
  'public.pos_upsert_product(text, text, text, text, jsonb, jsonb, integer, text)',
  'public.pos_delete_product(text, text, text, text, text, integer, text)',
  'public.pos_toggle_product_status(text, text, text, text, text, boolean, integer, text)',
  'public.pos_upsert_product_batch(text, text, text, text, jsonb, integer, text)',
  'public.pos_delete_product_batch(text, text, text, text, text, integer, text)',
  'public.pos_migrate_local_product_catalog(text, text, text, text, jsonb, jsonb, jsonb, text)'
];

const inventorySignatures = [
  'public.pos_add_inventory_entry(text, text, text, text, text, text, numeric, text, numeric, text, numeric, text, text, timestamptz, timestamptz, text, jsonb, text)',
  'public.pos_register_expiration_waste(text, text, text, text, text, numeric, text, text, text)',
  'public.pos_create_product_batch_from_parent_stock(text, text, text, text, text, timestamptz, numeric, text, text)',
  'public.pos_adjust_product_stock_without_batch_zero(text, text, text, text, text, text, text, text)'
];


const unlimitedAuthorities = [
  ['pos_upsert_category_unlimited', 'products'],
  ['pos_delete_category_unlimited', 'products'],
  ['pos_upsert_product_unlimited', 'products+inventory'],
  ['pos_delete_product_unlimited', 'products+inventory'],
  ['pos_toggle_product_status_unlimited', 'products'],
  ['pos_upsert_product_batch_unlimited', 'inventory'],
  ['pos_delete_product_batch_unlimited', 'inventory'],
  ['pos_migrate_local_product_catalog_unlimited', 'products+inventory-if-batches'],
  ['pos_register_expiration_waste_unlimited', 'inventory'],
  ['pos_create_product_batch_from_parent_stock_unlimited', 'inventory'],
  ['pos_adjust_product_stock_without_batch_zero_unlimited', 'inventory']
];

const unlimitedSignatures = [
  'public.pos_upsert_category_unlimited(text, text, text, text, jsonb, integer, text)',
  'public.pos_delete_category_unlimited(text, text, text, text, text, integer, text)',
  'public.pos_upsert_product_unlimited(text, text, text, text, jsonb, jsonb, integer, text)',
  'public.pos_delete_product_unlimited(text, text, text, text, text, integer, text)',
  'public.pos_toggle_product_status_unlimited(text, text, text, text, text, boolean, integer, text)',
  'public.pos_upsert_product_batch_unlimited(text, text, text, text, jsonb, integer, text)',
  'public.pos_delete_product_batch_unlimited(text, text, text, text, text, integer, text)',
  'public.pos_migrate_local_product_catalog_unlimited(text, text, text, text, jsonb, jsonb, jsonb, text)',
  'public.pos_register_expiration_waste_unlimited(text, text, text, text, text, numeric, text, text, text)',
  'public.pos_create_product_batch_from_parent_stock_unlimited(text, text, text, text, text, timestamp with time zone, numeric, text, text)',
  'public.pos_adjust_product_stock_without_batch_zero_unlimited(text, text, text, text, text, text, text, text)'
];

const closeoutRateLimitedFunctions = [
  'pos_register_expiration_waste',
  'pos_create_product_batch_from_parent_stock',
  'pos_adjust_product_stock_without_batch_zero'
];

test('R2D closeout moves exact authority to every unlimited mutation path', () => {
  for (const [name, requirement] of unlimitedAuthorities) {
    const fn = extractFunction(migration, 'create or replace function public.' + name + '(');
    assert.match(fn, /private\.validate_product_inventory_actor\(/u, name + ' must validate the current actor');
    assert.doesNotMatch(fn, /private\.validate_pos_sync_context\(/u, name + ' must not use the legacy context validator');
    assert.doesNotMatch(fn, /private\.assert_pos_products_write_permission\(v_context\)/u, name + ' must not retain legacy products authority');
    assert.doesNotMatch(fn, /private\.assert_pos_permission\(v_context,\s*'products'\s*\)/u, name + ' must not retain legacy products permission');
    if (requirement.includes('products')) assert.match(fn, /private\.assert_product_actor_authority\(v_context\)/u, name + ' must require products');
    if (requirement === 'inventory') assert.match(fn, /private\.assert_inventory_actor_authority\(v_context\)/u, name + ' must require inventory');
    if (requirement === 'products+inventory') {
      assert.match(fn, /private\.assert_product_actor_authority\(v_context\)/u, name + ' must require products');
      assert.match(fn, /private\.assert_inventory_actor_authority\(v_context\)/u, name + ' must require inventory');
    }
    if (requirement === 'products+inventory-if-batches') {
      assert.match(fn, /jsonb_array_length\(coalesce\(p_batches/u, name + ' must inspect migrated batches');
      assert.match(fn, /jsonb_array_elements\(coalesce\(p_products/u, name + ' must inspect migrated products');
      assert.match(fn, /product_item\.item->>'stock'/u, name + ' must detect migrated initial stock');
      assert.match(fn, /private\.assert_inventory_actor_authority\(v_context\)/u, name + ' must require inventory for combined payloads');
    }
    if (name === 'pos_upsert_product_unlimited') {
      assert.match(fn, /jsonb_array_length\(coalesce\(p_initial_batches/u);
      assert.match(fn, /existing\.deleted_at is null/u);
      assert.match(fn, /p_product->>'committedStock'/u);
    }
  }
  for (const signature of unlimitedSignatures) {
    assert.ok(migration.includes('revoke all on function ' + signature + ' from public, anon, authenticated, service_role;'), 'internal unlimited path must be deny-by-default: ' + signature);
    assert.ok(migration.includes('grant execute on function ' + signature + ' to service_role;'), 'service_role compatibility grant missing: ' + signature);
    assert.ok(!migration.includes('grant execute on function ' + signature + ' to anon, authenticated, service_role;'), 'unlimited path must not be public API: ' + signature);
  }
});

test('R2D closeout preserves the public rate-limit wrappers', () => {
  for (const name of closeoutRateLimitedFunctions) {
    const fn = extractFunction(migration, 'create or replace function public.' + name + '(');
    assert.match(fn, /enforce_pos_rpc_rate_limit_v2\(/u, name + ' must retain the rate limiter');
    assert.match(fn, new RegExp("p_rpc_name := '" + name + "'", 'u'));
    assert.match(fn, new RegExp('public\\.' + name + '_unlimited\\(', 'u'));
    assert.match(fn, /p_max_attempts := 120/u, name + ' must retain max attempts');
    assert.match(fn, /p_window_seconds := 600/u, name + ' must retain the rate window');
    assert.match(fn, /p_block_seconds := 300/u, name + ' must retain the block duration');
    assert.doesNotMatch(fn, /\b(?:insert into|update|delete from)\s+public\./iu, name + ' must remain a wrapper');
  }
});

test('R2D migration is forward-only and installs strict actor helpers', () => {
  assert.match(migration, /create or replace function private\.validate_product_inventory_actor\(/u);
  assert.match(migration, /public\.validate_pos_rpc_rate_limit_context\(/u);
  assert.match(migration, /create or replace function private\.has_product_inventory_permission\(/u);
  assert.match(migration, /jsonb_typeof\(coalesce\(p_context->'actor_permissions'/u);
  assert.match(migration, /create or replace function private\.assert_product_actor_authority\(/u);
  assert.match(migration, /create or replace function private\.assert_inventory_actor_authority\(/u);
  assert.doesNotMatch(migration, /private\.validate_pos_sync_context\(/u);
  assert.doesNotMatch(migration, /private\.assert_pos_permission\(v_context, 'pos'/u);
  assert.doesNotMatch(migration, /private\.assert_pos_products_write_permission\(v_context\)/u);
  for (const helper of [
    'private.has_product_inventory_permission(jsonb, text)',
    'private.validate_product_inventory_actor(text, text, text, text)',
    'private.assert_product_actor_authority(jsonb)',
    'private.assert_inventory_actor_authority(jsonb)'
  ]) assertPrivateAcl(helper);
  assert.match(migration, /notify pgrst, 'reload schema';/u);
});

test('catalog matrix has independent products/inventory authority with both-permission joins where needed', () => {
  for (const [name, requirement] of catalogFunctions) {
    const fn = extractFunction(migration, 'create or replace function public.' + name + '(');
    assert.match(fn, /private\.validate_product_inventory_actor\(/u, name + ' must use strict context');
    if (requirement.includes('products')) assert.match(fn, /private\.assert_product_actor_authority\(v_context\)/u, name + ' must require products');
    if (name === 'pos_upsert_product') {
      assert.match(fn, /existing\.deleted_at is null/u);
      assert.match(fn, /p_product->>'stock'/u);
      assert.match(fn, /p_product->>'committed_stock'/u);
      assert.match(fn, /private\.assert_inventory_actor_authority\(v_context\)/u);
    }
    if (requirement === 'inventory') assert.match(fn, /private\.assert_inventory_actor_authority\(v_context\)/u, name + ' must require inventory');
    if (requirement === 'products+inventory') {
      assert.match(fn, /private\.assert_product_actor_authority\(v_context\)/u);
      assert.match(fn, /private\.assert_inventory_actor_authority\(v_context\)/u);
    }
    if (requirement === 'products+inventory-if-batches') {
      assert.match(fn, /jsonb_array_length\(coalesce\(p_batches/u, name + ' must inspect migration batches');
      assert.match(fn, /jsonb_array_elements\(coalesce\(p_products/u, name + ' must inspect migrated products');
      assert.match(fn, /product_item\.item->>'stock'/u, name + ' must detect migrated initial stock');
      assert.match(fn, /private\.assert_inventory_actor_authority\(v_context\)/u);
    }
  }
  for (const signature of catalogSignatures) assertAcl(signature);
  for (const name of catalogFunctions.map((item) => item[0])) {
    assert.ok(migration.includes('alter function public.' + name + '('), 'legacy rename missing for ' + name);
    assert.ok(migration.includes('rename to ' + name + '_legacy_r2d;'), 'legacy target missing for ' + name);
  }
});

test('standalone inventory mutations require inventory and retain their historical bodies', () => {
  for (const name of [
    'pos_add_inventory_entry',
    'pos_register_expiration_waste',
    'pos_create_product_batch_from_parent_stock',
    'pos_adjust_product_stock_without_batch_zero'
  ]) {
    const fn = extractFunction(migration, 'create or replace function public.' + name + '(');
    assert.match(fn, /returns jsonb\s+language plpgsql\s+security definer\s+set search_path (?:=|to) ''/u, name + ' must remain hardened');
    if (name === 'pos_add_inventory_entry') {
      assert.match(fn, /private\.validate_product_inventory_actor\(/u, name + ' must use strict context');
      assert.match(fn, /private\.assert_inventory_actor_authority\(v_context\)/u, name + ' must require inventory');
    } else {
      assert.match(fn, /enforce_pos_rpc_rate_limit_v2\(/u, name + ' must retain its public rate limiter');
      assert.match(fn, new RegExp('public\\.' + name + '_unlimited\\(', 'u'));
      const unlimited = extractFunction(migration, 'create or replace function public.' + name + '_unlimited(');
      assert.match(unlimited, /private\.validate_product_inventory_actor\(/u, name + ' unlimited path must use strict context');
      assert.match(unlimited, /private\.assert_inventory_actor_authority\(v_context\)/u, name + ' unlimited path must require inventory');
    }
    assert.doesNotMatch(fn, /private\.validate_pos_sync_context\(/u);
    assert.doesNotMatch(fn, /private\.assert_pos_permission\(v_context, 'pos'/u);
    assert.doesNotMatch(fn, /private\.assert_pos_products_write_permission\(v_context\)/u);
  }
  for (const signature of inventorySignatures) assertAcl(signature);
});

test('client matrix captures actor provenance and fails closed during offline replay', () => {
  const authority = readProjectFile('src/services/auth/productInventoryAuthority.js');
  const repository = readProjectFile('src/services/products/productRepository.js');
  const cloud = readProjectFile('src/services/products/productCloudRepository.js');
  const inventoryEntry = readProjectFile('src/services/inventory/inventoryEntryService.js');
  const outbox = readProjectFile('src/services/sync/syncOutboxService.js');
  const replay = readProjectFile('src/services/products/productSyncHandler.js');

  assert.match(authority, /PRODUCT_PERMISSION = 'products'/u);
  assert.match(authority, /INVENTORY_PERMISSION = 'inventory'/u);
  assert.match(authority, /return \[PRODUCT_PERMISSION, INVENTORY_PERMISSION\]/u);
  assert.match(authority, /hasInitialProductStock/u);
  assert.match(authority, /operation\.actorSensitivity !== 'actor_bound'/u);
  assert.match(authority, /product_inventory_outbox_actor_context_stale/u);
  assert.match(repository, /actorSensitive: true/u);
  assert.match(repository, /originActor: actorOriginFromHandle\(actorHandle\)/u);
  assert.match(cloud, /assertProductInventoryMutationCurrent\(handle, requirements\)/u);
  assert.match(cloud, /hasInitialProductStock/u);
  assert.match(cloud, /isNewProduct = false/u);
  assert.match(inventoryEntry, /actorSensitive: true/u);
  assert.match(inventoryEntry, /originActor: actorOriginFromHandle\(actorHandle\)/u);
  assert.match(outbox, /LEGACY_ACTOR_BOUND_ENTITY_TYPES = new Set\(\[SYNC_ENTITY_TYPES\.SALE\]\)/u);
  assert.doesNotMatch(outbox, /ACTOR_SENSITIVE_ENTITY_TYPES/u, 'entity type alone must not classify historical R2D rows');
  assert.match(outbox, /actorOwnershipStatus === 'bound'/u);
  assert.match(replay, /assertProductInventoryOperationActorCurrent\(operation\)/u);
  assert.match(replay, /operation\.actorSensitivity === 'actor_bound'/u);
  assert.match(replay, /La operacion local no puede ejecutarse con el actor actual/u);
  assert.doesNotMatch(authority, /INVENTORY_MOVEMENT/u, 'sale-time inventory movements remain frozen outside R2D');
});

test('Staff products/inventory permission round-trip remains strict and transactional', () => {
  const r2c = readProjectFile('supabase/migrations/20260825233834_20260825232859_admin_staff_rbac_r2c_strict_ai_agent_boolean_authority.sql');
  const staffAdmin = readProjectFile('supabase/migrations/20260818165736_shared_terminal_legacy_admin_fail_closed.sql');
  const sqlTest = readProjectFile('supabase/tests/admin_staff_rbac_r2d_staff_permission_roundtrip_test.sql');
  const normalizer = extractFunction(r2c, 'create or replace function private.normalize_staff_permissions(');
  const updateImpl = extractFunction(staffAdmin, 'create or replace function private.admin_update_staff_user_impl(');

  assert.match(r2c, /'products', false/u);
  assert.match(r2c, /'inventory', false/u);
  assert.match(normalizer, /jsonb_typeof\(p_permissions -> v_key\) = 'boolean'/u);
  assert.match(normalizer, /'products'/u);
  assert.match(normalizer, /'inventory'/u);
  assert.match(updateImpl, /private\.normalize_staff_permissions\(p_permissions\)/u);
  assert.match(updateImpl, /permissions = v_new_permissions/u);
  for (const [products, inventory] of [
    ['true', 'false'],
    ['false', 'true'],
    ['true', 'true'],
    ['false', 'false']
  ]) {
    assert.ok(
      sqlTest.includes(`{"products":${products},"inventory":${inventory}`),
      `missing Staff round-trip case products=${products}, inventory=${inventory}`
    );
  }
  assert.match(sqlTest, /malformed values instead of truthifying them/u);
  assert.match(sqlTest, /begin;/u);
  assert.match(sqlTest, /rollback;/u);
});

test('UI and route matrix exposes products and inventory independently', () => {
  const app = readProjectFile('src/App.jsx');
  const navbar = readProjectFile('src/components/layout/Navbar.jsx');
  const page = readProjectFile('src/pages/ProductsPage.jsx');
  const list = readProjectFile('src/components/products/ProductList.jsx');
  const expiration = readProjectFile('src/components/dashboard/ExpirationAlert.jsx');

  assert.match(app, /PermissionRoute permission=\{\['products', 'inventory'\]\}/u);
  assert.match(navbar, /'\/productos': \['products', 'inventory'\]/u);
  assert.match(page, /canManageProducts = canAccess\('products'\)/u);
  assert.match(page, /canManageInventory = canAccess\('inventory'\)/u);
  assert.match(page, /activeTab === 'batches' && canManageInventory/u);
  assert.match(list, /canManageProducts = true, canManageInventory = true, canDeleteProducts = true/u);
  assert.match(list, /canManageInventory && \(/u);
  assert.match(list, /canDeleteProducts && \(/u);
  assert.match(expiration, /canAccess\('inventory'\) !== true/u);
  assert.match(expiration, /canManageInventory && item\.canCreateBatchFromStock/u);
});
