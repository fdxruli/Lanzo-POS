import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../supabase/migrations/20261110150000_cloud_legacy_inventory_guard_v1.sql', import.meta.url), 'utf8');

test('P1: el guard no decide con flags/snapshots del cliente', () => {
  assert.match(sql, /p\.license_id = p_license_id and p\.id = v_product_id/);
  assert.match(sql, /v_product\.track_stock is true/);
  assert.match(sql, /v_product\.recipe is not null/);
  assert.match(sql, /public\.pos_product_batches b/);
  assert.match(sql, /private\.rest_inv5_build_sale_inventory_requirements/);
  assert.doesNotMatch(sql.match(/create or replace function private\.assert_legacy_cloud_sale_no_inventory_required_v1[\s\S]*?\$guard\$;/i)?.[0] || '', /noCloudInventoryEffects|snapshotOnly/);
});

test('P1: cashier 6B es bloqueado antes de la hoja financiera, pero 6C conserva su ruta', () => {
  const section = sql.split('CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_cashier_unlimited')[1].split('CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_credit_unlimited')[0];
  assert.doesNotMatch(section, /if v_operation = 'sale\.cashier' then\s*perform private\.assert_legacy_cloud_sale_no_inventory_required_v1/);
  assert.match(section, /v_trusted_6c_scope := NULLIF/);
  assert.match(section, /v_trusted_6c_scope->>'license_id' is distinct from v_authorized->>'license_id'/);
  assert.match(section, /v_trusted_6c_scope->>'sale_id' is distinct from v_authorized->'sale'->>'id'/);
  assert.match(section, /v_trusted_6c_scope->>'idempotency_key' is distinct from v_authorized->>'idempotency_key'/);
  assert.ok(section.indexOf('assert_legacy_cloud_sale_no_inventory_required_v1') < section.indexOf('pos_create_cloud_sale_cashier_legacy_r2b'));
  assert.match(section, /if v_authorized \? 'idempotent_response'/);
  assert.match(section, /private\.r2b_authorize_sale_financial_request_v1/);
  assert.match(section, /private\.r2b_finalize_inventory_costs_v1/);
});

test('P1: 6C crea una marca interna por tenant, venta e idempotencia y la restaura', () => {
  const section = sql.split('CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_cashier_inventory_legacy_r2b')[1];
  const scope = section.indexOf("pg_catalog.set_config(\n      'lanzo.inventory_6c_core_scope_v1'");
  const core = section.indexOf('v_core_response := public.pos_create_cloud_sale_cashier_unlimited(');
  const restore = section.lastIndexOf("pg_catalog.set_config(\n      'lanzo.inventory_6c_core_scope_v1'");
  assert.ok(scope >= 0 && core > scope && restore > core);
  assert.match(section, /'license_id', v_license_id/);
  assert.match(section, /'sale_id', v_sale_id/);
  assert.match(section, /'idempotency_key', v_core_idempotency_key/);
  assert.match(section, /private\.apply_sale_inventory_effects/);
});
test('P1: SQL usa NULLIF real y comprueba el hash del motor 6C', () => {
  assert.doesNotMatch(sql, /pg_catalog\.nullif\s*\(/i);
  assert.match(sql, /NULLIF\(pg_catalog\.btrim\(v_norm->>'product_id'\)/);
  assert.match(sql, /eb42c825c1e43b2c00ba53c74c899ae7/);
});
test('P1: crédito sin inventario evita un commit sin stock obligatorio', () => {
  const section = sql.split('CREATE OR REPLACE FUNCTION public.pos_create_cloud_sale_credit_unlimited')[1];
  assert.match(section, /cloud_sales_inventory/);
  assert.match(section, /cloud_products_sync/);
  assert.match(section, /inventory_effect_status/);
  assert.match(section, /assert_legacy_cloud_sale_no_inventory_required_v1/);
  assert.match(section, /private\.r2b_finalize_inventory_costs_v1/);
});

test('P1: migración revierte por drift y no cambia ACL públicas', () => {
  assert.match(sql, /CLOUD_LEGACY_GUARD_DEPENDENCY_DRIFT/);
  assert.match(sql, /revoke all on function private\.assert_legacy_cloud_sale_no_inventory_required_v1/);
  assert.doesNotMatch(sql, /grant execute on function public\./i);
  assert.doesNotMatch(sql, /alter table|drop function|truncate|delete from public\.pos_/i);
});
