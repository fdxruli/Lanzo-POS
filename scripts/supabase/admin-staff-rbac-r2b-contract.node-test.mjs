import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', '20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const mapper = fs.readFileSync(path.join(repoRoot, 'src', 'services', 'salesCloud', 'salesCloudCashierMapper.js'), 'utf8');
const service = fs.readFileSync(path.join(repoRoot, 'src', 'services', 'salesCloud', 'salesCloudCashierService.js'), 'utf8');

test('R2B migration keeps the public rate-limited boundary and server authority gate', () => {
  for (const marker of [
    'private.r2b_authorize_sale_financial_request_v1',
    'SALE_PRICE_MISMATCH',
    'MANUAL_ITEM_PRICE_POLICY_REQUIRED',
    'DISCOUNT_PERMISSION_REQUIRED',
    'r2bClientUnitCostIgnored',
    'r2b_finalize_inventory_costs_v1',
    'ECOMMERCE_CONVERSION_AUTHORITY_REQUIRED',
    'alter function public.pos_create_cloud_sale_cashier_unlimited',
    'pos_create_cloud_sale_cashier_legacy_r2b',
    'grant execute on function public.pos_create_cloud_sale_cashier_unlimited',
    'grant execute on function public.pos_create_cloud_sale_cashier_inventory_unlimited',
    'grant execute on function public.pos_create_cloud_sale_credit_unlimited'
  ]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(migration, /set search_path = ''/g);
  assert.doesNotMatch(migration, /grant execute on function public\.pos_create_cloud_sale_(?:cashier|cashier_inventory|credit)_unlimited[^;]* to (?:public|anon|authenticated)/i);
});

test('R2B mapper preserves product identity provenance for manual-item fail-closed handling', () => {
  assert.match(mapper, /const productIdSource = firstText\(item\.productId, item\.parentId\) \? 'explicit' : 'line_identity';/);
  assert.match(mapper, /productIdSource,/);
});

test('R2B client maps server rejection codes to actionable messages', () => {
  for (const code of [
    'SALE_PRICE_MISMATCH',
    'MANUAL_ITEM_PRICE_POLICY_REQUIRED',
    'DISCOUNT_PERMISSION_REQUIRED',
    'SALE_ARITHMETIC_MISMATCH',
    'IDEMPOTENCY_CONFLICT'
  ]) assert.match(service, new RegExp(`${code}:`));
});
