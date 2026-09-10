import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260910053018_ecommerce_phase3_reservation_expiry_scheduler_r1.sql',
  import.meta.url
);
const phase3MigrationUrl = new URL(
  '../../supabase/migrations/20260910030440_ecommerce_phase3_stock_reservations.sql',
  import.meta.url
);

const migration = await readFile(migrationUrl, 'utf8');
const phase3Migration = await readFile(phase3MigrationUrl, 'utf8');

test('scheduler enables pg_cron in pg_catalog and schedules only the private expiry function', () => {
  assert.match(migration, /create extension if not exists pg_cron with schema pg_catalog/i);
  assert.match(migration, /v_expected_name constant text := 'ecommerce-stock-reservation-expiry-v1'/i);
  assert.match(migration, /v_expected_schedule constant text := '\*\/5 \* \* \* \*'/i);
  assert.match(
    migration,
    /v_expected_command constant text := 'SELECT private\.ecommerce_expire_abandoned_stock_reservations\(\);'/i
  );
  assert.match(migration, /perform cron\.schedule\(/i);
  assert.doesNotMatch(migration, /perform private\.ecommerce_expire_abandoned_stock_reservations\(/i);
});

test('scheduler is idempotent and rejects duplicate or conflicting jobs', () => {
  assert.match(
    migration,
    /select count\(\*\)\s+into v_job_count\s+from cron\.job\s+where jobname = v_expected_name/is
  );
  assert.match(migration, /ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_DUPLICATE_JOB/);
  assert.match(migration, /ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_CONFLICT/);
  assert.match(migration, /ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_VERIFICATION_FAILED/);
  assert.match(migration, /for update/i);
});

test('scheduler requires a protected security-definer target and denies client execution', () => {
  assert.match(migration, /p\.prosecdef/);
  assert.match(migration, /current_user <> 'postgres'/);
  assert.match(migration, /revoke all on schema cron from public, anon, authenticated/i);
  assert.match(migration, /revoke all on all tables in schema cron from public, anon, authenticated/i);
  assert.match(migration, /revoke all on all functions in schema cron from public, anon, authenticated/i);
  assert.match(migration, /grant execute on all functions in schema cron to postgres/i);
  assert.match(migration, /ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_CLIENT_CRON_SCHEMA_ACCESS/);
  assert.match(migration, /ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_CLIENT_EXPIRY_FUNCTION_ACL/);
  assert.match(migration, /pg_catalog\.aclexplode/);
  assert.match(migration, /has_schema_privilege\('anon', 'cron', 'usage'\)/);
  assert.match(migration, /has_schema_privilege\('authenticated', 'cron', 'usage'\)/);
});

test('scheduler migration does not mutate business tables or physical inventory', () => {
  assert.doesNotMatch(migration, /\b(?:insert|update|delete)\s+(?:into\s+)?public\.(?:ecommerce_orders|ecommerce_order_inventory_reservations|pos_products|pos_product_batches)/i);
});

test('the existing expiry target remains private, locked, idempotent and search-path safe', () => {
  assert.match(
    phase3Migration,
    /create or replace function private\.ecommerce_expire_abandoned_stock_reservations\(\)[\s\S]*?security definer\s+set search_path = ''/i
  );
  assert.match(phase3Migration, /stock_reservation_status = 'reserved'/i);
  assert.match(phase3Migration, /stock_reservation_expires_at <= now\(\)/i);
  assert.match(phase3Migration, /for update skip locked/i);
  assert.match(phase3Migration, /greatest\(committed_stock - v_reservation\.quantity, 0\)/i);
  assert.match(phase3Migration, /status = p_transition/i);
  assert.match(
    phase3Migration,
    /revoke all on function private\.ecommerce_expire_abandoned_stock_reservations\(\) from public, anon, authenticated/i
  );
});
