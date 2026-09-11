import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260910075733_ecommerce_phase3_fulfillment_reservation_hold_r1.sql',
  import.meta.url
);
const migration = await readFile(migrationUrl, 'utf8');

test('separates checkout expiry from fulfillment stock retention', () => {
  assert.match(migration, /stock_reservation_phase.*checkout.*fulfillment/is);
  assert.match(migration, /fulfillment_hold_expires_at/i);
  assert.match(migration, /return least\(greatest\(v_minutes, 30\), 1440\)/i);
  assert.match(migration, /v_minutes integer := 120/i);
  assert.match(migration, /when 'fulfillment' then fulfillment_hold_expires_at <= now\(\)/i);
});

test('preserves expired reservation history while prohibiting duplicate active holds', () => {
  assert.match(migration, /drop constraint if exists ecommerce_order_inventory_reservations_scope_unique/i);
  assert.match(migration, /active_unbatched[\s\S]*status = 'reserved'/i);
  assert.match(migration, /active_batched[\s\S]*status = 'reserved'/i);
  assert.match(migration, /reservation_reactivated/i);
  assert.match(migration, /fromStatus', 'expired', 'toStatus', 'reserved'/i);
});

test('acceptance and revalidation are tenant-scoped, atomic and stock-safe', () => {
  assert.match(migration, /for update;/i);
  assert.match(migration, /private\.ecommerce_revalidate_order_stock_for_fulfillment/i);
  assert.match(migration, /ECOMMERCE_ACCEPT_RESERVATION_STOCK_UNAVAILABLE/i);
  assert.match(migration, /stock - committed_stock >= v_remaining/i);
  assert.match(migration, /committed_stock = greatest\(committed_stock - v_reservation\.quantity, 0\)/i);
  assert.match(migration, /order by source_product_id, coalesce\(batch_id, ''\), id/i);
});

test('requires an active fulfillment reservation for operations and consumption', () => {
  assert.match(migration, /ecommerce_require_fulfillment_reservation_trigger/i);
  assert.match(migration, /ECOMMERCE_FULFILLMENT_RESERVATION_REQUIRED/i);
  assert.match(migration, /p_transition = 'consumed'/i);
  assert.match(migration, /coalesce\(r\.reservation_phase, 'checkout'\) <> 'fulfillment'/i);
  assert.match(migration, /new\.fulfillment_status = 'cancelled'/i);
});

test('keeps private functions non-callable by browser roles', () => {
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function private\.ecommerce_expire_abandoned_stock_reservations\(\) from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function private\.ecommerce_revalidate_order_stock_for_fulfillment/i);
  assert.match(migration, /grant execute on function public\.ecommerce_admin_revalidate_order_stock[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function private\.[^\n]+to (?:anon|authenticated)/i);
});
