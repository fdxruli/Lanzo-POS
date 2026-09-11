import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../../supabase/migrations/20260910225909_ecommerce_phase3_catalog_stock_projection_sync_r1.sql', import.meta.url),
  'utf8'
);

test('projects only authoritative available stock into the reservation publication', () => {
  assert.match(migration, /create or replace function private\.ecommerce_sync_published_stock_projection\(/i);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /greatest\(v_product\.stock - v_product\.committed_stock, 0\)/i);
  assert.match(migration, /sum\(greatest\(b\.stock - b\.committed_stock, 0\)\)/i);
  assert.match(migration, /pp\.availability_source = 'direct'/i);
  assert.match(migration, /pp\.configuration_type <> 'variant_parent'/i);
  assert.match(migration, /v\.source_product_id = v_product\.id/i);
});

test('refreshes every committed-stock transition without widening client access', () => {
  assert.match(migration, /after update of committed_stock on public\.pos_products/i);
  assert.match(migration, /new\.committed_stock is distinct from old\.committed_stock/i);
  assert.match(migration, /perform private\.ecommerce_sync_published_stock_projection\(new\.license_id, new\.id\)/i);
  assert.match(migration, /revoke all on function private\.ecommerce_sync_published_stock_projection\(uuid, text\)[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant execute on all functions/i);
});

test('repairs only stale reservation-linked direct projections without hardcoded QA data', () => {
  assert.match(migration, /select distinct r\.license_id, r\.source_product_id[\s\S]*from public\.ecommerce_order_inventory_reservations/i);
  assert.match(migration, /pp\.availability_source = 'direct'/i);
  assert.match(migration, /never scans\s+or\s+-- rewrites the whole catalog/i);
  assert.doesNotMatch(migration, /1785550192911|100ecb9a-6319-4443-a4e8-c6feb562fac2|EC-0000015[3-6]/i);
  assert.doesNotMatch(migration, /delete\s+from|truncate\s+|update\s+public\.pos_products\s+set\s+stock\s*=/i);
});
