import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260910030440_ecommerce_phase3_stock_reservations.sql',
  import.meta.url
);

const migration = await readFile(migrationUrl, 'utf8');

test('phase 3 uses POS committed stock as the sole reservation source', () => {
  assert.match(migration, /public\.pos_products/);
  assert.match(migration, /stock\s*-\s*committed_stock/);
  assert.match(migration, /set\s+committed_stock\s*=\s+committed_stock\s*\+/i);
  assert.doesNotMatch(migration, /set\s+stock\s*=\s+stock\s*-/i);
});

test('phase 3 has terminal reservation states, audit and expiration', () => {
  for (const state of ['not_applicable', 'reserved', 'released', 'expired', 'consumed', 'failed']) {
    assert.match(migration, new RegExp(`'${state}'`));
  }
  assert.match(migration, /ecommerce_order_inventory_reservation_events/);
  assert.match(migration, /ecommerce_expire_abandoned_stock_reservations/);
  assert.match(migration, /for update skip locked/i);
});

test('phase 3 is tenant-scoped, variant-aware and denies direct client access', () => {
  assert.match(migration, /published_variant_id/);
  assert.match(migration, /v\.portal_id\s*=\s*new\.portal_id/);
  assert.match(migration, /v\.license_id\s*=\s*new\.license_id/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.ecommerce_order_inventory_reservations from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.ecommerce_expire_abandoned_stock_reservations/i);
});

test('phase 3 keeps Free as a server-side no-op and makes transitions idempotent', () => {
  assert.match(migration, /ecommerce_stock_reservation/);
  assert.match(migration, /if private\.ecommerce_reservation_feature_enabled\(v_order\.license_id\) is not true then\s+return;/i);
  assert.match(migration, /unique \(order_item_id, batch_id\)/i);
  assert.match(migration, /stock_reservation_status = 'reserved'/i);
  assert.match(migration, /stock_reservation_status = p_transition/i);
});
