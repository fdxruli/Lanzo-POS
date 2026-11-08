import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');
const migration = read('supabase/migrations/20261108051235_lanzo_staff_credit_sales_permission_stage_5a.sql');
const packageJson = JSON.parse(read('package.json'));

test('legacy credit authority stays scoped to the current POS grant', () => {
  assert.match(migration, /'pos_credit_sales', true/u);
  assert.match(migration, /if p_permissions \? 'pos_credit_sales' then[\s\S]*?'false'::jsonb[\s\S]*?else[\s\S]*?v_result->'pos'/u);

  const guard = migration.slice(
    migration.indexOf('create or replace function private.assert_pos_credit_sale_permission'),
    migration.indexOf('$function$;', migration.indexOf('create or replace function private.assert_pos_credit_sale_permission'))
  );
  assert.match(guard, /if v_actor_type = 'admin' then\s+return;/u);
  assert.match(guard, /s\.id = v_staff_user_id\s+and s\.license_id = v_license_id\s+and s\.is_active is true[\s\S]*?for share/u);
  assert.match(guard, /private\.has_pos_permission\(v_current_context, 'pos'\)/u);
  assert.match(guard, /if v_current_permissions \? 'pos_credit_sales' then[\s\S]*?jsonb_typeof\(v_current_permissions->'pos_credit_sales'\) = 'boolean'[\s\S]*?is true/u);
  assert.match(guard, /POS_PERMISSION_DENIED:pos_credit_sales/u);
});

test('fresh debt is checked after completed and processing idempotency responses', () => {
  const authorizer = migration.slice(migration.indexOf('do $financial_authorizer$'));
  const completedCheck = authorizer.indexOf("position('idempotent_response' in v_definition)");
  const processingCheck = authorizer.indexOf("position('idempotency_processing' in v_definition)");
  const anchorCheck = authorizer.indexOf('position(v_anchor in v_definition)');
  const rewrite = authorizer.indexOf('v_definition := replace(v_definition, v_anchor, v_insertion || v_anchor)');

  assert.ok(completedCheck >= 0 && completedCheck < rewrite);
  assert.ok(processingCheck >= 0 && processingCheck < rewrite);
  assert.ok(anchorCheck >= 0 && anchorCheck < rewrite);
  assert.match(authorizer, /p_operation_type = 'sale\.credit' and v_total > v_payment_sum/u);
  assert.match(authorizer, /perform private\.assert_pos_credit_sale_permission\(v_context\)/u);
});

test('the migration is one focused forward-only permission change', () => {
  assert.equal((migration.match(/create or replace function/giu) || []).length, 1);
  assert.match(migration, /to_regprocedure\('private\.default_staff_permissions\(\)'\)/u);
  assert.match(migration, /to_regprocedure\('private\.normalize_staff_permissions\(jsonb\)'\)/u);
  assert.match(migration, /create or replace function private\.assert_pos_credit_sale_permission\(p_context jsonb\)/u);
  assert.match(migration, /revoke all on function private\.assert_pos_credit_sale_permission\(jsonb\)/u);
  assert.equal((migration.match(/private\.r2b_authorize_sale_financial_request_v1\(/giu) || []).length, 1);
  assert.doesNotMatch(migration, /\b(update|delete)\s+public\.(pos_sales|pos_customer_ledger|pos_cash_movements|pos_inventory_movements)/iu);
  assert.match(packageJson.scripts['test:staff-credit-sales-permission-5a'], /staff-credit-sales-permission-5a-contract\.node-test\.mjs/u);
});
