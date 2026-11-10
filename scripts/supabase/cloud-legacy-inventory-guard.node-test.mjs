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
  assert.ok(section.indexOf("if v_operation = 'sale.cashier' then") >= 0);
  assert.ok(section.indexOf('assert_legacy_cloud_sale_no_inventory_required_v1') < section.indexOf('pos_create_cloud_sale_cashier_legacy_r2b'));
  assert.match(section, /if v_authorized \? 'idempotent_response'/);
  assert.match(section, /private\.r2b_authorize_sale_financial_request_v1/);
  assert.match(section, /private\.r2b_finalize_inventory_costs_v1/);
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
